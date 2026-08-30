// POST /api/upload  (F5)
// Rele de subida: el celular NUNCA toca credenciales de Google.
// FormData: file (JPEG <= 3,5 MB), thumb (JPEG ~400 px), slug, caption?,
// width?, height?, sizeBytes?  -> valida, rate limit por evento+IP,
// refresca el token de Drive, subida resumable a la carpeta del evento,
// thumbnail a Storage publico thumbs/{eventId}/{photoId}.jpg y fila en
// photos (drive_file_id UNIQUE). Responde {photoId, thumbUrl, createdAt}.
// Body binario directo (nunca base64).
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getDriveClient, DriveError } from "@/lib/drive";
import { checkRateLimit } from "@/lib/ratelimit";
import {
  MAX_UPLOAD_BYTES,
  UploadError,
  uploadPhotoToDrive,
  deleteDriveFile,
  uploadThumbToStorage,
  insertPhotoRow,
  markDriveFull,
} from "@/lib/upload";

const GUEST_COOKIE = "guest_id";
const GUEST_MAX_AGE = 60 * 60 * 24 * 365; // 1 ano
const MAX_THUMB_BYTES = 1024 * 1024; // 1 MB de saneamiento (normal ~50-150 KB)
const MAX_CAPTION = 500;

// Limites T5.1: 10 subidas/min por invitado+IP y 120/min por evento
// Vercel Hobby: max 60 s por funcion (por defecto 10 s). Esta ruta hace
// validacion + rate limit + refresh token + upload resumable a Drive +
// thumbnail a Storage + insert, con reintentos y backoff: necesita el maximo.
export const maxDuration = 60;

const LIMITS = {
  guestWindowSec: 60,
  guestMax: 10,
  eventWindowSec: 60,
  eventMax: 120,
};

type EventPublic = {
  slug: string;
  title: string;
  owner_names: string[];
  message: string | null;
  welcome_photo_url: string | null;
  theme_key: string;
  theme_variant: string;
  status: string;
  created_at: string;
};

function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** Duck-typing de File: evita depender de `instanceof File` (Node 18 vs 20). */
function isFileLike(v: FormDataEntryValue | null): v is File {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as File).arrayBuffer === "function" &&
    typeof (v as File).name === "string"
  );
}

/** Limpia el pie de foto: quita HTML y caracteres de control (anti-XSS). */
function sanitizeCaption(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, 500);
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function POST(request: Request) {
  // ---------- 1. FormData + validacion basica ----------
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Se esperaba un cuerpo multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const thumb = form.get("thumb");
  const slug = (form.get("slug") as string | null)?.trim() ?? "";
  const caption = sanitizeCaption(form.get("caption"));
  const rawWidth = form.get("width");
  const rawHeight = form.get("height");
  const rawSize = form.get("sizeBytes");

  if (!isFileLike(file) || !isFileLike(thumb)) {
    return NextResponse.json({ error: "file y thumb son obligatorios" }, { status: 400 });
  }
  if (!/^[a-z0-9_-]{8,32}$/.test(slug)) {
    return NextResponse.json({ error: "slug invalido" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "El archivo debe ser una imagen" }, { status: 415 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "La foto supera los 3,5 MB" }, { status: 413 });
  }
  if (thumb.size > MAX_THUMB_BYTES) {
    return NextResponse.json({ error: "El thumbnail supera 1 MB" }, { status: 413 });
  }
  if (caption.length > MAX_CAPTION) {
    return NextResponse.json({ error: "El mensaje supera los 500 caracteres" }, { status: 400 });
  }
  const width = rawWidth ? Number(rawWidth) : null;
  const height = rawHeight ? Number(rawHeight) : null;
  const sizeBytes = rawSize ? Number(rawSize) : file.size;

  // ---------- 2. Evento por slug (get_event_public, sin RLS) ----------
  const admin = createAdminClient();
  const { data: event, error: eventError } = await admin.rpc("get_event_public", {
    p_slug: slug,
  });
  if (eventError) {
    console.error("[upload] get_event_public error:", eventError.message);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  const evt = event as EventPublic | null;
  if (!evt) {
    return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });
  }
  if (evt.status === "closed") {
    return NextResponse.json({ error: "Evento cerrado" }, { status: 403 });
  }
  const eventMeta = await getEventMetaBySlug(slug);
  if (!eventMeta) {
    return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 });
  }
  const eventId = eventMeta.id;

  // Limite opcional de fotos por evento (P4: events.max_photos)
  if (typeof eventMeta.maxPhotos === "number" && eventMeta.maxPhotos > 0) {
    const { count, error: countError } = await admin
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);
    if (countError) {
      console.error("[upload] count photos error:", countError.message);
    } else if ((count ?? 0) >= eventMeta.maxPhotos) {
      return NextResponse.json(
        { error: "Se alcanzo el limite de fotos de este evento." },
        { status: 403 }
      );
    }
  }

  // ---------- 3. Rate limit por evento+IP (ventana deslizante) ----------
  const ip = getClientIp(request);
  const guestLimit = await checkRateLimit({
    key: `upload:${eventId}:${ip}`,
    max: LIMITS.guestMax,
    windowSec: LIMITS.guestWindowSec,
  });
  if (!guestLimit.allowed) {
    return NextResponse.json(
      { error: "Demasiadas subidas. Espera un momento e intenta de nuevo." },
      { status: 429, headers: { "Retry-After": String(guestLimit.retryAfterSec) } }
    );
  }
  const eventLimit = await checkRateLimit({
    key: `upload:${eventId}`,
    max: LIMITS.eventMax,
    windowSec: LIMITS.eventWindowSec,
  });
  if (!eventLimit.allowed) {
    return NextResponse.json(
      { error: "El evento esta recibiendo muchas fotos. Intenta en unos segundos." },
      { status: 429, headers: { "Retry-After": String(eventLimit.retryAfterSec) } }
    );
  }

  // ---------- 4. guest_id (cookie anonima, P3) ----------
  const cookies = parseCookies(request.headers.get("cookie"));
  let guestId = cookies[GUEST_COOKIE];
  const isNewGuest = !guestId;
  if (!guestId) guestId = crypto.randomUUID();

  // ---------- 5. Cliente de Drive (refresca token si falta <5 min) ----------
  let driveClient;
  try {
    driveClient = await getDriveClient(eventId);
  } catch (e) {
    if (e instanceof DriveError && e.reason === "invalid_grant") {
      return NextResponse.json(
        { error: "El evento no acepta fotos por ahora (Drive necesita reconectarse)." },
        { status: 503, headers: { "X-Drive-Needs-Reconnect": "1" } }
      );
    }
    if (e instanceof DriveError && e.reason === "not_connected") {
      return NextResponse.json(
        { error: "El organizador aun no conecta Google Drive." },
        { status: 503 }
      );
    }
    console.error("[upload] getDriveClient error:", (e as Error).message);
    return NextResponse.json({ error: "Error temporal al conectar con Drive." }, { status: 503 });
  }

  // ---------- 6. Subida resumable a Drive ----------
  const photoId = crypto.randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  let driveFileId: string;
  try {
    driveFileId = await uploadPhotoToDrive(
      driveClient,
      driveClient.folderId,
      photoId,
      buffer
    );
  } catch (e) {
    if (e instanceof DriveError && e.reason === "storageQuotaExceeded") {
      await markDriveFull(eventId);
      return NextResponse.json(
        { error: "El Drive del organizador esta lleno. No se pueden subir mas fotos por ahora." },
        { status: 507 }
      );
    }
    if (e instanceof DriveError && e.reason === "userRateLimitExceeded") {
      return NextResponse.json(
        { error: "Google Drive esta saturado. Intenta de nuevo en un momento." },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    console.error("[upload] drive upload error:", (e as Error).message);
    return NextResponse.json(
      { error: "No se pudo subir la foto. Intenta de nuevo." },
      { status: 503 }
    );
  }

  // ---------- 7. Thumbnail a Storage publico ----------
  let thumbUrl: string;
  try {
    const thumbBuffer = Buffer.from(await thumb.arrayBuffer());
    thumbUrl = await uploadThumbToStorage(eventId, photoId, thumbBuffer);
  } catch (e) {
    // Limpiar el original de Drive para no dejar huerfanos
    await deleteDriveFile(driveClient.accessToken, driveFileId);
    const message =
      e instanceof UploadError ? e.message : "No se pudo guardar el thumbnail.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // ---------- 8. Fila en photos (fuente de verdad del feed) ----------
  const createdAt = new Date().toISOString();
  try {
    await insertPhotoRow({
      id: photoId,
      eventId,
      driveFileId,
      thumbUrl,
      caption: caption || null,
      guestId,
      width,
      height,
      sizeBytes,
    });
  } catch (e) {
    await deleteDriveFile(driveClient.accessToken, driveFileId);
    const message = e instanceof UploadError ? e.message : "Error al guardar la foto.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // ---------- 9. Respuesta + cookie del invitado ----------
  // guestId se devuelve para que el cliente lo adopte como identidad
  // unica (F8): la cookie httpOnly es la fuente autoritativa; el body
  // es bootstrap para likes/comentarios (lib/feed-client).
  const res = NextResponse.json({ photoId, thumbUrl, createdAt, guestId }, { status: 200 });
  if (isNewGuest) {
    res.cookies.set(GUEST_COOKIE, guestId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GUEST_MAX_AGE,
    });
  }
  return res;
}

/** Resuelve el uuid y el limite opcional de fotos desde el slug (solo backend). */
async function getEventMetaBySlug(
  slug: string
): Promise<{ id: string; maxPhotos: number | null } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("events")
    .select("id, max_photos")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error("[upload] getEventMetaBySlug error:", error.message);
    return null;
  }
  const row = data as { id: string; max_photos: number | null } | null;
  return row ? { id: row.id, maxPhotos: row.max_photos ?? null } : null;
}

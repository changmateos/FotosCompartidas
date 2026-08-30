// Subida de fotos (F5): resumable a Google Drive con reintentos
// idempotentes (backoff exponencial + jitter, respetando Retry-After),
// thumbnail a Supabase Storage publico y fila en photos (la BD es la
// fuente de verdad del feed; la fila se inserta SOLO tras confirmar
// el fileId de Drive). Solo servidor.
import "server-only";
import { createAdminClient } from "@/lib/supabase-admin";
import { DriveError, type DriveClient } from "@/lib/drive";

const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const MAX_RETRIES = 4;

export const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024; // margen sobre 4,5 MB de Vercel

export class UploadError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_connected"
      | "needs_reconnect"
      | "drive_full"
      | "drive_rate_limited"
      | "drive_error"
      | "storage_error"
      | "db_error"
      | "invalid"
  ) {
    super(message);
    this.name = "UploadError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const base = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s, 4s
  const jitter = Math.random() * base * 0.3;
  return Math.round(base + jitter);
}

// ---------- Resumable upload a Drive ----------

async function createResumableSession(
  accessToken: string,
  fileName: string,
  folderId: string,
  contentLength: number
): Promise<string> {
  const res = await fetch(
    `${DRIVE_UPLOAD_URL}?uploadType=resumable`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "image/jpeg",
        "X-Upload-Content-Length": String(contentLength),
      },
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
      }),
    }
  );

  if (!res.ok) {
    throw await driveErrorFrom(res);
  }
  const location = res.headers.get("location");
  if (!location) {
    throw new DriveError("Google no devolvio la URI de subida resumable", 500);
  }
  return location;
}

async function putFullBody(
  accessToken: string,
  uploadUri: string,
  buffer: Buffer
): Promise<string> {
  const res = await fetch(uploadUri, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "image/jpeg",
      "Content-Length": String(buffer.length),
    },
    body: new Uint8Array(buffer),
  });

  if (!res.ok) {
    throw await driveErrorFrom(res);
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string };
  if (!json.id) {
    throw new DriveError("Drive no devolvio fileId tras el PUT", 500);
  }
  return json.id;
}

async function driveErrorFrom(res: Response): Promise<DriveError> {
  let reason: string | undefined;
  let retryAfter: number | undefined;
  try {
    const j = (await res.json()) as {
      error?: { code?: number; message?: string; errors?: { reason?: string }[] };
    };
    reason = j.error?.errors?.[0]?.reason ?? j.error?.message ?? undefined;
  } catch {
    // cuerpo no JSON
  }
  if (res.status === 429) {
    retryAfter = Number(res.headers.get("retry-after") ?? 1) || 1;
  }
  return new DriveError(
    `Drive upload ${res.status} ${reason ?? ""}`.trim(),
    res.status,
    reason,
    retryAfter
  );
}

/**
 * Sube el JPEG (body completo, 2-4 MB) a la carpeta del evento con
 * subida resumable. Reintentos idempotentes: ante 429/5xx (y 403
 * userRateLimitExceeded) espera Retry-After o backoff con jitter y
 * vuelve a crear la sesion; la foto no se duplica porque la fila de
 * photos se inserta DESPUES de confirmar el fileId.
 * Devuelve el fileId de Drive.
 */
export async function uploadPhotoToDrive(
  client: DriveClient,
  folderId: string,
  photoId: string,
  buffer: Buffer
): Promise<string> {
  const fileName = `foto-${photoId}.jpg`;
  let lastError: unknown = new DriveError("upload fallido", 500);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const uploadUri = await createResumableSession(
        client.accessToken,
        fileName,
        folderId,
        buffer.length
      );
      return await putFullBody(client.accessToken, uploadUri, buffer);
    } catch (e) {
      lastError = e;
      if (e instanceof DriveError) {
        const retriable =
          e.status === 429 ||
          (e.status === 403 && e.reason === "userRateLimitExceeded") ||
          (e.status ?? 0) >= 500;
        if (!retriable) throw e; // 4xx definitivo (storageQuotaExceeded, etc.)
        const waitMs = e.retryAfterSec
          ? e.retryAfterSec * 1000
          : backoffMs(attempt);
        await sleep(waitMs);
        continue;
      }
      // Error de red: reintentar con backoff
      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}

/** Mejor esfuerzo: borra de Drive un archivo ya creado si fallo el resto. */
export async function deleteDriveFile(
  accessToken: string,
  fileId: string
): Promise<void> {
  try {
    await fetch(`${DRIVE_FILES_URL}/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // cleanup best-effort
  }
}

// ---------- Thumbnail en Supabase Storage ----------

export const THUMBS_BUCKET = "thumbs";
export const THUMBS_CACHE = "public, max-age=31536000, immutable";

export function thumbStoragePath(eventId: string, photoId: string): string {
  return `${eventId}/${photoId}.jpg`;
}

export function publicThumbUrl(eventId: string, photoId: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new UploadError("Falta NEXT_PUBLIC_SUPABASE_URL", "db_error");
  return `${base}/storage/v1/object/public/${THUMBS_BUCKET}/${thumbStoragePath(eventId, photoId)}`;
}

/** Sube el thumbnail a Storage publico (bucket "thumbs", cache 1 ano). */
export async function uploadThumbToStorage(
  eventId: string,
  photoId: string,
  thumbBuffer: Buffer,
  contentType = "image/jpeg"
): Promise<string> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(THUMBS_BUCKET).upload(
    thumbStoragePath(eventId, photoId),
    thumbBuffer,
    {
      contentType,
      cacheControl: THUMBS_CACHE,
      upsert: true,
    }
  );
  if (error) {
    console.error("[upload] storage error:", error.message);
    throw new UploadError("No se pudo guardar el thumbnail", "storage_error");
  }
  return publicThumbUrl(eventId, photoId);
}

// ---------- Fila en photos ----------

export type PhotoRowInput = {
  id: string;
  eventId: string;
  driveFileId: string;
  thumbUrl: string;
  caption: string | null;
  guestId: string;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
};

export async function insertPhotoRow(input: PhotoRowInput): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("photos").insert({
    id: input.id,
    event_id: input.eventId,
    drive_file_id: input.driveFileId,
    thumb_url: input.thumbUrl,
    caption: input.caption ?? null,
    guest_id: input.guestId,
    width: input.width ?? null,
    height: input.height ?? null,
    size_bytes: input.sizeBytes ?? null,
  });
  if (error) {
    console.error("[upload] photos insert error:", error.message);
    throw new UploadError("No se pudo guardar la foto en la base de datos", "db_error");
  }
}

// ---------- Marcas de estado en events ----------

export async function markDriveFull(eventId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("events")
    .update({ drive_full: true })
    .eq("id", eventId);
  if (error) {
    console.error("[upload] markDriveFull error:", error.message);
  }
}

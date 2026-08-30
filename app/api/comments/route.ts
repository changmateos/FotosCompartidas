// POST /api/comments (F6, T6.3): crea un comentario de un invitado
// anonimo (guest_id) via RPC add_comment (SECURITY DEFINER: valida
// foto existente, evento activo y texto 1-500; mantiene
// photos.comment_count). El texto se renderiza como texto plano en
// el cliente (React escapa HTML). Rate limit por IP (fail-open).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { checkRateLimit } from "@/lib/ratelimit";
import { isValidGuestId } from "@/lib/feed-client";

const MAX_COMMENT_LENGTH = 500;

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

const GUEST_COOKIE = "guest_id";
const GUEST_MAX_AGE = 60 * 60 * 24 * 365; // 1 ano

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return null;
}

/** Limpia el texto: quita etiquetas HTML y caracteres de control. */
function sanitizeText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]*>/g, "") // nada de HTML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
}

export async function POST(request: Request) {
  let body: { photoId?: unknown; guestId?: unknown; text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON invalido." }, { status: 400 });
  }

  const photoId = typeof body.photoId === "string" ? body.photoId : "";
  // Cookie guest_id autoritativa (la setea /api/upload); el body solo
  // para el primer contacto, persistiendose como cookie.
  const cookieGuest = readCookie(request.headers.get("cookie"), GUEST_COOKIE);
  const bodyGuest = typeof body.guestId === "string" ? body.guestId : "";
  const guestId = isValidGuestId(cookieGuest ?? "") ? (cookieGuest as string) : bodyGuest;
  const isNewGuest = !isValidGuestId(cookieGuest ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(photoId)) {
    return NextResponse.json({ error: "photoId invalido." }, { status: 400 });
  }
  if (!isValidGuestId(guestId)) {
    return NextResponse.json({ error: "guestId invalido." }, { status: 400 });
  }

  const text = sanitizeText(body.text);
  if (!text) {
    return NextResponse.json({ error: "Escribe un comentario (1 a 500 caracteres)." }, { status: 400 });
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    return NextResponse.json({ error: "El comentario supera los 500 caracteres." }, { status: 400 });
  }

  // Rate limit: max 5 comentarios/min por IP (T6.3)
  const limit = await checkRateLimit({ key: "comment:" + clientIp(request), max: 5, windowSec: 60 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Demasiados comentarios. Intenta en unos segundos." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_comment", {
    p_photo_id: photoId,
    p_guest_id: guestId,
    p_text: text,
  });

  if (error) {
    const message = error.message ?? "";
    if (/photo_not_found/i.test(message)) {
      return NextResponse.json({ error: "Foto no encontrada." }, { status: 404 });
    }
    if (/event_closed/i.test(message)) {
      return NextResponse.json({ error: "El evento esta cerrado." }, { status: 403 });
    }
    if (/invalid_comment_length/i.test(message)) {
      return NextResponse.json({ error: "El comentario debe tener entre 1 y 500 caracteres." }, { status: 400 });
    }
    console.error("[comments] add_comment error:", message);
    return NextResponse.json({ error: "No se pudo publicar el comentario." }, { status: 500 });
  }

  const comment = (Array.isArray(data) ? data[0] : data) as
    | { id: string; photo_id: string; guest_id: string; text: string; created_at: string }
    | null;
  if (!comment) {
    return NextResponse.json({ error: "No se pudo publicar el comentario." }, { status: 500 });
  }
  const res = NextResponse.json({ comment }, { status: 201 });
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

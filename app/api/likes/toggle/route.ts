// POST /api/likes/toggle (F6, T6.2): alterna el like de un invitado
// anonimo (guest_id de cookie) via RPC toggle_like (SECURITY DEFINER,
// mantiene photos.like_count). Rate limit ligero por IP (tabla
// rate_limits, fail-open).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { checkRateLimit } from "@/lib/ratelimit";
import { isValidGuestId } from "@/lib/feed-client";

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

export async function POST(request: Request) {
  let body: { photoId?: unknown; guestId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON invalido." }, { status: 400 });
  }

  const photoId = typeof body.photoId === "string" ? body.photoId : "";
  // La cookie guest_id (httpOnly, la setea /api/upload) es la fuente
  // autoritativa; el body solo se usa para el primer contacto y se
  // persiste como cookie para mantener UNA identidad por navegador.
  const cookieGuest = readCookie(request.headers.get("cookie"), GUEST_COOKIE);
  const bodyGuest = typeof body.guestId === "string" ? body.guestId : "";
  const guestId = isValidGuestId(cookieGuest ?? "") ? (cookieGuest as string) : bodyGuest;
  const isNewGuest = !isValidGuestId(cookieGuest ?? "");
  if (!UUID_PHOTO_RE.test(photoId)) {
    return NextResponse.json({ error: "photoId invalido." }, { status: 400 });
  }
  if (!isValidGuestId(guestId)) {
    return NextResponse.json({ error: "guestId invalido." }, { status: 400 });
  }

  // Rate limit ligero: max 30 toggles/min por IP (fail-open)
  const limit = await checkRateLimit({ key: "like:" + clientIp(request), max: 30, windowSec: 60 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta en unos segundos." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("toggle_like", {
    p_photo_id: photoId,
    p_guest_id: guestId,
  });

  if (error) {
    const message = error.message ?? "";
    if (/photo_not_found/i.test(message)) {
      return NextResponse.json({ error: "Foto no encontrada." }, { status: 404 });
    }
    if (/event_closed/i.test(message)) {
      return NextResponse.json({ error: "El evento esta cerrado." }, { status: 403 });
    }
    console.error("[likes] toggle_like error:", message);
    return NextResponse.json({ error: "No se pudo registrar el like." }, { status: 500 });
  }

  const row = Array.isArray(data) ? (data[0] as { liked?: boolean; count?: number } | undefined) : undefined;
  const res = NextResponse.json({ liked: Boolean(row?.liked), count: Number(row?.count ?? 0) });
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

const UUID_PHOTO_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
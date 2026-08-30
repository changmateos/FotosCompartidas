// GET /api/guest (hallazgo F8): unica fuente de la identidad anonima
// del invitado (P3). Lee la cookie httpOnly guest_id; si no existe la
// crea (UUID v4, 1 ano) y la devuelve en el body SOLO para bootstrap
// del cliente (el valor autoritativo queda en la cookie, invisible a
// JS). Asi subidas + likes + comentarios usan UNA identidad por
// navegador, sin divergencia con localStorage.
import crypto from "node:crypto";
import { NextResponse } from "next/server";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const existing = readCookie(request.headers.get("cookie"), GUEST_COOKIE);
  const guestId =
    existing && UUID_RE.test(existing) ? existing : crypto.randomUUID();

  const res = NextResponse.json({ guestId });
  res.cookies.set(GUEST_COOKIE, guestId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_MAX_AGE,
  });
  return res;
}

// ============================================================
// Capa de datos del FEED en el CLIENTE (F6).
// El feed NUNCA lee Google Drive: solo Supabase (tablas con
// policies publicas de 0009 + RPC get_event_id_by_slug de 0010)
// y thumbnails desde Storage publico.
// Este modulo es SOLO para componentes cliente ("use client").
// ============================================================

import { createClient } from "@/lib/supabase";

export const FEED_PAGE_SIZE = 30;
export const POLL_INTERVAL_MS = 9000; // fallback a polling 8-10 s (P2)
export const REALTIME_FALLBACK_MS = 8000; // si no llega push en 8 s -> polling

export type FeedPhoto = {
  id: string;
  thumb_url: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  like_count: number;
  comment_count: number;
  created_at: string;
};

export type FeedCursor = { created_at: string; id: string } | null;

export type FeedPage = {
  photos: FeedPhoto[];
  cursor: FeedCursor;
};

// ------------------------------------------------------------------
// Identidad anonima del invitado (P3, hallazgo F8 unificado): la
// UNICA fuente es la cookie httpOnly guest_id que gestiona el
// servidor (GET /api/guest la crea si falta y la devuelve solo como
// bootstrap). El cliente cachea ese id en localStorage y SIEMPRE lo
// usa para likes/comentarios; asi subidas + likes + comentarios
// comparten UNA identidad por navegador. El servidor valida UUID.
// ------------------------------------------------------------------

function uuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback manual (sin contexto seguro)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let resolvedGuestId: string | null = null;

/** Resuelve (async) el guest_id unico: cookie httpOnly del servidor. */
export async function getGuestId(): Promise<string> {
  if (typeof window === "undefined") return "";
  if (resolvedGuestId) return resolvedGuestId;

  // Cache local (mismo navegador) para no llamar /api/guest siempre
  try {
    const cached = window.localStorage.getItem("pme_guest_id");
    if (cached && UUID_RE.test(cached)) {
      resolvedGuestId = cached;
      return cached;
    }
    const res = await fetch("/api/guest", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { guestId?: string };
      if (data.guestId && UUID_RE.test(data.guestId)) {
        resolvedGuestId = data.guestId;
        window.localStorage.setItem("pme_guest_id", data.guestId);
        return data.guestId;
      }
    }
  } catch {
    // offline: fallback local; la proxima llamada reintenta /api/guest
  }

  const id = uuidV4();
  resolvedGuestId = id;
  try {
    // Safari (modo privado) lanza SecurityError/QuotaExceededError en
    // localStorage.setItem; no debe romper el feed (error boundary).
    window.localStorage.setItem("pme_guest_id", id);
  } catch {
    // sin storage local: el id vive en memoria por esta sesion
  }
  return id;
}

// ------------------------------------------------------------------
// Supabase (anon key + policies publicas)
// ------------------------------------------------------------------

export function getSupabase() {
  return createClient();
}

/** Resuelve el id del evento desde el slug (RPC 0010). */
export async function resolveEventId(slug: string): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("get_event_id_by_slug", { p_slug: slug });
  if (error || !data) return null;
  return String(data);
}

/**
 * Primera pagina del feed por REST directo con If-None-Match (ETag):
 * si no hubo cambios devuelve { changed: false } (304). La paginacion
 * es por cursor (created_at, id) (keyset, orden nuevo primero).
 */
export async function fetchPhotosPage(
  eventId: string,
  opts: { cursor?: FeedCursor; limit?: number; etag?: string | null } = {},
): Promise<{ photos: FeedPhoto[]; etag: string | null; changed: boolean; cursor: FeedCursor }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { photos: [], etag: null, changed: false, cursor: null };

  const limit = opts.limit ?? FEED_PAGE_SIZE;
  const params = new URLSearchParams({
    select: "id,thumb_url,caption,width,height,like_count,comment_count,created_at",
    event_id: "eq." + eventId,
    order: "created_at.desc,id.desc",
    limit: String(limit),
  });
  if (opts.cursor) {
    // keyset: (created_at, id) < (cursor.created_at, cursor.id)
    params.set(
      "or",
      "(created_at.lt." + opts.cursor.created_at + ",and(created_at.eq." + opts.cursor.created_at + ",id.lt." + opts.cursor.id + "))",
    );
  }

  const headers: Record<string, string> = {
    apikey: anonKey,
    Authorization: "Bearer " + anonKey,
    Accept: "application/json",
  };
  if (opts.etag) headers["If-None-Match"] = opts.etag;

  const res = await fetch(url + "/rest/v1/photos?" + params.toString(), { headers });
  if (res.status === 304) {
    return { photos: [], etag: opts.etag ?? null, changed: false, cursor: opts.cursor ?? null };
  }
  if (!res.ok) {
    throw new Error("No se pudo cargar el feed (" + res.status + ").");
  }
  const etag = res.headers.get("etag");
  const rows = (await res.json()) as FeedPhoto[];
  const photos = rows.filter((r) => r && typeof r.id === "string");
  const last = photos[photos.length - 1];
  const cursor: FeedCursor = photos.length >= limit && last ? { created_at: last.created_at, id: last.id } : null;
  return { photos, etag, changed: true, cursor };
}

/** Comentarios de una foto (orden mas viejos primero). */
export async function fetchComments(photoId: string): Promise<CommentPhoto[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("comments")
    .select("id, photo_id, guest_id, text, created_at")
    .eq("photo_id", photoId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[feed] comments error:", error.message);
    return [];
  }
  return (data ?? []) as unknown as CommentPhoto[];
}

/** Fotos a las que este invitado ya les dio like (estado inicial). */
export async function fetchMyLikedIds(eventId: string, guestId: string): Promise<Set<string>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("likes")
    .select("photo_id")
    .eq("event_id", eventId)
    .eq("guest_id", guestId);
  if (error) {
    console.error("[feed] likes error:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => String((r as { photo_id: string }).photo_id)));
}

export type CommentPhoto = {
  id: string;
  photo_id: string;
  guest_id: string;
  text: string;
  created_at: string;
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidGuestId(id: string): boolean {
  return typeof id === "string" && UUID_RE.test(id);
}

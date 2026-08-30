// ============================================================
// Lectura publica del feed y del evento (F4).
// El feed NUNCA lee Google Drive: solo Supabase (RPCs publicas)
// + thumbnails en Storage publico. Las credenciales van en
// .env.local (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).
// Este modulo es de SERVIDOR (no importar desde componentes cliente).
// ============================================================

import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { THEMES, DEFAULT_THEME_VARIANT } from "@/lib/themes";

export type EventPublic = {
  slug: string;
  title: string;
  owner_names: string[];
  message: string | null;
  welcome_photo_url: string | null;
  theme_key: string;
  theme_variant: string | null;
  status: "active" | "closed";
  created_at: string;
};

export type FeedPhoto = {
  id: string;
  event_id: string;
  thumb_url: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  like_count: number;
  comment_count: number;
  created_at: string;
};

export type FeedPage = { photos: FeedPhoto[]; nextCursor: FeedCursor };

let anonClient: SupabaseClient | null | undefined;

/** Cliente anon key (solo lectura publica). null si las env no estan configuradas. */
function getAnonClient(): SupabaseClient | null {
  if (anonClient !== undefined) return anonClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const configured = Boolean(url && key && !url.includes("TU-") && !key.includes("TU-"));
  if (!configured) {
    anonClient = null;
    return null;
  }
  anonClient = createClient(url as string, key as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return anonClient;
}

function normalizeRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    return (data[0] as Record<string, unknown> | undefined) ?? null;
  }
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return null;
}

/**
 * Header del evento publico via RPC get_event_public(slug) (migracion 0002,
 * SECURITY DEFINER). cache() de React deduplica la llamada entre
 * generateMetadata y el render de la pagina en la misma peticion.
 */
export const getEventPublic = cache(async (slug: string): Promise<EventPublic | null> => {
  const sb = getAnonClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc("get_event_public", { p_slug: slug });
  if (error) {
    console.error("[picmyevent] get_event_public(" + slug + ") fallo:", error.message);
    return null;
  }
  const row = normalizeRow(data);
  if (!row) return null;
  return {
    slug: String(row.slug ?? ""),
    title: String(row.title ?? ""),
    owner_names: Array.isArray(row.owner_names) ? (row.owner_names as string[]) : [],
    message: row.message ? String(row.message) : null,
    welcome_photo_url: row.welcome_photo_url ? String(row.welcome_photo_url) : null,
    theme_key: String(row.theme_key ?? "clasico"),
    theme_variant: row.theme_variant ? String(row.theme_variant) : null,
    status: row.status === "closed" ? "closed" : "active",
    created_at: String(row.created_at ?? ""),
  };
});

/**
 * Lectura base del feed (T4.1). Paginacion por cursor + Realtime/polling
 * se completan en F6 (RPC get_feed del backend, migraciones 0005/0006/0007).
 */
// Cursor compuesto (created_at, id) para keyset: orden nuevo primero.
export type FeedCursor = { created_at: string; id: string } | null;

/**
 * Lectura base del feed (F6): SOLO Supabase (photos con policies
 * publicas de 0009; NUNCA Drive), nuevo primero con paginacion por
 * cursor (created_at, id). El cliente usa lib/feed-client.ts; esta
 * version sirve para Server Components / testing.
 */
export async function getFeedPhotos(
  eventId: string,
  cursor?: FeedCursor,
  limit = 30,
): Promise<FeedPage> {
  const sb = getAnonClient();
  if (!sb) return { photos: [], nextCursor: null };

  let query = sb
    .from("photos")
    .select("id, thumb_url, caption, width, height, like_count, comment_count, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.or(
      "created_at.lt." + cursor.created_at + ",and(created_at.eq." + cursor.created_at + ",id.lt." + cursor.id + ")",
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error("[picmyevent] getFeedPhotos fallo:", error.message);
    return { photos: [], nextCursor: null };
  }
  const photos = (data ?? []) as unknown as FeedPhoto[];
  const last = photos[photos.length - 1];
  const nextCursor: FeedCursor =
    photos.length >= limit && last ? { created_at: last.created_at, id: last.id } : null;
  return { photos, nextCursor };
}

/**
 * Resuelve el data-theme de CSS a partir de theme_key + theme_variant.
 * Acepta tanto el key completo de la variante (ej. "elegante-marfil")
 * como 'light'/'dark' (schema de events.theme_variant).
 */
export function resolveDataTheme(themeKey: string, variant?: string | null): string {
  const theme = THEMES.find((t) => t.key === themeKey);
  if (!theme) return DEFAULT_THEME_VARIANT;
  if (variant) {
    const exact = theme.variants.find((v) => v.dataTheme === variant);
    if (exact) return exact.dataTheme;
    if (variant === "dark") {
      const dark = theme.variants.find((v) => /negro|neon/.test(v.key));
      if (dark) return dark.dataTheme;
    }
  }
  return theme.variants[0]?.dataTheme ?? DEFAULT_THEME_VARIANT;
}

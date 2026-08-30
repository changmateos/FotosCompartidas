// ============================================================
// Logica del panel admin (F2): crear evento (slug nanoid(10)
// UNIQUE con retry en colision), listar eventos del organizador,
// editar config, foto de bienvenida en Storage y QR.
// MODULO DE SERVIDOR (server-only): usa lib/supabase-server
// (sesion + RLS) y lib/supabase-admin (service_role) donde hace
// falta (insert de eventos y Storage).
// ============================================================

import "server-only";
import { customAlphabet } from "nanoid";

// Slug: solo minusculas + digitos + _ y - (regex ^[a-z0-9_-]{8,32}$ que
// valida /api/upload; nanoid por defecto genera mayusculas).
const slugAlphabet = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789_-", 10);
import { createClient as createServerClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { THEMES, DEFAULT_THEME_VARIANT } from "@/lib/themes";

export type EventRecord = {
  id: string;
  slug: string;
  title: string;
  owner_names: string[];
  message: string | null;
  welcome_photo_url: string | null;
  theme_key: string;
  theme_variant: string;
  status: "active" | "closed";
  created_by: string;
  created_at: string;
  closed_at: string | null;
  drive_full: boolean;
  max_photos: number | null;
};

export type CreateEventInput = {
  title: string;
  ownerNames?: string[];
  message?: string | null;
  themeKey?: string;
  variantKey?: string;
};

export type UpdateEventInput = {
  title?: string;
  ownerNames?: string[];
  message?: string | null;
  themeKey?: string;
  variantKey?: string;
  /** Limite opcional de fotos (P4): null = sin limite. */
  maxPhotos?: number | null;
};

/** Bucket publico de Supabase Storage (creado en F0). */
export const WELCOME_BUCKET = "thumbs";
export const WELCOME_FOLDER = "bienvenida";

export function welcomePhotoPath(eventId: string): string {
  return WELCOME_FOLDER + "/" + eventId + "/welcome.jpg";
}

// ------------------------------------------------------------------
// Validacion / saneado
// ------------------------------------------------------------------

export function sanitizeOwnerNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    if (result.length >= 10) break;
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name || name.length > 80) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

export function sanitizeMessage(message: unknown): string | null {
  if (typeof message !== "string") return null;
  const text = message.trim();
  if (!text) return null;
  if (text.length > 500) throw new Error("El mensaje es demasiado largo (maximo 500 caracteres).");
  return text;
}

/**
 * Resuelve (themeKey, variantKey) validos. Si se pasa una variante
 * concreta (ej. "elegante-marfil") se guarda tal cual; si no, la
 * primera variante del tema. Usa el key concreto en theme_variant
 * para que /e/[slug] aplique exactamente el combo elegido.
 */
export function resolveTheme(themeKey?: string, variantKey?: string): { themeKey: string; variantKey: string } {
  const theme = THEMES.find((t) => t.key === themeKey);
  if (!theme) return { themeKey: "clasico", variantKey: DEFAULT_THEME_VARIANT };
  const variant = theme.variants.find((v) => v.key === variantKey || v.dataTheme === variantKey);
  return { themeKey: theme.key, variantKey: variant?.dataTheme ?? theme.variants[0].dataTheme };
}

function assertTitle(title: string): string {
  const t = (title ?? "").trim();
  if (!t) throw new Error("El titulo del evento es obligatorio.");
  if (t.length > 120) throw new Error("El titulo es demasiado largo (maximo 120 caracteres).");
  return t;
}

// ------------------------------------------------------------------
// Crear evento: slug nanoid(10) con retry en colision (UNIQUE)
// ------------------------------------------------------------------

export async function createEvent(input: CreateEventInput, userId: string): Promise<EventRecord> {
  const title = assertTitle(input.title);
  const ownerNames = sanitizeOwnerNames(input.ownerNames);
  const message = sanitizeMessage(input.message);
  const { themeKey, variantKey } = resolveTheme(input.themeKey, input.variantKey);

  const admin = createAdminClient();
  let lastError: { message?: string } | null = null;

  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = slugAlphabet();
    const { data, error } = await admin
      .from("events")
      .insert({
        slug,
        title,
        owner_names: ownerNames,
        message,
        theme_key: themeKey,
        theme_variant: variantKey,
        created_by: userId,
      })
      .select("*")
      .single();

    if (!error && data) {
      // event_member del creador (PK event_id + organizer_id)
      const { error: memberError } = await admin
        .from("event_members")
        .insert({ event_id: data.id, organizer_id: userId });
      if (memberError) {
        throw new Error("No se pudo registrar al organizador del evento: " + memberError.message);
      }
      return data as unknown as EventRecord;
    }

    if (error && error.code === "23505") {
      lastError = error; // colision de slug: regenerar y reintentar
      continue;
    }
    throw new Error(error?.message ?? "No se pudo crear el evento.");
  }

  throw new Error(lastError?.message ?? "No se pudo generar un slug unico para el evento. Intenta de nuevo.");
}

// ------------------------------------------------------------------
// Lectura (RLS: solo miembros del evento)
// ------------------------------------------------------------------

export async function listOrganizerEvents(userId: string): Promise<EventRecord[]> {
  const supabase = await createServerClient();
  const { data: memberships, error: memberError } = await supabase
    .from("event_members")
    .select("event_id")
    .eq("organizer_id", userId);
  if (memberError) throw new Error("No se pudieron leer tus eventos.");
  const ids = (memberships ?? []).map((m) => m.event_id as string);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .in("id", ids)
    .order("created_at", { ascending: false });
  if (error) throw new Error("No se pudieron leer tus eventos.");
  return (data ?? []) as unknown as EventRecord[];
}

export async function getEventForAdmin(eventId: string): Promise<EventRecord | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
  if (error || !data) return null;
  return data as unknown as EventRecord;
}

// ------------------------------------------------------------------
// Actualizar config (titulo, ownerNames, message, themeKey, variantKey)
// ------------------------------------------------------------------

export async function updateEventConfig(eventId: string, input: UpdateEventInput): Promise<EventRecord | null> {
  const patch: Record<string, unknown> = {};

  if (input.title !== undefined) patch.title = assertTitle(input.title);
  if (input.ownerNames !== undefined) patch.owner_names = sanitizeOwnerNames(input.ownerNames);
  if (input.message !== undefined) patch.message = sanitizeMessage(input.message);
  if (input.themeKey !== undefined || input.variantKey !== undefined) {
    const { themeKey, variantKey } = resolveTheme(input.themeKey, input.variantKey);
    patch.theme_key = themeKey;
    patch.theme_variant = variantKey;
  }
  if (input.maxPhotos !== undefined) {
    if (input.maxPhotos === null) {
      patch.max_photos = null; // sin limite
    } else {
      const n = Math.floor(input.maxPhotos);
      if (Number.isNaN(n) || n < 1 || n > 99999) {
        throw new Error("El limite de fotos debe ser un numero entre 1 y 99999 (o vacio = sin limite).");
      }
      patch.max_photos = n;
    }
  }

  if (Object.keys(patch).length === 0) throw new Error("No hay cambios que guardar.");

  // RLS (events_update_member): solo miembros del evento
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("events")
    .update(patch)
    .eq("id", eventId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error("No se pudo guardar la configuracion: " + error.message);
  return (data as unknown as EventRecord | null) ?? null;
}

// ------------------------------------------------------------------
// Foto de bienvenida: Storage publico (bucket thumbs, carpeta
// bienvenida/{eventId}/) + events.welcome_photo_url
// ------------------------------------------------------------------

export async function uploadWelcomePhoto(eventId: string, file: Blob, contentType: string): Promise<string> {
  const admin = createAdminClient();
  const path = welcomePhotoPath(eventId);

  const { error: uploadError } = await admin.storage.from(WELCOME_BUCKET).upload(path, file, {
    contentType: contentType || "image/jpeg",
    upsert: true,
    cacheControl: "31536000",
  });
  if (uploadError) throw new Error("No se pudo subir la foto de bienvenida: " + uploadError.message);

  const { data: publicData } = admin.storage.from(WELCOME_BUCKET).getPublicUrl(path);
  const url = publicData.publicUrl;

  const { error: updateError } = await admin.from("events").update({ welcome_photo_url: url }).eq("id", eventId);
  if (updateError) throw new Error("No se pudo guardar la foto de bienvenida: " + updateError.message);

  return url;
}

export async function removeWelcomePhoto(eventId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.storage.from(WELCOME_BUCKET).remove([welcomePhotoPath(eventId)]);
  await admin.from("events").update({ welcome_photo_url: null }).eq("id", eventId);
}

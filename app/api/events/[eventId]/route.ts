// PATCH /api/events/[eventId] (F2, T2.1): actualiza la config del
// evento (titulo, ownerNames, message, themeKey, variantKey).
// Solo miembros del evento (RLS events_update_member).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { updateEventConfig } from "@/lib/events";

type Params = { params: Promise<{ eventId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { eventId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON invalido." }, { status: 400 });
  }

  try {
    const event = await updateEventConfig(eventId, {
      title: typeof body.title === "string" ? body.title : undefined,
      ownerNames: Array.isArray(body.ownerNames) ? (body.ownerNames as string[]) : undefined,
      message: typeof body.message === "string" ? body.message : undefined,
      themeKey: typeof body.themeKey === "string" ? body.themeKey : undefined,
      variantKey: typeof body.variantKey === "string" ? body.variantKey : undefined,
      maxPhotos: body.maxPhotos === null || typeof body.maxPhotos === "number" ? (body.maxPhotos as number | null) : undefined,
    });
    if (!event) {
      return NextResponse.json({ error: "Evento no encontrado o sin permisos." }, { status: 404 });
    }
    return NextResponse.json(event);
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo guardar la configuracion.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// DELETE /api/events/[eventId] (F7, T7.4): borra el evento entero.
// - Storage: elimina TODOS los thumbs con prefijo thumbs/{eventId}/.
// - BD: borra photos (cascade likes/comments), event_members,
//   drive_connections y events.
// - Google Drive: INTACTO (las fotos siguen en el Drive del organizador).
// El slug muere (404): /e/[slug] deja de existir.
// Solo miembros del evento.
import { createAdminClient } from "@/lib/supabase-admin";

export async function DELETE(request: Request, { params }: Params) {
  const { eventId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: isMember, error: memberError } = await admin.rpc(
    "is_event_member",
    { p_event_id: eventId, p_uid: user.id }
  );
  if (memberError) {
    console.error("[events] DELETE is_event_member error:", memberError.message);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
  if (!isMember) {
    return NextResponse.json({ error: "Sin permisos sobre este evento." }, { status: 403 });
  }

  // 0. Foto de bienvenida (F4): eliminar bienvenida/{eventId}/welcome.jpg
  //    (best-effort) para no dejar objetos huerfanos en Storage.
  {
    const { error: welcomeError } = await admin.storage
      .from("thumbs")
      .remove(["bienvenida/" + eventId + "/welcome.jpg"]);
    if (welcomeError) {
      console.error("[events] DELETE welcome photo error:", welcomeError.message);
    }
  }

  // 1. Storage: listar por prefijo thumbs/{eventId}/ y borrar todo
  const storage = admin.storage.from("thumbs");
  let offset = 0;
  const batchSize = 500;
  for (;;) {
    const { data: objects, error: listError } = await storage.list(eventId, {
      limit: batchSize,
      offset,
    });
    if (listError) {
      console.error("[events] DELETE storage list error:", listError.message);
      break;
    }
    const items = (objects ?? []) as { name: string }[];
    if (items.length === 0) break;
    const paths = items.map((o) => `${eventId}/${o.name}`);
    const { error: removeError } = await storage.remove(paths);
    if (removeError) {
      console.error("[events] DELETE storage remove error:", removeError.message);
      break;
    }
    if (items.length < batchSize) break;
    offset += batchSize;
  }

  // 2. BD (orden respetando FKs; photos cascade likes/comments)
  const { error: e1 } = await admin.from("photos").delete().eq("event_id", eventId);
  if (e1) console.error("[events] DELETE photos:", e1.message);
  const { error: e2 } = await admin.from("event_members").delete().eq("event_id", eventId);
  if (e2) console.error("[events] DELETE event_members:", e2.message);
  const { error: e3 } = await admin.from("drive_connections").delete().eq("event_id", eventId);
  if (e3) console.error("[events] DELETE drive_connections:", e3.message);
  const { error: e4 } = await admin.from("events").delete().eq("id", eventId);
  if (e4) {
    console.error("[events] DELETE events:", e4.message);
    return NextResponse.json({ error: "No se pudo borrar el evento." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}


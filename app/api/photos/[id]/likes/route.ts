// DELETE /api/photos/[id]/likes (F7.2 / P5 opcion 1): borra TODOS
// los likes de una foto y resetea photos.like_count a 0.
// Solo organizadores miembros del evento.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: photo, error: photoError } = await admin
    .from("photos")
    .select("id, event_id")
    .eq("id", id)
    .maybeSingle();
  if (photoError) {
    console.error("[photos/likes] select error:", photoError.message);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: "Foto no encontrada." }, { status: 404 });
  }

  const eventId = (photo as { event_id: string }).event_id;
  const { data: isMember, error: memberError } = await admin.rpc(
    "is_event_member",
    { p_event_id: eventId, p_uid: user.id }
  );
  if (memberError) {
    console.error("[photos/likes] is_event_member error:", memberError.message);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
  if (!isMember) {
    return NextResponse.json({ error: "Sin permisos sobre este evento." }, { status: 403 });
  }

  const { data: deleted, error: deleteError } = await admin
    .from("likes")
    .delete({ count: "exact" })
    .eq("photo_id", id);
  if (deleteError) {
    console.error("[photos/likes] delete error:", deleteError.message);
    return NextResponse.json({ error: "No se pudieron borrar los likes." }, { status: 500 });
  }

  const { error: resetError } = await admin
    .from("photos")
    .update({ like_count: 0 })
    .eq("id", id);
  if (resetError) {
    console.error("[photos/likes] reset error:", resetError.message);
    return NextResponse.json({ error: "No se pudo actualizar el contador." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: (deleted as unknown[] | null)?.length ?? 0 });
}

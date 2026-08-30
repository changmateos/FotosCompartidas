// DELETE /api/comments/[id] (F7, T7.2): borra un comentario.
// Solo miembros del evento. Mantiene el contador denormalizado
// photos.comment_count (decremento con piso 0).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

type Params = { params: Promise<{ id: string }> };

type CommentRow = { id: string; event_id: string; photo_id: string };

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
  const { data: comment, error: commentError } = await admin
    .from("comments")
    .select("id, event_id, photo_id")
    .eq("id", id)
    .maybeSingle();
  if (commentError) {
    console.error("[comments] select error:", commentError.message);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
  if (!comment) {
    return NextResponse.json({ error: "Comentario no encontrado." }, { status: 404 });
  }

  const row = comment as CommentRow;

  // Autorizacion: solo miembros del evento
  const { data: isMember, error: memberError } = await admin.rpc(
    "is_event_member",
    { p_event_id: row.event_id, p_uid: user.id }
  );
  if (memberError) {
    console.error("[comments] is_event_member error:", memberError.message);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
  if (!isMember) {
    return NextResponse.json({ error: "Sin permisos sobre este evento." }, { status: 403 });
  }

  // Borrar el comentario
  const { error: deleteError } = await admin.from("comments").delete().eq("id", id);
  if (deleteError) {
    console.error("[comments] delete error:", deleteError.message);
    return NextResponse.json({ error: "No se pudo borrar el comentario." }, { status: 500 });
  }

  // Decrementar el contador de la foto (piso 0)
  const { data: photo } = await admin
    .from("photos")
    .select("comment_count")
    .eq("id", row.photo_id)
    .maybeSingle();
  const current = (photo as { comment_count?: number } | null)?.comment_count ?? 0;
  const { error: counterError } = await admin
    .from("photos")
    .update({ comment_count: Math.max(0, current - 1) })
    .eq("id", row.photo_id);
  if (counterError) {
    console.error("[comments] counter update error:", counterError.message);
  }

  return NextResponse.json({ ok: true });
}

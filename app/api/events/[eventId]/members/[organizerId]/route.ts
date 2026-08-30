// DELETE /api/events/[eventId]/members/[organizerId] (F7.5 / hallazgo F2):
// quita a un organizador del evento. Solo miembros. No se puede quitar
// al CREADOR del evento (events.created_by es FK restrict; el evento
// quedaria huerfano).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

type Params = { params: Promise<{ eventId: string; organizerId: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const { eventId, organizerId } = await params;

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
    console.error("[members] is_event_member error:", memberError.message);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
  if (!isMember) {
    return NextResponse.json({ error: "Sin permisos sobre este evento." }, { status: 403 });
  }

  // No permitir quitar al creador
  const { data: event } = await admin
    .from("events")
    .select("created_by")
    .eq("id", eventId)
    .maybeSingle();
  if ((event as { created_by: string } | null)?.created_by === organizerId) {
    return NextResponse.json(
      { error: "No se puede quitar al creador del evento." },
      { status: 400 }
    );
  }

  const { error: deleteError } = await admin
    .from("event_members")
    .delete()
    .eq("event_id", eventId)
    .eq("organizer_id", organizerId);
  if (deleteError) {
    console.error("[members] delete error:", deleteError.message);
    return NextResponse.json({ error: "No se pudo quitar al organizador." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

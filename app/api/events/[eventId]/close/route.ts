// POST /api/events/[eventId]/close (F7, T7.3): cierra el evento.
// status='closed' + closed_at. Efectos:
// - /api/upload rechaza con 403 "Evento cerrado" (get_event_public).
// - El feed sigue visible (pagina /e/[slug] + RLS de lectura publica).
// - add_comment y toggle_like rechazan (evento no activo, decision 20).
// Solo miembros del evento.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";

type Params = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, { params }: Params) {
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
    console.error("[events/close] is_event_member error:", memberError.message);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
  if (!isMember) {
    return NextResponse.json({ error: "Sin permisos sobre este evento." }, { status: 403 });
  }

  const { error } = await admin
    .from("events")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", eventId);
  if (error) {
    console.error("[events/close] update error:", error.message);
    return NextResponse.json({ error: "No se pudo cerrar el evento." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "closed" });
}

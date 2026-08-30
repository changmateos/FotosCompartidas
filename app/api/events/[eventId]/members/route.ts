// POST /api/events/[eventId]/members (F7.5 / hallazgo F2): anade un
// organizador al evento por EMAIL (de su cuenta Google). Solo los
// miembros actuales pueden anadir. Inserta en event_members con
// role 'admin' (todos admin en v1). No duplica (PK event_id+organizer_id).
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

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON invalido." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Email invalido." }, { status: 400 });
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

  // Buscar al organizador por email (fila de organizers creada por el trigger)
  const { data: organizer, error: orgError } = await admin
    .from("organizers")
    .select("id, email, display_name")
    .eq("email", email)
    .maybeSingle();
  if (orgError) {
    console.error("[members] organizers error:", orgError.message);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
  if (!organizer) {
    return NextResponse.json(
      { error: "No existe ningun organizador con ese email (debe haber entrado una vez con su cuenta de Google)." },
      { status: 404 }
    );
  }

  const orgId = (organizer as { id: string; display_name: string | null }).id;
  const { error: insertError } = await admin.from("event_members").upsert(
    { event_id: eventId, organizer_id: orgId, role: "admin" },
    { onConflict: "event_id,organizer_id" }
  );
  if (insertError) {
    console.error("[members] insert error:", insertError.message);
    return NextResponse.json({ error: "No se pudo anadir al organizador." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, organizerId: orgId });
}

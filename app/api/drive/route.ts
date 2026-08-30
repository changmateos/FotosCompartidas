// DELETE /api/drive  (T3.5): desconecta Drive de un evento.
// Borra la fila de drive_connections (tokens cifrados incluidos).
// La carpeta y las fotos permanecen en el Drive del organizador.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { deleteConnection } from "@/lib/tokens";

export async function DELETE(request: Request) {
  let body: { eventId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // se valida abajo
  }
  const eventId = body.eventId;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!eventId) {
    return NextResponse.json({ error: "eventId requerido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: isMember, error: rpcError } = await admin.rpc(
    "is_event_member",
    { p_event_id: eventId, p_uid: user.id }
  );
  if (rpcError) {
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  if (!isMember) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // T7.5 (R2-F1): solo el organizador que CONECTO puede desconectar.
  // RPC is_drive_owner (migracion 0012).
  const { data: isOwner, error: ownerError } = await admin.rpc("is_drive_owner", {
    p_event_id: eventId,
    p_uid: user.id,
  });
  if (ownerError) {
    console.error("[drive] is_drive_owner error:", ownerError.message);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  if (!isOwner) {
    return NextResponse.json(
      { error: "Solo el organizador que conecto el Drive puede desconectarlo." },
      { status: 403 }
    );
  }

  try {
    await deleteConnection(eventId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[drive] DELETE error:", (e as Error).message);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

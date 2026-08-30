// GET /api/drive/status?eventId=...  (T3.4)
// Devuelve la cuota real del Drive del organizador (About.storageQuota)
// mas la carpeta conectada. NUNCA expone tokens. Si el token murio
// (invalid_grant) devuelve needsReconnect=true para guiar la reconexion.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getDriveClient, getQuota, DriveError } from "@/lib/drive";
import { getConnectionRow, updateNeedsReconnect } from "@/lib/tokens";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId");

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

  const conn = await getConnectionRow(eventId);
  if (!conn) {
    return NextResponse.json({ connected: false, needsReconnect: false });
  }

  // T7.5 (R2-F1): solo el organizador que CONECTO el Drive puede ver la
  // conexion. RPC is_drive_owner (migracion 0012): drive_connections
  // .organizer_id = p_uid. Los endpoints usan service_role (bypass RLS),
  // por eso la propiedad se valida aqui.
  const { data: isOwner, error: ownerError } = await admin.rpc("is_drive_owner", {
    p_event_id: eventId,
    p_uid: user.id,
  });
  if (ownerError) {
    console.error("[drive/status] is_drive_owner error:", ownerError.message);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  if (!isOwner) {
    return NextResponse.json(
      { error: "Solo el organizador que conecto el Drive puede ver esta seccion." },
      { status: 403 }
    );
  }

  try {
    // getDriveClient refresca el access token si faltan < 5 min
    const client = await getDriveClient(eventId);
    const quota = await getQuota(client.accessToken);
    return NextResponse.json({
      connected: true,
      limit: quota.limit,
      usage: quota.usage,
      usageInDrive: quota.usageInDrive,
      folderId: conn.folder_id,
      folderName: conn.folder_name,
      needsReconnect: false,
    });
  } catch (e) {
    if (e instanceof DriveError && e.reason === "invalid_grant") {
      // getDriveClient ya marco needs_reconnect=true
      const row = await getConnectionRow(eventId);
      return NextResponse.json({
        connected: false,
        needsReconnect: true,
        folderId: row?.folder_id ?? conn.folder_id,
        folderName: row?.folder_name ?? conn.folder_name,
      });
    }
    // Error temporal de la API (429/red): el panel puede reintentar.
    console.error("[drive/status] error:", (e as Error).message);
    return NextResponse.json({
      connected: true,
      error: "temporal",
      folderId: conn.folder_id,
      folderName: conn.folder_name,
      needsReconnect: conn.needs_reconnect,
    });
  }
}

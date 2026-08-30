// DELETE /api/photos/[id] (F7, T7.1): borra una foto del evento.
// - Drive: TRASH (P6 del plan: papelera, recuperable 30 dias; mejor
//   UX que files.delete duro). Best-effort: si el token de Drive fallo,
//   la moderacion continua (BD + Storage) y se registra el error.
// - Storage: elimina thumbs/{eventId}/{id}.jpg (bucket publico "thumbs").
// - BD: borra la fila de photos (cascade sobre likes y comments).
// Solo organizadores miembros del evento (event_members / creador).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getDriveClient } from "@/lib/drive";

type Params = { params: Promise<{ id: string }> };

type PhotoRow = {
  id: string;
  event_id: string;
  drive_file_id: string | null;
};

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
    .select("id, event_id, drive_file_id")
    .eq("id", id)
    .maybeSingle();
  if (photoError) {
    console.error("[photos] select error:", photoError.message);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
  if (!photo) {
    return NextResponse.json({ error: "Foto no encontrada." }, { status: 404 });
  }

  // Autorizacion: solo miembros del evento
  const { data: isMember, error: memberError } = await admin.rpc(
    "is_event_member",
    { p_event_id: (photo as PhotoRow).event_id, p_uid: user.id }
  );
  if (memberError) {
    console.error("[photos] is_event_member error:", memberError.message);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
  if (!isMember) {
    return NextResponse.json({ error: "Sin permisos sobre este evento." }, { status: 403 });
  }

  const eventId = (photo as PhotoRow).event_id;
  const driveFileId = (photo as PhotoRow).drive_file_id;

  // 1. Drive -> trash (best-effort)
  let driveTrashed = false;
  if (driveFileId) {
    try {
      const client = await getDriveClient(eventId);
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${driveFileId}/trash`,
        { method: "POST", headers: { Authorization: `Bearer ${client.accessToken}` } }
      );
      if (res.ok) {
        driveTrashed = true;
      } else {
        console.error(`[photos] drive trash fallo (${res.status})`);
      }
    } catch (e) {
      console.error("[photos] drive trash error (se continua):", (e as Error).message);
    }
  }

  // 2. Thumb de Storage
  const thumbPath = `${eventId}/${id}.jpg`;
  const { error: storageError } = await admin.storage
    .from("thumbs")
    .remove([thumbPath]);
  if (storageError) {
    console.error("[photos] storage remove error:", storageError.message);
  }

  // 3. BD (cascade likes/comments)
  const { error: deleteError } = await admin.from("photos").delete().eq("id", id);
  if (deleteError) {
    console.error("[photos] delete error:", deleteError.message);
    return NextResponse.json({ error: "No se pudo borrar la foto." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, driveTrashed });
}

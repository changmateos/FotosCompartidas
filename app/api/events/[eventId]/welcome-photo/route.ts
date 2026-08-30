// POST/DELETE /api/events/[eventId]/welcome-photo (F2, T2.2):
// sube la foto de bienvenida a Supabase Storage (bucket publico
// "thumbs", carpeta bienvenida/{eventId}/) y guarda la URL en
// events.welcome_photo_url. DELETE la quita. Solo miembros.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { uploadWelcomePhoto, removeWelcomePhoto } from "@/lib/events";

type Params = { params: Promise<{ eventId: string }> };

const MAX_WELCOME_BYTES = 8 * 1024 * 1024;

async function isMember(eventId: string, organizerId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("event_members")
    .select("event_id")
    .eq("event_id", eventId)
    .eq("organizer_id", organizerId)
    .maybeSingle();
  return Boolean(data);
}

export async function POST(request: Request, { params }: Params) {
  const { eventId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!(await isMember(eventId, user.id))) {
    return NextResponse.json({ error: "No eres miembro de este evento." }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "FormData invalido." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Se esperaba un archivo de imagen." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "El archivo debe ser una imagen." }, { status: 400 });
  }
  if (file.size > MAX_WELCOME_BYTES) {
    return NextResponse.json({ error: "La imagen supera los 8 MB." }, { status: 413 });
  }

  try {
    // El cliente ya comprime a JPEG (prepareUploadImage). Se fuerza image/jpeg
    // para no servir un SVG u otro content-type controlado por el cliente (MED-3).
    const url = await uploadWelcomePhoto(eventId, file, "image/jpeg");
    return NextResponse.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo subir la foto de bienvenida.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { eventId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (!(await isMember(eventId, user.id))) {
    return NextResponse.json({ error: "No eres miembro de este evento." }, { status: 403 });
  }

  try {
    await removeWelcomePhoto(eventId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo quitar la foto.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

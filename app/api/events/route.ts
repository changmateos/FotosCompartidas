// POST /api/events (F2, T1.3): crea un evento con slug aleatorio
// nanoid(10) (retry en colision) y registra el event_member del
// creador. Requiere sesion de organizador (middleware renueva la
// sesion; aqui se valida con getUser).
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { createEvent } from "@/lib/events";

export async function POST(request: Request) {
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
    const event = await createEvent(
      {
        title: typeof body.title === "string" ? body.title : "",
        ownerNames: Array.isArray(body.ownerNames) ? (body.ownerNames as string[]) : undefined,
        message: typeof body.message === "string" ? body.message : null,
        themeKey: typeof body.themeKey === "string" ? body.themeKey : undefined,
        variantKey: typeof body.variantKey === "string" ? body.variantKey : undefined,
      },
      user.id,
    );
    return NextResponse.json({ eventId: event.id, slug: event.slug }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo crear el evento.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

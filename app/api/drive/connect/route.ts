// POST /api/drive/connect (plan) o GET /api/drive/connect?eventId=&folderName=
// (aceptacion de t3): inicia el OAuth PKCE propio del organizador.
// Guarda state+verifier+eventId+folderName en una cookie httpOnly y
// redirige a Google (scopes profile, email, drive.file, prompt=consent).
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { buildAuthUrl, generatePkce } from "@/lib/drive";
import { getConnectionRow } from "@/lib/tokens";

const MAX_FOLDER_NAME = 200;
const STATE_TTL_MS = 10 * 60 * 1000; // 10 min

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return handleConnect(
    searchParams.get("eventId") ?? null,
    searchParams.get("folderName") ?? null
  );
}

export async function POST(request: Request) {
  let body: { eventId?: string; folderName?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // cuerpo vacio o invalido -> se valida abajo
  }
  return handleConnect(body.eventId ?? null, body.folderName ?? null);
}

async function handleConnect(eventId: string | null, folderName: string | null) {
  // 1. Sesion del organizador
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parametros
  if (!eventId || !folderName?.trim()) {
    return NextResponse.json(
      { error: "eventId y folderName son obligatorios" },
      { status: 400 }
    );
  }
  const name = folderName.trim().slice(0, MAX_FOLDER_NAME);

  // 3. El usuario debe ser miembro del evento (o su creador)
  const admin = createAdminClient();
  const { data: isMember, error: rpcError } = await admin.rpc(
    "is_event_member",
    { p_event_id: eventId, p_uid: user.id }
  );
  if (rpcError) {
    console.error("[drive/connect] rpc is_event_member error:", rpcError.message);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  if (!isMember) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 3b. Anti-hijack (T7.5/R2-F1): si el Drive ya esta conectado por OTRO
  // organizador, este evento no permite reconectar por otra cuenta.
  {
    const conn = await getConnectionRow(eventId);
    if (conn && (conn as { organizer_id: string }).organizer_id !== user.id) {
      return NextResponse.json(
        { error: "El Drive ya esta conectado por otro organizador de este evento." },
        { status: 403 }
      );
    }
  }

  // 4. PKCE + state
  const { verifier, challenge } = generatePkce();
  const state = crypto.randomBytes(16).toString("hex");
  const payload = JSON.stringify({
    state,
    verifier,
    eventId,
    folderName: name,
    createdAt: Date.now(),
  });

  // 5. Cookie httpOnly con el estado del flujo
  const cookieStore = await cookies();
  cookieStore.set("drive_oauth", payload, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });

  // 6. Redirigir a Google
  return NextResponse.redirect(buildAuthUrl({ state, codeChallenge: challenge }));
}

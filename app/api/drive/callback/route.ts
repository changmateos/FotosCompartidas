// GET /api/drive/callback?code=...&state=...  (T3.1)
// Valida el state de la cookie, intercambia el code por tokens
// (PKCE), los CIFRA y guarda en drive_connections (1 por evento),
// crea la carpeta en Drive (si no existe ya) y redirige a
// /admin/[eventId]?drive=connected.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  exchangeCodeForTokens,
  createFolder,
  DriveError,
} from "@/lib/drive";
import { getConnectionRow, upsertConnection } from "@/lib/tokens";

// Vercel Hobby: max 60 s por funcion. El intercambio OAuth + creacion de
// carpeta en Drive puede tardar; usar el maximo permitido.
export const maxDuration = 60;

const STATE_TTL_MS = 10 * 60 * 1000;

type OauthPayload = {
  state: string;
  verifier: string;
  eventId: string;
  folderName: string;
  createdAt: number;
};

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const googleError = searchParams.get("error");

  const cookieStore = await cookies();
  const raw = cookieStore.get("drive_oauth")?.value;
  const clearCookie = () =>
    cookieStore.set("drive_oauth", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });

  const fail = (reason: string) => {
    clearCookie();
    return NextResponse.redirect(`${origin}/admin?drive=error&reason=${reason}`);
  };

  if (!raw) return fail("no_state");
  let payload: OauthPayload;
  try {
    payload = JSON.parse(raw) as OauthPayload;
  } catch {
    return fail("bad_state");
  }
  if (!state || state !== payload.state) return fail("state_mismatch");
  if (Date.now() - payload.createdAt > STATE_TTL_MS) return fail("expired");
  if (googleError) return fail(`google_${googleError}`);
  if (!code) return fail("no_code");

  // Sesion del organizador
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthorized");

  // Sigue siendo miembro del evento
  const admin = createAdminClient();
  const { data: isMember, error: rpcError } = await admin.rpc(
    "is_event_member",
    { p_event_id: payload.eventId, p_uid: user.id }
  );
  if (rpcError || !isMember) return fail("forbidden");

  // Intercambio code -> tokens (PKCE)
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, payload.verifier);
  } catch (e) {
    console.error("[drive/callback] exchange error:", (e as Error).message);
    return fail("exchange_failed");
  }
  if (!tokens.refresh_token) {
    // En modo testing de Google el refresh token puede no llegar si la
    // app OAuth no esta publicada o el consent no se volvio a pedir.
    console.error("[drive/callback] sin refresh_token en la respuesta");
    return fail("no_refresh_token");
  }

  // Anti-hijack (T7.5/R2-F1): si el Drive ya esta conectado por OTRO
  // organizador, el flujo OAuth no puede reemplazar esa conexion.
  {
    const existingOwner = await getConnectionRow(payload.eventId);
    if (existingOwner && (existingOwner as { organizer_id: string }).organizer_id !== user.id) {
      console.error("[drive/callback] conexion existente de otro organizador");
      return fail("not_owner");
    }
  }

  // Carpeta: SIEMPRE la crea la app (T3.3). Al reconectar se reutiliza
  // la carpeta existente para no duplicar (T3.5).
  let folder: { id: string; name: string };
  try {
    const existing = await getConnectionRow(payload.eventId);
    if (existing) {
      folder = { id: existing.folder_id, name: existing.folder_name };
    } else {
      folder = await createFolder(tokens.access_token, payload.folderName);
    }
  } catch (e) {
    console.error("[drive/callback] createFolder error:", (e as Error).message);
    const reason =
      e instanceof DriveError && e.reason === "storageQuotaExceeded"
        ? "storage_quota"
        : "folder_error";
    return fail(reason);
  }

  // Guardar tokens CIFRADOS (upsert 1 por evento)
  try {
    await upsertConnection({
      eventId: payload.eventId,
      organizerId: user.id,
      folderId: folder.id,
      folderName: folder.name,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    });
  } catch (e) {
    console.error("[drive/callback] upsert error:", (e as Error).message);
    return fail("save_failed");
  }

  clearCookie();
  return NextResponse.redirect(
    `${origin}/admin/${payload.eventId}?drive=connected`
  );
}

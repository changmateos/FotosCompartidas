// Cliente de Google Drive (Fase 3): OAuth PKCE propio del organizador
// (scopes profile, email, drive.file), intercambio/refresh de tokens,
// creacion de carpeta, cuota (About) y getDriveClient() que refresca
// ~5 min antes de expirar y detecta invalid_grant -> needs_reconnect.
// Solo se ejecuta en el servidor (import server-only).
import "server-only";
import crypto from "node:crypto";
import { getDecryptedTokens, updateTokens, updateNeedsReconnect } from "@/lib/tokens";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_URL = "https://www.googleapis.com/drive/v3";

export const GOOGLE_SCOPES =
  "openid profile email https://www.googleapis.com/auth/drive.file";

const REFRESH_BEFORE_MS = 5 * 60 * 1000; // refrescar si faltan < 5 min

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getClientCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new DriveError(
      "Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI en .env.local",
      500
    );
  }
  return { clientId, clientSecret, redirectUri };
}

// ---------- Errores ----------
export class DriveError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly reason?: string,
    readonly retryAfterSec?: number
  ) {
    super(message);
    this.name = "DriveError";
  }
}

// ---------- PKCE ----------
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl(opts: {
  state: string;
  codeChallenge: string;
}): string {
  const { clientId, redirectUri } = getClientCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent", // garantiza refresh token
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// ---------- Token endpoint ----------
type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    ...params,
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (e) {
    throw new DriveError(
      `Error de red con el token endpoint de Google: ${(e as Error).message}`,
      0
    );
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const reason =
      typeof json.error === "string" ? (json.error as string) : "token_error";
    // invalid_grant = refresh token muerto/revocado (app OAuth en testing,
    // token revocado...). El panel debe guiar a reconectar.
    if (reason === "invalid_grant") {
      throw new DriveError("Token de Google invalido (invalid_grant)", res.status, "invalid_grant");
    }
    throw new DriveError(
      `Token endpoint error ${res.status}: ${reason}`,
      res.status,
      reason
    );
  }

  return json as unknown as TokenResponse;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const { redirectUri } = getClientCredentials();
  return postToken({
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresInSec: number }> {
  const res = await postToken({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return { accessToken: res.access_token, expiresInSec: res.expires_in };
}

// ---------- Drive API ----------
async function apiFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${DRIVE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let reason: string | undefined;
    let retryAfter: number | undefined;
    try {
      const j = (await res.json()) as {
        error?: { code?: number; message?: string; errors?: { reason?: string }[] };
      };
      reason = j.error?.errors?.[0]?.reason ?? j.error?.message ?? undefined;
    } catch {
      // cuerpo no JSON
    }
    if (res.status === 429) {
      retryAfter = Number(res.headers.get("retry-after") ?? 1) || 1;
    }
    throw new DriveError(
      `Drive API ${res.status} ${reason ?? ""}`.trim(),
      res.status,
      reason,
      retryAfter
    );
  }

  return (await res.json()) as T;
}

export type FolderInfo = { id: string; name: string };

// La app SIEMPRE crea la carpeta (drive.file no permite elegir una
// carpeta existente; decision 17 / T3.3).
export async function createFolder(
  accessToken: string,
  folderName: string
): Promise<FolderInfo> {
  const data = await apiFetch<{ id: string; name: string }>(accessToken, "/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  return { id: data.id, name: data.name };
}

export type DriveQuota = { limit: number; usage: number; usageInDrive: number };

export async function getQuota(accessToken: string): Promise<DriveQuota> {
  const data = await apiFetch<{
    storageQuota: { limit?: string; usage?: string; usageInDrive?: string };
  }>(accessToken, "/about?fields=storageQuota");
  const q = data.storageQuota ?? {};
  return {
    limit: Number(q.limit ?? 0),
    usage: Number(q.usage ?? 0),
    usageInDrive: Number(q.usageInDrive ?? 0),
  };
}

// ---------- Cliente autenticado (lo usara F5 para subir) ----------
export type DriveClient = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  folderId: string;
  folderName: string;
  needsReconnect: boolean;
};

// Carga los tokens del evento, refresca si faltan < 5 min y devuelve
// el cliente listo. Si el refresh falla con invalid_grant, marca la
// conexion como rota (needs_reconnect) para el panel.
export async function getDriveClient(eventId: string): Promise<DriveClient> {
  const tokens = await getDecryptedTokens(eventId);
  if (!tokens) {
    throw new DriveError("Drive no conectado para este evento", 404, "not_connected");
  }

  let { accessToken, refreshToken, expiresAt } = tokens;
  const needsRefresh =
    !expiresAt || expiresAt.getTime() - Date.now() < REFRESH_BEFORE_MS;

  if (needsRefresh) {
    try {
      const refreshed = await refreshAccessToken(refreshToken);
      accessToken = refreshed.accessToken;
      expiresAt = new Date(Date.now() + refreshed.expiresInSec * 1000);
      await updateTokens(eventId, accessToken, refreshToken, expiresAt);
      tokens.needsReconnect = false;
    } catch (e) {
      if (e instanceof DriveError && e.reason === "invalid_grant") {
        await updateNeedsReconnect(eventId, true);
      }
      throw e;
    }
  }

  return {
    accessToken,
    refreshToken,
    expiresAt,
    folderId: tokens.folderId,
    folderName: tokens.folderName,
    needsReconnect: tokens.needsReconnect,
  };
}

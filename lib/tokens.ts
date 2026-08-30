// Acceso a drive_connections: guardar/leer/borrar la conexion de
// Drive de un evento (1 por evento). Los tokens se almacenan
// CIFRADOS (lib/crypto.ts); solo el backend los descifra (T3.2).
import "server-only";
import { createAdminClient } from "@/lib/supabase-admin";
import { encrypt, decrypt } from "@/lib/crypto";

export type DriveConnectionRow = {
  id: string;
  event_id: string;
  organizer_id: string;
  folder_id: string;
  folder_name: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string | null;
  needs_reconnect: boolean;
  updated_at: string;
};

export type DriveTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
  folderId: string;
  folderName: string;
  needsReconnect: boolean;
};

export async function getConnectionRow(
  eventId: string
): Promise<DriveConnectionRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("drive_connections")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();

  if (error) {
    console.error("[tokens] getConnectionRow error:", error.message);
    throw error;
  }
  return (data as DriveConnectionRow | null) ?? null;
}

export async function upsertConnection(input: {
  eventId: string;
  organizerId: string;
  folderId: string;
  folderName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date | null;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("drive_connections").upsert(
    {
      event_id: input.eventId,
      organizer_id: input.organizerId,
      folder_id: input.folderId,
      folder_name: input.folderName,
      access_token_encrypted: encrypt(input.accessToken),
      refresh_token_encrypted: encrypt(input.refreshToken),
      token_expires_at: input.expiresAt ? input.expiresAt.toISOString() : null,
      needs_reconnect: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_id" }
  );

  if (error) {
    console.error("[tokens] upsertConnection error:", error.message);
    throw error;
  }
}

// Tras refrescar el access token: guarda el nuevo + borra el flag de reconexion.
export async function updateTokens(
  eventId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null
): Promise<void> {
  const admin = createAdminClient();
  const patch: Record<string, unknown> = {
    access_token_encrypted: encrypt(accessToken),
    token_expires_at: expiresAt ? expiresAt.toISOString() : null,
    needs_reconnect: false,
    updated_at: new Date().toISOString(),
  };
  if (refreshToken) {
    patch.refresh_token_encrypted = encrypt(refreshToken);
  }
  const { error } = await admin
    .from("drive_connections")
    .update(patch)
    .eq("event_id", eventId);

  if (error) {
    console.error("[tokens] updateTokens error:", error.message);
    throw error;
  }
}

export async function updateNeedsReconnect(
  eventId: string,
  value: boolean
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("drive_connections")
    .update({ needs_reconnect: value, updated_at: new Date().toISOString() })
    .eq("event_id", eventId);

  if (error) {
    console.error("[tokens] updateNeedsReconnect error:", error.message);
    throw error;
  }
}

export async function deleteConnection(eventId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("drive_connections")
    .delete()
    .eq("event_id", eventId);

  if (error) {
    console.error("[tokens] deleteConnection error:", error.message);
    throw error;
  }
}

// Devuelve los tokens DESCIFRADOS (solo backend). null si no hay conexion.
export async function getDecryptedTokens(
  eventId: string
): Promise<DriveTokens | null> {
  const row = await getConnectionRow(eventId);
  if (!row) return null;

  return {
    accessToken: decrypt(row.access_token_encrypted),
    refreshToken: decrypt(row.refresh_token_encrypted),
    expiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
    folderId: row.folder_id,
    folderName: row.folder_name,
    needsReconnect: row.needs_reconnect,
  };
}

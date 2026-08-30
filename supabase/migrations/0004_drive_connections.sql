-- ============================================================
-- PicMyEvent · Migracion 0004: drive_connections
-- Fase 3 (T3.1/T3.2): 1 conexion por evento (decision 15). Los
-- tokens van CIFRADOS (AES-256-GCM, TOKEN_ENCRYPTION_KEY); solo el
-- backend (service_role) los descifra. El cliente NUNCA los lee.
-- Las policies RLS estan en 0009_rls_policies.sql.
-- ============================================================

create table if not exists public.drive_connections (
  id                      uuid primary key default gen_random_uuid(),
  event_id                uuid not null unique references public.events (id) on delete cascade,
  organizer_id            uuid not null references public.organizers (id) on delete cascade,
  folder_id               text not null,
  folder_name             text not null,
  access_token_encrypted  text not null,
  refresh_token_encrypted text not null,
  token_expires_at        timestamptz,
  needs_reconnect         boolean not null default false,
  updated_at              timestamptz not null default now()
  -- Nota (revision): organizer_id ya identifica quien conecto;
  -- connected_by se elimino por redundante (T7.5 usa organizer_id).
);

comment on table public.drive_connections is
  'Conexion Drive del organizador por evento. Tokens cifrados; solo backend (service_role).';

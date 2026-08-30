-- ============================================================
-- PicMyEvent · Migracion 0005: photos
-- Fase 1 (T1.1): metadata del feed. El ORIGINAL vive en Google
-- Drive (F5); aqui solo la referencia + thumbnail en Storage.
-- Las policies RLS estan en 0009_rls_policies.sql.
-- ============================================================

create table if not exists public.photos (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  drive_file_id text unique,
  thumb_url     text not null,
  caption       text check (caption is null or char_length(caption) <= 500),
  guest_id      text not null,
  width         int,
  height        int,
  size_bytes    int,
  like_count    int not null default 0,
  comment_count int not null default 0,
  created_at    timestamptz not null default now()
);

comment on table public.photos is
  'Metadata del feed. El original vive en Drive; thumb_url apunta a Storage publico.';

-- Indice del feed (cursor: event_id + created_at DESC + id DESC)
create index if not exists idx_photos_feed
  on public.photos (event_id, created_at desc, id desc);

create index if not exists idx_photos_drive_file
  on public.photos (drive_file_id);

-- ------------------------------------------------------------------
-- Helper: evento existente => sus fotos/likes/comments son publicos
-- (el feed sigue visible aunque el evento este cerrado, decision 20).
-- SECURITY DEFINER para que anon pueda usarlo en policies.
-- ------------------------------------------------------------------
create or replace function public.event_is_public(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.events e where e.id = p_event_id);
$$;

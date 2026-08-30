-- ============================================================
-- PicMyEvent · Migracion 0003: event_members (multi-organizador)
-- Fase 1 (T1.1). Todos los miembros son 'admin' en v1.
-- Las policies RLS estan en 0009_rls_policies.sql.
-- ============================================================

create table if not exists public.event_members (
  event_id     uuid not null references public.events (id) on delete cascade,
  organizer_id uuid not null references public.organizers (id) on delete cascade,
  role         text not null default 'admin' check (role in ('admin')),
  created_at   timestamptz not null default now(),
  primary key (event_id, organizer_id)
);

comment on table public.event_members is
  'N:M eventos <-> organizadores. Todos admin en v1 (decision 7).';

create index if not exists idx_event_members_organizer
  on public.event_members (organizer_id);

-- ------------------------------------------------------------------
-- Helper RLS compartido: es auth.uid() miembro del evento? (o el
-- creador via events.created_by). SECURITY DEFINER para poder
-- consultar events sin policies (el llamador puede ser anon).
-- ------------------------------------------------------------------
create or replace function public.is_event_member(p_event_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.event_members em
    where em.event_id = p_event_id and em.organizer_id = p_uid
  ) or exists (
    select 1
    from public.events e
    where e.id = p_event_id and e.created_by = p_uid
  );
$$;

-- Sobrecarga sin uid explicito (usa auth.uid()) para policies.
create or replace function public.is_event_member(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_event_member(p_event_id, auth.uid());
$$;

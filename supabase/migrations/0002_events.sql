-- ============================================================
-- PicMyEvent · Migracion 0002: events
-- Fase 1 (T1.1): un evento = un QR. La lectura publica NO pasa por
-- la tabla (RLS anon denegada): se usa get_event_public(slug),
-- SECURITY DEFINER, que expone solo campos publicos.
-- Las policies RLS estan en 0009_rls_policies.sql (dependen del
-- helper is_event_member definido en 0003).
-- ============================================================

create table if not exists public.events (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  title             text not null,
  owner_names       text[] not null default '{}',
  message           text,
  welcome_photo_url text,
  theme_key         text not null default 'clasico',
  theme_variant     text not null default 'light',
  status            text not null default 'active'
                    check (status in ('active', 'closed')),
  created_by        uuid not null references public.organizers (id) on delete restrict,
  created_at        timestamptz not null default now(),
  closed_at         timestamptz,
  drive_full        boolean not null default false,
  max_photos        int
);

comment on table public.events is
  'Eventos. Un evento = un QR. slug nanoid(10) base64url con retry en colision.';

create index if not exists idx_events_status on public.events (status);

-- ------------------------------------------------------------------
-- Tipo compuesto publico devuelto por get_event_public.
-- drive_full NO se expone (informacion interna del organizador).
-- ------------------------------------------------------------------
create type public.events_public as (
  slug              text,
  title             text,
  owner_names       text[],
  message           text,
  welcome_photo_url text,
  theme_key         text,
  theme_variant     text,
  status            text,
  created_at        timestamptz
);

-- ------------------------------------------------------------------
-- get_event_public(slug): lectura del header de /e/[slug] sin RLS.
-- SECURITY DEFINER + search_path fijo para no depender de policies.
-- ------------------------------------------------------------------
create or replace function public.get_event_public(p_slug text)
returns public.events_public
language sql
security definer
set search_path = public
stable
as $$
  select e.slug, e.title, e.owner_names, e.message, e.welcome_photo_url,
         e.theme_key, e.theme_variant, e.status, e.created_at
  from public.events e
  where e.slug = p_slug
  limit 1;
$$;

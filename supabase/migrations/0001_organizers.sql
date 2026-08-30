-- ============================================================
-- PicMyEvent · Migracion 0001: organizers
-- Fase 1 (T1.1): el organizador es un usuario de Supabase Auth
-- (id == auth.users.id). El trigger crea la fila al registrarse.
-- ============================================================

create table if not exists public.organizers (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null unique,
  display_name text,
  created_at   timestamptz not null default now()
);

comment on table public.organizers is
  'Organizadores de eventos. id == auth.users.id (cuenta Google).';

-- ------------------------------------------------------------------
-- Trigger: al crearse un usuario en auth.users (signup Google),
-- insertar su fila en organizers. SECURITY DEFINER porque el
-- trigger corre como el usuario anonimo y auth.users no es legible
-- por anon.
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organizers (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      new.email
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------
-- RLS: cada organizador solo lee/actualiza su propia fila.
-- ------------------------------------------------------------------
alter table public.organizers enable row level security;

create policy "organizers_select_own"
  on public.organizers for select
  using (auth.uid() = id);

create policy "organizers_update_own"
  on public.organizers for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- El insert lo hace el trigger (security definer) y el backend con
-- service_role (bypass RLS); el anon no puede insertar.

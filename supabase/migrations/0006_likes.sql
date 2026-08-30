-- ============================================================
-- PicMyEvent · Migracion 0006: likes
-- Fase 1 (T1.1): me gusta anonimos (guest_id de cookie).
-- Las policies RLS estan en 0009_rls_policies.sql.
-- ============================================================

create table if not exists public.likes (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  guest_id   text not null,
  created_at timestamptz not null default now(),
  unique (photo_id, guest_id)
);

comment on table public.likes is
  'Likes anonimos. UNIQUE(photo_id, guest_id): un like por invitado por foto.';

create index if not exists idx_likes_photo on public.likes (photo_id);
create index if not exists idx_likes_event on public.likes (event_id);

-- ------------------------------------------------------------------
-- RPC toggle_like: alterna el like y mantiene photos.like_count.
-- SECURITY DEFINER: es la UNICA via de insert/delete para anon
-- (no hay policies directas sobre likes).
-- ------------------------------------------------------------------
create or replace function public.toggle_like(p_photo_id uuid, p_guest_id text)
returns table (liked boolean, count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  select event_id into v_event_id
  from public.photos where id = p_photo_id;

  if v_event_id is null then
    raise exception 'photo_not_found' using errcode = 'P0001';
  end if;

  -- Tras el cierre el feed es SOLO LECTURA para los invitados
  -- (decision 20): sin likes nuevos, igual que sin comentarios
  -- (add_comment valida lo mismo).
  if not exists (
    select 1 from public.events
    where id = v_event_id and status = 'active'
  ) then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.likes
    where photo_id = p_photo_id and guest_id = p_guest_id
  ) then
    delete from public.likes
    where photo_id = p_photo_id and guest_id = p_guest_id;
    update public.photos
       set like_count = greatest(like_count - 1, 0)
     where id = p_photo_id;
    liked := false;
  else
    insert into public.likes (photo_id, event_id, guest_id)
    values (p_photo_id, v_event_id, p_guest_id);
    update public.photos
       set like_count = like_count + 1
     where id = p_photo_id;
    liked := true;
  end if;

  select like_count into count
  from public.photos where id = p_photo_id;

  return next;
end;
$$;

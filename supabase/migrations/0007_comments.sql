-- ============================================================
-- PicMyEvent · Migracion 0007: comments
-- Fase 1 (T1.1): comentarios anonimos (guest_id).
-- Las policies RLS estan en 0009_rls_policies.sql.
-- ============================================================

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos (id) on delete cascade,
  event_id   uuid not null references public.events (id) on delete cascade,
  guest_id   text not null,
  text       text not null check (char_length(text) between 1 and 500),
  created_at timestamptz not null default now()
);

comment on table public.comments is
  'Comentarios anonimos. Texto limitado a 500 chars (validado ademas en la API).';

create index if not exists idx_comments_feed
  on public.comments (photo_id, created_at);

create index if not exists idx_comments_event on public.comments (event_id);

-- ------------------------------------------------------------------
-- RPC add_comment: inserta comentario solo si la foto existe y su
-- evento esta activo; mantiene photos.comment_count. SECURITY
-- DEFINER: unica via de insert para anon.
-- ------------------------------------------------------------------
create or replace function public.add_comment(p_photo_id uuid, p_guest_id text, p_text text)
returns public.comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_comment  public.comments;
begin
  if p_text is null or char_length(p_text) < 1 or char_length(p_text) > 500 then
    raise exception 'invalid_comment_length' using errcode = 'P0001';
  end if;

  select event_id into v_event_id
  from public.photos where id = p_photo_id;

  if v_event_id is null then
    raise exception 'photo_not_found' using errcode = 'P0001';
  end if;

  -- Solo eventos activos aceptan comentarios nuevos (T6.3).
  if not exists (
    select 1 from public.events
    where id = v_event_id and status = 'active'
  ) then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;

  insert into public.comments (photo_id, event_id, guest_id, text)
  values (p_photo_id, v_event_id, p_guest_id, p_text)
  returning * into v_comment;

  update public.photos
     set comment_count = comment_count + 1
   where id = p_photo_id;

  return v_comment;
end;
$$;

-- ============================================================
-- PicMyEvent · Migracion 0010: feed publico (F6)
-- get_event_id_by_slug: resuelve el id del evento a partir del
-- slug para que el feed del cliente (anon key) pueda leer
-- photos/likes/comments por event_id. events_public (0002) no
-- expone el id a proposito; esta funcion es la unica via anon
-- de slug -> id. SECURITY DEFINER + search_path fijo.
-- NOTA: el feed NO usa get_feed (RPC del plan): las policies
-- publicas de 0009 (photos/likes/comments select) permiten al
-- anon leer directo con la anon key, con paginacion por cursor
-- (created_at, id) en el cliente. Sin llamadas a Drive.
-- ============================================================

create or replace function public.get_event_id_by_slug(p_slug text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from public.events where slug = p_slug limit 1;
$$;

comment on function public.get_event_id_by_slug(text) is
  'Resuelve el id del evento desde el slug para el feed publico (F6).';

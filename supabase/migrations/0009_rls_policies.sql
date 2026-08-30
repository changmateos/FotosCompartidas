-- ============================================================
-- PicMyEvent · Migracion 0009: RLS policies (todas las tablas)
-- Se aplica DESPUES de tablas y funciones (0001-0008) porque las
-- policies referencian is_event_member / event_is_public.
-- ============================================================

-- ---------- organizers ----------
alter table public.organizers enable row level security;

create policy "organizers_select_own"
  on public.organizers for select
  using (auth.uid() = id);

create policy "organizers_update_own"
  on public.organizers for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
-- insert: solo via trigger handle_new_user (security definer) o
-- service_role; anon/authenticated no tienen policy -> denegado.

-- ---------- events ----------
alter table public.events enable row level security;

-- El anon NO lee la tabla: usa get_event_public(slug) (0002).
create policy "events_select_member"
  on public.events for select
  using (public.is_event_member(id, auth.uid()));

create policy "events_update_member"
  on public.events for update
  using (public.is_event_member(id, auth.uid()))
  with check (public.is_event_member(id, auth.uid()));

create policy "events_delete_member"
  on public.events for delete
  using (public.is_event_member(id, auth.uid()));
-- insert: solo backend (service_role). El creador inserta via
-- POST /api/events con la clave de servicio.

-- ---------- event_members ----------
alter table public.event_members enable row level security;

create policy "event_members_select_member"
  on public.event_members for select
  using (public.is_event_member(event_id, auth.uid()));

create policy "event_members_insert_member"
  on public.event_members for insert
  with check (public.is_event_member(event_id, auth.uid()));

create policy "event_members_delete_member"
  on public.event_members for delete
  using (public.is_event_member(event_id, auth.uid()));

-- ---------- drive_connections ----------
alter table public.drive_connections enable row level security;

create policy "drive_connections_select_member"
  on public.drive_connections for select
  using (public.is_event_member(event_id, auth.uid()));

create policy "drive_connections_update_member"
  on public.drive_connections for update
  using (public.is_event_member(event_id, auth.uid()))
  with check (public.is_event_member(event_id, auth.uid()));

create policy "drive_connections_delete_member"
  on public.drive_connections for delete
  using (public.is_event_member(event_id, auth.uid()));
-- insert: solo backend (service_role); tokens cifrados.

-- ---------- photos ----------
alter table public.photos enable row level security;

-- Feed publico: anon lee las filas de eventos existentes (cerrados
-- incluidos; decision 20). La fila no contiene datos sensibles.
create policy "photos_select_public"
  on public.photos for select
  using (public.event_is_public(event_id));

-- Moderacion (F7): un miembro del evento borra fotos.
create policy "photos_delete_member"
  on public.photos for delete
  using (public.is_event_member(event_id, auth.uid()));
-- insert: solo backend (service_role), tras confirmar fileId en Drive.

-- ---------- likes ----------
alter table public.likes enable row level security;

create policy "likes_select_public"
  on public.likes for select
  using (public.event_is_public(event_id));
-- insert/delete: SOLO via RPC toggle_like (security definer).
-- El anon no tiene policies directas -> denegado.

-- ---------- comments ----------
alter table public.comments enable row level security;

create policy "comments_select_public"
  on public.comments for select
  using (public.event_is_public(event_id));

-- Moderacion (F7): miembro del evento borra comentarios.
create policy "comments_delete_member"
  on public.comments for delete
  using (public.is_event_member(event_id, auth.uid()));
-- insert: SOLO via RPC add_comment (security definer).

-- ---------- rate_limits ----------
-- Solo el backend (service_role) escribe/lee; el anon no necesita
-- policies. Habilitar RLS igualmente como red de seguridad.
alter table public.rate_limits enable row level security;

-- ============================================================
-- Realtime (F6): habilitar postgres_changes para photos, likes y
-- comments. PASO EXACTO (se ejecuta una sola vez, en el SQL editor
-- del dashboard de Supabase, o como migracion 0010):
--
--   alter publication supabase_realtime add table public.photos;
--   alter publication supabase_realtime add table public.likes;
--   alter publication supabase_realtime add table public.comments;
--
-- Verificacion: desde el dashboard Realtime > Replication deben
-- aparecer las 3 tablas en la publicacion supabase_realtime.
-- (Alternativa dashboard: Database > Replication > supabase_realtime
--  -> "Add tables" -> marcar photos, likes, comments -> Save.)
-- ============================================================

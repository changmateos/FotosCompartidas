-- ============================================================
-- PicMyEvent · TODAS las migraciones en orden (0001-0012)
-- Pega este archivo completo en Supabase > SQL Editor > Run
-- ============================================================

-- ##### 0001_organizers.sql #####
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

-- ##### 0002_events.sql #####
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

-- ##### 0003_event_members.sql #####
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

-- ##### 0004_drive_connections.sql #####
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

-- ##### 0005_photos.sql #####
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

-- ##### 0006_likes.sql #####
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

-- ##### 0007_comments.sql #####
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

-- ##### 0008_rate_limits.sql #####
-- ============================================================
-- PicMyEvent · Migracion 0008: rate_limits
-- Fase 1 (T1.1): rate limiting sin servicios externos (ADR-003,
-- P7 del plan). Ventana deslizante por clave (evento+IP, IP, ...).
-- ============================================================

create table if not exists public.rate_limits (
  key          text primary key,
  count        int not null default 0,
  window_start timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.rate_limits is
  'Contadores de rate limiting por clave (p.ej. upload:{eventId}:{ip}). Ventana deslizante.';

create index if not exists idx_rate_limits_window on public.rate_limits (window_start);

-- ##### 0009_rls_policies.sql #####
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

-- ##### 0010_feed.sql #####
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

-- ##### 0011_drive_connections_rls_owner.sql #####
-- ============================================================
-- PicMyEvent · Migracion 0011: RLS drive_connections restringida
-- al organizador que CONECTO (hallazgo F6 de la revision final).
-- Antes: cualquier miembro del evento podia leer/actualizar/borrar
-- la conexion (y, con ella, los tokens cifrados). Ahora SOLO
-- organizer_id == auth.uid() (quien conecto; ver 0004, donde
-- connected_by se elimino por redundante con organizer_id).
-- Los endpoints del panel usan service_role + is_event_member y no
-- se ven afectados; esto protege la fila si alguna vez se consulta
-- con la sesion del organizador.
-- ============================================================

drop policy if exists "drive_connections_select_member" on public.drive_connections;
drop policy if exists "drive_connections_update_member" on public.drive_connections;
drop policy if exists "drive_connections_delete_member" on public.drive_connections;

create policy "drive_connections_select_owner"
  on public.drive_connections for select
  using (organizer_id = auth.uid());

create policy "drive_connections_update_owner"
  on public.drive_connections for update
  using (organizer_id = auth.uid())
  with check (organizer_id = auth.uid());

create policy "drive_connections_delete_owner"
  on public.drive_connections for delete
  using (organizer_id = auth.uid());

-- ##### 0012_drive_owner_rpc.sql #####
-- ============================================================
-- PicMyEvent · Migracion 0012: RPC is_drive_owner
-- (hallazgo R2-F1 de la review round-2, T7.5)
-- Verifica que p_uid sea el organizador que CONECTO el Drive del
-- evento (drive_connections.organizer_id = p_uid). SECURITY DEFINER
-- para que los endpoints con service_role puedan usarla igual que
-- is_event_member; tambien sirve para policies si hiciera falta.
-- ============================================================

create or replace function public.is_drive_owner(p_event_id uuid, p_uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.drive_connections dc
    where dc.event_id = p_event_id and dc.organizer_id = p_uid
  );
$$;

-- Sobrecarga sin uid explicito (usa auth.uid()) para policies.
create or replace function public.is_drive_owner(p_event_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_drive_owner(p_event_id, auth.uid());
$$;

-- ============================================================
-- Realtime: publicar photos, likes y comments para el feed en vivo
-- (tambien se puede hacer en Dashboard > Database > Replication)
-- ============================================================
alter publication supabase_realtime add table public.photos, public.likes, public.comments;

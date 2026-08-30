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

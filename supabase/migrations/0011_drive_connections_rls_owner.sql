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

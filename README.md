# PicMyEvent

App web (multi-evento) para que los invitados de un evento escaneen un QR, tomen fotos con la camara nativa de su celular y estas caigan en la carpeta de Google Drive del organizador, con feed en vivo (fotos + mensajes + likes + comentarios).

- **Stack**: Next.js (Vercel, plan Hobby gratis) + Supabase (gratis) + Google Drive (del organizador, 15 GB).
- **Vision y decisiones**: `handshake_fotos-compartidas.md` · **Plan**: `PLAN_IMPLEMENTACION.md` (F0-F9) · **Informe tecnico**: `INFORME_VIABILIDAD.md`.
- **ADRs**: `docs/ADRs.md` (rele Vercel + OAuth propio, plan B signed URL, rate limit Postgres).
- **Entrega final**: `docs/entrega/informe-final.md` (informe, checklist de lanzamiento, guia del organizador) · **Pruebas**: `docs/pruebas.md`.

## Setup completo (F0-F9)

### 1. Supabase (supabase.com, plan Free)

1. Crear proyecto y copiar URL + anon key + service role key a `.env.local` (plantilla en `.env.example`).
2. **Aplicar las migraciones en orden** (SQL editor, una por una o todas juntas):
   `supabase/migrations/0001_organizers.sql` … `0012_drive_owner_rpc.sql` (incluye 0010_feed.sql del feed y 0011/0012 de RLS de Drive).
   Crean las 8 tablas, RLS, RPCs (get_event_public, toggle_like, add_comment, is_event_member, is_drive_owner) y el trigger del organizador.
3. **Auth > Providers > Google**: habilitar con GOOGLE_CLIENT_ID/SECRET de Google Cloud y URL de redireccion `https://TU-DOMINIO/api/auth/callback`.
   - Auth > URL Configuration > Redirect URLs: anadir `https://TU-DOMINIO/api/auth/callback`.
4. **Storage**: crear bucket publico `thumbs` (los thumbnails del feed; cache publico largo).
5. **Realtime**: habilitar la publicacion para el feed (SQL editor):
   `alter publication supabase_realtime add table public.photos, public.likes, public.comments;`
   (o Dashboard > Database > Replication > supabase_realtime > Add tables).

### 2. Google Cloud (consola, app OAuth PUBLICADA)

1. Crear proyecto y la pantalla de consentimiento (app name PicMyEvent, dominio Vercel, email de soporte).
2. Crear credenciales **OAuth Web** con:
   - URIs de redireccion: `https://TU-DOMINIO/api/auth/callback` y `https://TU-DOMINIO/api/drive/callback`.
   - Scopes: `openid`, `profile`, `email`, `https://www.googleapis.com/auth/drive.file`.
3. **PUBLICAR la app** ("In production"): requisito para que el refresh token de Drive no muera a los 7 dias. La politica de privacidad vive en `/privacy` (pagina incluida) y debe estar desplegada y enlazada en la consent screen. La verificacion de scope sensitive es opcional (solo quita la advertencia).
4. `.env.local`: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI=`https://TU-DOMINIO/api/drive/callback`, TOKEN_ENCRYPTION_KEY (generar: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

### 3. Vercel (plan Hobby, gratis)

1. Importar el repo como proyecto `picmyevent`, framework Next.js.
2. Variables de entorno (Production): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, TOKEN_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL.
3. Deploy: `https://TU-DOMINIO/` y `/privacy` deben cargar; configurar el dominio propio (HTTPS automatico).

### 4. Verificacion y pruebas

- `npm run typecheck` y `npm run build` (build limpio).
- Prueba de humo en produccion: organizador real crea evento, conecta Drive, descarga el QR; 2 moviles (iPhone HEIC + Android) suben fotos; verificar Drive, feed, likes/comentarios, cierre y borrado.
- Concurrencia: `node scripts/load-test.ts --base https://TU-DOMINIO --slug <slug> --guests 500` y `node scripts/load-feed.mjs --feed-url <url> --clients 500` (detalles en `docs/pruebas.md`).

## Checklist de lanzamiento

Ver `docs/entrega/informe-final.md` (seccion 6): OAuth publicada, /privacy OK, envs de produccion, sin secretos en el repo, migraciones + Realtime + bucket, backup Supabase, dominio/HTTPS, prueba de humo completa.

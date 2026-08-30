# PLAN DE IMPLEMENTACION — PicMyEvent
**App web de fotos de invitados en eventos** · Vercel + Supabase + Google Drive (stack 100% gratuito)
Fuentes: handshake_fotos-compartidas.md (vision cerrada, 21 decisiones) + INFORME_VIABILIDAD.md (informe tecnico verificado, junio 2026).
Estado: PLAN LISTO PARA EJECUTAR · Equipo objetivo: 1-2 desarrolladores · Idioma de UI: espanol

---

## 1. RESUMEN EJECUTIVO

PicMyEvent es una sola app web multi-evento: el organizador crea su evento desde un panel con su cuenta de Google, la app genera un QR (URL /e/<slug>) que los invitados escanean para tomar fotos con la camara nativa y ver un feed en vivo con mensajes, likes y comentarios. Las fotos originales (comprimidas a ~3000 px JPEG, HEIC convertido) caen en la carpeta de Google Drive del organizador (alcance drive.file, rele por Vercel), y el feed se sirve SOLO desde Supabase (thumbnails en Storage publico) con Realtime + fallback a polling para aguantar 100-500 invitados simultaneos sin coste. El plan se ejecuta en 10 fases (F0-F9), ~47 tareas, con publicacion de la app OAuth de Google como primer requisito critico (evita que los tokens mueran a los 7 dias) y compresion controlada <=3,5 MB como condicion para el limite de 4,5 MB de Vercel. Estimacion general: **L** (ver seccion 3).

---

## 2. ARQUITECTURA

### 2.1 Diagrama de flujo

```
                    INVITADOS (sin registro, cookie anonima)
   [Celular] input capture -> HEIC? -> heic2any -> compresion ~3000px JPEG <=3,5MB
        |                            + thumbnail ~400px (~50-150 KB)
        v
   +--------------------------------------------------------------+
   |  VERCEL (plan Hobby, gratis)                                  |
   |  Next.js App Router + TS + Tailwind                           |
   |  +- Paginas publicas: / , /e/[slug], /privacy                |
   |  +- Panel admin: /admin*  (protegido)                         |
   |  +- API routes (funciones serverless):                        |
   |     POST /api/upload  (rele: recibe foto,                     |
   |       la sube a Drive, thumb a Storage,                       |
   |       metadata a Supabase)                                    |
   |     /api/likes /api/comments /api/events ...                  |
   +-------+----------------------------------+-------------------+
           | OAuth drive.file +               | REST / Realtime
           | resumable upload                 | (postgres_changes)
           v                                  v
   +-----------------+               +------------------------------+
   | GOOGLE DRIVE    |               | SUPABASE (free)              |
   | (del organiza-  |               | +- Postgres: events,         |
   |  dor, 15GB)     |               | |  organizers, photos,       |
   | carpeta creada  |               | |  likes, comments,          |
   | por la app,     |               | |  drive_connections         |
   | original de     |               | +- Auth: Google OAuth        |
   | cada foto       |               | +- Storage publico:          |
   +-----------------+               | |  thumbs/{eventId}/...      |
                                    | +- Realtime: <150 conns      |
                                    +------------------------------+
   FEED: el celular NUNCA lee Drive. Lee Supabase (foto + mensaje +
   likes + comentarios + thumb URL). Drive guarda SOLO el original.
```

### 2.2 Tablas de Supabase (resumen; detalle en seccion 4)

| Tabla | Proposito | Claves |
|---|---|---|
| `organizers` | Organizadores (id == auth.users.id) | PK id, UNIQUE email |
| `events` | Un evento = un QR | PK id, UNIQUE slug, FK created_by |
| `event_members` | Multi-organizador (N:M) | PK (event_id, organizer_id) |
| `drive_connections` | Carpeta + tokens cifrados del que conecta Drive (1 por evento) | PK id, UNIQUE event_id, FK organizer_id |
| `photos` | Metadata del feed (el original vive en Drive) | PK id, UNIQUE drive_file_id, FK event_id, indice feed (event_id, created_at DESC) |
| `likes` | Me gusta (guest_id anonimo) | PK id, UNIQUE (photo_id, guest_id) |
| `comments` | Comentarios | PK id, FK photo_id, indice (photo_id, created_at) |
| `rate_limits` | Rate limiting por evento+IP (ventana deslizante) | PK key (text) |

### 2.3 Rutas API de Next.js (App Router)

| Metodo | Path | Cuerpo / Query | Que hace |
|---|---|---|---|
| POST | `/api/upload` | FormData: `file` (binario JPEG), `slug`, `caption?`, `thumb` (binario) | Valida tipo/tamano (<=3,5 MB), rate limit por evento+IP, refresca token si falta, subida resumable a Drive (backoff+jitter, Retry-After), sube thumb a Storage publico, inserta fila en `photos`, responde {photoId, thumbUrl, createdAt}. Difunde por Realtime. |
| POST | `/api/likes/toggle` | JSON: {photoId} | Rate limit ligero; ejecuta RPC `toggle_like(photo_id, guest_id)`; responde {liked, count}. |
| POST | `/api/comments` | JSON: {photoId, text} | Rate limit por IP; valida texto (<=500 chars, sin HTML); inserta via RPC `add_comment`; responde el comentario. |
| DELETE | `/api/comments/[id]` | — | Admin (sesion + miembro del evento): borra comentario. |
| DELETE | `/api/photos/[id]` | — | Admin: borra de Drive (files.delete), thumb de Storage, filas de photos/likes/comments. |
| POST | `/api/events` | JSON: {title, ownerNames[], message?, themeKey, variantKey?} | Admin autenticado: genera slug nanoid(10) (retry en colision), crea evento + event_member; responde {eventId, slug}. |
| PATCH | `/api/events/[eventId]` | JSON parcial de config | Admin miembro: actualiza config del evento (titulo, nombres, mensaje, tema, foto bienvenida, estado). |
| POST | `/api/events/[eventId]/close` | — | Admin: status='closed' (corta subidas; feed sigue visible). |
| DELETE | `/api/events/[eventId]` | — | Admin: borra thumbs de Storage y filas (photos/likes/comments/members/drive_connection). Drive queda intacto. El slug muere (404). |
| GET | `/api/drive/status` | — | Admin: `drive/v3/about?fields=storageQuota` con token del organizador; responde {limit, usage, usageInDrive, folderId, folderName}. NUNCA expone tokens. |
| POST | `/api/drive/connect` | JSON: {eventId, folderName} | Admin: inicia OAuth PKCE propio (scopes profile email drive.file), guarda state+verifier en cookie, redirige a Google. |
| GET | `/api/drive/callback` | query: code, state | Intercambia code por tokens, los cifra y guarda en `drive_connections`, crea la carpeta con `folderName` (files.create, mimeType folder), guarda folderId, redirige a /admin/[eventId]. |
| DELETE | `/api/drive` | JSON: {eventId} | Admin: desconecta Drive (borra fila de drive_connections; la carpeta y fotos quedan en el Drive del organizador). |
| GET | `/api/events/[eventId]/qrcode` | — | (Opcional) PNG del QR; recomendado: generar y descargar 100% en cliente con qrcode.react + canvas, sin API. |

Nota: la lectura publica de un evento (GET /e/[slug]) se hace en el Server Component con la anon key via funcion SQL `get_event_public(slug)` (no expone columnas sensibles); el feed se lee con la anon key contra vistas/RPC publicas.

### 2.4 Estructura de carpetas del proyecto

```
picmyevent/
+-- app/
|  +-- layout.tsx                     # Root layout (fuentes, base)
|  +-- page.tsx                       # Landing: "Crea tu evento" + como funciona
|  +-- privacy/page.tsx               # Politica de privacidad (REQUISITO para publicar OAuth)
|  +-- e/[slug]/page.tsx              # Pagina publica del evento (feed + boton foto)
|  +-- admin/
|  |  +-- page.tsx                    # Lista de mis eventos
|  |  +-- new/page.tsx                # Crear evento
|  |  +-- [eventId]/page.tsx          # Panel: tabs [Config | QR | Drive | Fotos]
|  +-- auth/callback/route.ts         # Callback Supabase Auth (Google)
|  +-- auth/drive-callback/route.ts   # Callback OAuth de Drive
|  +-- api/
|     +-- upload/route.ts             # POST: subida de fotos (rele)
|     +-- likes/toggle/route.ts
|     +-- comments/route.ts           # POST
|     +-- comments/[id]/route.ts      # DELETE
|     +-- photos/[id]/route.ts        # DELETE
|     +-- events/route.ts             # POST
|     +-- events/[eventId]/route.ts   # PATCH / DELETE
|     +-- events/[eventId]/close/route.ts
|     +-- drive/status/route.ts       # GET cuota
|     +-- drive/connect/route.ts      # POST (inicia OAuth)
|     +-- drive/route.ts              # DELETE (desconectar)
+-- components/
|  +-- admin/  (config-form, qr-card, drive-panel, moderation-list, quota-meter)
|  +-- event/  (header, feed, photo-card, caption-box, camera-button)
|  +-- ui/     (button, spinner, toast, modal, empty-state)
+-- lib/
|  +-- supabase/ (client.ts, server.ts, admin.ts, middleware.ts)
|  +-- google/   (oauth.ts, drive.ts, cipher.ts)
|  +-- image/    (compress.ts, heic.ts, thumbnail.ts)
|  +-- rate-limit.ts
|  +-- guest.ts  (cookie anonima del invitado)
|  +-- slug.ts
|  +-- themes.ts + styles/themes.css  (6 temas x 2 variantes, CSS variables)
+-- supabase/
|  +-- migrations/  (0001_*.sql ... 0008_*.sql)
|  +-- seed.sql
+-- middleware.ts                     # Protege /admin, renueva sesion
+-- public/  (favicon, manifest, icons)
+-- .env.local / .env.example
+-- package.json
```

---

## 3. FASES Y TAREAS

Convenciones: [S/M/L] = estimacion relativa de la fase. Cada tarea cierra con un criterio "done" verificable. Las fases 2, 3 y 8 pueden solaparse en paralelo si hay 2 devs.

### FASE 0 — Setup del proyecto (S) — Depende de: nada
**Objetivo**: repositorio desplegado, todos los servicios gratuitos creados y el requisito critico de la publicacion OAuth en marcha.

- **T0.1** Crear repo `picmyevent`: Next.js (App Router) + TypeScript + Tailwind, estructura de carpetas de 2.4, lint + prettier, `README.md` con setup.
  - done: `npm run dev` levanta la landing placeholder; `npm run build` pasa sin errores.
- **T0.2** Crear proyecto Supabase (free): habilitar Auth con provider Google (se anade `https://www.googleapis.com/auth/drive.file` en additionalScopes solo como respaldo; el flujo principal de Drive es OAuth propio, Fase 3), crear bucket publico `thumbs` con cache headers largos (public-read, cache-control immutable 1y), habilitar Realtime para las tablas photos/likes/comments.
  - done: desde el dashboard se ve el bucket y el provider Google activo; `anon` y `service_role` en `.env.local`.
- **T0.3** Google Cloud: crear proyecto, configurar OAuth consent screen (app name PicMyEvent, dominio Vercel, email de soporte), crear credencial OAuth Web (redirect: `/auth/drive-callback` y callback de Supabase Auth), scopes: openid, profile, email, drive.file. **PUBLICAR la app de OAuth** (gratis; la politica de privacidad en /privacy lo permite). Crear pagina `/privacy` (texto: que datos se guardan, donde viven las fotos, como borrarlas, contacto).
  - done: la consent screen figura "In production" (con o sin verificacion, que es opcional para drive.file); `/privacy` desplegada y enlazada en la pantalla de consentimiento.
- **T0.4** Vercel: importar repo, project `picmyevent`, dominio, variables de entorno (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ENCRYPTION_KEY (32 bytes random), APP_URL), deploy inicial.
  - done: `https://<dominio>/` y `/privacy` cargan en produccion; `vercel env` listadas.
- **T0.5** Verificacion de fase: checklist F0 en README (todo green). Documentar en `docs/ADRs.md` la decision de usar el rele Vercel + OAuth propio (y el plan B signed URL como ADR pendiente, ver F5).
  - done: checklist firmado; ADR-001 escrito.

### FASE 1 — Auth de organizador (M) — Depende de: F0
**Objetivo**: el organizador entra con su Google y crea su primer evento.

- **T1.1** Migraciones SQL: tablas `organizers`, `events`, `event_members` (seccion 4) + RLS + funcion `get_event_public(slug)`. Trigger `on_auth_user_created` que crea la fila en `organizers` al registrarse.
  - done: migraciones aplicadas; `psql`/SQL editor verifica policies.
- **T1.2** Auth SSR con `@supabase/ssr`: login con Google (PKCE, `redirectTo` = `/auth/callback`), callback route que intercambia y redirige, `middleware.ts` que protege `/admin*` y renueva la sesion.
  - done: logueado con una cuenta Google real, la sesion persiste entre recargas; `/admin` sin sesion redirige a login.
- **T1.3** Pagina `/admin`: lista "Mis eventos" (vacia por ahora) + pagina "Crear evento": formulario minimo (titulo) -> POST /api/events -> slug nanoid(10) -> redirige a `/admin/[eventId]`.
  - done: creando un evento aparece en la lista con su slug; la fila `event_members` contiene al creador.
- **T1.4** Verificacion: dos cuentas Google distintas pueden crear eventos; ningun invitado (sin sesion) accede a `/admin`.
  - done: probado con 2 cuentas y en incognito.

### FASE 2 — Panel admin basico (M) — Depende de: F1
**Objetivo**: configurar el evento (titulo, nombres, mensaje, foto de bienvenida, tema) y generar/descargar el QR.

- **T2.1** Formulario de config: titulo, nombres de los duenos (lista), mensaje de dedicatoria; PATCH /api/events/[eventId]; guardado con feedback (toast) y persistencia entre recargas.
  - done: los cambios aparecen en `/e/[slug]` (aun sin feed).
- **T2.2** Foto de bienvenida: subir imagen (reusar pipeline de compresion de F4 para el thumb) a Storage `thumbs/{eventId}/welcome.jpg`, guardar URL en `events.welcome_photo_url`; poder quitarla.
  - done: la foto se muestra en el header de `/e/[slug]`; se puede reemplazar y borrar.
- **T2.3** Temas base: definir en `themes.ts` + `styles/themes.css` los 6 temas del handshake (ELEGANTE, FIESTA, NATURALEZA, CLASICO, INSTITUCIONAL, TROPICAL), cada uno con 2 variantes (claro/oscuro), como CSS variables (`--c-bg`, `--c-fg`, `--c-accent`, `--c-card`, `--c-btn`, ...). Selector en el panel (tarjetas de vista previa).
  - done: cambiando de tema, `/e/[slug]` cambia de color sin recargar; 12 combos visibles.
- **T2.4** QR: `qrcode.react` (QRCodeSVG) con URL absoluta APP_URL + "/e/" + slug; boton "Descargar PNG" (render a canvas -> `toDataURL` -> link download); tarjeta con el QR en el panel.
  - done: el PNG descargado se escanea con un lector real y abre `/e/[slug]` correctamente.
- **T2.5** Verificacion: flujo completo "crear evento -> configurar -> descargar QR" sin soporte.
  - done: checklist F2 firmado.

### FASE 3 — Conexion a Google Drive (M) — Depende de: F1
**Objetivo**: el organizador conecta su Drive (drive.file), la app crea la carpeta, guarda los tokens cifrados y muestra la cuota.

- **T3.1** Flujo OAuth PKCE propio: `/api/drive/connect` genera code_challenge/verifier (S256), guarda state+verifier+eventId en cookie httpOnly, redirige a Google (scopes profile email drive.file, prompt=consent para obtener refresh token); `/api/drive/callback` valida state, intercambia code, guarda tokens.
  - done: con la app publicada se obtiene refresh token; en dev con test users, verificar que llega el refresh token (offline access).
- **T3.2** Cifrado de tokens: AES-256-GCM con `ENCRYPTION_KEY` (lib `google/cipher.ts`); tabla `drive_connections` (event_id, organizer_id, folder_id, folder_name, access_token_encrypted, refresh_token_encrypted, token_expires_at, updated_at). Helper `getDriveClient(eventId)` que descifra, refresca el access token si faltan <5 min, y devuelve un cliente autenticado.
  - done: los tokens en la BD estan cifrados (inspeccion visual en SQL editor); `getDriveClient` refresca sin error tras 1 h.
- **T3.3** Crear carpeta: con el token, `files.create` (mimeType `application/vnd.google-apps.folder`, name = `folderName` elegido por el organizador, p.ej. "PicMyEvent - Boda Ana 2025"); guardar `folderId`. UI en el panel: input de nombre + boton "Conectar".
  - done: la carpeta aparece en el Drive real del organizador con ese nombre; el panel muestra "Conectado a <carpeta>".
- **T3.4** Medidor de cuota: `GET /api/drive/status` -> `About.get({fields:'storageQuota'})`; UI con barra (usage/limit), aviso cuando <10% libre; aviso si ya superada.
  - done: la barra muestra valores reales de la cuenta; el aviso <10% se dispara (probado con valor de prueba).
- **T3.5** Verificacion: reconectar no duplica carpetas; desconectar (DELETE /api/drive) limpia tokens y la UI pasa a "Conectar".
  - done: checklist F3 firmado.

### FASE 4 — Pagina del evento + captura/compresion (M) — Depende de: F2 (y F1 para el slug)
**Objetivo**: `/e/[slug]` se ve con el tema y el invitado puede capturar con la camara nativa y preparar la foto (HEIC->JPEG, ~3000 px, <=3,5 MB, thumbnail).

- **T4.1** Pagina `/e/[slug]`: Server Component que llama `get_event_public(slug)`; header con titulo, nombres, mensaje, foto de bienvenida; tema aplicado via CSS variables; pie con boton grande "Tomar foto" (deshabilitado si `status='closed'`); base del feed (lectura simple, sin realtime; se completa en F6).
  - done: con un evento de prueba, la pagina muestra config y tema; slug inexistente -> 404 limpio.
- **T4.2** Captura: `<input type="file" accept="image/*" capture="environment">` oculto disparado por el boton; deteccion HEIC (tipo `image/heic*` o extension .heic) -> `heic2any` (WASM, `toType:'image/jpeg', quality:0.8`); si falla, fallback: aceptar el archivo tal cual (Safari a veces entrega JPEG) o pedir elegir de galeria.
  - done: probado en iPhone real con foto HEIC -> se obtiene Blob JPEG en el cliente.
- **T4.3** Compresion: `browser-image-compression` (maneja orientacion EXIF) a max 3000 px y q0.8; si el resultado >3,5 MB, reducir q a 0.7 o bajar a 2600 px hasta caber (margen sobre el limite de 4,5 MB de Vercel). Generar thumbnail ~400 px (JPEG q0.7, ~50-150 KB) en el mismo paso. Mostrar preview y campo "Mensaje" (caption, opcional).
  - done: fotos de prueba de 8-12 MB (y HEIC) terminan en 1,5-3,5 MB + thumb <200 KB; medido en consola.
- **T4.4** UI de estados: "Procesando...", "Subiendo...", error con reintento manual, limite de concurrentes (1 subida a la vez por invitado para simplificar).
  - done: los estados se ven correctamente en movil lento (devtools throttling 3G).
- **T4.5** Verificacion: ciclo completo en 2 moviles (iPhone + Android).
  - done: checklist F4 firmado.

### FASE 5 — Subida a Drive via Vercel (L) — Depende de: F3 (Drive) y F4 (cliente)
**Objetivo**: POST /api/upload sube la foto al Drive del organizador con reintentos robustos y escribe metadata en Supabase; manejo de los limites duros; plan B documentado.

- **T5.1** Endpoint `POST /api/upload`: acepta FormData (file binario + thumb binario + slug + caption). Valida: tipo imagen, tamano <=3,5 MB, evento activo (via `get_event_public`), caption <=500 chars. **Rate limiting** por `evento+IP` (tabla `rate_limits`: upsert con ventana deslizante, p.ej. max 10 subidas/min por invitado e IP y max 120/min por evento; respuesta 429 con Retry-After).
  - done: curl con foto >3,5 MB -> 413; 11 subidas rapidas -> 429 con Retry-After.
- **T5.2** Subida resumable a Drive: sesion iniciada (POST a la URI de resumable de la API de Drive con metadata name=foto-<photoId>.jpg, parents=[folderId]), PUT por trozos (o un solo PUT del body completo de 2-4 MB; el body cabe en memoria), capturar fileId. Backoff exponential con jitter y respeto de `Retry-After` ante 429/5xx; max 4 reintentos. Idempotencia: en un reintento, continuar el mismo uploadId; si no, crear uno nuevo (la foto no se duplica porque la metadata se inserta despues).
  - done: 30 subidas seguidas desde un script local (alternando 429 simulados con un stub) -> todas terminan con fileId unico en Drive.
- **T5.3** Refresh de token dentro del flujo: `getDriveClient` refresca antes de subir si falta <5 min; si el refresh falla con `invalid_grant` (token muerto), marcar `drive_connections` como rota (campo `needs_reconnect`) y devolver 503 al invitado con mensaje "el evento no acepta fotos por ahora" + aviso al organizador (flag visible en el panel).
  - done: simulado revocando el token -> el invitado ve el aviso y el panel muestra "Reconectar Drive".
- **T5.4** Metadata + thumbnail: subir thumb a `thumbs/{eventId}/{photoId}.jpg` (Storage publico, cache largo), insertar `photos` (drive_file_id, thumb_url, caption, guest_id, size_bytes, width/height), broadcast Realtime. La insercion se hace SOLO despues de confirmar el fileId de Drive (la BD es la fuente de verdad del feed).
  - done: subida real de 20 fotos desde movil -> aparecen en la carpeta de Drive del organizador y en `photos`.
- **T5.5** Manejo de errores de Drive: `403 storageQuotaExceeded` -> aviso al invitado + `events.drive_full=true` para el panel; `403 userRateLimitExceeded`/429 -> backoff; error de red -> reintento en cliente (boton "Reintentar"). UI del invitado simple: "Subida exitosa" / "Error, reintenta".
  - done: con quota simulada al limite, el flujo degrada sin crashear y el panel avisa.
- **T5.6** ADR plan B (documentado, NO implementado): subida directa del cliente a Supabase Storage con signed URL (Vercel solo firma) + copia a Drive en background (cron/trigger). Dejar el ADR-002 en `docs/ADRs.md` con el diseno, por que no se implementa ahora (complejidad; el rele cabe) y cuando activarlo (si >4,5 MB se vuelve problema o 500 simultaneos saturan Vercel).
  - done: ADR-002 escrito y revisado; sin codigo de plan B en el repo.
- **T5.7** Verificacion de fase: 50 fotos reales desde 3 dispositivos distintos; medicion de tiempos en 4G.
  - done: checklist F5 firmado; tiempos p50/p95 registrados en `docs/pruebas.md`.

### FASE 6 — Feed en vivo (M) — Depende de: F5 y F2
**Objetivo**: feed nuevo-primero con likes/comentarios y actualizacion en vivo con fallback a polling.

- **T6.1** Lectura del feed: RPC/vista publica `get_feed(event_id, cursor, limit=30)` ordenada `created_at DESC, id DESC`; paginacion por cursor (se devuelve `next_cursor`). Los thumbs se sirven desde la URL publica de Storage (cache CDN).
  - done: feed con 100 fotos paginado sin duplicados ni huecos (scroll infinito).
- **T6.2** Likes: RPC `toggle_like(photo_id, guest_id)` (guest_id = cookie anonima, creada en el primer uso; UNIQUE(photo_id, guest_id) evita duplicados) + trigger que mantiene `photos.like_count`; endpoint `/api/likes/toggle` con rate limit. UI: corazon con contador y estado activo por invitado.
  - done: 2 invitados dan like a la misma foto; el contador sube/baja sin duplicados; al recargar, el estado del invitado persiste.
- **T6.3** Comentarios: RPC `add_comment(photo_id, guest_id, text)` (valida evento activo y texto) + endpoint `/api/comments` con rate limit (p.ej. 5/min por IP) + trigger `comments_count`; borrado admin via `/api/comments/[id]`. UI: lista + input de comentario por foto.
  - done: comentarios aparecen al instante en 2 moviles; texto con HTML inyectado se muestra como texto plano.
- **T6.4** Realtime + fallback: suscripcion `postgres_changes` (INSERT/DELETE/UPSERT) en `photos`, `likes`, `comments` filtrada por `event_id`; **detector de fallback**: si no llega ningun push en X s (p.ej. 8 s) o tras un error de conexion, pasar a polling cada 8-10 s con cursor + `If-None-Match` (ETag de PostgREST); volver a Realtime si reconecta. Para 500 concurrentes, configurar `?limit=150` de conexiones Realtime y que el resto caiga naturalmente a polling (el cliente lo decide por heartbeat).
  - done: 2 moviles en la misma red: push <3 s; con Realtime bloqueado (simulado), el poll actualiza en <12 s; con 200+ conexiones abiertas no se rompe nada (ver F9).
- **T6.5** Verificacion: moderacion basica desde el panel (ver feed del evento con indicador de fotos/comentarios para borrar) - solo lectura en esta fase.
  - done: checklist F6 firmado.

### FASE 7 — Panel admin avanzado (M) — Depende de: F6
**Objetivo**: moderacion completa, cierre y borrado de evento.

- **T7.1** Borrar foto: `DELETE /api/photos/[id]` -> `files.delete` en Drive (la foto sale del Drive del organizador), borra thumb de Storage y filas (photos + likes + comments + triggers de contadores). UI: grilla del feed en el panel con boton "Borrar" + confirmacion.
  - done: borrando una foto, desaparece de Drive (verificado en la cuenta real), del Storage y del feed en <5 s.
- **T7.2** Borrar comentarios y likes: boton por comentario (T6.3); para likes, poder borrar todos los likes de una foto o los de un guest_id (ver P5). UI consistente con confirmacion.
  - done: cada tipo de borrado verificado en 2 eventos distintos.
- **T7.3** Cerrar evento: POST /api/events/[eventId]/close -> `status='closed'`, `closed_at`; `/e/[slug]` muestra el feed y el mensaje "Evento cerrado" y NO muestra el boton de foto; `/api/upload` rechaza con 403 "Evento cerrado".
  - done: verificado con UI + curl; al abrir el QR despues del cierre el feed sigue visible.
- **T7.4** Borrar evento: DELETE /api/events/[eventId] -> borra thumbs del Storage (listar por prefijo `thumbs/{eventId}/`) y filas de photos/likes/comments/event_members/drive_connections/events (transaccion); Drive intacto. El QR deja de funcionar (404).
  - done: borrado completo verificado (Storage sin archivos residuales; slug -> 404); las fotos siguen en el Drive del organizador.
- **T7.5** Multi-organizador: anadir/eliminar organizadores al evento (por email de su cuenta Google; se anade a `event_members`); todos ven el panel completo; solo quien conecto Drive ve/desconecta la conexion (campo `connected_by`).
  - done: 2 cuentas administran el mismo evento; la conexion Drive es unica y gestionada por su dueno.
- **T7.6** Verificacion: checklist de moderacion recorrida en un evento real de prueba.
  - done: checklist F7 firmado.

### FASE 8 — Temas y pulido (S) — Depende de: F2 (paralelizable)
**Objetivo**: UI terminada, responsive, con estados de carga/error y PWA opcional.

- **T8.1** Completar los 12 combos (6 temas x 2 variantes) con paletas definidas en el handshake (ELEGANTE marfil/dorado y negro/dorado; FIESTA fucsia/violeta y neon; NATURALEZA bosque/madera y arena/terracota; CLASICO blanco/negro y beige/nogal; INSTITUCIONAL azul/rojo-gris; TROPICAL turquesa/arena y coral/amarillo). Contraste verificado (AA para texto).
  - done: 12 combos aplicados en `/e/[slug]` y en el panel (vista previa real).
- **T8.2** Responsive + estados: movil primero; estados loading/skeleton, error con reintento, empty ("Aun no hay fotos, se el primero!"); accesibilidad basica (labels, foco, `aria` en botones de icono).
  - done: revisado en 3 tamanos (360/768/1280) y con lector de pantalla basico (axe sin errores criticos).
- **T8.3** PWA opcional: `manifest.webmanifest` + iconos + `theme-color` (sin service worker complejo; solo "instalar en pantalla"). Si consume mucho, descartar (marcado opcional).
  - done: la app se puede anadir a pantalla de inicio en Android; si se descarta, dejarlo documentado.
- **T8.4** Verificacion visual: screenshots en docs/pruebas.md.
  - done: checklist F8 firmado.

### FASE 9 — Pruebas de concurrencia y despliegue final (L) — Depende de: F5-F8
**Objetivo**: demostrar que aguanta 100-500 invitados simultaneos (subiendo y viendo) en el plan gratuito, y cerrar el despliegue.

- **T9.1** Script de carga de subidas: script Node (o k6) que simula N invitados (N = 100, 250, 500) subiendo fotos de 2-3 MB reales contra /api/upload con IPs/guest_ids distintos (respetando el rate limit configurado, o subiendolo en el entorno de test). Medir: exito %, p95 latencia, 429/5xx, tiempo total.
  - done: informe con la tabla de resultados por N; sin perdida de datos (todas las filas tienen fileId).
- **T9.2** Script de carga del feed: N clientes suscritos a Realtime + N en polling (mezcla 50/50 y 100% polling para 500); medir p95 de propagacion de una foto nueva y errores de conexion.
  - done: con 500 en polling, la foto nueva se ve en <12 s p95; Realtime con <150 no se cae.
- **T9.3** Analisis y ajustes: en base a resultados, ajustar (tamano de compresion, backoff, limite de rate, cache de thumbs, `?limit=` de Realtime). Repetir la prueba del caso peor.
  - done: el caso peor (500) pasa con margen; resultados finales en docs/pruebas.md.
- **T9.4** Checklist de despliegue final: app OAuth publicada y verificada (o advertencia documentada), /privacy OK, envs de produccion, sin secretos en el repo, backup basico de Supabase habilitado, dominio y HTTPS, prueba de humo completa en produccion (organizador real + 2 moviles).
  - done: checklist firmado; deploy a produccion verificado.
- **T9.5** Cierre: informe final (resultados, limites conocidos, guia de operacion para el organizador, "como repetir el evento").
  - done: informe final en docs/ entrega; repo etiquetado v1.0.

### Mapa de dependencias

```
F0 --> F1 --> F2 --> F4 --> F5 --> F6 --> F7 --> F9
        |      |      |       |       |
        |      |      +------>|       |
        |      +------------->|       |
        +----------> F3 ----->|       |
        F2 --> F8 (paralelo) ----------+
```
(Con 2 devs: dev A hace F1->F2->F4->F5->F6; dev B hace F3 y F8 en paralelo, luego ayuda en F7/F9.)

**Estimaciones**: F0 S · F1 M · F2 M · F3 M · F4 M · F5 L · F6 M · F7 M · F8 S · F9 L.
**Estimacion general: L** — ~47 tareas; 6-8 semanas a tiempo completo con 2 desarrolladores (o 10-14 semanas con 1 dev); las fases criticas son F5 (subida robusta) y F9 (concurrencia). Sin plazos duros (decision del proyecto), se prioriza "bien hecha".

---

## 4. ESQUEMA DE BASE DE DATOS

Todo en Postgres de Supabase (free). Migraciones numeradas en `supabase/migrations/`. RLS activado en todas las tablas; el cliente usa la anon key con policies; el backend de Vercel usa `service_role` SOLO donde hace falta (upload, borrados, cifrado).

### 4.1 `organizers`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | = `auth.users.id` (FK a auth.users, on delete cascade) |
| email | text UNIQUE NOT NULL | de la cuenta Google |
| display_name | text | del perfil Google |
| created_at | timestamptz default now() | |

RLS: `select/update` para `auth.uid() = id`. Trigger `handle_new_user` inserta la fila al registrarse.

### 4.2 `events`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK default gen_random_uuid() | |
| slug | text UNIQUE NOT NULL | nanoid(10) base64url, `^[a-z0-9_-]{8,32}$`; retry en colision |
| title | text NOT NULL | |
| owner_names | text[] NOT NULL default '{}' | nombres de los duenos |
| message | text | dedicatoria (nullable) |
| welcome_photo_url | text | thumb de bienvenida en Storage |
| theme_key | text NOT NULL default 'clasico' | 6 temas |
| theme_variant | text NOT NULL default 'light' | 'light' | 'dark' |
| status | text NOT NULL default 'active' CHECK (status in ('active','closed')) | |
| created_by | uuid NOT NULL FK organizers | |
| created_at | timestamptz default now() | |
| closed_at | timestamptz | |
| drive_full | bool default false | se marca al recibir storageQuotaExceeded |
| max_photos | int | limite opcional por evento (default null = sin limite) |

Indices: UNIQUE(slug); `idx_events_status ON events(status)`.
RLS: anon NO puede leer la tabla (usa la funcion `get_event_public(slug)`, security definer, que devuelve solo campos publicos: slug, title, owner_names, message, welcome_photo_url, theme_key, theme_variant, status, created_at; drive_full NO se expone). Organizadores (miembros de `event_members`): select/update/delete completos.

### 4.3 `event_members`
| Campo | Tipo | Notas |
|---|---|---|
| event_id | uuid FK events ON DELETE CASCADE | |
| organizer_id | uuid FK organizers ON DELETE CASCADE | |
| role | text default 'admin' | todos admin en v1 |
| created_at | timestamptz default now() | |
| PK (event_id, organizer_id) | | |

RLS: insert/select/delete solo si `auth.uid()` ya es miembro del mismo evento (o el creador). Helper SQL `is_event_member(event_id uuid, uid uuid)`.

### 4.4 `drive_connections`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| event_id | uuid UNIQUE FK events ON DELETE CASCADE | 1 conexion por evento (decision 15) |
| organizer_id | uuid NOT NULL FK organizers | quien conecto |
| folder_id | text NOT NULL | id de la carpeta creada |
| folder_name | text NOT NULL | nombre visible |
| access_token_encrypted | text NOT NULL | AES-256-GCM |
| refresh_token_encrypted | text NOT NULL | AES-256-GCM |
| token_expires_at | timestamptz | del access token |
| needs_reconnect | bool default false | token invalid_grant |
| updated_at | timestamptz | |

RLS: select/update/delete SOLO miembros del evento; los tokens estan cifrados y el cliente NUNCA los lee (solo el backend con service_role los descifra). Policy helper: `is_event_member(event_id)`.

### 4.5 `photos`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK default gen_random_uuid() | tambien se usa como nombre del archivo en Drive y Storage |
| event_id | uuid NOT NULL FK events ON DELETE CASCADE | |
| drive_file_id | text UNIQUE | fileId de Drive (idempotencia) |
| thumb_url | text NOT NULL | URL publica `thumbs/{eventId}/{id}.jpg` |
| caption | text | mensaje del invitado (<=500 chars) |
| guest_id | text NOT NULL | cookie anonima del invitado |
| width / height | int | del JPEG comprimido |
| size_bytes | int | |
| like_count | int NOT NULL default 0 | denormalizado (trigger) |
| comment_count | int NOT NULL default 0 | denormalizado (trigger) |
| created_at | timestamptz default now() | |

Indices: `idx_photos_feed ON photos(event_id, created_at DESC, id DESC)` (cursor del feed); UNIQUE(drive_file_id).
RLS: anon select de las filas de eventos publicos (la fila no contiene datos sensibles — thumb_url y caption son publicos por diseno); insert/delete solo backend (service_role) y admin.

### 4.6 `likes`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| photo_id | uuid FK photos ON DELETE CASCADE | |
| event_id | uuid FK events ON DELETE CASCADE | denormalizado para RLS/borrado |
| guest_id | text NOT NULL | |
| created_at | timestamptz default now() | |
| UNIQUE (photo_id, guest_id) | | un like por invitado por foto |

RLS: anon select; insert/delete via RPC `toggle_like` (SECURITY DEFINER) que ademas mantiene `photos.like_count`.

### 4.7 `comments`
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| photo_id | uuid FK photos ON DELETE CASCADE | |
| event_id | uuid FK events ON DELETE CASCADE | |
| guest_id | text NOT NULL | |
| text | text NOT NULL CHECK (char_length(text) between 1 and 500) | |
| created_at | timestamptz default now() | |

Indices: `idx_comments_feed ON comments(photo_id, created_at)`. RLS: anon select; insert via RPC `add_comment` (valida evento activo); delete admin (miembro).

### 4.8 `rate_limits` (opcional, para el rate limiting sin servicios externos)
| Campo | Tipo | Notas |
|---|---|---|
| key | text PK | `upload:{eventId}:{ip}` etc. |
| count | int NOT NULL | |
| window_start | timestamptz NOT NULL | ventana deslizante |
| updated_at | timestamptz | |

Alternativa evaluada: Upstash Redis free (10k req/dia) — se prefiere Postgres para no depender de otro servicio; el costo es 1 upsert por llamada. Documentar en ADR-003.

### 4.9 Funciones/RPC publicas (SECURITY DEFINER)
- `get_event_public(slug text) returns events_public` — datos del header para /e/[slug].
- `get_feed(event_id uuid, cursor timestamptz, limit int default 30)` — pagina del feed (fotos + like_count + comment_count + primeros comentarios, si se quiere).
- `toggle_like(photo_id uuid, guest_id text)` returns (liked bool, count int).
- `add_comment(photo_id uuid, guest_id text, text text) returns comments`.
- `delete_comment(comment_id uuid, uid uuid)` / `delete_photo(photo_id uuid)` — llamadas por el backend con service_role (validan membresia).

---

## 5. RIESGOS Y MITIGACIONES (top 5 del informe + como se mitigan en este plan)

| # | Riesgo | Detalle | Mitigacion en el plan |
|---|---|---|---|
| 1 | **Refresh token de Google muere a los 7 dias** (modo testing) | El organizador tendria que reconectar cada semana; inviable en produccion | **T0.3: publicar la app de OAuth en la Fase 0** (gratis; consent screen + /privacy). En desarrollo se usan test users y se asume reconexion semanal. En produccion: T5.3 detecta `invalid_grant`, marca `needs_reconnect` y avisa en el panel para reconectar. Monitorear en F9. |
| 2 | **Limites duros de Vercel: body 4,5 MB / funcion 60 s** | Fotos grandes o redes moviles lentas rompen la subida | T4.3 fuerza JPEG <=3,5 MB (3000 px q0.8, bajando q a 0.7 o 2600 px si excede); T5.1 valida en el endpoint (413); body binario directo (nunca base64); T5.2 resumable con reintentos; T4.4 UI de reintento. **Plan B**: ADR-002 (signed URL a Supabase Storage + copia a Drive en background) documentado en T5.6, listo para activar si hace falta. Medir tiempos 3G/4G en T5.7. |
| 3 | **Realtime free: 200 conexiones concurrentes < 500 invitados** | El push no llega a 500 simultaneos | T6.4: arquitectura hibrida desde el inicio — Realtime con `?limit=150` para eventos pequenos y **fallback automatico a polling 8-10 s con cursor + ETag** (el cliente detecta ausencia de push/heartbeat). El polling de 500 clientes (~6.000 req/min) lo aguanta PostgREST con los indices de 4.5/4.6. Probar ambos modos en T9.2. |
| 4 | **Capacidad: 15 GB de Drive del organizador + 1 GB de Storage de Supabase** | ~5.000 fotos/cuenta; los thumbs llenan 1 GB si no se limpian | T3.4 medidor de cuota con About.get + barra y aviso <10%; T5.5 marca `drive_full` y avisa; T7.1 borra foto (Drive + Storage) y T7.4 borra evento limpiando TODOS los thumbs (listar por prefijo); limite opcional `events.max_photos`; aviso por email al 80% (opcional, si se configura en F7). |
| 5 | **UX limitada de drive.file: no puede elegir carpeta existente + advertencia "app no verificada"** | El organizador espera elegir su carpeta | T3.3: la app SIEMPRE crea la carpeta con el nombre que el organizador elige (decision 17); texto explicativo en el panel ("Las fotos caen en una carpeta nueva de tu Drive"). Publicar la app (T0.3) quita la advertencia (la verificacion de scope sensitive es opcional y solo quita el aviso). Desconectar/reconectar limpio en T3.5. |

**Riesgos menores gestionados en el plan**: colisiones de slug (nanoid + UNIQUE + retry, T1.3); abuso del QR publico (rate limiting T5.1/T6.3, moderacion T7, cierre T7.3); contenido inapropiado (moderacion T7.1/T7.2); banda de Vercel 100 GB/mes (~30 eventos de 500 fotos; aceptable, vigilar en F9); 50.000 MAU de Auth (irrelevante: solo organizadores se autentican).

---

## 6. CRITERIOS DE ACEPTACION (la app esta lista cuando...)

1. **Onboarding**: un organizador nuevo, sin ayuda, crea su evento, lo configura (titulo, nombres, mensaje, foto de bienvenida, tema), conecta su Drive (la app crea la carpeta), descarga el QR y lo imprime — todo en <10 minutos (verificado en F2/F3).
2. **Captura y subida**: un invitado con iPhone (foto HEIC) y otro con Android escanean el QR, toman fotos, escriben un mensaje, y la foto comprimida (~3000 px, <=3,5 MB) aparece en la carpeta de Drive del organizador Y en el feed, en <10 s tras pulsar subir (verificado en F4/F5).
3. **Feed en vivo**: las fotos nuevas aparecen en el feed de los demas en <3 s con Realtime (<150 conectados) y en <12 s con polling (500 conectados); orden nuevo-primero, paginacion por cursor sin duplicados (F6, F9).
4. **Interaccion**: los invitados dan likes y comentan; los contadores se actualizan en vivo; un invitado no puede dar dos likes a la misma foto; el texto se renderiza seguro (F6).
5. **Moderacion y ciclo de vida**: el organizador borra fotos (desaparecen de Drive, Storage y feed), comentarios y likes; cierra el evento (el feed sigue visible, el boton de foto desaparece y /api/upload rechaza con 403); borra el evento entero (el QR muere con 404, el Storage queda limpio, el Drive intacto) (F7).
6. **Multi-organizador**: dos organizadores administran el mismo evento; solo el que conecto Drive gestiona la conexion (F7.5).
7. **Escala**: la prueba de concurrencia con 500 invitados simultaneos (subiendo y viendo) no pierde datos, no supera los limites de Vercel/Supabase y queda documentada con tiempos p95 (F9).
8. **Cuota**: el panel muestra el uso real del Drive y avisa antes de llenarse; ante `storageQuotaExceeded` la app degrada con avisos claros, sin crashear (F3/F5).
9. **Produccion real**: la app OAuth esta publicada (o la limitacion documentada), /privacy accesible, sin secretos en el repo, deploy verificado y la prueba de humo completa en produccion (F9.4).
10. **Coste cero**: todo el stack corre en los planes gratuitos; no hay ningun servicio de pago en la arquitectura (cualquier excepcion queda marcada como riesgo en ADRs).

---

## 7. PREGUNTAS QUE EL EQUIPO DEBERA RESOLVER EN IMPLEMENTACION

| # | Pregunta | Recomendacion |
|---|---|---|
| P1 | Idioma de la interfaz (decision aun abierta del handshake) | **Espanol para v1** (recomendado por el usuario). Disenar con textos en un archivo `messages/es.ts` para facilitar i18n futura. |
| P2 | Frecuencia exacta del polling de respaldo | **8-10 s** (informe). Empezar en 10 s y bajar a 8 si la latencia lo permite; usar cursor + ETag desde el dia 1 (T6.4). |
| P3 | Identidad del invitado (para likes, comentarios y moderacion) | **Cookie anonima `guest_id`** (UUID v4, httpOnly, 1 año) creada en el primer uso. Sin fingerprinting (privacidad + simplicidad). |
| P4 | Limite de fotos por evento (decision 8: "sin limites"; el informe sugiere limite configurable) | **Sin limite por defecto** (respetar la decision), pero dejar `events.max_photos` implementado como tope opcional que el organizador puede activar; el limite real es la cuota (medidor + avisos). |
| P5 | Borrar un "like inapropiado": el like no tiene autor visible | **Dos opciones en el panel**: borrar todos los likes de una foto, o ver la actividad por `guest_id` (lista de aportaciones del invitado) y borrar sus likes/comentarios/fotos. Empezar por la primera. |
| P6 | Borrado de fotos de Drive: `files.delete` (duro) vs `files.trash` (papelera) | **Trash** (recuperable 30 dias, mejor UX si el organizador se arrepiente) — el alcance drive.file lo permite. Documentar que el invitado NO puede recuperar nada. |
| P7 | Rate limiting: tabla en Postgres vs Upstash Redis free | **Tabla `rate_limits` en Postgres** (cero dependencias, gratis). Upstash solo si las escrituras de rate limit compiten con el feed (medir en F9). |
| P8 | PWA: manifest sin service worker vs nada | **Manifest + icons solo** (instalable, sin SW complejo). Si consume tiempo, descartar (es opcional, F8.3). |
| P9 | `provider_token` de Supabase Auth (Google) vs OAuth propio para Drive | **OAuth propio PKCE** (recomendado por el informe: control total del refresh token cifrado, no depende de la vida de la sesion de Supabase). El flujo de Supabase Auth queda solo para la identidad del organizador. |

---

## ANEXO A — Checklist critico de inicio (orden de ejecucion recomendado)

1. (F0) Crear repo y desplegar en Vercel lo antes posible — todo lo demas cuelga de ahi.
2. (F0) **Publicar la app OAuth de Google y crear /privacy** — es el unico bloqueador real del informe; hacerlo al principio para que los refresh tokens duren.
3. (F1) Auth de organizador + crear evento (slug) — desbloquea el resto del panel.
4. (F3) Conectar Drive antes de F5 — la subida depende de tener la carpeta.
5. (F4) Compresion <=3,5 MB antes de tocar el endpoint de subida — el limite de Vercel no se negocia.
6. (F5) Subida robusta (resumable + backoff + rate limit) — es la fase L; reservarle el tiempo que merece.
7. (F6) Feed con fallback a polling desde el dia 1 — no dejar Realtime como unica via.
8. (F9) Probar 500 antes de darlo por terminado — el objetivo de escala se demuestra, no se asume.

# Informe final — PicMyEvent (F9, entrega)

Version objetivo: v1.0 · Stack 100% gratuito: Vercel (Hobby) + Supabase (Free)
+ Google Drive del organizador.

## 1. Que se construyo

App web multi-evento (Next.js App Router + TS + Tailwind, espanol) donde un
organizador crea su evento con su cuenta de Google, genera/descarga un QR
(/e/<slug>), conecta su Google Drive (la app crea la carpeta) y los invitados
escanean el QR, toman fotos con la camara nativa (HEIC -> JPEG, comprimidas a
~3000 px <= 3,5 MB) que caen en la carpeta de Drive del organizador, con feed
en vivo (fotos + mensajes + likes + comentarios) servido SOLO desde Supabase
(thumbs en Storage publico; Drive nunca se lee para el feed).

Fases implementadas: F0 (scaffold + /privacy + temas), F1 (auth organizador +
esquema Supabase 8 tablas + RLS + RPCs), F2 (panel basico: crear evento,
config, QR), F3 (OAuth PKCE drive.file propio + tokens cifrados + cuota),
F4 (pagina /e/[slug] + captura/compresion cliente), F5 (POST /api/upload:
rele Vercel, resumable con backoff, rate limit, thumbs, photos),
F6 (feed en vivo: likes/comments + Realtime con fallback polling),
F7 (moderacion API: borrar foto/comentario, cerrar, borrar evento),
F8 (temas + responsive + estados), F9 (este documento + scripts de carga).

## 2. Resultados de concurrencia

Estado: **PENDIENTE DE EJECUCION CONTRA EL DEPLOY REAL** (requiere envs
reales + migraciones 0001-0011 + Realtime + evento con Drive; checklist en la
seccion 6). Procedimiento y criterios en docs/pruebas.md. Objetivos del plan:

### Subidas (scripts/load-test.ts, N=100/250/500)

| N | Exito % (obj >= 99) | p50 | p95 (obj < 10 s) | 429 | 5xx | Tiempo | Estado |
|---|---|---|---|---|---|---|---|
| 100 |  |  |  |  |  |  | PENDIENTE |
| 250 |  |  |  |  |  |  | PENDIENTE |
| 500 |  |  |  |  |  |  | PENDIENTE |

### Feed (scripts/load-feed.mjs)

| Config | Clientes | p95 propagacion (obj) | Estado |
|---|---|---|---|
| Realtime | 100 | < 3 s | PENDIENTE |
| Polling | 500 | < 12 s | PENDIENTE |

Criterios: sin perdida de datos (todas las filas de photos con drive_file_id),
429 reintentados hasta 200, 507 drive_full degrada sin crashear, feed nunca
golpea Drive (d14/d17).

## 2b. Como ejecutar las pruebas F9 (checklist)

Estado: las tablas de la seccion 2 estan PENDIENTES hasta ejecutar contra el
deploy real. Pasos:

1. Completar el checklist de despliegue (seccion 6): envs reales en Vercel,
   migraciones 0001-0011 aplicadas, bucket "thumbs" publico, Realtime
   publication activa, app OAuth publicada, /privacy accesible.
2. Crear un evento de prueba en /admin, conectar su Drive (carpeta creada por
   la app) y anotar el slug.
3. Subidas (T9.1): node scripts/load-test.ts --base https://TU-DOMINIO --slug
   <slug> --guests 100|250|500 [--retry-on-429 true] -> copiar la FILA_TABLA a
   la seccion 2 y a docs/pruebas.md.
4. Feed (T9.2): node scripts/load-feed.mjs --feed-url <url-json-del-feed>
   --clients 500 --interval 10 --duration 180; mientras corre, subir una foto
   y medir el p95 de propagacion (upload -> primer poll que la muestra).
5. Registrar tiempos p50/p95, 429/5xx y el resultado de las validaciones
   (backoff 429/403, storageQuotaExceeded 507) en las tablas de la seccion 2.
6. Ajustes si hace falta (T9.3): tamano de compresion, backoff, rate limits,
   cache de thumbs, intervalo de polling; repetir el caso peor (500).

Criterios de aceptacion (objetivo): exito >=99% (o 100% menos 429 esperados),
p95 latencia <10 s; propagacion <3 s Realtime (<150 clientes) y <12 s polling
(500 clientes); sin perdida de datos (todas las filas de photos con
drive_file_id) y feed que NUNCA golpea Drive (d14/d17).

## 3. Limites conocidos

- Vercel Hobby: body 4,5 MB (compresion <=3,5 MB), funcion 60 s, banda
  100 GB/mes (~30 eventos de 500 fotos).
- Supabase Free: 200 conexiones Realtime (fallback polling desde el dia 1),
  500 MB DB, 1 GB storage (thumbs ~100 KB/foto), 5 GB egress.
- Drive 15 GB del organizador (~5.000 fotos de 3 MB): medidor de cuota + aviso
  <10% + 507 ante storageQuotaExceeded (events.drive_full).
- drive.file: la app solo ve archivos que ella crea; la carpeta la crea SIEMPRE
  la app (el organizador elige el nombre); advertencia "app no verificada"
  hasta publicar/verificar (la verificacion sensitive es opcional).
- Tokens de Google: la app OAuth debe estar PUBLICADA (en testing el refresh
  token muere a los 7 dias); ante invalid_grant el panel guia a reconectar.
- Plan B documentado (ADR-002) si el rele o los limites de Vercel se saturan.

## 4. Guia de operacion del organizador

1. Entrar en /admin con su cuenta de Google.
2. "Crear evento": titulo (y nombres/mensaje/tema/foto de bienvenida desde el
   panel del evento). La app genera el slug y el QR.
3. Descargar el QR (PNG), imprimirlo y colocarlo en el evento.
4. En el panel del evento, tab Drive: elegir nombre de carpeta y "Conectar" ->
   autorizar en Google (alcance drive.file). Las fotos caeran ahi.
5. Los invitados escanean el QR: toman fotos (la app comprime), escriben un
   mensaje opcional y suben; el feed las muestra en vivo con likes/comentarios.
6. Moderacion: desde el panel pueden borrar fotos (papelera de Drive, 30 dias
   recuperables), comentarios y likes.
7. Cerrar el evento cuando quieran: el feed queda visible (solo lectura para
   invitados) y el boton de foto desaparece.
8. Borrar el evento: elimina la app, el QR muere (404) y las fotos quedan en su
   Drive. Desconectar Drive solo quita la conexion (carpeta intacta).

## 5. Como repetir el evento

- Crear un evento nuevo desde /admin (nuevo slug + nuevo QR).
- Conectar Drive con una carpeta nueva (o la misma cuenta).
- El evento anterior queda cerrado/visible o se borra; no hay datos
  compartidos entre eventos.

## 6. Checklist de despliegue final (T9.4)

- [ ] App OAuth de Google PUBLICADA ("In production"); consent screen con
      scopes profile, email, drive.file y redirecciones
      /api/auth/callback y /api/drive/callback.
- [ ] /privacy accesible en produccion y enlazada en la pantalla de consent.
- [ ] Envs de produccion en Vercel: NEXT_PUBLIC_SUPABASE_URL/ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID/SECRET, GOOGLE_REDIRECT_URI,
      TOKEN_ENCRYPTION_KEY (32 bytes base64), NEXT_PUBLIC_APP_URL.
- [x] Sin secretos en el repo (.env*.local en .gitignore; verificacion
      "git grep" de claves) — commit f8f2042 verificado (95 archivos, sin
      .env.local ni node_modules).
- [ ] Migraciones 0001-0012 aplicadas en Supabase + Realtime publication con
      photos/likes/comments + bucket "thumbs" publico.
- [ ] Backup basico de Supabase habilitado (dashboard: Database > Backups).
- [ ] Dominio y HTTPS funcionando.
- [x] Repo git inicializado en main con commit v1.0 inicial (f8f2042).
- [ ] Prueba de humo completa en produccion: organizador real crea evento,
      conecta Drive, descarga QR; 2 moviles (iPhone HEIC + Android) suben
      fotos; verificacion en Drive y feed; cerrar y borrar evento.
- [ ] Resultados de T9.1/T9.2 pegados en la seccion 2 y en docs/pruebas.md.

## 7. Entrega

- Repo etiquetado v1.0 (git tag v1.0) tras pasar el checklist.
- Este informe en docs/entrega/informe-final.md.
- ADRs en docs/ADRs.md · pruebas en docs/pruebas.md · scripts en scripts/.

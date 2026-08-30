# INFORME DE VIABILIDAD TECNICA - App de fotos de eventos (Vercel + Supabase + Google Drive)

Verificacion de fuentes: junio 2026 (los limites de los planes gratuitos cambian; se indica la fuente oficial de cada dato).

---

## 1. SUBIDA A GOOGLE DRIVE (backend Vercel, sin exponer credenciales)

(a) RESPUESTA. La forma correcta es el rele por backend: el celular NUNCA toca credenciales de Google; envia la foto al endpoint de Vercel y la funcion serverless la sube a Drive con el token del organizador. Evaluacion de las dos opciones:
- (a) Backend con access/refresh token OAuth del organizador (recomendada): el archivo queda "owned" por el organizador y cuenta contra sus 15 GB (ver Q4). El access token expira ~1 h; hay que refrescarlo con el refresh token (guardado cifrado en Supabase/Vercel). Punto critico: en modo testing de Google Cloud el refresh token muere a los 7 dias (ver Q5); hay que publicar la app de OAuth.
- (b) Service account: NO puede subir a la carpeta de una cuenta personal directamente, pero si si compartes la carpeta del organizador con el email de la service account (funciona con cuentas personales). Ventaja: no hay OAuth por usuario, no hay problema de los 7 dias, la key JSON va en env vars de Vercel. Desventajas: los archivos quedan "owned" por la SA (cuentan contra el storage de la SA, tambien 15 GB; si se llena da StorageQuotaExceeded), y el organizador no puede borrarlos desde "Mi unidad" (si desde la carpeta compartida).

Limites de la API de Drive: simple/multipart upload max. 5 MB; resumable upload hasta 5 TB (nuestras fotos de 2-4 MB caben en multipart, pero resumable es mas robusto en movil: reintenta trozos). Existen limites por usuario por ventana de 100 s y un limite diario por proyecto (los valores exactos por endpoint estan en la pagina oficial Usage limits; con 100-500 subidas simultaneas todo pasa por UN solo token del organizador, asi que en rafagas de >1.000 llamadas/100 s se puede tocar el limite por usuario). Los errores 429/403 se manejan con exponential backoff con jitter (respetar Retry-After) y una cola de subidas con reintentos idempotentes (la API de Drive da el fileId, asi que un reintento no duplica si se usa el mismo uploadId resumable).

(b) FUENTES.
- https://developers.google.com/workspace/drive/api/guides/manage-uploads - tipos de upload, limite 5 TB resumable (verificado 2026).
- https://developers.google.com/workspace/drive/api/guides/limits - usage limits por usuario/proyecto (verificado 2026).
- https://stackoverflow.com/questions/68483840/how-to-resolve-a-403-error-user-rate-limit-exceeded-in-google-drive-api - manejo de 403 userRateLimitExceeded (verificado 2026).
- https://discuss.google.dev/t/storagequotaexceeded-the-users-drive-storage-quota-has-been-exceeded-for-service-account/104375/7 - limite de storage de service accounts.
- https://rcloneview.com/support/blog/cloud-api-rate-limits-explained-rcloneview - 429/backoff.

(c) RECOMENDACION. Rele en Vercel con token OAuth del organizador + scope drive.file; subida resumable; body binario directo (NUNCA base64, infla 33%); cola + backoff con jitter; refrescar el access token 5 min antes de expirar; guardar el refresh token cifrado y con RLS. Tener la service account como plan B (folder compartida con su email) si el token del organizador falla por el tema de los 7 dias.

(d) BLOQUEADOR: No para 2-4 MB. Los limites duros son el body de 4,5 MB y los 60 s de Vercel (ver Q7) y la caducidad de 7 dias del refresh token en testing (ver Q5).

---

## 2. FEED EN VIVO SIN GOLPEAR DRIVE

(a) RESPUESTA. El feed lee SOLO Supabase: tabla de fotos con metadata (autor, mensaje, likes, comentarios, URL de thumbnail) + Realtime para el push. Supabase Realtime en el plan free: 200 conexiones concurrentes y 200 mensajes/seg. Con 100-500 usuarios: hasta ~150 concurrentes Realtime aguanta; para 500 NO llega, por lo que se necesita fallback a polling (cada 5-10 s con cursor last_id y ETag/If-None-Match de PostgREST; 500 usuarios x 12 req/min ~= 6.000 req/min, que PostgREST maneja bien con indices).

Thumbnails: descartar thumbnailLink de Drive v3 para el feed: requiere cabecera Authorization (no es hotlinkeable) y pegarla a la API de Drive en cada lectura, justo lo que la decision del proyecto prohibe. Opciones reales:
1. Generar el thumbnail en el cliente (canvas, JPEG/WebP de 300-500 px, ~50-150 KB) y subirlo junto al original a Supabase Storage (bucket publico + CDN); el feed muestra esa URL.
2. Generarlo en el backend (sharp) al recibir la foto (consume tiempo de los 60 s de Vercel).

El plan free de Supabase incluye 1 GB de file storage y 5 GB de egress, por lo que los thumbs caben (1.000 fotos x 100 KB ~= 100 MB), pero hay que borrarlos al eliminar eventos.

(b) FUENTES.
- https://supabase.com/docs/guides/realtime/limits - 200 conexiones concurrentes / 200 msg/s en free (verificado 2026).
- https://supabase.com/docs/guides/realtime/pricing - pricing de Realtime (verificado 2026).
- https://supabase.com/pricing - 500 MB DB, 1 GB storage, 5 GB egress en free (verificado 2026).

(c) RECOMENDACION. Arquitectura hibrida: Realtime cuando el evento tenga <150 concurrentes con auto-fallback a polling 8-10 s al superarlo (o polling puro para simplificar). Thumbnails SIEMPRE en Supabase Storage publico con cache headers largos; la URL de thumb va en la fila de Supabase; el original vive solo en Drive.

(d) BLOQUEADOR: Realtime free no cubre 500 concurrentes, pero no es bloqueador si aceptas polling/hibrido, que si cubre 500 sin costo.
---

## 3. CAMARA NATIVA DESDE EL NAVEGADOR + HEIC + COMPRESION

(a) RESPUESTA. Metodo correcto: <input type="file" accept="image/*" capture="environment">. En iOS Safari (>=13) y Android Chrome abre la camara trasera nativa directamente; sin capture abre el selector. getUserMedia NO se usa (camara embebida, no querida).

HEIC: iOS Safari entrega el HEIC original en el input (en algunos flujos lo convierte solo; no es confiable). Solucion probada: heic2any (WASM, convierte HEIC a JPEG en el cliente; necesario porque Chrome no decodifica HEIC en canvas). Luego redimensionar a ~3000 px y comprimir con canvas.toBlob('image/jpeg', 0.8) o la libreria browser-image-compression (envuelve canvas y arregla la orientacion EXIF con createImageBitmap + image-orientation 'from-image'). Resultado esperado: JPEG 2-4 MB.

(b) FUENTES.
- https://zenn.dev/kou_pg_0131/articles/safari-input-file-heic - Safari y HEIC en file input (verificado 2026).
- https://news.ycombinator.com/item?id=23260987 - discusion HEIC a JPEG en iOS (verificado 2026).
- https://www.npmjs.com/package/@kbrt38/heic2any - heic2any (WASM) (verificado 2026).
- https://safeguard.sh/resources/blog/browser-image-compression - browser-image-compression en cliente (verificado 2026).

(c) RECOMENDACION. Input file + capture="environment"; si file.type es HEIC (o extension .heic) aplicar heic2any; despues resize a 3000 px + JPEG q0.8 con canvas; generar ademas el thumbnail (Q2) en el mismo paso; subir ambos.

(d) BLOQUEADOR: No. Fallback si heic2any falla: pedir al usuario elegir desde la galeria o aceptar el archivo tal cual (Safari a veces ya lo entrega como JPEG).

---

## 4. ALMACENAMIENTO DE DRIVE (15 GB)

(a) RESPUESTA. Toda cuenta gratuita de Google tiene 15 GB compartidos entre Drive, Gmail y Google Fotos. Cuando se llena: Drive deja de sincronizar, no se pueden subir archivos y la API devuelve 403 storageQuotaExceeded. Para detectarlo: GET https://www.googleapis.com/drive/v3/about?fields=storageQuota devuelve {limit, usage, usageInDrive} (1 llamada, sin coste relevante). Capacidad: ~15 GB / 3 MB ~= 5.000 fotos por cuenta (3.750-7.500 segun 2-4 MB). Con 500 fotos/evento son ~10-15 eventos por cuenta (menos si el organizador usa Gmail/Fotos).

(b) FUENTES.
- https://support.google.com/drive/answer/6374270 - gestion del almacenamiento de 15 GB (verificado 2026).
- https://developers.google.com/resources/api-libraries/documentation/drive/v3/python/latest/drive_v3.about.html - endpoint About/storageQuota (verificado 2026).
- https://discuss.google.dev/t/storagequotaexceeded-the-users-drive-storage-quota-has-been-exceeded-for-service-account/104375/7 - error al superar quota (verificado 2026).

(c) RECOMENDACION. Chequear About.get al entrar el organizador al admin y antes de cada evento; UI con barra de uso; bloqueo de subidas con aviso cuando quede <10%; limite configurable de fotos por evento; avisar por email al 80%.

(d) BLOQUEADOR: No, pero es una limitacion de capacidad real: planificar multi-cuenta o limpieza para eventos de mucho volumen.

---

## 5. AUTENTICACION GOOGLE + SUPABASE (OAuth, tokens, drive.file)

(a) RESPUESTA. Dos caminos:
1. Supabase Auth con provider Google + additionalScopes ['https://www.googleapis.com/auth/drive.file'] (configurable en dashboard). Supabase guarda provider_token/provider_refresh_token en la sesion y los refresca automaticamente mientras la sesion este viva (supabase-js autoRefreshToken). Util para el organizador dentro de la sesion.
2. Flujo OAuth propio con PKCE para el organizador, guardando el refresh token cifrado en Supabase (tabla con RLS solo-admin o Vault). Mas control y permite recargar tokens en background.

CRITICO (verificado): en modo testing de Google Cloud, los refresh tokens expiran a los 7 dias (miles de reportes: gmail-tester #139, posts de 2026, invalid_grant "Token has been expired or revoked"). Para tokens duraderos hay que publicar la app de OAuth ("In production"): se necesita consent screen completo y una politica de privacidad alojada (una pagina /privacy en Vercel sirve). drive.file es scope SENSITIVE (no restricted), por lo que NO exige la verificacion completa de Google; pero mientras la app no este verificada, los usuarios ven la pantalla de advertencia "Google hasn't verified this app" (aceptable para el organizador, molesto). La verificacion de scopes sensitive es opcional y solo quita la advertencia.

Carpeta existente vs creada: con drive.file el Picker de Google solo muestra archivos/carpetas que la propia app creo, por lo que el organizador NO puede elegir una carpeta arbitraria ya existente. Solucion: la app crea la carpeta (el organizador escribe el nombre) y guarda el folderId. Elegir una carpeta existente exigiria drive.readonly/drive (restricted, con verificacion obligatoria).

(b) FUENTES.
- https://stackoverflow.com/questions/79702574/selecting-a-folder-in-the-google-picker-with-the-drive-file-scope - Picker + drive.file (verificado 2026).
- https://stackoverflow.com/questions/79757761/how-do-i-filter-the-google-picker-to-show-only-files-created-by-drive-file-scope - limites del Picker con drive.file (verificado 2026).
- https://developers.google.cn/identity/protocols/oauth2/production-readiness/sensitive-scope-verification - verificacion de scopes sensitive (verificado 2026).
- https://support.google.com/cloud/answer/15549945 - gestion de audiencia/testing de la app OAuth (verificado 2026).
- https://github.com/levz0r/gmail-tester/issues/139 - refresh token muere en ~1 semana en testing (verificado 2026).
- https://tech.queenofsandiego.com/posts/2026-05-06-1831.html - fix del expiry de 7 dias pasando a produccion (verificado 2026).
- https://nango.dev/blog/google-oauth-invalid-grant-token-has-been-expired-or-revoked - invalid_grant por token caducado (verificado 2026).

(c) RECOMENDACION. Flujo OAuth PKCE propio para el organizador con scopes profile email drive.file; refresh token cifrado en Supabase; publicar la app de OAuth cuanto antes (gratis, sin tarjeta) con privacy policy en /privacy; carpeta SIEMPRE creada por la app. En desarrollo, asumir re-conexion semanal.

(d) BLOQUEADOR PARCIAL: sin publicar la app, el organizador debe re-autenticarse cada 7 dias, inviable en produccion; publicar la consent screen es la mitigacion (gratis).
---

## 6. QR POR EVENTO (slug unico)

(a) RESPUESTA. Generar el QR con qrcode.react (componente QRCodeSVG, compatible con App Router; se puede renderizar en servidor) o next-qrcode (hooks). El QR codifica la URL absoluta https://<dominio>/e/<slug>. Slug: generar aleatorio con nanoid (10-12 chars, base64url), no secuencial y por tanto no adivinable; validar con regex ^[a-z0-9_-]{8,32}$ + indice UNIQUE en Supabase + reintento en colision. Seguridad: el QR es publico y cualquiera puede subir (por diseno), por lo que hay que mitigar con rate limiting por evento/IP en la funcion de subida, limite de tamano/total por evento, moderacion en admin (borrar fotos/comentarios) y boton "cerrar evento" que corta las subidas.

(b) FUENTES.
- https://www.npmjs.com/package/qrcode.react - libreria (verificado 2026).
- https://github.com/Bunlong/next-qrcode - alternativa (verificado 2026).
- https://blog.gitcode.com/6965859c6b2ea4cd94ddac52a2eb730d.html - soporte de qrcode.react en Server Components (verificado 2026).

(c) RECOMENDACION. qrcode.react QRCodeSVG; slug nanoid(10) en base64url; UNIQUE + retry; logging por IP; limites por evento; descarga del QR como PNG (canvas).

(d) BLOQUEADOR: No.

---

## 7. LIMITES DE VERCEL GRATIS (plan Hobby)

(a) RESPUESTA. Limites actuales del plan Hobby (verificados en docs oficiales, 2026):
- Body maximo de funcion serverless: 4,5 MB (KB oficial + error FUNCTION_PAYLOAD_TOO_LARGE).
- Duracion max. de funcion: 60 s (cambio de 10 s a 60 s en 2023).
- Ancho de banda: 100 GB/mes.
- Numero de funciones: historico ~12/proyecto; la pagina de limites oficial (vercel.com/docs/limits) es la fuente vigente al momento del deploy.

Una foto JPEG de 2-4 MB SI cabe en 4,5 MB si el body es binario directo (multipart); con base64 (inflado 33%) un JPEG de 3,5 MB ya se pasa. Y 60 s puede ser poco en redes moviles lentas. Alternativas si el limite molesta: (1) subida directa del cliente a Supabase Storage con signed URL (Vercel solo firma la URL, no transporta bytes) y luego un trigger/job copia de Supabase a Drive; (2) subir en segundo plano con reintentos mientras el usuario ve "subiendo...". Coste de banda: 500 fotos x 3 MB x 2 (subida + lectura) ~= 3 GB/evento, es decir ~30 eventos/mes dentro de los 100 GB.

(b) FUENTES.
- https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions - limite 4,5 MB y workarounds (verificado 2026).
- https://vercel.com/docs/errors/function_payload_too_large - error oficial (verificado 2026).
- https://vercel.com/changelog/vercel-functions-for-hobby-can-now-run-up-to-60-seconds - 60 s en Hobby (verificado 2026).
- https://vercel.com/docs/limits y https://vercel.com/docs/plans - pagina de limites/planes (verificado 2026).

(c) RECOMENDACION. Rele Vercel con body binario directo y JPEG <=3,5 MB para margen; medir el tiempo real de subida en 3G/4G; tener el flujo signed-URL a Supabase Storage y copia a Drive como plan B listo (es el que mejor escala a 500 usuarios).

(d) BLOQUEADOR: No, pero 4,5 MB/60 s son limites duros; la arquitectura decidida (rele Vercel) funciona solo si controlas tamano y tiempo; el plan B de signed URL es la valvula de escape.

---

## 8. REALTIME DE SUPABASE: limites exactos

(a) RESPUESTA. Plan free (docs oficiales, verificado 2026): 200 conexiones concurrentes y 200 mensajes por segundo (ademas de los limites generales: 500 MB DB, 1 GB storage, 5 GB egress, 50.000 MAU de Auth). Con 100-500 usuarios: 100-150 concurrentes dan Realtime suficiente; 500 excede el limite de conexiones. Polling (PostgREST con cursor last_id + ETags, cada 5-10 s) aguanta 500 sin coste. Likes/comentarios: se escriben via RPC (Postgres) y se difunden por Realtime postgres_changes o se leen en el siguiente poll.

(b) FUENTES.
- https://supabase.com/docs/guides/realtime/limits - 200 conexiones / 200 msg-s en free (verificado 2026).
- https://supabase.com/docs/guides/realtime/pricing - pricing Realtime (verificado 2026).
- https://supabase.com/pricing - limites del plan free (verificado 2026).

(c) RECOMENDACION. Hibrido: Realtime para <150 concurrentes + fallback automatico a polling 8-10 s; o polling puro (mas simple, sin estado de conexion). En el cliente: "si no llega el push en X s, hacer poll".

(d) BLOQUEADOR PARCIAL: 200 conexiones no cubren 500 en vivo; se mitiga con polling/hibrido sin costo adicional.
---

## RIESGOS Y BLOQUEADORES (top 5)

1. Refresh token de Google muere a los 7 dias en modo testing. El organizador tendria que reconectar cada semana. Mitigacion: publicar la app de OAuth (gratis; consent screen + privacy policy en /privacy); usar test users durante desarrollo.
2. Limites duros de Vercel (4,5 MB body / 60 s) con subidas de invitados en redes moviles lentas. Mitigacion: compresion <=3,5 MB, body binario, subida con reintentos; plan B: signed URL a Supabase Storage + copia a Drive en background (tambien evita el cuello de Vercel con 500 simultaneos).
3. Realtime free (200 conexiones) < 500 usuarios. Mitigacion: polling/hibrido (sin costo); si se exige push a 500+, hace falta plan de pago.
4. Capacidad: 15 GB de Drive del organizador y 1 GB de Supabase Storage. ~5.000 fotos por cuenta de Google; los thumbs llenan el 1 GB si no se limpian. Mitigacion: medidor de quota en el admin (About.get), limite por evento, limpieza de thumbs al borrar eventos, aviso al llenarse.
5. drive.file limita la UX del organizador: no puede elegir una carpeta existente (solo las creadas por la app) y vera la advertencia "app no verificada" si no se publica. Mitigacion: crear la carpeta por la app (el organizador pone el nombre); publicar la app; documentarlo en el admin.

VEREDICTO GENERAL: el stack Vercel (gratis) + Supabase (gratis) + Google Drive (gratis) es VIABLE para el objetivo de 100-500 invitados simultaneos, con dos condiciones: (1) publicar la app de Google OAuth para que el token del organizador no caduque en 7 dias, y (2) controlar el tamano de foto y tener el flujo de subida directa a Supabase Storage como plan B ante los 4,5 MB/60 s de Vercel. El feed debe servirse desde Supabase con thumbnails en Supabase Storage (nunca leyendo Drive por cada celular), con Realtime solo para eventos pequenos y polling como respaldo.
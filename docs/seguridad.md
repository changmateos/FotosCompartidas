# Reporte de Seguridad · PicMyEvent

Fecha: 2026-08-30
Metodo: revision manual del codigo fuente (rutas API, libs, migraciones RLS,
configuracion) + npm audit de dependencias.

## Resumen ejecutivo

La arquitectura de seguridad esta bien disenada en los puntos criticos:
RLS completo en Supabase, tokens de Google cifrados (AES-256-GCM), OAuth PKCE
propio con state+verifier, feed que nunca toca Drive, validacion de membresia
en todos los endpoints de moderacion y rate limiting en escrituras anonimas.
Sin embargo hay 3 hallazgos ALTOS, 5 MEDIOS y 3 BAJOS que conviene atender
antes de un lanzamiento masivo.

---

## Hallazgos

### ALTO-1 · Dependencias vulnerables (npm audit)
6 vulnerabilidades: 1 high + 5 moderate.
- postcss <= 8.5.22 (via next): XSS en output CSS, path traversal y lectura
  arbitraria de archivos .map. Es la cadena next -> postcss.
- uuid < 11.1.1 (via googleapis -> gaxios): falta de bounds check en v3/v5/v6.
Impacto: postcss corre en BUILD time (no en runtime del servidor), asi que el
riesgo real de explotacion es bajo, pero el escaner de Vercel lo marcara.
uuid corre en runtime (gaxios para llamadas a Google).
Recomendacion: actualizar dependencias. npm audit fix --force instalaria
next@16 (breaking). Alternativa conservadora: subir googleapis a una version
>= 150 y evaluar next 15.x mas reciente que traiga postcss parcheado.

### ALTO-2 · Falta de headers de seguridad (next.config.ts)
next.config.ts esta vacio. No se envian CSP, X-Frame-Options,
X-Content-Type-Options, Referrer-Policy ni Permissions-Policy.
Impacto: la app queda expuesta a clickjacking (iframe en otro sitio), MIME
sniffing, y no restringe el origen de carga de recursos.
Recomendacion: anadir headers de seguridad en next.config.ts.

### ALTO-3 · Sin proteccion anti-abuso en endpoints anonimos
Los invitados son anonimos (sin login). Subida de fotos, likes y comentarios
se protegen SOLO con rate limit por IP. No hay captcha ni mecanismo anti-bot.
Impacto: en un evento politico/escolar publico, un atacante puede usar
proxies/botnets para subir fotos no deseadas o spam de comentarios a gran
escala. La moderacion (borrar) existe, pero es reactiva.
Recomendacion: considerar CAPTCHA (Turnstile/Cloudflare es gratis) en
comentarios/likes, o un limite mas estricto + moderacion previa opcional.

### MED-1 · Rate limiting fail-open
lib/ratelimit.ts devuelve allowed=true si la base de datos falla
(decision documentada para no bloquear invitados). En un ataque combinado
con saturacion de la BD, el rate limit desaparece.
Recomendacion: aceptable para v1, pero registrar alerta cuando el rate
limit falla repetidamente (hoy solo console.error).

### MED-2 · guest_id spoofeable en likes/comentarios (primer contacto)
En /api/likes/toggle y /api/comments, si el navegador no tiene cookie guest_id
y envia un guestId arbitrario (cualquier UUID valido), el servidor lo acepta
como identidad. Un atacante puede votar/comentar como otro guest_id.
Impacto: bajo (likes/comentarios son anonimos y hay moderacion), pero rompe
la integridad de un like por invitado (UNIQUE photo+guest).
Recomendacion: en likes/comments, IGNORAR el guestId del body y usar SIEMPRE
la cookie; si no hay cookie, crearla en ese endpoint (como hace /api/guest).

### MED-3 · Validacion de imagen solo por client-content-type
El servidor valida file.type.startsWith(image/) pero el content-type lo
controla el cliente. No se verifican magic bytes. El thumbnail lo genera el
cliente y se sube como image/jpeg fijo (bien), pero la foto de bienvenida
(welcome-photo) usa file.type del cliente como contentType.
Impacto: un atacante podria subir un archivo no-imagen (o un SVG con script)
si consigue que se sirva con un content-type peligroso. Como se renderiza con
img (no inline), el SVG no ejecuta scripts, pero sigue siendo superficie.
Recomendacion: en welcome-photo, fijar contentType a image/jpeg (la imagen
ya se comprime a JPEG en el cliente) y validar magic bytes JPEG (FF D8 FF).

### MED-4 · El feed publico expone fotos por event_id
El feed usa RLS event_is_public: cualquier foto de CUALQUIER evento es legible
con la anon key si se conoce el event_id. El event_id se obtiene del slug via
get_event_id_by_slug. El slug es nanoid(10) (62^10 combinaciones, no
adivinable por fuerza bruta), asi que el QR actua como secreto de acceso.
Impacto: aceptable POR DISENO (decision 5: feed publico), pero conviene
documentar que el slug es la unica barrera de acceso al feed.
Recomendacion: no expone nada extra (no hay endpoint que liste slugs).

### MED-5 · Enumeracion de emails en endpoint de miembros
POST /api/events/[id]/members devuelve 404 con No existe ningun organizador
con ese email vs 200 si existe. Un miembro del evento puede enumerar que
emails estan registrados en la app.
Impacto: bajo (solo miembros del evento), pero es una fuga de informacion.
Recomendacion: devolver un error generico No se pudo anadir sin distinguir.

### BAJO-1 · guest_id duplicado por localStorage
lib/feed-client.ts cachea el guest_id en localStorage. Si se usa localStorage
como respaldo, un atacante con acceso al device puede leerlo. Es identidad
anonima, impacto minimo.

### BAJO-2 · x-forwarded-for como unica fuente de IP
getClientIp usa x-forwarded-for. En Vercel es confiable (Vercel la establece),
pero en otro host sin proxy podria spoofearse para evadir rate limits.
Recomendacion: OK en Vercel; documentar que NO debe desplegarse detras de un
proxy no confiable sin ajustar getClientIp.

### BAJO-3 · captions sin sanitizar en servidor
Los captions (pie de foto) solo se validan en longitud (<=500), no se sanean
de HTML. Se renderizan con React (escape automatico), asi que no hay XSS
practico, pero el dato crudo queda en BD.
Recomendacion: aplicar el mismo sanitizeText de comentarios al caption.

---

## Puntos BIEN hechos (no requieren cambio)

- RLS completo y correcto (0009 + 0011): anon solo lee via get_event_public /
  event_is_public; escrituras sensibles solo service_role / RPC SECURITY DEFINER.
- Tokens de Google cifrados AES-256-GCM con IV aleatorio y authTag.
- OAuth PKCE propio con state+verifier en cookie httpOnly, TTL 10 min, y
  validacion de state en callback (anti-CSRF).
- Propiedad de Drive restringida al organizador que conecto (is_drive_owner).
- Anti-hijack en connect/callback (un miembro no reemplaza la conexion).
- Comentarios: sanitizacion de HTML + caracteres de control + rate limit.
- Subida: resumable idempotente, backoff+jitter, limpieza de huerfanos,
  manejo de cuota llena (507) y token vencido (503).
- Cierre de evento: subidas/likes/comentarios bloqueados en readonly.
- Middleware renueva sesion y protege /admin.
- Validacion de membresia (is_event_member) en TODOS los endpoints de
  moderacion (borrar foto/comentario/likes, cerrar, borrar evento, miembros).

---

## Fixes recomendados para aplicar AHORA (bajo riesgo, alto valor)

1. Headers de seguridad en next.config.ts (ALTO-2).
2. Ignorar guestId del body en likes/comments y usar solo cookie (MED-2).
3. Sanitizar caption (BAJO-3) y fijar contentType JPEG en welcome-photo (MED-3).
4. Error generico en enumeracion de emails (MED-5).
5. Actualizar dependencias (ALTO-1) con criterio (ver nota).

Los que dependen de decision de producto (CAPTCHA, rate limit estricto) se
recomiendan para eventos publicos grandes.
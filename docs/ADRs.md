# ADRs — PicMyEvent

Registro de Decisiones de Arquitectura (Architecture Decision Records).
Formato: problema, decision, consecuencias. Fechas aproximadas por fase.

---

## ADR-001 — Rele en Vercel + OAuth propio para Google Drive

**Estado**: aceptado (F0/F3) · **Fecha**: Fase 0

**Contexto**: los invitados suben fotos de 2-4 MB; el celular NO debe tocar
credenciales de Google. El alcance drive.file solo permite que la app vea los
archivos que ella misma crea (decision 17 del handshake).

**Decision**:
- La subida pasa SIEMPRE por el rele de Vercel: POST /api/upload recibe la foto
  y la sube a la carpeta del Drive del organizador con su token OAuth.
- El organizador conecta su Drive con un flujo OAuth PKCE PROPIO
  (/api/drive/connect + /api/drive/callback) con scopes openid profile email
  drive.file, access_type=offline y prompt=consent. Supabase Auth queda SOLO
  para la identidad del organizador (P9).
- El refresh token se cifra (AES-256-GCM, TOKEN_ENCRYPTION_KEY) y se guarda en
  drive_connections; el backend lo refresca ~5 min antes de expirar.
- El body es binario directo (multipart), nunca base64.

**Consecuencias**:
- El organ de Vercel transporta los bytes (limite 4,5 MB por request; la
  compresion del cliente garantiza <=3,5 MB).
- La app OAuth debe estar PUBLICADA (en testing los refresh tokens mueren a los
  7 dias). Si los limites de Vercel (4,5 MB / 60 s) o la concurrencia (500
  simultaneos) se vuelven un problema, activar ADR-002.

---

## ADR-002 — Plan B: signed URL a Supabase Storage + copia a Drive en background

**Estado**: documentado, NO implementado (T5.6) · **Fecha**: F5

**Contexto**: los limites duros de Vercel (body 4,5 MB, funcion 60 s) y el cuello
del rele con 500 invitados simultaneos son los riesgos principales de F5. El
informe de viabilidad propone una valvula de escape.

**Decision (disenada, no implementada)**:
1. Vercel ya no transporta los bytes: POST /api/upload solo VALIDA (tamano,
   rate limit, evento) y devuelve una signed URL de Supabase Storage
   (createSignedUrl, expira ~5-10 min).
2. El invitado sube el JPEG directamente a la signed URL (PUT) y el thumbnail
   igual.
3. En segundo plano (trigger de Supabase / cron de Vercel / queue), una funcion
   copia el objeto de Storage a la carpeta de Drive del organizador usando el
   token cifrado de drive_connections (mismo getDriveClient de F3).
4. La fila de photos se inserta cuando el objeto esta en Storage (el feed usa
   la URL publica de Storage igualmente); Drive es copia final.

**Por que no se implementa ahora**: el rele cabe (2-4 MB, 60 s) para el objetivo
de 100-500 invitados; la complejidad de la copia en background y su
consistencia no justifican el cambio sin evidencia de saturacion.

**Cuando activarlo**: si F9 muestra que >500 simultaneos saturan el rele, si el
body de 4,5 MB se vuelve insuficiente, o si la banda de Vercel (100 GB/mes) se
acerca al limite con eventos grandes.

**Consecuencias**: menos bytes por Vercel (solo firma), mejor escala; requiere
implementar el job de copia, manejar reintentos y la politica de borrado en
ambos almacenes.

---

## ADR-003 — Rate limiting en Postgres (tabla rate_limits) en vez de Upstash Redis

**Estado**: aceptado (F1/F5) · **Fecha**: F1

**Contexto**: el QR es publico por diseno (cualquiera puede subir); hace falta
rate limiting por evento+IP. Opciones: Upstash Redis free (10k req/dia) o una
tabla en Postgres.

**Decision**: tabla rate_limits en Postgres con ventana deslizante
(lib/ratelimit.ts): claves upload:{eventId}:{ip} (10/min por invitado) y
upload:{eventId} (120/min por evento), 429 con Retry-After. Coste: 1 select +
1 upsert por llamada. Fail-open ante errores de BD (no bloquear invitados por
un fallo del contador).

**Consecuencias**: cero dependencias externas; las escrituras de rate limit
comptien levemente con el feed (medir en F9). Si las mediciones muestran
contienda, migrar a Upstash (o a un RPC atomico con insert ... on conflict).

---

## Anexo — Decisiones de producto referenciadas

- P6: borrado de fotos de Drive = TRASH (papelera, recuperable 30 dias), no
  files.delete duro.
- P7: rate limiting Postgres (ADR-003).
- P8: PWA = manifest + icons sin service worker (opcional, F8).
- P9: Supabase Auth solo identidad; Drive con OAuth propio (ADR-001).

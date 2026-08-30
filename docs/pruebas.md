# Pruebas de concurrencia — PicMyEvent (F9)

Objetivo: demostrar que la app aguanta 100-500 invitados simultaneos (subiendo
y viendo el feed) en el plan gratuito (Vercel Hobby + Supabase Free), sin
perdida de datos y dentro de los limites (4,5 MB body / 60 s funcion / 200
conexiones Realtime con fallback a polling).

## Estado de ejecucion

**PENDIENTE DE EJECUCION CONTRA EL DEPLOY REAL.** Los scripts estan listos y
verificados (typecheck/build OK), pero las mediciones requieren: envs reales en
Vercel, migraciones 0001-0011 aplicadas en Supabase, bucket "thumbs" publico,
publicacion Realtime activa y un evento de prueba con Drive conectado. Pasos en
docs/entrega/informe-final.md (checklist de despliegue). Este documento define
el procedimiento y los CRITERIOS DE ACEPTACION; las celdas "medido" se
rellenan tras ejecutar contra el deploy.

## Pre-requisitos

1. Deploy en Vercel con envs reales (ver docs/entrega/informe-final.md).
2. Evento de prueba creado con su Drive conectado (carpeta creada por la app).
3. Bucket "thumbs" publico y publicacion Realtime habilitada
   (alter publication supabase_realtime add table public.photos, likes, comments).
4. `node scripts/load-test.ts --help` debe listar las opciones (script TS).

## T9.1 — Carga de subidas (scripts/load-test.ts)

    node scripts/load-test.ts --base https://TU-DOMINIO \
         --slug <slug-evento> --guests 100 [--rate 1] [--concurrency 20]

Repetir con N = 100, 250 y 500. El script genera JPEG de ~2,5 MB en memoria,
usa guest_id e IP (x-forwarded-for) distintos por invitado, respeta el rate
limit (10/min por invitado, 120/min por evento) y VALIDA el backoff (429/403
con Retry-After) y storageQuotaExceeded (507/drive_full).

### Resultados T9.1 (objetivo = criterio de aceptacion; rellenar "medido")

| N | Exito % (obj >= 99) | p50 medido | p95 medido (obj < 10 s) | 429 | 5xx | Tiempo total | Estado |
|---|---|---|---|---|---|---|---|
| 100 |  |  |  |  |  |  | PENDIENTE |
| 250 |  |  |  |  |  |  | PENDIENTE |
| 500 |  |  |  |  |  |  | PENDIENTE |

Criterios: 100% de exito (o 100% menos 429 esperados por rate limit); sin
perdida de datos: todas las filas de photos con drive_file_id UNIQUE;
los 429 se reintentan y terminan en 200 cuando el limite lo permite.

## T9.2 — Carga del feed (scripts/load-feed.mjs)

    node scripts/load-feed.mjs --feed-url <url-json-del-feed> \
         --clients 500 --interval 10 --duration 180

Mezcla recomendada: 50/50 Realtime/polling para <300 y 100% polling para 500.
Mientras corre, sube una foto (script T9.1 o movil) y mide el p95 de
propagacion (tiempo entre upload y primer poll que la muestra).

### Resultados T9.2 (objetivo = criterio de aceptacion; rellenar "medido")

| Config | Clientes | Polls 200 | 304 | Errores | p95 poll | p95 propagacion | Estado |
|---|---|---|---|---|---|---|---|
| Realtime | 100 |  |  |  |  | < 3 s (obj) | PENDIENTE |
| Polling | 500 |  |  |  |  | < 12 s (obj) | PENDIENTE |

Criterios: con 500 en polling la foto nueva se ve en <12 s p95; Realtime con
<150 no se cae; sin errores de conexion masivos.

## T9.3 — Analisis y ajustes

En base a los resultados, ajustar (si hace falta):
- Tamano de compresion (lib/image.ts: MAX_UPLOAD_BYTES / CANVAS_STEPS).
- Backoff de /api/upload (lib/upload.ts: MAX_RETRIES / backoffMs).
- Limites de rate limit (lib/ratelimit.ts + app/api/upload).
- Cache de thumbs (cacheControl en lib/upload.ts).
- Fallback a polling (lib/feed-client.ts: intervalo 8-10 s).

Repetir la prueba del caso peor (500) tras los ajustes y actualizar la tabla.

## Notas de medicion

- Red 4G real o throttling (Chrome DevTools) para subidas desde movil.
- Registrar tiempos p50/p95 en esta tabla y en docs/entrega/informe-final.md.
- La banda de Vercel (100 GB/mes) ~ 30 eventos de 500 fotos de 3 MB; vigilar.

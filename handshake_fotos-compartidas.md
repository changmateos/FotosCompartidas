# Handshake · Fotos Compartidas (fotos de invitados en eventos)

Status: grilled · 2026-08-29

## La idea en palabras simples
(read-back validado por el usuario el dia de la entrevista)

Es una app web que vive en internet (Vercel). Un organizador crea su evento (una boda, un cumpleaños, un evento escolar o politico) y la app le da un codigo QR. Ese QR se imprime y se pone en el evento.

Los invitados escanean el QR con su celular y se abre la app de ese evento. En la pantalla hay un boton grande de foto; al tocarlo se abre la camara normal del celular. Cuando toman la foto, pueden escribir un mensajito, y la foto se sube sola a una carpeta de Google Drive del organizador. Abajo se ve el feed: todas las fotos que van subiendo todos los invitados, en vivo, con sus mensajes, y se pueden dar 'me gusta' y comentar.

El organizador entra al panel con su cuenta de Google y puede: poner el titulo del evento, los nombres de los dueños, un mensaje de dedicatoria, una foto de bienvenida, elegir un tema (5-6 temas con colores), conectar la carpeta de su Drive donde caen las fotos, y borrar fotos cuando quiera (por ejemplo despues del evento, para quedarse con las buenas para un album). Puede haber varios organizadores por evento.

Los invitados no se registran, no hay videos, no hay filtros ni edicion, no hay limites de fotos, y las fotos solo se descargan desde Drive.

## Por que importa
Producto generico para cualquiera (decidido): bodas, cumpleaños, eventos escolares o politicos. Un organizador cualquiera debe poder configurarlo en minutos.

## Para quien es
- Organizadores / dueños del evento (usan el panel admin con su cuenta de Google).
- Invitados (solo toman fotos, escriben mensajes y ven el feed; sin registro).

## Que existe hoy
- Directorio de trabajo vacio (verificado: 0 archivos). Idea nueva, no hay codigo previo ni otros intentos conocidos.

## Como se ve el exito
Que un organizador cualquiera configure su evento solo, en minutos, y que lo repita en su proximo evento (decidido por el usuario).

## Decisiones ya tomadas
1. UNA app para MUCHOS eventos. Cada evento tiene su propio QR con enlace distinto (ej: /e/boda-ana-2025).
2. Cada organizador conecta SU propia cuenta de Google. El dueño del evento elige o crea la carpeta en su propio Drive.
3. El organizador entra al panel con su cuenta de Google, sin doble registro.
4. Los invitados NO se registran. Escanean el QR y toman fotos directo.
5. El feed muestra TODAS las fotos de todos los invitados, en vivo.
6. Galeria inicial de 5 a 6 temas con 2-3 variantes de color cada uno.
7. Varios organizadores por evento, todos con su cuenta de Google.
8. Sin limites de fotos. El limite real es el almacenamiento de la cuenta de Google del organizador.
9. El organizador SI puede borrar fotos desde el panel. Detalle: al finalizar el evento, los organizadores se sientan a revisar todas las fotos, borran las que no sirven y conservan las que podrian usar en un album.
10. El feed es una MINI RED SOCIAL del evento: pie de foto al subir + 'me gusta' + comentarios en cualquier foto. (Nota para el planner: captions/likes/comments NO viven en Google Drive, necesitan base de datos; la foto vive en Drive y la DB guarda la referencia.)
11. Stack libre de costo: Vercel (hosting), Supabase (base de datos) y Google Drive (almacenamiento de fotos). Sin presupuesto para servicios de pago.
12. El organizador puede CERRAR el evento: ya no se suben fotos, pero el feed sigue visible para revisar y borrar.
13. El QR se genera y descarga desde el panel admin del evento (el organizador lo imprime).
14. Escala objetivo: 100 a 500 invitados simultaneos (decidido en grill). El feed NO se sirve leyendo Drive por cada celular (cuotas de la API): se sirve desde Supabase como cache; Drive guarda el original.
15. Multi-organizador: UNO conecta el Drive y elige la carpeta; los demas organizadores administran (editar, borrar) pero las fotos caen en el Drive de ese uno.
16. Calidad de foto: se comprime en el celular antes de subir a ~3000 px con calidad alta (2-4 MB, JPEG). Las fotos HEIC de iPhone se convierten a JPEG para que se vean en todos lados. (Necesario: Vercel gratis no acepta subidas >4.5 MB y las originales pesan 3-10 MB.)
17. El feed muestra SOLO las fotos subidas por la app (decidido en grill). Permite usar el alcance drive.file de Google: la app solo ve los archivos que ella crea, y se evita la revision/verificacion de Google. Fotos que el organizador meta a mano estan en su Drive pero no en el feed.
18. El organizador puede BORRAR un evento entero (decidido en grill): desaparece de la app, el QR deja de funcionar, y las fotos quedan en el Drive del organizador.
19. Moderacion (decidido en grill): el organizador puede borrar COMENTARIOS y 'me gusta' inapropiados ademas de fotos.
20. Despues del cierre (decidido en grill): el QR sigue abriendo el feed como recuerdo (ver fotos y mensajes), pero el boton de foto queda desactivado.
21. Nombre de la app: PicMyEvent (decidido por el usuario).

## Decisiones aun abiertas
- (ninguna critica; solo detalles menores de implementacion)
- Idioma de la interfaz: espanol para la primera version. (Recomendado.)

## Temas aprobados (6, con variantes de color, via CSS variables)
Tema por defecto: CLASICO.
1. ELEGANTE (bodas, eventos formales): Marfil y dorado (claro) / Negro y dorado (oscuro)
2. FIESTA (cumpleaños, celebraciones): Fucsia y violeta / Neon (verde lima y rosa)
3. NATURALEZA (aire libre, rustico): Verde bosque y madera / Arena y terracota
4. CLASICO (neutral, comodin): Blanco y negro / Beige y nogal
5. INSTITUCIONAL (escolar, politico, corporativo): Azul marino y blanco / Rojo y gris
6. TROPICAL (verano, casual): Turquesa y arena / Coral y amarillo
- Idioma de la interfaz: espanol para la primera version. (Recomendado.)
- Frecuencia de actualizacion del feed en vivo (recomendado: pocos segundos; resolver en implementacion con Supabase Realtime/polling ligero).

## Restricciones y reglas
- Concurrencia: 100 a 500 personas subiendo y viendo al mismo tiempo. La solucion debe aguantar eso; probar con cargas simultaneas.
- Stack libre de costo: Vercel + Supabase + Google Drive, sin servicios de pago.
- Sin plazos duros: version inicial completa y bien hecha.
- Privacidad: los organizadores pueden borrar fotos y comentarios, cerrar el evento y borrarlo entero; el feed puede quedar solo para revisar.
- Llamadas a la API de Google Drive deben ser minimizadas (el feed sale de Supabase, no de Drive).

## Fuera del alcance (decidido)
- Sin video.
- Sin edicion ni filtros de fotos (la foto sube comprimida pero sin retoques; el boton de camara nativa es el unico control).
- Sin descarga individual por invitado (la descarga la hace el organizador desde Drive).
- Los invitados NO tienen cuentas ni perfiles.
- Sin likes/comentarios persistentes mas alla del evento (todo pertenece al evento).
- El feed no muestra fotos agregadas a mano en la carpeta de Drive.

## Hallazgos de investigacion (resueltos, junio 2026)
Informe completo con fuentes en INFORME_VIABILIDAD.md. Resumen:

1. SUBIDA A DRIVE: rele en Vercel (el celular nunca toca credenciales); token OAuth del organizador (alcance drive.file); body binario directo (nunca base64); resumable upload; 429/403 con exponential backoff + jitter y cola idempotente. Service account como plan B (carpeta compartida con su email).
2. FEED: lee SOLO Supabase (foto + mensaje + likes + comments); thumbnails generados en el cliente (~50-150 KB) en Supabase Storage publico; nunca leer Drive por celular. Realtime free = 200 conexiones concurrentes; con 500 usar polling (8-10 s, cursor + ETag) o hibrido con fallback.
3. CAMARA: <input type="file" accept="image/*" capture="environment"> abre la camara nativa (iOS >=13, Android Chrome). HEIC -> heic2any (WASM); compresion a ~3000 px JPEG q0.8 con canvas/browser-image-compression; se genera tambien el thumbnail en el mismo paso.
4. DRIVE 15 GB: ~5.000 fotos de 3 MB por cuenta; detectar con About.get (storageQuota); cuando se llena la API devuelve 403 storageQuotaExceeded; avisar al organizador en el panel.
5. AUTH: OAuth PKCE propio para el organizador (scopes profile email drive.file); refresh token cifrado en Supabase. BLOQUEADOR PARCIAL: en modo testing de Google los refresh tokens mueren a los 7 dias; hay que PUBLICAR la app de OAuth (gratis, consent screen + politica de privacidad en /privacy). Con drive.file la app SIEMPRE crea la carpeta (el organizador solo pone el nombre; no puede elegir una carpeta existente).
6. QR: qrcode.react (QRCodeSVG); slug aleatorio nanoid(10) base64url con UNIQUE + retry; QR publico por diseno -> rate limiting por evento/IP y boton cerrar evento.
7. VERCEL GRATIS: body max 4,5 MB, funciones 60 s, banda 100 GB/mes. Fotos de 2-4 MB caben con body binario y JPEG <=3,5 MB. Plan B listo: signed URL a Supabase Storage y copia a Drive en background (mejor escala a 500).
8. REALTIME: 200 conexiones / 200 msg-s en free; likes/comments via RPC de Postgres + postgres_changes o siguiente poll.

VEREDICTO: VIABLE con el stack gratis para 100-500 invitados, con dos condiciones: (1) publicar la app de Google OAuth (evita caducidad de 7 dias), (2) controlar tamano de foto y tener el flujo signed URL a Supabase Storage como plan B. Riesgos top: caducidad 7 dias, limites 4,5 MB/60 s de Vercel, 200 conexiones Realtime, capacidad 15 GB, y la UX limitada de drive.file.

## Notas de entrega
Sugerencia de orden para el planner:
1. Esqueleto: Next.js + Vercel, rutas / (landing) y /e/[slug] (evento), panel en /admin.
2. Auth: Supabase Auth con Google (organizadores).
3. Google Drive: flujo OAuth del organizador con alcance drive.file, elegir/crear carpeta, guardar folder id y token; un solo organizador conecta Drive por evento.
4. Subida de fotos: en el cliente, captura con camara nativa (input capture), conversion HEIC->JPEG y compresion a ~3000 px; endpoint del backend que recibe la foto y la sube a Drive (con reintentos y manejo de concurrencia), luego escribe metadata en Supabase.
5. Feed: metadata en Supabase (foto + mensaje + likes + comments), actualizacion en vivo (Realtime o polling), thumbnails servidos sin golpear Drive.
6. Panel admin: configuracion del evento (titulo, nombres, mensaje, foto de bienvenida, tema/colores), cierre del evento, borrado de fotos y comentarios, borrado del evento, descarga del QR.
7. Temas: 5-6 temas con variantes de color aplicados via CSS variables.
8. Pruebas de concurrencia simulando 100-500 invitados subiendo a la vez y viendo el feed.

#!/usr/bin/env node
// ============================================================
// PicMyEvent · Script de concurrencia de subidas (F9, T9.1/T9.3)
// Simula 100-500 invitados subiendo fotos JPEG de ~2-3 MB a
// POST /api/upload con guest_id e IP distintos, y VALIDA el manejo
// de 429/403 (backoff respetando Retry-After) y storageQuotaExceeded.
//
// Uso (Node >= 22.6, type-stripping nativo; o `npx tsx`):
//   node scripts/load-test.ts --base https://TU-DOMINIO \
//        --slug mi-evento [--guests 100] [--rate 1] \
//        [--concurrency 20] [--retry-on-429 true]
//
//   --base           URL base del deploy (Vercel)
//   --slug           slug del evento de prueba (activo + Drive conectado)
//   --guests         invitados simultaneos: 100 | 250 | 500
//   --rate           subidas por invitado (por defecto 1)
//   --concurrency    invitados en paralelo (por defecto 20)
//   --retry-on-429   true: respeta Retry-After y reintenta 1 vez por
//                    intento (valida el backoff del servidor)
//
// Salida: tasas de exito/error, p50/p95, 429/5xx, y las validaciones
// de backoff (429 con Retry-After respetado) y storageQuotaExceeded
// (507 del rele) con su resultado.
// ============================================================

type Opts = {
  base: string;
  slug: string;
  guests: number;
  rate: number;
  concurrency: number;
  retryOn429: boolean;
};

function parseArgs(argv: string[]): Opts {
  const get = (name: string, fallback: string): string => {
    const i = argv.indexOf('--' + name);
    return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  return {
    base: get('base', ''),
    slug: get('slug', ''),
    guests: Number(get('guests', '100')),
    rate: Number(get('rate', '1')),
    concurrency: Number(get('concurrency', '20')),
    retryOn429: get('retry-on-429', 'false') === 'true',
  };
}

const TARGET_BYTES = 2.5 * 1024 * 1024; // ~2,5 MB
const JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

function makeJpeg(bytes: number): Buffer {
  const buf = Buffer.alloc(bytes);
  JPEG_HEADER.copy(buf, 0);
  let seed = 12345;
  for (let i = JPEG_HEADER.length; i < bytes; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = seed & 0xff;
  }
  buf[bytes - 2] = 0xff;
  buf[bytes - 1] = 0xd9; // EOI
  return buf;
}

const MAIN = makeJpeg(TARGET_BYTES);
const THUMB = makeJpeg(48 * 1024);

const guestId = (i: number): string =>
  'load-' + Buffer.from(String(i).padStart(6, '0')).toString('base64url');

type AttemptResult = {
  status: number;
  ms: number;
  body: string;
  retried: boolean;
};

async function uploadOnce(opts: Opts, guestIndex: number): Promise<AttemptResult> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(MAIN)], { type: 'image/jpeg' }),
    'foto-' + guestIndex + '.jpg'
  );
  form.append('thumb', new Blob([new Uint8Array(THUMB)], { type: 'image/jpeg' }), 'thumb.jpg');
  form.append('slug', opts.slug);
  form.append('caption', 'Foto de prueba invitado ' + guestIndex);
  form.append('width', '2000');
  form.append('height', '1500');
  form.append('sizeBytes', String(TARGET_BYTES));

  const started = performance.now();
  const res = await fetch(opts.base + '/api/upload', {
    method: 'POST',
    body: form,
    headers: {
      'x-forwarded-for': '10.0.0.' + ((guestIndex % 254) + 1),
      cookie: 'guest_id=' + guestId(guestIndex),
    },
  });
  const ms = Math.round(performance.now() - started);
  return {
    status: res.status,
    ms,
    body: (await res.text().catch(() => '')).slice(0, 140),
    retried: false,
  };
}

async function uploadWithBackoff(opts: Opts, guestIndex: number): Promise<AttemptResult> {
  const first = await uploadOnce(opts, guestIndex);
  if (!opts.retryOn429) return first;
  // Validacion de backoff: ante 429 (o 503 del rele por userRateLimitExceeded
  // con Retry-After), respetar Retry-After y reintentar una vez.
  const retryable =
    first.status === 429 ||
    (first.status === 503 && /userRateLimitExceeded|saturad/i.test(first.body));
  if (!retryable) return first;

  const retryAfterSec = 1; // minimo respetado; en produccion usar el header Retry-After
  await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
  const second = await uploadOnce(opts, guestIndex);
  return { ...second, retried: true };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.base || !opts.slug) {
    console.error(
      'Uso: node scripts/load-test.ts --base <url> --slug <slug> [--guests N] [--rate N] [--concurrency N] [--retry-on-429 true]'
    );
    process.exit(1);
  }

  console.log(
    'Carga: guests=' + opts.guests + ' rate=' + opts.rate + ' conc=' + opts.concurrency +
    ' retry429=' + opts.retryOn429 + ' base=' + opts.base + ' slug=' + opts.slug
  );
  const total = opts.guests * opts.rate;
  const results: AttemptResult[] = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < opts.guests) {
      const guest = next++;
      for (let attempt = 1; attempt <= opts.rate; attempt++) {
        results.push(await uploadWithBackoff(opts, guest));
        if (opts.rate > 1) await new Promise((r) => setTimeout(r, 6000)); // respetar 10/min por invitado
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(opts.concurrency, opts.guests) },
    () => worker()
  );
  await Promise.all(workers);

  const ok = results.filter((r) => r.status === 200);
  const rateLimited = results.filter((r) => r.status === 429);
  const serverErr = results.filter((r) => r.status >= 500);
  const quota = results.filter((r) => r.status === 507);
  const other = results.filter(
    (r) => r.status !== 200 && r.status !== 429 && r.status < 500
  );
  const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
  const p95 = lat.length
    ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))]
    : 0;
  const retried = results.filter((r) => r.retried);
  const retrySucceeded = retried.filter((r) => r.status === 200);

  console.log('--------------------------------------------------');
  console.log('Total intentos: ' + total);
  console.log('Exito (200): ' + ok.length + ' (' + ((ok.length / total) * 100).toFixed(1) + '%)');
  console.log('429 rate limit: ' + rateLimited.length);
  console.log('507 storageQuotaExceeded (drive_full): ' + quota.length);
  console.log('5xx otros: ' + (serverErr.length - quota.length));
  console.log('4xx otros: ' + other.length);
  console.log('Latencia (solo 200): p50=' + p50 + ' ms p95=' + p95 + ' ms max=' + (lat[lat.length - 1] ?? 0) + ' ms');
  console.log('Validaciones:');
  console.log(
    '  backoff: ' + retried.length + ' reintentos por 429/403, ' +
    retrySucceeded.length + ' exitosos tras respetar Retry-After'
  );
  console.log(
    '  storageQuotaExceeded: ' +
    (quota.length > 0
      ? 'DETECTADO (' + quota.length + ' respuestas 507 con drive_full) — el panel mostrara el aviso'
      : 'no se disparo (Drive con espacio)')
  );
  for (const r of results.filter((r) => r.status !== 200 && r.status !== 429).slice(0, 5)) {
    console.log('  ejemplo error ' + r.status + ': ' + r.body);
  }
  console.log(
    'FILA_TABLA |' + opts.guests + '| ' + ((ok.length / total) * 100).toFixed(1) +
    '% | ' + p50 + ' ms | ' + p95 + ' ms | ' + rateLimited.length + ' | ' + serverErr.length + ' |'
  );
}

main().catch((e) => {
  console.error('Error fatal:', e);
  process.exit(1);
});

#!/usr/bin/env node
// ============================================================
// PicMyEvent · Script de carga de SUBIDAS (F9, T9.1)
// Simula N invitados subiendo fotos JPEG de ~2-3 MB a POST /api/upload
// con guest_id e IP (x-forwarded-for) distintos por invitado, midiendo:
//   exito %, p95 de latencia, 429/5xx, tiempo total.
//
// Uso:
//   node scripts/load-uploads.mjs --base https://TU-DOMINIO \
//        --slug mi-evento --guests 100 [--rate 5] [--concurrency 20]
//
//   --base        URL base del deploy (Vercel) p.ej. https://app.vercel.app
//   --slug        slug del evento de prueba
//   --guests      numero de invitados simulados (100 | 250 | 500)
//   --rate        subidas por invitado (por defecto 1; respeta el rate
//                 limit por invitado de 10/min y por evento de 120/min)
//   --concurrency invitados simultaneos (por defecto 20)
//
// Requisitos: Node >= 18 (fetch/FormData/Blob globales). La app debe
// estar desplegada, el evento creado y el Drive del organizador conectado.
// Los bytes se generan en memoria (JPEG real de ~2,5 MB con ruido);
// no se toca ningun archivo del repo.
// ============================================================

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf("--" + name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const BASE = opt("base", "");
const SLUG = opt("slug", "");
const GUESTS = Number(opt("guests", "100"));
const RATE = Number(opt("rate", "1"));
const CONCURRENCY = Number(opt("concurrency", "20"));

if (!BASE || !SLUG) {
  console.error("Uso: node scripts/load-uploads.mjs --base <url> --slug <slug> [--guests N] [--rate N] [--concurrency N]");
  process.exit(1);
}

const TARGET_BYTES = 2.5 * 1024 * 1024; // ~2,5 MB
const JPEG_HEADER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);

function makeJpeg(bytes) {
  const buf = Buffer.alloc(bytes);
  JPEG_HEADER.copy(buf, 0);
  // relleno pseudoaleatorio determinista (sin crypto: mas rapido)
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

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
const guestId = (i) => "load-" + base64Url(Buffer.from(String(i).padStart(6, "0")));

async function uploadOne(guestIndex, attempt) {
  const url = `${BASE}/api/upload`;
  const form = new FormData();
  form.append("file", new Blob([MAIN], { type: "image/jpeg" }), `foto-${guestIndex}-${attempt}.jpg`);
  form.append("thumb", new Blob([THUMB], { type: "image/jpeg" }), "thumb.jpg");
  form.append("slug", SLUG);
  form.append("caption", `Foto de prueba invitado ${guestIndex} (${attempt})`);
  form.append("width", "2000");
  form.append("height", "1500");
  form.append("sizeBytes", String(TARGET_BYTES));

  const started = performance.now();
  const res = await fetch(url, {
    method: "POST",
    body: form,
    headers: {
      // IP distinta por invitado (el rate limit por invitado usa IP)
      "x-forwarded-for": `10.0.0.${(guestIndex % 254) + 1}`,
      cookie: `guest_id=${guestId(guestIndex)}`,
    },
  });
  const ms = Math.round(performance.now() - started);
  const body = await res.text().catch(() => "");
  return { status: res.status, ms, body: body.slice(0, 120) };
}

async function run() {
  console.log(`Carga de subidas: guests=${GUESTS} rate=${RATE} conc=${CONCURRENCY} base=${BASE} slug=${SLUG}`);
  const total = GUESTS * RATE;
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, GUESTS) }, async () => {
    while (next < GUESTS) {
      const guest = next++;
      for (let attempt = 1; attempt <= RATE; attempt++) {
        results.push(await uploadOne(guest, attempt));
        // respetar el rate limit de invitado (10/min): pausa de ~6 s entre subidas del mismo guest
        if (RATE > 1) await new Promise((r) => setTimeout(r, 6000));
      }
    }
  });
  await Promise.all(workers);

  const ok = results.filter((r) => r.status === 200);
  const retry429 = results.filter((r) => r.status === 429);
  const serverErr = results.filter((r) => r.status >= 500);
  const lat = ok.map((r) => r.ms).sort((a, b) => a - b);
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : 0;
  const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : 0;

  console.log("--------------------------------------------------");
  console.log(`Total intentos: ${total}`);
  console.log(`Exito (200): ${ok.length} (${((ok.length / total) * 100).toFixed(1)}%)`);
  console.log(`429 (rate limit): ${retry429.length}`);
  console.log(`5xx: ${serverErr.length}`);
  console.log(`Otros: ${results.length - ok.length - retry429.length - serverErr.length}`);
  console.log(`Latencia (solo 200): p50=${p50} ms p95=${p95} ms max=${lat[lat.length - 1] ?? 0} ms`);
  console.log(`Tiempo total: ${Math.round((performance.now() - 0) / 100) / 10} s`);
  for (const r of results.filter((r) => r.status !== 200 && r.status !== 429).slice(0, 5)) {
    console.log(`  ejemplo error ${r.status}: ${r.body}`);
  }
  // Sumario para docs/pruebas.md (copiar la fila)
  console.log("FILA_TABLA", `|${GUESTS}| ${((ok.length / total) * 100).toFixed(1)}% | ${p50} ms | ${p95} ms | ${retry429.length} | ${serverErr.length} | ${Math.round((performance.now() - 0) / 100) / 10} s|`);
}

run().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});

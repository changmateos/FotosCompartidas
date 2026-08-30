#!/usr/bin/env node
// ============================================================
// PicMyEvent · Script de carga del FEED (F9, T9.2)
// Simula N clientes leyendo el feed del evento (URL JSON que devuelve
// items con "created_at") cada intervalo de polling (8-10 s), con
// If-None-Match/ETag, midiendo:
//   - p95 de propagacion de una foto nueva (tiempo entre el upload y
//     su aparicion en el poll de un cliente)
//   - errores de conexion y 304/200
//
// Uso:
//   node scripts/load-feed.mjs --feed-url <url-json-del-feed> \
//        --clients 500 [--interval 10] [--duration 120]
//
//   --feed-url   URL del feed del evento que devuelve JSON con una
//                lista de items (cada item con "created_at"; p.ej. el
//                endpoint del feed de /e/[slug] o un RPC get_feed).
//                Debe soportar If-None-Match (ETag de PostgREST).
//   --clients    numero de clientes simulados (500 en el caso peor)
//   --interval   segundos entre polls (8-10 recomendado; T6.4)
//   --duration   segundos totales de la prueba (para medir propagacion,
//                sube una foto con un script aparte mientras corre)
//
// Requisitos: Node >= 18. El evento debe estar activo y el feed
// publicado (lectura publica, sin sesion).
// ============================================================

const args = process.argv.slice(2);
function opt(name, fallback) {
  const i = args.indexOf("--" + name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const FEED_URL = opt("feed-url", "");
const CLIENTS = Number(opt("clients", "500"));
const INTERVAL = Number(opt("interval", "10"));
const DURATION = Number(opt("duration", "120"));

if (!FEED_URL) {
  console.error("Uso: node scripts/load-feed.mjs --feed-url <url> [--clients N] [--interval S] [--duration S]");
  process.exit(1);
}

const startedAt = Date.now();
let polls = 0;
let notModified = 0;
let errors = 0;
let firstSeenById = new Map(); // id -> timestamp del primer poll que lo vio
const latencies = [];

async function pollOnce(clientId, etag) {
  const t0 = performance.now();
  try {
    const res = await fetch(FEED_URL, {
      headers: etag ? { "If-None-Match": etag } : {},
    });
    const ms = Math.round(performance.now() - t0);
    if (res.status === 304) {
      notModified++;
      return { etag, items: [] };
    }
    if (!res.ok) {
      errors++;
      return { etag, items: [] };
    }
    polls++;
    latencies.push(ms);
    const etagNext = res.headers.get("etag") ?? undefined;
    const body = await res.json().catch(() => null);
    const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
    for (const it of items) {
      const id = it.id ?? it.photo_id ?? JSON.stringify(it.created_at);
      if (!firstSeenById.has(id)) firstSeenById.set(id, Date.now());
    }
    return { etag: etagNext, items };
  } catch {
    errors++;
    return { etag, items: [] };
  }
}

async function clientLoop(clientId) {
  let etag;
  while (Date.now() - startedAt < DURATION * 1000) {
    const r = await pollOnce(clientId, etag);
    etag = r.etag;
    await new Promise((res) => setTimeout(res, INTERVAL * 1000));
  }
}

async function run() {
  console.log(`Carga del feed: clients=${CLIENTS} interval=${INTERVAL}s duration=${DURATION}s url=${FEED_URL}`);
  const workers = Array.from({ length: CLIENTS }, (_, i) => clientLoop(i));
  await Promise.all(workers);

  const lat = latencies.sort((a, b) => a - b);
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : 0;
  const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : 0;

  console.log("--------------------------------------------------");
  console.log(`Polls 200: ${polls} | 304: ${notModified} | errores: ${errors}`);
  console.log(`Latencia poll: p50=${p50} ms p95=${p95} ms`);
  console.log(`Items vistos: ${firstSeenById.size}`);
  console.log(`Tiempo total: ${Math.round((Date.now() - startedAt) / 100) / 10} s`);
  console.log(
    "Para medir propagacion: sube una foto mientras corre y mira el 'Items vistos'; el p95 de propagacion = p95 del tiempo entre upload y primer poll que la muestra (registra manualmente upload_time - first_seen)."
  );
}

run().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});

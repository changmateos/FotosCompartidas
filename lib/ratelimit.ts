// Rate limiting sin servicios externos (P7/ADR-003): tabla
// rate_limits con ventana deslizante por clave (evento+IP, IP, ...).
// Solo el backend escribe/lee (service_role; la tabla no tiene
// policies para anon). Fail-open ante errores de BD para no bloquear
// a los invitados por un fallo del contador.
import "server-only";
import { createAdminClient } from "@/lib/supabase-admin";

export type RateLimitDecision = { allowed: boolean; retryAfterSec: number };

type RateLimitRow = {
  key: string;
  count: number;
  window_start: string;
  updated_at: string;
};

export async function checkRateLimit(opts: {
  key: string;
  max: number;
  windowSec: number;
}): Promise<RateLimitDecision> {
  const admin = createAdminClient();
  const now = Date.now();
  const windowMs = opts.windowSec * 1000;

  try {
    const { data: row } = await admin
      .from("rate_limits")
      .select("*")
      .eq("key", opts.key)
      .maybeSingle();

    let count = 1;
    let windowStart: string | null = null;

    if (row) {
      const rowStart = new Date((row as RateLimitRow).window_start).getTime();
      if (now - rowStart < windowMs) {
        count = ((row as RateLimitRow).count ?? 0) + 1;
        windowStart = (row as RateLimitRow).window_start;
        if (count > opts.max) {
          // Registrar el intento bloqueado y devolver cuanto esperar
          await admin
            .from("rate_limits")
            .update({ count, updated_at: new Date().toISOString() })
            .eq("key", opts.key);
          const retryAfterSec = Math.max(
            1,
            Math.ceil((rowStart + windowMs - now) / 1000)
          );
          return { allowed: false, retryAfterSec };
        }
      }
    }

    // Ventana nueva o dentro del limite: upsert con el contador actual
    const { error } = await admin.from("rate_limits").upsert(
      {
        key: opts.key,
        count,
        window_start: windowStart ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) {
      console.error("[ratelimit] upsert error:", error.message);
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch (e) {
    console.error("[ratelimit] error:", (e as Error).message);
    return { allowed: true, retryAfterSec: 0 }; // fail-open
  }
}

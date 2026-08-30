// Cliente Supabase para el NAVEGADOR (componentes cliente).
// Usa la anon key (publica) + cookies gestionadas por @supabase/ssr.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local (ver .env.example)."
    );
  }

  return createBrowserClient(url, anonKey);
}

export type SupabaseClient = ReturnType<typeof createClient>;

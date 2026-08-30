// Callback de Supabase Auth (login con Google, Fase 1 T1.2).
// Supabase redirige aqui con ?code=... tras el consentimiento;
// intercambiamos el code por una sesion (PKCE) y vamos a /admin.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/admin";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!code) {
    return NextResponse.redirect(`${origin}/?login=error`);
  }
  if (!url || !anonKey) {
    console.error("[api/auth/callback] faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY");
    return NextResponse.redirect(`${origin}/?login=error`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // OK: solo falla si se invoca desde un Server Component.
        }
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (!error) {
    return NextResponse.redirect(`${origin}${next}`);
  }

  console.error("[api/auth/callback] exchangeCodeForSession error:", error.message);
  return NextResponse.redirect(`${origin}/?login=error`);
}

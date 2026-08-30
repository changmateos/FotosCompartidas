"use client";

// Boton de login con Google (Fase 1, T1.2). Usa Supabase Auth
// (PKCE) SOLO para la IDENTIDAD del organizador (scopes por defecto
// de Google: profile + email).
//
// DECISION (revision F3, P9 del plan): el alcance drive.file NO se
// pide aqui. Todo el acceso a Google Drive vive EXCLUSIVAMENTE en el
// flujo OAuth PKCE propio de la Fase 3 (/api/drive/connect), que
// permite cifrar el refresh token con TOKEN_ENCRYPTION_KEY y
// refrescarlo en background. Pedir drive.file en ambos flujos
// duplicaria scopes/consentimientos sin beneficio.
import { useState } from "react";
import { createClient } from "@/lib/supabase";

export function LoginButton({ label = "Entrar con Google" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback`,
          // Sin options.scopes: Google entrega profile + email por defecto.
        },
      });
      if (error) throw error;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar sesion");
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
      <button
        type="button"
        onClick={handleLogin}
        disabled={loading}
        style={{
          padding: "0.75rem 1.5rem",
          borderRadius: "9999px",
          border: "1px solid var(--border)",
          background: "var(--primary)",
          color: "var(--bg)",
          fontWeight: 600,
          fontSize: "1rem",
          cursor: loading ? "wait" : "pointer",
        }}
      >
        {loading ? "Abriendo Google..." : label}
      </button>
      {error && <p style={{ color: "#c0392b", fontSize: "0.875rem" }}>{error}</p>}
    </div>
  );
}

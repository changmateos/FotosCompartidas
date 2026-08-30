"use client";

// Error boundary del segmento /e/[slug] (F8): error de red/servidor
// con mensaje claro en espanol y boton de reintento.
import { useEffect } from "react";
import "./event-page.css"; // fix: el css vive en [slug]/ (coordinacion backend, t7)

export default function EventError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[picmyevent] error en /e/[slug]:", error);
  }, [error]);

  return (
    <main
      className="ep-root"
      style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: "2rem 1.25rem", gap: "1rem" }}
    >
      <h1 style={{ fontSize: "1.75rem", fontWeight: 800, margin: 0 }}>Algo salio mal</h1>
      <p style={{ color: "var(--muted)", maxWidth: "28rem", margin: 0, lineHeight: 1.5 }}>
        No pudimos cargar la pagina del evento. Revisa tu conexion a internet e intenta de nuevo.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          marginTop: "0.5rem",
          padding: "0.7rem 1.4rem",
          borderRadius: "999px",
          background: "var(--text)",
          color: "var(--bg)",
          fontWeight: 600,
          border: "none",
          cursor: "pointer",
        }}
      >
        Reintentar
      </button>
    </main>
  );
}

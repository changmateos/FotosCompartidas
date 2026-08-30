// Pagina 404 del segmento /e/[slug] (F8): mensaje claro en espanol
// cuando el evento no existe (o el enlace esta mal / hubo un error).
import Link from "next/link";
import "./event-page.css"; // fix: el css vive en [slug]/ (coordinacion backend, t7)

export default function EventNotFound() {
  return (
    <main
      className="ep-root"
      style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: "2rem 1.25rem", gap: "1rem" }}
    >
      <h1 style={{ fontSize: "1.75rem", fontWeight: 800, margin: 0 }}>Evento no encontrado</h1>
      <p style={{ color: "var(--muted)", maxWidth: "28rem", margin: 0, lineHeight: 1.5 }}>
        No encontramos este evento. Puede que el enlace este mal, que el evento se haya borrado o que
        haya un problema de conexion. Revisa el codigo QR o pedile el enlace correcto al organizador.
      </p>
      <Link
        href="/"
        style={{
          marginTop: "0.5rem",
          padding: "0.7rem 1.4rem",
          borderRadius: "999px",
          background: "var(--text)",
          color: "var(--bg)",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Ir al inicio
      </Link>
    </main>
  );
}

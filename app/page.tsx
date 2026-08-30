// Landing publica (Fase 0) + login del organizador (Fase 1).
import type { Metadata } from "next";
import { LoginButton } from "@/components/auth/login-button";

export const metadata: Metadata = {
  title: "PicMyEvent · Fotos de tu evento",
  description:
    "Los invitados toman fotos con su celular y quedan en tu Google Drive, con feed en vivo.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ login?: string }>;
}) {
  const { login } = await searchParams;

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "2rem", textAlign: "center" }}>
      <h1 style={{ fontSize: "2.5rem", fontWeight: 700 }}>PicMyEvent</h1>
      <p style={{ color: "var(--muted)", maxWidth: "32rem" }}>
        Crea tu evento, imprime el código QR y deja que tus invitados capturen los
        mejores momentos. Las fotos caen directo en tu Google Drive.
      </p>

      {login === "required" && (
        <p style={{ color: "var(--primary)", fontSize: "0.9rem" }}>
          Necesitas entrar con tu cuenta de Google para acceder al panel.
        </p>
      )}
      {login === "error" && (
        <p style={{ color: "#c0392b", fontSize: "0.9rem" }}>
          No se pudo completar el inicio de sesion. Intentalo de nuevo.
        </p>
      )}

      <div style={{ marginTop: "0.5rem" }}>
        <LoginButton label="Soy organizador · Entrar con Google" />
      </div>
    </main>
  );
}

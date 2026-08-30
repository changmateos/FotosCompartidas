// Panel de administracion (F1+T2): protegido por middleware.ts.
// Sin sesion muestra el login con Google; con sesion, la lista de
// eventos del organizador (F2, T2.1) + boton para crear evento.
import Link from "next/link";
import { createClient } from "@/lib/supabase-server";
import { listOrganizerEvents } from "@/lib/events";
import { LoginButton } from "@/components/auth/login-button";
import { LogoutButton } from "@/components/auth/logout-button";
import "./admin.css";

export const metadata = { title: "Panel · PicMyEvent" };

// Depende de sesion (cookies): nunca prerenderizar en build time.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="adm-main" style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <h1>Panel de administracion</h1>
        <p style={{ color: "var(--muted)", maxWidth: "28rem" }}>
          Entra con tu cuenta de Google para crear y gestionar tus eventos de PicMyEvent.
        </p>
        <LoginButton label="Entrar con Google" />
      </main>
    );
  }

  const name =
    user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email ?? "organizador";

  let events: Awaited<ReturnType<typeof listOrganizerEvents>> = [];
  let listError: string | null = null;
  try {
    events = await listOrganizerEvents(user.id);
  } catch (err) {
    listError = err instanceof Error ? err.message : "No se pudieron cargar tus eventos.";
  }

  return (
    <main className="adm-main">
      <header className="adm-head">
        <h1>Panel de administracion</h1>
        <LogoutButton />
      </header>

      <p style={{ color: "var(--muted)", margin: 0 }}>
        Conectado como <strong style={{ color: "var(--text)" }}>{name}</strong> ({user.email})
      </p>

      <section className="adm-card">
        <div className="adm-card-header">
          <h2>Mis eventos</h2>
          <Link href="/admin/new" className="adm-btn adm-btn-primary">
            Crear evento
          </Link>
        </div>

        {listError ? (
          <p className="adm-error">{listError}</p>
        ) : events.length === 0 ? (
          <p className="adm-hint" style={{ fontSize: "0.9rem" }}>
            Todavia no tienes eventos. Crea el primero y descarga su QR.
          </p>
        ) : (
          <ul className="adm-event-list">
            {events.map((event) => (
              <li key={event.id}>
                <Link href={"/admin/" + event.id}>
                  <span className="adm-event-title">{event.title}</span>
                  <span className="adm-event-meta">
                    /e/{event.slug} · {event.status === "closed" ? "Cerrado" : "Activo"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

// Pagina "Crear evento" (F2, T1.3): formulario minimo que llama a
// POST /api/events y redirige a /admin/[eventId].
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { CreateEventForm } from "./create-event-form";
import "../admin.css";

export const metadata = { title: "Crear evento · PicMyEvent" };

// Depende de sesion (cookies): nunca prerenderizar en build time.
export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/?login=required");

  return (
    <main className="adm-main">
      <header className="adm-head">
        <h1>Crear evento</h1>
        <a href="/admin" className="adm-btn">
          Volver al panel
        </a>
      </header>
      <section className="adm-card">
        <CreateEventForm />
      </section>
    </main>
  );
}

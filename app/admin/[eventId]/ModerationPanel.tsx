"use client";

// Ciclo de vida del evento (F7): cerrar evento (POST
// /api/events/[eventId]/close) y borrar evento (DELETE
// /api/events/[eventId]; el Drive del organizador queda intacto).
// Las FOTOS se revisan aparte en la pestana "Revisar fotos" (ReviewSwiper).
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ModerationPanel({
  eventId,
  slug,
  initialStatus,
}: {
  eventId: string;
  slug: string;
  initialStatus: "active" | "closed";
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"active" | "closed">(initialStatus);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  function flash(msg: string) {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3000);
  }

  async function closeEvent() {
    if (!window.confirm("¿Cerrar el evento? Los invitados ya no podran subir fotos, pero el feed queda visible como recuerdo.")) return;
    setBusy("close");
    setError(null);
    try {
      const res = await fetch("/api/events/" + eventId + "/close", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cerrar el evento.");
      setStatus("closed");
      flash("Evento cerrado. El feed sigue visible; no se aceptan mas fotos.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cerrar el evento.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteEvent() {
    if (
      !window.confirm(
        "¿Borrar el EVENTO ENTERO? El QR dejara de funcionar y se eliminaran fotos, comentarios y configuracion de la app. Las fotos quedan en TU Google Drive.",
      )
    ) {
      return;
    }
    if (!window.confirm("Confirmacion final: el evento se borra definitivamente de PicMyEvent. ¿Continuar?")) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch("/api/events/" + eventId, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo borrar el evento.");
      router.push("/admin");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar el evento.");
      setBusy(null);
    }
  }

  return (
    <section className="adm-card">
      <div className="adm-card-header">
        <h3>Ciclo de vida</h3>
        {status === "closed" ? (
          <span className="adm-badge">Evento cerrado</span>
        ) : (
          <span className="adm-badge adm-badge-active">Activo</span>
        )}
      </div>

      {statusMsg && <p className="adm-status">{statusMsg}</p>}
      {error && <p className="adm-error">{error}</p>}

      <div className="adm-mod-actions">
        {status === "active" && (
          <button type="button" className="adm-btn" onClick={() => void closeEvent()} disabled={busy === "close"}>
            {busy === "close" ? "Cerrando..." : "Cerrar evento"}
          </button>
        )}
        <button type="button" className="adm-btn adm-btn-danger" onClick={() => void deleteEvent()} disabled={busy === "delete"}>
          {busy === "delete" ? "Borrando..." : "Borrar evento"}
        </button>
      </div>

      <p className="adm-hint">
        Pagina publica: <a href={"/e/" + slug} style={{ color: "var(--primary)" }}>/e/{slug}</a>
      </p>
    </section>
  );
}

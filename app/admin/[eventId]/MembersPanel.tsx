"use client";

// Multi-organizador (repair hallazgo #2 / T7.5): lista de miembros,
// agregar por email (POST /api/events/[eventId]/members) y quitar
// (DELETE /api/events/[eventId]/members/[organizerId]; el creador no
// se puede quitar).
import { useState } from "react";
import { useRouter } from "next/navigation";

export type MemberRow = {
  organizerId: string;
  email: string;
  displayName: string | null;
};

export function MembersPanel({
  eventId,
  createdBy,
  currentUserId,
  members,
}: {
  eventId: string;
  createdBy: string;
  currentUserId: string;
  members: MemberRow[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  function flash(msg: string) {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3500);
  }

  async function addMember() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy("add");
    setError(null);
    try {
      const res = await fetch("/api/events/" + eventId + "/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo agregar al organizador.");
      setEmail("");
      flash("Organizador agregado.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo agregar al organizador.");
    } finally {
      setBusy(null);
    }
  }

  async function removeMember(organizerId: string) {
    if (!window.confirm("¿Quitar a este organizador del evento?")) return;
    setBusy("remove:" + organizerId);
    setError(null);
    try {
      const res = await fetch("/api/events/" + eventId + "/members/" + organizerId, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo quitar al organizador.");
      flash("Organizador quitado.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar al organizador.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="adm-card">
      <h3>Organizadores</h3>
      <p className="adm-hint">Todos los miembros administran el evento (v1). El creador no se puede quitar.</p>

      {statusMsg && <p className="adm-status">{statusMsg}</p>}
      {error && <p className="adm-error">{error}</p>}

      <ul className="adm-member-list">
        {members.map((m) => {
          const isCreator = m.organizerId === createdBy;
          const isMe = m.organizerId === currentUserId;
          return (
            <li key={m.organizerId} className="adm-member-row">
              <span>
                {m.displayName ?? m.email}
                {isMe ? " (tu)" : ""}
                {isCreator ? " (creador)" : ""}
              </span>
              {!isCreator && (
                <button
                  type="button"
                  className="adm-btn adm-btn-small adm-btn-danger"
                  onClick={() => void removeMember(m.organizerId)}
                  disabled={busy === "remove:" + m.organizerId}
                >
                  Quitar
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="adm-chip-row">
        <input
          type="email"
          className="adm-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email del organizador (cuenta Google)"
          aria-label="Email del organizador a agregar"
        />
        <button type="button" className="adm-btn" onClick={() => void addMember()} disabled={busy === "add" || !email.trim()}>
          {busy === "add" ? "Agregando..." : "Agregar"}
        </button>
      </div>
      <p className="adm-hint">La persona debe haber entrado una vez con su cuenta de Google (se crea su fila de organizador).</p>
    </section>
  );
}

"use client";

// Formulario de creacion de evento (F2, T1.3): titulo, duenos,
// mensaje y tema; POST /api/events -> redirige a /admin/[eventId].
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ThemePicker, type ThemeSelection } from "../theme-picker";
import { OwnerNamesInput } from "../owner-names-input";

export function CreateEventForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [ownerNames, setOwnerNames] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [theme, setTheme] = useState<ThemeSelection>({ themeKey: "clasico", variantKey: "clasico-bn" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Ponle un titulo al evento.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          ownerNames,
          message,
          themeKey: theme.themeKey,
          variantKey: theme.variantKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear el evento.");
      router.push("/admin/" + data.eventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el evento.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="adm-form" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h2 style={{ margin: 0 }}>Nuevo evento</h2>

      <div className="adm-field">
        <label className="adm-label" htmlFor="event-title">
          Titulo del evento *
        </label>
        <input
          id="event-title"
          type="text"
          className="adm-input"
          value={title}
          maxLength={120}
          placeholder="Ej: Boda de Ana y Luis"
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      <OwnerNamesInput value={ownerNames} onChange={setOwnerNames} id="event-owners" />

      <div className="adm-field">
        <label className="adm-label" htmlFor="event-message">
          Mensaje de dedicatoria
        </label>
        <textarea
          id="event-message"
          className="adm-textarea"
          value={message}
          maxLength={500}
          placeholder="Ej: Gracias por acompañarnos. Dejanos tus fotos y un mensajito."
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      <div className="adm-field">
        <span className="adm-label">Tema del evento</span>
        <ThemePicker value={theme} onChange={setTheme} />
      </div>

      {error && <p className="adm-error">{error}</p>}

      <div style={{ display: "flex", gap: "0.7rem" }}>
        <button type="submit" className="adm-btn adm-btn-primary" disabled={saving}>
          {saving ? "Creando..." : "Crear evento"}
        </button>
      </div>
    </form>
  );
}

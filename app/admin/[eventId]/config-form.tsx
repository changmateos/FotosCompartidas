"use client";

// Formulario de configuracion del evento (F2, T2.1-T2.3): edita
// titulo, duenos, mensaje, tema/variante (PATCH /api/events/[id])
// y la foto de bienvenida (POST/DELETE welcome-photo; el cliente
// reusa el pipeline de compresion de F4 via prepareUploadImage).
import { useState, type ChangeEvent } from "react";
import type { EventRecord } from "@/lib/events";
import { prepareUploadImage } from "@/lib/image";
import { ThemePicker, type ThemeSelection } from "../theme-picker";
import { OwnerNamesInput } from "../owner-names-input";

export function ConfigForm({ event }: { event: EventRecord }) {
  const [title, setTitle] = useState(event.title);
  const [ownerNames, setOwnerNames] = useState<string[]>(event.owner_names);
  const [message, setMessage] = useState(event.message ?? "");
  const [theme, setTheme] = useState<ThemeSelection>({
    themeKey: event.theme_key,
    variantKey: event.theme_variant,
  });
  const [welcomeUrl, setWelcomeUrl] = useState<string | null>(event.welcome_photo_url);
  const [maxPhotos, setMaxPhotos] = useState(event.max_photos != null ? String(event.max_photos) : "");

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) {
      setError("El titulo es obligatorio.");
      return;
    }
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/events/" + event.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          ownerNames,
          message,
          themeKey: theme.themeKey,
          variantKey: theme.variantKey,
          maxPhotos: maxPhotos === "" ? null : Number(maxPhotos),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar la configuracion.");
      setStatus("Configuracion guardada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la configuracion.");
    } finally {
      setSaving(false);
    }
  }

  async function handleWelcomeFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    setStatus(null);
    try {
      // Reusa el pipeline de F4: HEIC -> JPEG, ~3000 px, <= 3,5 MB
      const prepared = await prepareUploadImage(file);
      const form = new FormData();
      form.append("file", prepared.mainFile, "welcome.jpg");
      const res = await fetch("/api/events/" + event.id + "/welcome-photo", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo subir la foto.");
      setWelcomeUrl(data.url);
      setStatus("Foto de bienvenida actualizada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la foto.");
    } finally {
      setUploading(false);
    }
  }

  async function removeWelcome() {
    setUploading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/events/" + event.id + "/welcome-photo", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo quitar la foto.");
      setWelcomeUrl(null);
      setStatus("Foto de bienvenida quitada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar la foto.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="adm-card">
      <h2>Configuracion</h2>

      <div className="adm-field">
        <label className="adm-label" htmlFor="cfg-title">
          Titulo del evento
        </label>
        <input
          id="cfg-title"
          type="text"
          className="adm-input"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <OwnerNamesInput value={ownerNames} onChange={setOwnerNames} id="cfg-owners" />

      <div className="adm-field">
        <label className="adm-label" htmlFor="cfg-message">
          Mensaje de dedicatoria
        </label>
        <textarea
          id="cfg-message"
          className="adm-textarea"
          value={message}
          maxLength={500}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      <div className="adm-field">
        <span className="adm-label">Tema del evento</span>
        <ThemePicker value={theme} onChange={setTheme} />
      </div>

      <div className="adm-field">
        <label className="adm-label" htmlFor="cfg-maxphotos">
          Limite de fotos (opcional)
        </label>
        <input
          id="cfg-maxphotos"
          type="number"
          className="adm-input"
          min={1}
          max={99999}
          inputMode="numeric"
          value={maxPhotos}
          placeholder="Sin limite"
          onChange={(e) => setMaxPhotos(e.target.value)}
        />
        <p className="adm-hint">Tope de subidas para este evento. Vacio = sin limite (P4).</p>
      </div>

      <div className="adm-field">
        <span className="adm-label">Foto de bienvenida</span>
        <div className="adm-welcome">
          {welcomeUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={welcomeUrl} alt="Foto de bienvenida actual" className="adm-welcome-img" />
          ) : (
            <p className="adm-hint">Sin foto: el header del evento se mostrara solo con titulo y mensaje.</p>
          )}
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <label className="adm-btn" style={{ cursor: uploading ? "wait" : "pointer" }}>
              {uploading ? "Procesando..." : welcomeUrl ? "Cambiar foto" : "Subir foto"}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => void handleWelcomeFile(e)}
                disabled={uploading}
                style={{ display: "none" }}
              />
            </label>
            {welcomeUrl && (
              <button type="button" className="adm-btn" onClick={() => void removeWelcome()} disabled={uploading}>
                Quitar foto
              </button>
            )}
          </div>
        </div>
      </div>

      {status && <p className="adm-status">{status}</p>}
      {error && <p className="adm-error">{error}</p>}

      <div>
        <button type="button" className="adm-btn adm-btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </section>
  );
}

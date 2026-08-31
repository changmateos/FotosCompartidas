"use client";

// Wizard de configuracion del evento (peticion UX): paso a paso, con el paso
// PERSISTIDO en la URL (?paso=N). Al volver del OAuth de Google (que redirige
// a /admin/[eventId]?drive=connected y pierde ?paso) el componente lo retoma
// desde localStorage, asi NO se reinicia en el paso 1.
//  - Pasos: 1 Informacion · 2 Tema y colores · 3 Foto de bienvenida ·
//           4 Google Drive · 5 Compartir QR
//  - "Terminar" limpia el wizard y va al one-page de edicion.
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { EventRecord } from "@/lib/events";
import { ThemePicker, type ThemeSelection } from "../theme-picker";
import { OwnerNamesInput } from "../owner-names-input";
import { DrivePanel } from "./DrivePanel";
import { QRCard } from "@/components/qr/QRCard";
import { MembersPanel, type MemberRow } from "./MembersPanel";
import { ModerationPanel } from "./ModerationPanel";

const STEPS = [
  { n: 1, label: "Informacion" },
  { n: 2, label: "Tema y colores" },
  { n: 3, label: "Foto de bienvenida" },
  { n: 4, label: "Google Drive" },
  { n: 5, label: "Compartir QR" },
];

function storageKey(eventId: string) {
  return "pme_wizard_step_" + eventId;
}

type Props = {
  event: EventRecord;
  qrUrl: string;
  members: MemberRow[];
  createdBy: string;
  currentUserId: string;
  initialStatus: "active" | "closed";
};

export function SetupWizard({ event, qrUrl, members, createdBy, currentUserId, initialStatus }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlPaso = searchParams?.get("paso");
  // Paso inicial: URL (?paso=, p.ej. al volver del OAuth de Drive con paso=4)
  // o localStorage (retoma tras recargar) o 1.
  const [step, setStep] = useState(1);

  useEffect(() => {
    try {
      if (urlPaso) {
        const n = Number(urlPaso);
        if (Number.isInteger(n) && n >= 1 && n <= STEPS.length) {
          setStep(n);
          window.localStorage.setItem(storageKey(event.id), String(n));
          return;
        }
      }
      const saved = window.localStorage.getItem(storageKey(event.id));
      if (saved) {
        const n = Number(saved);
        if (Number.isInteger(n) && n >= 1 && n <= STEPS.length) setStep(n);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, urlPaso]);

  function go(n: number) {
    const clamped = Math.min(Math.max(1, n), STEPS.length);
    setStep(clamped);
    try {
      window.localStorage.setItem(storageKey(event.id), String(clamped));
    } catch {
      // ignore
    }
  }

  function finish() {
    try {
      window.localStorage.removeItem(storageKey(event.id));
    } catch {
      // ignore
    }
    router.push("/admin/" + event.id);
  }

  return (
    <div className="wz-root">
      <div className="wz-steps" role="tablist" aria-label="Pasos de configuracion">
        {STEPS.map((s) => (
          <button
            key={s.n}
            type="button"
            className={"wz-step" + (s.n === step ? " wz-step-active" : "") + (s.n < step ? " wz-step-done" : "")}
            onClick={() => go(s.n)}
            role="tab"
            aria-selected={s.n === step}
          >
            <span className="wz-step-num">{s.n < step ? "\u2713" : s.n}</span>
            <span className="wz-step-label">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="wz-body">
        {step === 1 && <InfoStep event={event} />}
        {step === 2 && <ThemeStep event={event} />}
        {step === 3 && <WelcomePhotoStep event={event} />}
        {step === 4 && <DriveStep eventId={event.id} />}
        {step === 5 && (
          <ShareStep
            event={event}
            qrUrl={qrUrl}
            members={members}
            createdBy={createdBy}
            currentUserId={currentUserId}
            initialStatus={initialStatus}
          />
        )}
      </div>

      <div className="wz-nav">
        <button type="button" className="adm-btn" onClick={() => go(step - 1)} disabled={step <= 1}>
          Anterior
        </button>
        {step < STEPS.length ? (
          <button type="button" className="adm-btn adm-btn-primary" onClick={() => go(step + 1)}>
            Siguiente
          </button>
        ) : (
          <button type="button" className="adm-btn adm-btn-primary" onClick={finish}>
            Terminar configuracion
          </button>
        )}
      </div>

      <p className="adm-hint" style={{ textAlign: "center" }}>
        Tu progreso se guarda en cada paso: si cierras la pagina, al volver continuas donde quedaste.
      </p>
    </div>
  );
}

/* ---------------- Paso 1: Informacion ---------------- */
function InfoStep({ event }: { event: EventRecord }) {
  const [title, setTitle] = useState(event.title);
  const [ownerNames, setOwnerNames] = useState<string[]>(event.owner_names);
  const [message, setMessage] = useState(event.message ?? "");
  const [maxPhotos, setMaxPhotos] = useState(event.max_photos != null ? String(event.max_photos) : "");
  const [saving, setSaving] = useState(false);
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
          maxPhotos: maxPhotos === "" ? null : Number(maxPhotos),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar.");
      setStatus("Guardado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="adm-card">
      <h3>Informacion del evento</h3>
      <p className="adm-hint">Titulo, duenos y mensaje de dedicatoria que veran los invitados.</p>

      <div className="adm-field">
        <label className="adm-label" htmlFor="wz-title">Titulo del evento</label>
        <input id="wz-title" type="text" className="adm-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <OwnerNamesInput value={ownerNames} onChange={setOwnerNames} id="wz-owners" />

      <div className="adm-field">
        <label className="adm-label" htmlFor="wz-message">Mensaje de dedicatoria</label>
        <textarea id="wz-message" className="adm-textarea" value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} />
      </div>

      <div className="adm-field">
        <label className="adm-label" htmlFor="wz-maxphotos">Limite de fotos (opcional)</label>
        <input id="wz-maxphotos" type="number" className="adm-input" min={1} max={99999} inputMode="numeric" value={maxPhotos} placeholder="Sin limite" onChange={(e) => setMaxPhotos(e.target.value)} />
        <p className="adm-hint">Tope de subidas para este evento. Vacio = sin limite.</p>
      </div>

      {status && <p className="adm-status">{status}</p>}
      {error && <p className="adm-error">{error}</p>}

      <div>
        <button type="button" className="adm-btn adm-btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Guardando..." : "Guardar informacion"}
        </button>
      </div>
    </section>
  );
}

/* ---------------- Paso 2: Tema y colores ---------------- */
function ThemeStep({ event }: { event: EventRecord }) {
  const [theme, setTheme] = useState<ThemeSelection>({ themeKey: event.theme_key, variantKey: event.theme_variant });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch("/api/events/" + event.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeKey: theme.themeKey, variantKey: theme.variantKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar el tema.");
      setStatus("Tema guardado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el tema.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="adm-card">
      <h3>Tema y colores</h3>
      <p className="adm-hint">Elegi el estilo que acompanara la pagina del evento.</p>
      <ThemePicker value={theme} onChange={setTheme} />
      {status && <p className="adm-status">{status}</p>}
      {error && <p className="adm-error">{error}</p>}
      <div>
        <button type="button" className="adm-btn adm-btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Guardando..." : "Guardar tema"}
        </button>
      </div>
    </section>
  );
}

/* ---------------- Paso 3: Foto de bienvenida ---------------- */
function WelcomePhotoStep({ event }: { event: EventRecord }) {
  const [welcomeUrl, setWelcomeUrl] = useState<string | null>(event.welcome_photo_url);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    setStatus(null);
    try {
      const { prepareUploadImage } = await import("@/lib/image");
      const prepared = await prepareUploadImage(file);
      const form = new FormData();
      form.append("file", prepared.mainFile, "welcome.jpg");
      const res = await fetch("/api/events/" + event.id + "/welcome-photo", { method: "POST", body: form });
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

  async function remove() {
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
      <h3>Foto de bienvenida</h3>
      <p className="adm-hint">Una imagen que aparecera arriba de la pagina del evento.</p>
      <div className="adm-welcome">
        {welcomeUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={welcomeUrl + (welcomeUrl.includes("?") ? "&" : "?") + "v=" + Date.now()}
            alt="Foto de bienvenida actual"
            className="adm-welcome-img"
          />
        ) : (
          <p className="adm-hint">Sin foto: el header mostrara solo titulo y mensaje.</p>
        )}
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <label className="adm-btn" style={{ cursor: uploading ? "wait" : "pointer" }}>
            {uploading ? "Procesando..." : welcomeUrl ? "Cambiar foto" : "Subir foto"}
            <input type="file" accept="image/*" onChange={(e) => void handleFile(e)} disabled={uploading} style={{ display: "none" }} />
          </label>
          {welcomeUrl && (
            <button type="button" className="adm-btn" onClick={() => void remove()} disabled={uploading}>
              Quitar foto
            </button>
          )}
        </div>
      </div>
      {status && <p className="adm-status">{status}</p>}
      {error && <p className="adm-error">{error}</p>}
    </section>
  );
}

/* ---------------- Paso 4: Google Drive ---------------- */
function DriveStep({ eventId }: { eventId: string }) {
  return (
    <section className="adm-card">
      <h3>Google Drive</h3>
      <p className="adm-hint">Conecta la carpeta donde caeran las fotos de los invitados.</p>
      <DrivePanel eventId={eventId} modo="nuevo" />
    </section>
  );
}

/* ---------------- Paso 5: Compartir QR ---------------- */
function ShareStep({
  event,
  qrUrl,
  members,
  createdBy,
  currentUserId,
  initialStatus,
}: {
  event: EventRecord;
  qrUrl: string;
  members: MemberRow[];
  createdBy: string;
  currentUserId: string;
  initialStatus: "active" | "closed";
}) {
  return (
    <div className="wz-share">
      <section className="adm-card">
        <h3>Tu evento esta listo</h3>
        <p className="adm-hint">
          Comparti este codigo QR: los invitados lo escanean y se abre la pagina de fotos.
        </p>
        <QRCard url={qrUrl} slug={event.slug} />
      </section>

      <MembersPanel eventId={event.id} createdBy={createdBy} currentUserId={currentUserId} members={members} />
      <ModerationPanel eventId={event.id} slug={event.slug} initialStatus={initialStatus} />
    </div>
  );
}

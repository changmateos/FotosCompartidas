"use client";

// Obturador sticky en el TOP del feed (peticion UX): el invitado puede
// tomar una foto en cualquier momento mientras hace scroll por el feed.
// - Barra fija arriba con el obturador compacto (siempre visible).
// - Al tocar, abre la camara nativa y muestra el flujo (procesar,
//   vista previa + mensaje, subir) en un OVERLAY a pantalla completa.
// Reusa lib/image.ts (HEIC->JPEG, compresion, thumbnail) y POST /api/upload.
import { useRef, useState, type ChangeEvent } from "react";
import { prepareUploadImage, type PhotoToUpload, type PreparedImage } from "@/lib/image";
import "./camera.css";
import "./sticky-camera.css";

export function StickyCameraBar({ eventSlug }: { eventSlug: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);
  const preparedRef = useRef<PreparedImage | null>(null);

  const [phase, setPhase] = useState<"idle" | "processing" | "preview" | "uploading" | "success" | "error">("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "processing" || phase === "uploading";

  function openOverlay() {
    setError(null);
    setCaption("");
    preparedRef.current = null;
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  function closeOverlay() {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    preparedRef.current = null;
    setCaption("");
    setError(null);
    setPhase("idle");
  }

  async function processFile(file: File) {
    pendingFileRef.current = file;
    openOverlay();
    setPhase("processing");
    try {
      const prepared = await prepareUploadImage(file);
      preparedRef.current = prepared;
      setPreviewUrl(URL.createObjectURL(prepared.mainFile));
      setPhase("preview");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "No se pudo procesar la foto. Intenta de nuevo.");
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void processFile(file);
  }

  async function handleSubmit() {
    const prepared = preparedRef.current;
    if (!prepared) return;
    setError(null);
    setPhase("uploading");
    try {
      const photo: PhotoToUpload = { ...prepared, caption: caption.trim().slice(0, 500) };
      const form = new FormData();
      form.append("file", photo.mainFile, "foto.jpg");
      form.append("thumb", photo.thumbFile, "thumb.jpg");
      form.append("slug", eventSlug);
      if (photo.caption) form.append("caption", photo.caption);
      form.append("width", String(photo.width));
      form.append("height", String(photo.height));
      form.append("sizeBytes", String(photo.sizeBytes));
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "No se pudo subir la foto.");
      setPhase("success");
      // Auto-cerrar el overlay tras un instante y dejar el obturador listo
      setTimeout(() => closeOverlay(), 1600);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "No se pudo subir la foto. Reintenta.");
    }
  }

  return (
    <>
      {/* Barra sticky superior */}
      <div className="sc-bar">
        <button
          type="button"
          className="sc-shutter"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label="Tomar foto"
        >
          <span className="sc-shutter-icon" aria-hidden="true">
            {"\u{1F4F7}"}
          </span>
        </button>
        <span className="sc-bar-text">Tomar foto</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="cam-input"
        onChange={handleFileChange}
        disabled={busy}
        data-event-slug={eventSlug}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Overlay del flujo de captura */}
      {phase !== "idle" && (
        <div className="sc-overlay" role="dialog" aria-modal="true" aria-label="Captura de foto">
          {phase === "processing" && (
            <div className="cam-status" role="status">
              <span className="cam-spinner" aria-hidden="true" />
              <p>Procesando tu foto…</p>
            </div>
          )}

          {phase === "preview" && previewUrl && (
            <div className="sc-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Vista previa de tu foto" className="sc-preview-img" />
              <input
                type="text"
                className="cam-caption"
                value={caption}
                maxLength={500}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Escribe un mensaje (opcional)"
                aria-label="Mensaje de la foto"
              />
              <div className="cam-actions">
                <button type="button" className="cam-btn cam-btn-primary" onClick={() => void handleSubmit()} disabled={busy}>
                  Subir foto
                </button>
                <button type="button" className="cam-btn" onClick={closeOverlay} disabled={busy}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {phase === "uploading" && (
            <div className="cam-status" role="status">
              <span className="cam-spinner" aria-hidden="true" />
              <p>Subiendo…</p>
            </div>
          )}

          {phase === "success" && (
            <div className="cam-status cam-success" role="status">
              <p className="cam-success-icon" aria-hidden="true">{"\u{1F389}"}</p>
              <p>¡Foto subida!</p>
              <p className="cam-status-sub">Ya esta en el feed y en el Drive del organizador.</p>
            </div>
          )}

          {phase === "error" && (
            <div className="cam-status cam-error" role="alert">
              <p>No se pudo procesar la foto.</p>
              <p className="cam-status-sub">{error}</p>
              <div className="cam-actions">
                <button
                  type="button"
                  className="cam-btn cam-btn-primary"
                  onClick={() => {
                    if (pendingFileRef.current) void processFile(pendingFileRef.current);
                  }}
                >
                  Reintentar
                </button>
                <button type="button" className="cam-btn" onClick={closeOverlay}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

"use client";

// Boton grande de foto (F4): abre la camara nativa con
// <input type="file" accept="image/*" capture="environment"> (SIN getUserMedia),
// procesa HEIC -> JPEG, comprime a ~3000 px <= 3,5 MB y genera thumbnail ~400 px
// (lib/image.ts). Estados: Procesando / Vista previa + mensaje / Subiendo /
// Exito / Error con reintento. Una subida a la vez por invitado.

import { useRef, useState, type ChangeEvent } from "react";
import { prepareUploadImage, type PhotoToUpload, type PreparedImage } from "@/lib/image";
import "./camera.css";

export type CameraButtonProps = {
  /** Slug del evento (reservado para F5: subida a /api/upload). */
  eventSlug: string;
  /** Desactiva el boton (evento cerrado). La pagina oculta el boton en ese caso. */
  disabled?: boolean;
  /**
   * Funcion de subida que conecta F5. Si no se provee (F4), el flujo
   * termina en "Foto lista" tras la compresion.
   */
  upload?: (photo: PhotoToUpload) => Promise<void>;
};

type Phase = "idle" | "processing" | "preview" | "uploading" | "success" | "error";

export function CameraButton({ eventSlug, disabled = false, upload }: CameraButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);
  const preparedRef = useRef<PreparedImage | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "processing" || phase === "uploading";

  /**
   * Subida real (F5): construye el FormData segun el contrato de
   * POST /api/upload (file JPEG <=3,5 MB, thumb ~400 px, slug,
   * caption?, width?, height?, sizeBytes?) y lanza el fetch. La
   * cookie guest_id la setea el servidor en el primer uso.
   */
  async function defaultUpload(photo: PhotoToUpload): Promise<void> {
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
    if (!res.ok) {
      throw new Error(data.error ?? "No se pudo subir la foto.");
    }
  }

  function reset() {
    preparedRef.current = null;
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setCaption("");
    setError(null);
    setPhase("idle");
  }

  async function processFile(file: File) {
    pendingFileRef.current = file;
    reset();
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
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (file) void processFile(file);
  }

  async function handleSubmit() {
    const prepared = preparedRef.current;
    if (!prepared) return;
    setError(null);
    setPhase("uploading");
    try {
      const photo: PhotoToUpload = { ...prepared, caption: caption.trim().slice(0, 500) };
      if (upload) {
        await upload(photo);
      } else {
        await defaultUpload(photo);
      }
      setPhase("success");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "No se pudo subir la foto. Reintenta.");
    }
  }

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="cam-root">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="cam-input"
        onChange={handleFileChange}
        disabled={disabled || busy}
        data-event-slug={eventSlug}
        aria-hidden="true"
        tabIndex={-1}
      />

      {phase === "idle" && (
        <div className="cam-idle">
          <button
            type="button"
            className="cam-shutter"
            onClick={openPicker}
            disabled={disabled}
            aria-label="Tomar foto"
          >
            <span className="cam-shutter-icon" aria-hidden="true">
              {"\u{1F4F7}"}
            </span>
          </button>
          <p className="cam-hint">Toca el boton para abrir tu camara y tomar una foto de este evento.</p>
        </div>
      )}

      {phase === "processing" && (
        <div className="cam-status" role="status">
          <span className="cam-spinner" aria-hidden="true" />
          <p>Procesando tu foto…</p>
          <p className="cam-status-sub">Comprimiendo para que suba rapido</p>
        </div>
      )}

      {phase === "preview" && previewUrl && (
        <div className="cam-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Vista previa de tu foto" className="cam-preview-img" />
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
            <button type="button" className="cam-btn" onClick={openPicker}>
              Elegir otra
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
        <div className="cam-idle">
          <p className="cam-hint cam-success" role="status">
            ¡Foto subida! Ya esta en el feed y en el Drive del organizador.
          </p>
          <button
            type="button"
            className="cam-shutter"
            onClick={openPicker}
            disabled={disabled}
            aria-label="Tomar otra foto"
          >
            <span className="cam-shutter-icon" aria-hidden="true">
              {"\u{1F4F7}"}
            </span>
          </button>
          <p className="cam-hint">Toca el boton para tomar otra foto.</p>
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
            <button type="button" className="cam-btn" onClick={openPicker}>
              Elegir otra
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

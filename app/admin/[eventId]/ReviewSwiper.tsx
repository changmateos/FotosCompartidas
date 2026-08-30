"use client";

// Revisor de fotos del evento (peticion UX, version robusta para movil):
// el organizador repasa las fotos una a una con botones claros.
//   - "Guardar"  -> mantiene la foto y pasa a la siguiente
//   - "Eliminar" -> borra la foto (papelera de Drive + Storage + BD) y pasa
// SIN gestos de swipe ni touch-action:none: el scroll tactil del admin
// funciona normal en Android Chrome.
import { useState } from "react";

export type ReviewPhoto = {
  id: string;
  thumb_url: string;
  caption: string | null;
  created_at: string;
  like_count: number;
  comment_count: number;
};

export function ReviewSwiper({
  photos,
  onDeleted,
}: {
  photos: ReviewPhoto[];
  onDeleted?: (photoId: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(0);
  const [removed, setRemoved] = useState(0);

  const current = photos[index];
  const done = !current;

  async function deletePhoto() {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/photos/" + current.id, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo borrar la foto.");
      setRemoved((n) => n + 1);
      onDeleted?.(current.id);
      setIndex((i) => i + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar la foto.");
    } finally {
      setBusy(false);
    }
  }

  function keepPhoto() {
    if (!current || busy) return;
    setKept((n) => n + 1);
    setIndex((i) => i + 1);
  }

  if (done) {
    return (
      <section className="adm-card">
        <h3>Revisar fotos</h3>
        <div className="sw-done" role="status">
          <span className="sw-done-icon" aria-hidden="true">{"\u{1F389}"}</span>
          <p className="sw-done-title">¡Ya revisaste todas las fotos!</p>
          <p className="adm-hint">
            Mantuviste {kept} foto{kept === 1 ? "" : "s"} y eliminaste {removed}.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="adm-card">
      <div className="adm-card-header">
        <h3>Revisar fotos</h3>
        <span className="adm-hint">
          {index + 1} de {photos.length}
        </span>
      </div>

      {error && <p className="adm-error">{error}</p>}

      <div className="sw-card-static">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.thumb_url} alt={current.caption ?? "Foto del evento"} className="sw-img" draggable={false} />
        <div className="sw-body">
          <p className="sw-caption">{current.caption || "Sin mensaje"}</p>
          <p className="adm-hint">
            {formatDate(current.created_at)} · {current.like_count} likes · {current.comment_count} comentarios
          </p>
        </div>
      </div>

      <div className="sw-buttons">
        <button
          type="button"
          className="sw-btn sw-btn-keep"
          onClick={() => void keepPhoto()}
          disabled={busy}
        >
          {"\u{2713}"} Guardar
        </button>
        <button
          type="button"
          className="sw-btn sw-btn-delete"
          onClick={() => void deletePhoto()}
          disabled={busy}
        >
          {busy ? "Borrando..." : "\u{2715} Eliminar"}
        </button>
      </div>
    </section>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

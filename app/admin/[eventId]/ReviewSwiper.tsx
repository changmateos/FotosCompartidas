"use client";

// Revisor de fotos estilo Tinder (peticion UX): el organizador repasa
// las fotos del evento una a una. Swipe a la IZQUIERDA = eliminar la
// foto (papelera de Drive + Storage + BD); swipe a la DERECHA = mantener
// (pasa a la siguiente). Al terminar muestra un mensaje de cierre.
// Soporta touch (pointer events) y mouse (arrastrar). Tambien botones
// visibles como alternativa accesible.
import { useRef, useState, type PointerEvent } from "react";

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
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(0);
  const [removed, setRemoved] = useState(0);

  const startX = useRef(0);
  const startY = useRef(0);
  const horizontal = useRef(false);

  const current = photos[index];
  const done = !current;

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (busy || done) return;
    startX.current = e.clientX;
    startY.current = e.clientY;
    horizontal.current = false;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragging || busy || done) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (!horizontal.current && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      horizontal.current = true;
    }
    if (horizontal.current) setDragX(dx);
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    setDragging(false);
    const dx = e.clientX - startX.current;
    if (horizontal.current && Math.abs(dx) > 80) {
      if (dx < 0) void swipeLeft();
      else void swipeRight();
    } else {
      setDragX(0);
    }
  }

  async function swipeLeft() {
    // eliminar
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/photos/" + current.id, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo borrar la foto.");
      setRemoved((n) => n + 1);
      onDeleted?.(current.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar la foto.");
      setBusy(false);
      setDragX(0);
      return;
    }
    advance();
  }

  async function swipeRight() {
    // mantener
    if (!current) return;
    setKept((n) => n + 1);
    advance();
  }

  function advance() {
    setBusy(false);
    setDragX(0);
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

  const rotation = dragX / 20;

  return (
    <section className="adm-card">
      <div className="adm-card-header">
        <h3>Revisar fotos</h3>
        <span className="adm-hint">
          {index + 1} de {photos.length}
        </span>
      </div>

      {error && <p className="adm-error">{error}</p>}

      <div
        className="sw-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="sw-card"
          style={{
            transform: `translateX(${dragX}px) rotate(${rotation}deg)`,
            transition: dragging ? "none" : "transform 0.25s ease",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.thumb_url} alt={current.caption ?? "Foto del evento"} className="sw-img" draggable={false} />
          <div className="sw-body">
            <p className="sw-caption">{current.caption || "Sin mensaje"}</p>
            <p className="adm-hint">
              {formatDate(current.created_at)} · {current.like_count} likes · {current.comment_count} comentarios
            </p>
          </div>
        </div>

        {/* Indicadores de direccion */}
        <div className="sw-hint sw-hint-left" style={{ opacity: dragX < -40 ? 1 : 0.4 }}>
          Eliminar
        </div>
        <div className="sw-hint sw-hint-right" style={{ opacity: dragX > 40 ? 1 : 0.4 }}>
          Mantener
        </div>
      </div>

      <p className="adm-hint sw-help">
        Desliza a la izquierda para eliminar, a la derecha para mantener.
      </p>

      {/* Botones accesibles (alternativa al swipe) */}
      <div className="sw-buttons">
        <button
          type="button"
          className="adm-btn adm-btn-danger"
          onClick={() => void swipeLeft()}
          disabled={busy}
        >
          {busy ? "Borrando..." : "✕ Eliminar"}
        </button>
        <button
          type="button"
          className="adm-btn adm-btn-primary"
          onClick={() => void swipeRight()}
          disabled={busy}
        >
          Mantener ✓
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

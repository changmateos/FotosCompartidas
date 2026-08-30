"use client";

// Boton "me gusta" (F6, T6.2): corazon con contador y estado activo
// por invitado. Optimista: cambia al instante y revierte si la API
// falla. Deshabilitado en eventos cerrados (feed de solo lectura).
import { useState } from "react";

export function LikeButton({
  photoId,
  guestId,
  liked,
  count,
  disabled,
  onToggle,
}: {
  photoId: string;
  guestId: string;
  liked: boolean;
  count: number;
  disabled?: boolean;
  onToggle?: (photoId: string, liked: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [localLiked, setLocalLiked] = useState(liked);
  const [localCount, setLocalCount] = useState(count);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (busy || disabled) return;
    const next = !localLiked;
    setBusy(true);
    setError(null);
    // Optimista
    setLocalLiked(next);
    setLocalCount(Math.max(0, localCount + (next ? 1 : -1)));
    try {
      const res = await fetch("/api/likes/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId, guestId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo registrar el like.");
      setLocalLiked(data.liked);
      setLocalCount(data.count);
      onToggle?.(photoId, data.liked);
    } catch (e) {
      // Revertir
      setLocalLiked(liked);
      setLocalCount(count);
      setError(e instanceof Error ? e.message : "No se pudo registrar el like.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="feed-like-wrap">
      <button
        type="button"
        className={"feed-like" + (localLiked ? " feed-like-active" : "")}
        onClick={() => void toggle()}
        disabled={busy || disabled}
        aria-pressed={localLiked}
        aria-label={localLiked ? "Quitar me gusta" : "Dar me gusta"}
      >
        <span className="feed-like-icon" aria-hidden="true">
          {localLiked ? "\u2764\uFE0F" : "\u2661"}
        </span>
        <span className="feed-like-count">{localCount}</span>
      </button>
      {error && <span className="feed-inline-error">{error}</span>}
    </span>
  );
}

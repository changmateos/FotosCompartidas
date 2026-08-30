"use client";

// Lista de comentarios + input (F6, T6.3). El texto se renderiza como
// texto plano (React escapa HTML). POST /api/comments con rate limit.
import { useEffect, useState, type FormEvent } from "react";
import { fetchComments, type CommentPhoto } from "@/lib/feed-client";

export function CommentList({
  photoId,
  guestId,
  status,
  onCommentAdded,
}: {
  photoId: string;
  guestId: string;
  status: "active" | "closed";
  onCommentAdded?: (photoId: string) => void;
}) {
  const [comments, setComments] = useState<CommentPhoto[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchComments(photoId).then((cs) => {
      if (!cancelled) setComments(cs);
    });
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId, guestId, text: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo publicar el comentario.");
      setComments((prev) => [...(prev ?? []), data.comment as CommentPhoto]);
      setText("");
      onCommentAdded?.(photoId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo publicar el comentario.");
    } finally {
      setSending(false);
    }
  }

  const readOnly = status !== "active";

  return (
    <div className="feed-comments">
      {comments === null ? (
        <p className="feed-comments-loading">Cargando comentarios...</p>
      ) : comments.length === 0 ? (
        <p className="feed-comments-empty">Sin comentarios todavia.</p>
      ) : (
        <ul className="feed-comments-list">
          {comments.map((c) => (
            <li key={c.id} className="feed-comment">
              <p className="feed-comment-text">{c.text}</p>
              <time className="feed-comment-time">{formatDateTime(c.created_at)}</time>
            </li>
          ))}
        </ul>
      )}

      <form className="feed-comment-form" onSubmit={(e) => void submit(e)}>
        <input
          type="text"
          className="feed-comment-input"
          value={text}
          maxLength={500}
          placeholder={readOnly ? "El evento esta cerrado" : "Escribe un comentario..."}
          disabled={readOnly || sending}
          onChange={(e) => setText(e.target.value)}
          aria-label="Comentario"
        />
        <button type="submit" className="feed-comment-send" disabled={readOnly || sending || !text.trim()}>
          {sending ? "..." : "Enviar"}
        </button>
      </form>
      {error && <p className="feed-inline-error">{error}</p>}
      {readOnly && <p className="feed-hint">Evento cerrado: el feed queda como recuerdo, sin comentarios nuevos.</p>}
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

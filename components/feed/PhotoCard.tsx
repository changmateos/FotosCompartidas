"use client";

// Tarjeta del feed (F6): thumbnail (Storage publico, NUNCA Drive),
// pie de foto, boton me gusta y comentarios.
import { useState } from "react";
import type { FeedPhoto } from "@/lib/feed-client";
import { LikeButton } from "./LikeButton";
import { CommentList } from "./CommentList";

export function PhotoCard({
  photo,
  guestId,
  liked,
  status,
  onToggleLike,
  onCommentAdded,
}: {
  photo: FeedPhoto;
  guestId: string;
  liked: boolean;
  status: "active" | "closed";
  onToggleLike?: (photoId: string, liked: boolean) => void;
  onCommentAdded?: (photoId: string) => void;
}) {
  const [commentsOpen, setCommentsOpen] = useState(false);

  return (
    <article className="feed-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.thumb_url}
        alt={photo.caption ?? "Foto del evento"}
        className="feed-thumb"
        loading="lazy"
        decoding="async"
      />
      {photo.caption ? <p className="feed-caption">{photo.caption}</p> : null}

      <div className="feed-meta">
        <LikeButton
          photoId={photo.id}
          guestId={guestId}
          liked={liked}
          count={photo.like_count}
          disabled={status !== "active"}
          onToggle={onToggleLike}
        />
        <button
          type="button"
          className="feed-comment-toggle"
          onClick={() => setCommentsOpen((v) => !v)}
          aria-expanded={commentsOpen}
        >
          <span aria-hidden="true">{"\u{1F4AC}"}</span>
          <span>Comentarios ({photo.comment_count})</span>
        </button>
        <time className="feed-time">{formatDateTime(photo.created_at)}</time>
      </div>

      {commentsOpen && (
        <CommentList
          photoId={photo.id}
          guestId={guestId}
          status={status}
          onCommentAdded={onCommentAdded}
        />
      )}
    </article>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

"use client";

// Seccion del feed (F6): resuelve el id del evento desde el slug,
// carga las fotos con Realtime + fallback a polling (use-feed) y
// renderiza la lista con estados de carga/error/vacio. El feed lee
// SOLO Supabase (photos/likes/comments + thumbs de Storage).
import { useEffect, useState } from "react";
import { resolveEventId, getGuestId, fetchMyLikedIds, FEED_PAGE_SIZE } from "@/lib/feed-client";
import { useFeed } from "./use-feed";
import { PhotoCard } from "./PhotoCard";
import "./feed.css";

export function FeedSection({ slug, status }: { slug: string; status: "active" | "closed" }) {
  const [guestId, setGuestIdState] = useState("");
  const [eventId, setEventId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  // guest_id unico (cookie httpOnly del servidor via /api/guest, F8)
  useEffect(() => {
    let cancelled = false;
    void getGuestId().then((id) => {
      if (!cancelled) setGuestIdState(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!guestId) return;
    let cancelled = false;
    void (async () => {
      const id = await resolveEventId(slug);
      if (cancelled) return;
      if (!id) {
        setResolveError("No pudimos encontrar este evento.");
        return;
      }
      setEventId(id);
      const liked = await fetchMyLikedIds(id, guestId);
      if (!cancelled) setLikedIds(liked);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, guestId]);

  const feed = useFeed(eventId ?? "");

  function handleToggleLike(photoId: string, liked: boolean) {
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (liked) next.add(photoId);
      else next.delete(photoId);
      return next;
    });
  }

  function handleCommentAdded(_photoId: string) {
    // Los contadores se refrescan via Realtime/polling (merge por id).
  }

  if (resolveError) {
    return <div className="feed-state feed-error">{resolveError}</div>;
  }

  if (!eventId || !guestId || feed.loading) {
    return (
      <div className="feed-list" aria-label="Cargando fotos">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="feed-skeleton">
            <div className="sk-skeleton feed-skeleton-thumb" />
            <div className="sk-skeleton feed-skeleton-line" />
          </div>
        ))}
      </div>
    );
  }

  if (feed.error && feed.photos.length === 0) {
    return (
      <div className="feed-state feed-error" role="alert">
        <p>No se pudo cargar el feed. Revisa tu conexion.</p>
        <p className="feed-error-detail">{feed.error}</p>
        <button type="button" className="feed-retry" onClick={() => feed.retry()}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="feed-root">
      <div className="feed-live">
        {feed.mode === "realtime" ? "En vivo" : "Actualizando..."}
      </div>

      {feed.photos.length === 0 ? (
        <div className="feed-state feed-empty">
          <span className="feed-empty-icon" aria-hidden="true">
            {"\u{1F4F8}"}
          </span>
          <p className="feed-empty-title">Aun no hay fotos</p>
          <p className="feed-empty-text">¡Se el primero! Subi tu foto arriba y aparece aca al instante.</p>
        </div>
      ) : (
        <>
          <div className="feed-list">
            {feed.photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                guestId={guestId}
                liked={likedIds.has(photo.id)}
                status={status}
                onToggleLike={handleToggleLike}
                onCommentAdded={handleCommentAdded}
              />
            ))}
          </div>

          {feed.hasMore && (
            <div className="feed-more">
              <button
                type="button"
                className="feed-more-btn"
                onClick={() => void feed.loadMore()}
                disabled={feed.loadingMore}
              >
                {feed.loadingMore ? "Cargando..." : "Ver mas fotos"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

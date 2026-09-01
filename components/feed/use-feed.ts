"use client";

// Hook del feed (F6): carga inicial + paginacion por cursor +
// Realtime (postgres_changes) con DETECTOR DE FALLBACK: si no llega
// ningun push en REALTIME_FALLBACK_MS (8 s) o la conexion falla,
// pasa a polling cada POLL_INTERVAL_MS (9 s) con If-None-Match (ETag);
// si llega un push, vuelve a Realtime. Merge por id de la primera
// pagina (fotos nuevas al tope, contadores actualizados).

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  fetchPhotosPage,
  getSupabase,
  FEED_PAGE_SIZE,
  POLL_INTERVAL_MS,
  REALTIME_FALLBACK_MS,
  type FeedCursor,
  type FeedPhoto,
} from "@/lib/feed-client";

export type FeedMode = "realtime" | "polling";

type RealtimePayload = { eventType?: string; old?: { id?: string } };

function byNewest(a: FeedPhoto, b: FeedPhoto): number {
  if (a.created_at === b.created_at) return a.id < b.id ? 1 : -1;
  return a.created_at < b.created_at ? 1 : -1;
}

export function useFeed(eventId: string) {
  const [photos, setPhotos] = useState<FeedPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<FeedMode>("realtime");

  const cursorRef = useRef<FeedCursor>(null);
  const etagRef = useRef<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPushRef = useRef<number>(Date.now());

  const mergePage = useCallback((incoming: FeedPhoto[]) => {
    setPhotos((prev) => {
      const map = new Map<string, FeedPhoto>();
      for (const p of prev) map.set(p.id, p);
      for (const p of incoming) map.set(p.id, p);
      return Array.from(map.values()).sort(byNewest);
    });
  }, []);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    setMode("polling");
    pollingRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await fetchPhotosPage(eventId, { etag: etagRef.current, limit: FEED_PAGE_SIZE });
          if (res.changed) {
            etagRef.current = res.etag;
            mergePage(res.photos);
          }
        } catch {
          // el proximo poll reintenta; no rompe la UI
        }
      })();
    }, POLL_INTERVAL_MS);
  }, [eventId, mergePage]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setMode("realtime");
  }, []);

  // Push de Realtime: borrados -> quitar del listado; el resto -> refrescar pagina 1
  const onPush = useCallback(
    (payload: RealtimePayload) => {
      lastPushRef.current = Date.now();
      stopPolling();
      if (payload?.eventType === "DELETE" && payload.old?.id) {
        const removedId = payload.old.id;
        setPhotos((prev) => prev.filter((p) => p.id !== removedId));
        return;
      }
      void (async () => {
        try {
          const res = await fetchPhotosPage(eventId, { etag: etagRef.current, limit: FEED_PAGE_SIZE });
          if (res.changed) {
            etagRef.current = res.etag;
            mergePage(res.photos);
          }
        } catch {
          // ignora: el polling de fallback se encarga
        }
      })();
    },
    [eventId, mergePage, stopPolling],
  );

  // Carga inicial + suscripcion Realtime + detector de fallback
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const first = await fetchPhotosPage(eventId, { limit: FEED_PAGE_SIZE });
        if (cancelled) return;
        etagRef.current = first.etag;
        cursorRef.current = first.cursor;
        setHasMore(Boolean(first.cursor));
        mergePage(first.photos);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "No se pudo cargar el feed.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const supabase = getSupabase();
    // El canal Realtime va en try/catch: si la conexion falla (p.ej. el
    // WebSocket bloqueado en algunos navegadores), se degrada a polling en
    // lugar de lanzar un error que romperia la pagina (error boundary).
    let channel: RealtimeChannel | null = null;
    try {
      channel = supabase
        .channel("feed-" + eventId)
        .on("postgres_changes", { event: "*", schema: "public", table: "photos", filter: "event_id=eq." + eventId }, (payload) => onPush(payload as RealtimePayload))
        .on("postgres_changes", { event: "*", schema: "public", table: "likes", filter: "event_id=eq." + eventId }, (payload) => onPush(payload as RealtimePayload))
        .on("postgres_changes", { event: "*", schema: "public", table: "comments", filter: "event_id=eq." + eventId }, (payload) => onPush(payload as RealtimePayload))
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            startPolling();
          }
        });
    } catch {
      // WebSocket no disponible (Safari/otros): fallback a polling directo.
      startPolling();
    }

    // Detector de fallback: si no llega push en X segundos -> polling
    const watcher = setInterval(() => {
      if (Date.now() - lastPushRef.current > REALTIME_FALLBACK_MS) {
        startPolling();
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(watcher);
      stopPolling();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [eventId, mergePage, onPush, startPolling, stopPolling]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !cursorRef.current) return;
    setLoadingMore(true);
    try {
      const res = await fetchPhotosPage(eventId, { cursor: cursorRef.current, limit: FEED_PAGE_SIZE });
      cursorRef.current = res.cursor;
      setHasMore(Boolean(res.cursor));
      setPhotos((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const next = [...prev, ...res.photos.filter((p) => !seen.has(p.id))];
        return next.sort(byNewest);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar mas fotos.");
    } finally {
      setLoadingMore(false);
    }
  }, [eventId, loadingMore]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const first = await fetchPhotosPage(eventId, { limit: FEED_PAGE_SIZE });
        etagRef.current = first.etag;
        cursorRef.current = first.cursor;
        setHasMore(Boolean(first.cursor));
        mergePage(first.photos);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo cargar el feed.");
      } finally {
        setLoading(false);
      }
    })();
  }, [eventId, mergePage]);

  return { photos, loading, loadingMore, hasMore, error, mode, loadMore, retry };
}

"use client";

// Moderacion y ciclo de vida del evento (repair F1 [HIGH] / T7):
// borrar fotos (DELETE /api/photos/[id]), borrar comentarios
// (DELETE /api/comments/[id]), cerrar evento (POST
// /api/events/[eventId]/close) y borrar evento (DELETE
// /api/events/[eventId]; el Drive del organizador queda intacto).
import { useState } from "react";
import { useRouter } from "next/navigation";

export type AdminPhoto = {
  id: string;
  thumb_url: string;
  caption: string | null;
  created_at: string;
  like_count: number;
  comment_count: number;
};

export type AdminComment = {
  id: string;
  photo_id: string;
  guest_id: string;
  text: string;
  created_at: string;
};

export function ModerationPanel({
  eventId,
  slug,
  initialStatus,
  initialPhotos,
  initialComments,
}: {
  eventId: string;
  slug: string;
  initialStatus: "active" | "closed";
  initialPhotos: AdminPhoto[];
  initialComments: AdminComment[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"active" | "closed">(initialStatus);
  const [photos, setPhotos] = useState<AdminPhoto[]>(initialPhotos);
  const [comments, setComments] = useState<AdminComment[]>(initialComments);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  function flash(msg: string) {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 3000);
  }

  async function deletePhoto(photoId: string) {
    if (!window.confirm("¿Borrar esta foto? Desaparece del feed, del Storage y va a la papelera de tu Drive.")) return;
    setBusy("photo:" + photoId);
    setError(null);
    try {
      const res = await fetch("/api/photos/" + photoId, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo borrar la foto.");
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
      setComments((prev) => prev.filter((c) => c.photo_id !== photoId));
      flash("Foto borrada.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar la foto.");
    } finally {
      setBusy(null);
    }
  }

  async function clearLikes(photoId: string) {
    if (!window.confirm("¿Borrar todos los likes de esta foto?")) return;
    setBusy("likes:" + photoId);
    setError(null);
    try {
      const res = await fetch("/api/photos/" + photoId + "/likes", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudieron borrar los likes.");
      setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, like_count: 0 } : p)));
      flash("Likes borrados.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron borrar los likes.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteComment(commentId: string) {
    if (!window.confirm("¿Borrar este comentario?")) return;
    setBusy("comment:" + commentId);
    setError(null);
    try {
      const res = await fetch("/api/comments/" + commentId, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo borrar el comentario.");
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      flash("Comentario borrado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar el comentario.");
    } finally {
      setBusy(null);
    }
  }

  async function closeEvent() {
    if (!window.confirm("¿Cerrar el evento? Los invitados ya no podran subir fotos, pero el feed queda visible como recuerdo.")) return;
    setBusy("close");
    setError(null);
    try {
      const res = await fetch("/api/events/" + eventId + "/close", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cerrar el evento.");
      setStatus("closed");
      flash("Evento cerrado. El feed sigue visible; no se aceptan mas fotos.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cerrar el evento.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteEvent() {
    if (
      !window.confirm(
        "¿Borrar el EVENTO ENTERO? El QR dejara de funcionar y se eliminaran fotos, comentarios y configuracion de la app. Las fotos quedan en TU Google Drive.",
      )
    ) {
      return;
    }
    if (!window.confirm("Confirmacion final: el evento se borra definitivamente de PicMyEvent. ¿Continuar?")) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await fetch("/api/events/" + eventId, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo borrar el evento.");
      router.push("/admin");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar el evento.");
      setBusy(null);
    }
  }

  const commentsByPhoto = new Map<string, AdminComment[]>();
  for (const c of comments) {
    const list = commentsByPhoto.get(c.photo_id) ?? [];
    list.push(c);
    commentsByPhoto.set(c.photo_id, list);
  }

  return (
    <section className="adm-card">
      <div className="adm-card-header">
        <h3>Moderacion</h3>
        {status === "closed" ? (
          <span className="adm-badge">Evento cerrado</span>
        ) : (
          <span className="adm-badge adm-badge-active">Activo</span>
        )}
      </div>

      {statusMsg && <p className="adm-status">{statusMsg}</p>}
      {error && <p className="adm-error">{error}</p>}

      {photos.length === 0 ? (
        <p className="adm-hint">Todavia no hay fotos en este evento.</p>
      ) : (
        <ul className="adm-photo-list">
          {photos.map((photo) => {
            const photoComments = commentsByPhoto.get(photo.id) ?? [];
            return (
              <li key={photo.id} className="adm-photo-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.thumb_url} alt={photo.caption ?? "Foto del evento"} className="adm-photo-thumb" loading="lazy" />
                <div className="adm-photo-body">
                  <p className="adm-photo-caption">{photo.caption || "Sin mensaje"}</p>
                  <p className="adm-hint">
                    {formatDate(photo.created_at)} · {photo.like_count} likes · {photo.comment_count} comentarios
                  </p>

                  {photoComments.length > 0 && (
                    <ul className="adm-comment-list">
                      {photoComments.map((c) => (
                        <li key={c.id} className="adm-comment-row">
                          <span className="adm-comment-text">{c.text}</span>
                          <button
                            type="button"
                            className="adm-btn adm-btn-small"
                            onClick={() => void deleteComment(c.id)}
                            disabled={busy === "comment:" + c.id}
                          >
                            Borrar
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="adm-photo-actions">
                    <button
                      type="button"
                      className="adm-btn adm-btn-small"
                      onClick={() => void clearLikes(photo.id)}
                      disabled={busy === "likes:" + photo.id}
                    >
                      {busy === "likes:" + photo.id ? "Borrando..." : "Borrar likes"}
                    </button>
                    <button
                      type="button"
                      className="adm-btn adm-btn-small adm-btn-danger"
                      onClick={() => void deletePhoto(photo.id)}
                      disabled={busy === "photo:" + photo.id}
                    >
                      {busy === "photo:" + photo.id ? "Borrando..." : "Borrar foto"}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="adm-mod-actions">
        {status === "active" && (
          <button type="button" className="adm-btn" onClick={() => void closeEvent()} disabled={busy === "close"}>
            {busy === "close" ? "Cerrando..." : "Cerrar evento"}
          </button>
        )}
        <button type="button" className="adm-btn adm-btn-danger" onClick={() => void deleteEvent()} disabled={busy === "delete"}>
          {busy === "delete" ? "Borrando..." : "Borrar evento"}
        </button>
      </div>

      <p className="adm-hint">
        Pagina publica: <a href={"/e/" + slug} style={{ color: "var(--primary)" }}>/e/{slug}</a>
      </p>
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

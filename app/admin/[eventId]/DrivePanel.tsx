"use client";

// Panel de Google Drive del evento (repair F1 [HIGH] / T3): estado de
// conexion, medidor de cuota real, conectar (OAuth PKCE propio via
// POST /api/drive/connect, que redirige a Google) y desconectar.
import { useEffect, useState } from "react";

type DriveStatus =
  | { connected: false; needsReconnect: boolean; folderName?: string | null }
  | {
      connected: true;
      limit: number;
      usage: number;
      usageInDrive: number;
      folderId: string;
      folderName: string;
      needsReconnect: boolean;
      error?: string | null; // "temporal": fallo transitorio de la API
    };

export function DrivePanel({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("PicMyEvent - Fotos del evento");
  const [busy, setBusy] = useState(false);
  const [notOwner, setNotOwner] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setNotOwner(false);
    try {
      const res = await fetch("/api/drive/status?eventId=" + encodeURIComponent(eventId));
      if (res.status === 403) {
        // Solo el organizador que conecto el Drive gestiona la conexion (T7.5)
        setNotOwner(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo consultar el estado de Drive.");
      setStatus(data as DriveStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar el estado de Drive.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function disconnect() {
    if (!window.confirm("¿Desconectar Google Drive? Las fotos ya subidas quedan en tu Drive; solo se quita la conexion de la app.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/drive", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo desconectar.");
      setStatus({ connected: false, needsReconnect: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo desconectar.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="adm-card">
        <h3>Google Drive</h3>
        <p className="adm-hint">Consultando el estado...</p>
      </section>
    );
  }

  const conn = status && status.connected ? status : null;

  return (
    <section className="adm-card">
      <h3>Google Drive</h3>
      <p className="adm-hint">
        Las fotos de los invitados caen en una carpeta nueva de TU Google Drive (alcance drive.file).
      </p>

      {notOwner ? (
        <p className="adm-hint">
          La conexion de Google Drive la gestiona el organizador que la conecto. Si necesitas cambiarla,
          pedile a esa persona.
        </p>
      ) : (
        <>
          {error && <p className="adm-error">{error}</p>}

      {!conn ? (
        <div className="adm-drive-connect">
          {status && status.needsReconnect && (
            <p className="adm-status" style={{ color: "#b8860b" }}>
              La conexion anterior vencio (token invalido). Reconecta para seguir recibiendo fotos.
            </p>
          )}
          <div className="adm-chip-row">
            <input
              type="text"
              className="adm-input"
              value={folderName}
              maxLength={200}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Nombre de la carpeta en tu Drive"
              aria-label="Nombre de la carpeta de Drive"
            />
          </div>
          <form method="POST" action="/api/drive/connect">
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="folderName" value={folderName} />
            <button type="submit" className="adm-btn adm-btn-primary" disabled={!folderName.trim()}>
              Conectar Google Drive
            </button>
          </form>
          <p className="adm-hint">
            Se abrira Google para autorizar a PicMyEvent (una sola vez). La app crea la carpeta con ese nombre.
          </p>
        </div>
      ) : (
        <div className="adm-drive-info">
          <p>
            Conectado a <strong>{conn.folderName}</strong>
          </p>
          {conn.error === "temporal" ? (
            <p className="adm-error">La API de Drive fallo temporalmente. Reintenta en un momento.</p>
          ) : (
            <div className="adm-quota">
              <div className="adm-quota-bar" role="img" aria-label={"Uso de Drive " + percentOf(conn.usage, conn.limit) + "%"}>
                <div className="adm-quota-fill" style={{ width: percentOf(conn.usage, conn.limit) + "%" }} />
              </div>
              <p className="adm-hint">
                {formatBytes(conn.usage)} de {formatBytes(conn.limit)} usados ({percentOf(conn.usage, conn.limit)}%)
              </p>
            </div>
          )}
          <button type="button" className="adm-btn" onClick={() => void disconnect()} disabled={busy}>
            {busy ? "Desconectando..." : "Desconectar Drive"}
          </button>
        </div>
      )}
        </>
      )}
    </section>
  );
}

function percentOf(usage: number, limit: number): number {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((usage / limit) * 100));
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 GB";
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? gb.toFixed(1) + " GB" : Math.round(bytes / 1024 / 1024) + " MB";
}

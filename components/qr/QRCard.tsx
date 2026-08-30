"use client";

// Tarjeta QR del evento (F2, T2.4): QRCodeSVG para mostrar y un
// QRCodeCanvas oculto (1024 px) para exportar el PNG. El QR codifica
// NEXT_PUBLIC_APP_URL + "/e/" + slug.
import { useRef, useState } from "react";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import "./qr.css";

export function QRCard({ url, slug }: { url: string; slug: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const needsConfig = url.includes("TU-") || !url.startsWith("http");

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = "qr-" + (slug || "evento") + ".png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard no disponible: no es bloqueante
    }
  }

  return (
    <section className="qr-card">
      <h3>Codigo QR del evento</h3>
      <p className="qr-hint">
        Imprimilo y ponelo en el evento: los invitados lo escanean y se abre la pagina de fotos.
      </p>

      <div className="qr-figure">
        <QRCodeSVG value={url} size={220} level="M" marginSize={4} className="qr-svg" />
        {/* Canvas oculto para exportar PNG en alta resolucion */}
        <QRCodeCanvas
          ref={canvasRef}
          value={url}
          size={1024}
          level="M"
          marginSize={4}
          className="qr-canvas-hidden"
          aria-hidden="true"
        />
      </div>

      <p className="qr-url">{url}</p>
      {needsConfig && (
        <p className="qr-warning">
          Configura NEXT_PUBLIC_APP_URL en .env.local para que el QR apunte al dominio real.
        </p>
      )}

      <div className="qr-actions">
        <button type="button" className="adm-btn adm-btn-primary" onClick={downloadPng}>
          Descargar PNG
        </button>
        <button type="button" className="adm-btn" onClick={() => void copyUrl()}>
          {copied ? "Copiado" : "Copiar enlace"}
        </button>
      </div>
    </section>
  );
}

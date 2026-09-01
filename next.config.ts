import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' data:",
      // wss:// es imprescindible: Supabase Realtime usa WebSockets.
      // Safari aplica el CSP de WebSocket de forma estricta y bloquearia
      // el canal sin esta entrada (provocaba error de pagina en iPhone).
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://oauth2.googleapis.com",
      "frame-src 'self' https://accounts.google.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://accounts.google.com",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Fase 5 (subida): las fotos llegan como body binario; mantener el bodyParser por defecto
  // y controlar el tamaño en la API (<=3,5 MB). Config adicional se agrega por fase.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

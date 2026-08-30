import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fase 5 (subida): las fotos llegan como body binario; mantener el bodyParser por defecto
  // y controlar el tamaño en la API (<=3,5 MB). Config adicional se agrega por fase.
};

export default nextConfig;

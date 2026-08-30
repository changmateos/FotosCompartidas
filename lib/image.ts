// ============================================================
// Pipeline de imagen EN EL CLIENTE (F4).
// HEIC -> heic2any -> JPEG; compresion a ~3000 px <= 3,5 MB
// (browser-image-compression con canvas, sin CDN) y thumbnail
// ~400 px generado con createImageBitmap + imageOrientation
// "from-image" (orientacion EXIF correcta tras la compresion).
// SOLO se importa desde componentes cliente ("use client").
// ============================================================

import imageCompression from "browser-image-compression";

export const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024; // margen sobre el limite de 4,5 MB de Vercel
export const TARGET_MAX_DIMENSION = 3000; // ~3000 px en el lado mayor
export const THUMB_MAX_DIMENSION = 400; // thumbnail del feed (~50-150 KB)

export type PreparedImage = {
  mainFile: File; // JPEG ~3000 px, <= 3,5 MB
  thumbFile: File; // JPEG ~400 px
  width: number; // dimensiones finales del JPEG (orientacion aplicada)
  height: number;
  sizeBytes: number;
  originalWasHeic: boolean;
};

export type PhotoToUpload = PreparedImage & { caption: string };

/** Detecta HEIC/HEIF por MIME (image/heic*) o extension (.heic/.heif). */
export function isHeicFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return type.includes("heic") || type.includes("heif") || /\.(heic|heif)$/.test(name);
}

/**
 * Convierte HEIC -> JPEG con heic2any (WASM en worker propio, sin CDN).
 * Import dinamico: el modulo toca `window` al cargar y solo debe
 * ejecutarse en el navegador (evita romper el SSR de Next.js).
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  const mod = await import("heic2any");
  const output = await mod.default({ blob: file, toType: "image/jpeg", quality: 0.8 });
  const blob = Array.isArray(output) ? output[0] : output;
  const name = (file.name || "foto").replace(/\.(heic|heif)$/i, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

/** Algunos moviles (Android) envian file.type vacio; se infiere de la extension. */
function ensureImageType(file: File): File {
  if (/^image\//.test(file.type)) return file;
  if (/\.jpe?g$/i.test(file.name)) return new File([file], file.name, { type: "image/jpeg" });
  if (/\.png$/i.test(file.name)) return new File([file], file.name, { type: "image/png" });
  if (/\.webp$/i.test(file.name)) return new File([file], file.name, { type: "image/webp" });
  return file;
}

type OrientedSource = {
  draw: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

/**
 * Decodifica aplicando la orientacion EXIF: createImageBitmap con
 * imageOrientation "from-image" (y fallback a <img>, que tambien la
 * aplica en navegadores modernos). Garantiza que la foto comprimida
 * no quede rotada.
 */
async function decodeOriented(file: Blob): Promise<OrientedSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { draw: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // fallback: <img> aplica orientacion EXIF en navegadores modernos
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("No se pudo leer la imagen."));
    });
    return { draw: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function fitWithin(w: number, h: number, maxDim: number): { width: number; height: number } {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const scale = Math.min(1, maxDim / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo codificar el JPEG."))),
      "image/jpeg",
      quality,
    );
  });
}

/** Pasos de red de seguridad (canvas propio): dimension y calidad decrecientes hasta caber en 3,5 MB. */
const CANVAS_STEPS = [
  { maxDim: 3000, quality: 0.8 },
  { maxDim: 3000, quality: 0.7 },
  { maxDim: 2600, quality: 0.7 },
  { maxDim: 2400, quality: 0.65 },
  { maxDim: 2200, quality: 0.6 },
  { maxDim: 2000, quality: 0.55 },
  { maxDim: 1800, quality: 0.5 },
  { maxDim: 1600, quality: 0.45 },
] as const;

/** Compresion con canvas propio (usado como fallback o ultimo recurso). */
async function compressWithCanvas(file: Blob): Promise<{ file: File; width: number; height: number }> {
  const src = await decodeOriented(file);
  try {
    for (const step of CANVAS_STEPS) {
      const { width, height } = fitWithin(src.width, src.height, step.maxDim);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo inicializar el lienzo de compresion.");
      ctx.drawImage(src.draw, 0, 0, width, height);
      const blob = await canvasToJpeg(canvas, step.quality);
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return { file: new File([blob], "foto.jpg", { type: "image/jpeg" }), width, height };
      }
    }
    throw new Error("No se pudo comprimir la foto por debajo de 3,5 MB.");
  } finally {
    src.close?.();
  }
}

/**
 * Compresion principal a ~3000 px JPEG <= 3,5 MB.
 * browser-image-compression: maxWidthOrHeight 3000 + maxSizeMB 3,5
 * (reduce calidad/dimension hasta caber) y maneja la orientacion EXIF.
 * useWebWorker:false -> evita depender de la CDN (jsdelivr) que usaria
 * el worker por defecto; en un evento con red lenta es mas fiable.
 */
export async function compressToLimit(file: File): Promise<{ file: File; width: number; height: number }> {
  let compressed: File;
  try {
    compressed = await imageCompression(file, {
      maxWidthOrHeight: TARGET_MAX_DIMENSION,
      maxSizeMB: MAX_UPLOAD_BYTES / (1024 * 1024),
      initialQuality: 0.8,
      useWebWorker: false,
      fileType: "image/jpeg",
    });
  } catch {
    return compressWithCanvas(file);
  }
  if (compressed.size > MAX_UPLOAD_BYTES) {
    return compressWithCanvas(file); // red de seguridad: nunca superar 3,5 MB
  }
  const { width, height } = await readDimensions(compressed);
  return { file: compressed, width, height };
}

/** Dimensiones reales (con orientacion EXIF aplicada) de un blob de imagen. */
export async function readDimensions(file: Blob): Promise<{ width: number; height: number }> {
  const src = await decodeOriented(file);
  try {
    return { width: src.width, height: src.height };
  } finally {
    src.close?.();
  }
}

/** Thumbnail ~400 px (JPEG q0.7) con orientacion EXIF correcta. */
export async function createThumbnail(file: Blob): Promise<File> {
  const src = await decodeOriented(file);
  try {
    const { width, height } = fitWithin(src.width, src.height, THUMB_MAX_DIMENSION);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo inicializar el lienzo del thumbnail.");
    ctx.drawImage(src.draw, 0, 0, width, height);
    const blob = await canvasToJpeg(canvas, 0.7);
    return new File([blob], "thumb.jpg", { type: "image/jpeg" });
  } finally {
    src.close?.();
  }
}

/**
 * Pipeline completo de una foto elegida/capturada:
 * HEIC -> heic2any -> JPEG; compresion ~3000 px <= 3,5 MB; thumbnail ~400 px.
 */
export async function prepareUploadImage(file: File): Promise<PreparedImage> {
  const source = ensureImageType(file);
  const originalWasHeic = isHeicFile(source);

  let jpeg: File;
  if (originalWasHeic) {
    try {
      jpeg = await convertHeicToJpeg(source);
    } catch (err) {
      // Fallback (T4.2): Safari a veces entrega JPEG aunque el nombre sea .heic
      if (/^image\/jpe?g$/i.test(source.type) || /\.jpe?g$/i.test(source.name)) {
        jpeg = source;
      } else {
        throw new Error("No se pudo convertir la foto HEIC a JPEG. Elige otra desde la galeria.");
      }
    }
  } else {
    jpeg = source;
  }

  const { file: mainFile, width, height } = await compressToLimit(jpeg);
  const thumbFile = await createThumbnail(mainFile);

  return { mainFile, thumbFile, width, height, sizeBytes: mainFile.size, originalWasHeic };
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PicMyEvent · Fotos de tu evento",
  description: "Los invitados toman fotos con su celular y quedan en tu Google Drive, con feed en vivo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

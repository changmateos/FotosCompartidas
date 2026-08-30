import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AdminBodyClass } from "@/components/admin-body-class";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "PicMyEvent · Fotos de tu evento",
  description: "Los invitados toman fotos con su celular y quedan en tu Google Drive, con feed en vivo.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AdminBodyClass />
        {children}
      </body>
    </html>
  );
}

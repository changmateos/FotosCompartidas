"use client";

// Añade/quita la clase "body-admin" en <body> segun la ruta.
// Solo en /admin* bloqueamos el scroll del body (overflow:hidden) para
// que el admin sea el unico scroll container y el sticky funcione sin
// doble scroll. En el resto de paginas el body scrollea normal.
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function AdminBodyClass() {
  const pathname = usePathname();
  useEffect(() => {
    const isAdmin = pathname?.startsWith("/admin");
    document.body.classList.toggle("body-admin", !!isAdmin);
    return () => document.body.classList.remove("body-admin");
  }, [pathname]);
  return null;
}

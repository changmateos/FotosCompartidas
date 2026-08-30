// Middleware global: renueva la sesion de Supabase en cada request
// y protege /admin* (Fase 1, T1.2).
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase-middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Se excluyen assets estaticos; el resto (paginas y API) pasa
    // por el refresco de sesion.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

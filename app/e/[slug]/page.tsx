// ============================================================
// Pagina publica del evento /e/[slug] (F4 + F8).
// Server Component: lee el evento via RPC get_event_public(slug)
// (404 si no existe), aplica el tema con [data-theme] y muestra el
// boton grande de camara (captura nativa + compresion en cliente).
// F8: meta tags OG, theme-color, vista previa de temas (?vista=temas),
// pagina 404 y error en espanol, feed vacio pulido.
// El feed en vivo se completa en F6 (lib/feed.ts + Realtime/polling).
// ============================================================

import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { getEventPublic, resolveDataTheme } from "@/lib/feed";
import { THEME_BG } from "@/lib/themes";
import { CameraButton } from "@/components/camera/CameraButton";
import { ThemePreview } from "@/components/theme/ThemePreview";
import { FeedSection } from "@/components/feed/FeedSection";
import "./event-page.css";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ vista?: string }>;
};

function formatOwnerNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + " y " + names[1];
  return names.slice(0, -1).join(", ") + " y " + names[names.length - 1];
}

function eventDescription(event: { message: string | null; owner_names: string[] }): string {
  if (event.message) return event.message;
  const owners = formatOwnerNames(event.owner_names);
  if (owners) return "Fotos de " + owners + " · PicMyEvent";
  return "Comparte tus fotos del evento.";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventPublic(slug);
  if (!event) {
    return { title: "Evento no encontrado · PicMyEvent" };
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const pageUrl = appUrl + "/e/" + slug;
  const description = eventDescription(event);
  const title = event.title + " · PicMyEvent";
  const images = event.welcome_photo_url
    ? [{ url: event.welcome_photo_url, width: 1200, height: 630, alt: event.title }]
    : undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: "PicMyEvent",
      type: "website",
      locale: "es_AR",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: event.welcome_photo_url ? [event.welcome_photo_url] : undefined,
    },
  };
}

export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { slug } = await params;
  const event = await getEventPublic(slug);
  const dataTheme = event ? resolveDataTheme(event.theme_key, event.theme_variant) : null;
  return { themeColor: dataTheme ? (THEME_BG[dataTheme] ?? "#ffffff") : "#ffffff" };
}

export default async function EventPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams ?? Promise.resolve({} as { vista?: string })]);
  const event = await getEventPublic(slug);
  if (!event) notFound();

  const dataTheme = resolveDataTheme(event.theme_key, event.theme_variant);
  const isClosed = event.status === "closed";
  const owners = formatOwnerNames(event.owner_names);
  const previewThemes = sp.vista === "temas";

  return (
    <div data-theme={dataTheme} className="ep-root">
      <header className="ep-header">
        {event.welcome_photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.welcome_photo_url + (event.welcome_photo_url.includes("?") ? "&" : "?") + "v=" + Date.now()} alt="" className="ep-welcome-img" loading="lazy" decoding="async" />
        ) : null}
        <h1 className="ep-title">{event.title}</h1>
        {owners ? <p className="ep-owners">{owners}</p> : null}
        {event.message ? <p className="ep-message">{event.message}</p> : null}
      </header>

      <main className="ep-body">
        {previewThemes ? (
          <section className="ep-section" aria-label="Vista previa de temas">
            <h2 className="ep-section-title">Vista previa de temas</h2>
            <ThemePreview />
          </section>
        ) : (
          <>
            {isClosed ? (
              <div className="ep-closed-banner" role="status">
                Este evento esta cerrado: ya no se aceptan fotos, pero el feed queda como recuerdo.
              </div>
            ) : (
              <section className="ep-section" aria-label="Subir una foto">
                <h2 className="ep-section-title">Comparte tu foto</h2>
                <CameraButton eventSlug={slug} />
              </section>
            )}

            <section className="ep-section" aria-label="Fotos del evento">
              <h2 className="ep-section-title">Fotos de los invitados</h2>
              <FeedSection slug={slug} status={event.status} />
            </section>
          </>
        )}
      </main>

      <footer className="ep-footer">Hecho con PicMyEvent</footer>
    </div>
  );
}

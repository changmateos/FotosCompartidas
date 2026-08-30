// Panel de configuracion del evento (F2, T2.1-T2.4): formulario de
// config (titulo, duenos, mensaje, foto de bienvenida, tema) + QR.
// Solo miembros (getEventForAdmin usa RLS; si no -> 404).
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase-server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getEventForAdmin } from "@/lib/events";
import { ConfigForm } from "./config-form";
import { QRCard } from "@/components/qr/QRCard";
import { DrivePanel } from "./DrivePanel";
import { ModerationPanel } from "./ModerationPanel";
import { ReviewSwiper, type ReviewPhoto } from "./ReviewSwiper";
import { MembersPanel, type MemberRow } from "./MembersPanel";
import "../admin.css";

export const dynamic = "force-dynamic";

export default async function EventAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { eventId } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "review" ? "review" : "config";
  const event = await getEventForAdmin(eventId);
  if (!event) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const qrUrl = appUrl + "/e/" + event.slug;

  // Moderacion (repair F1): fotos y comentarios del evento. RLS publica
  // (photos/comments select) permite leerlas con la sesion del miembro.
  const supabase = await createClient();
  const { data: photosData } = await supabase
    .from("photos")
    .select("id, thumb_url, caption, created_at, like_count, comment_count")
    .eq("event_id", event.id)
    .order("created_at", { ascending: false })
    .limit(300);
  const photos = (photosData ?? []) as unknown as ReviewPhoto[];

  // Multi-organizador (repair #2): lista de miembros con email/display.
  // event_members via RLS; el detalle de organizers se lee con el
  // cliente admin (pagina admin solo para miembros; sin datos sensibles).
  const { data: memberships } = await supabase
    .from("event_members")
    .select("organizer_id")
    .eq("event_id", event.id);
  const memberIds = (memberships ?? []).map((m) => String((m as { organizer_id: string }).organizer_id));
  const admin = createAdminClient();
  const { data: orgs } = await admin
    .from("organizers")
    .select("id, email, display_name")
    .in("id", memberIds);
  const orgMap = new Map((orgs ?? []).map((o) => [String((o as { id: string }).id), o as { email: string; display_name: string | null }]));
  const members: MemberRow[] = memberIds.map((oid) => {
    const org = orgMap.get(oid);
    return {
      organizerId: oid,
      email: org?.email ?? oid,
      displayName: org?.display_name ?? null,
    };
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="adm-main">
      <header className="adm-head">
        <div>
          <Link href="/admin" className="adm-btn" style={{ marginBottom: "0.75rem" }}>
            Volver al panel
          </Link>
          <h1>{event.title}</h1>
        </div>
        <Link href={"/e/" + event.slug} className="adm-btn">
          Ver pagina publica
        </Link>
      </header>

      <nav className="adm-tabs" aria-label="Secciones del panel">
        <a href={"/admin/" + event.id} className={"adm-tab" + (tab === "config" ? " adm-tab-active" : "")}>
          Configuracion
        </a>
        <a
          href={"/admin/" + event.id + "?tab=review"}
          className={"adm-tab" + (tab === "review" ? " adm-tab-active" : "")}
        >
          Revisar fotos
        </a>
      </nav>

      {tab === "review" ? (
        <ReviewSwiper photos={photos} />
      ) : (
        <>
          <ConfigForm event={event} />

          <DrivePanel eventId={event.id} />

          <QRCard url={qrUrl} slug={event.slug} />

          <MembersPanel
            eventId={event.id}
            createdBy={event.created_by}
            currentUserId={user?.id ?? ""}
            members={members}
          />

          <ModerationPanel
            eventId={event.id}
            slug={event.slug}
            initialStatus={event.status}
          />
        </>
      )}
    </main>
  );
}

"use client";

// Edicion de un evento YA CONFIGURADO en UNA sola pagina (peticion UX):
// todo junto (informacion, tema, foto, Drive, QR, miembros, ciclo de
// vida), responsive PC/celular. La revision/eliminacion de fotos del
// final del evento vive en la pestana "Revisar fotos" (separada).
import type { EventRecord } from "@/lib/events";
import { ConfigForm } from "./config-form";
import { DrivePanel } from "./DrivePanel";
import { QRCard } from "@/components/qr/QRCard";
import { MembersPanel, type MemberRow } from "./MembersPanel";
import { ModerationPanel } from "./ModerationPanel";

export function ConfigOnePage({
  event,
  qrUrl,
  members,
  createdBy,
  currentUserId,
  initialStatus,
}: {
  event: EventRecord;
  qrUrl: string;
  members: MemberRow[];
  createdBy: string;
  currentUserId: string;
  initialStatus: "active" | "closed";
}) {
  return (
    <div className="wz-onepage">
      <ConfigForm event={event} />
      <DrivePanel eventId={event.id} modo="editar" />
      <QRCard url={qrUrl} slug={event.slug} />
      <MembersPanel eventId={event.id} createdBy={createdBy} currentUserId={currentUserId} members={members} />
      <ModerationPanel eventId={event.id} slug={event.slug} initialStatus={initialStatus} />
    </div>
  );
}

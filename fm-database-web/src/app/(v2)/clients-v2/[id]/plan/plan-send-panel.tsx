"use client";

import { SendPackageButton } from "@/components/client-widgets/send-package-button";

export function PlanSendPanel({
  planSlug,
  clientId,
  clientEmail,
  clientName,
}: {
  planSlug: string;
  clientId: string;
  clientEmail?: string;
  clientName?: string;
}) {
  return (
    <SendPackageButton
      planSlug={planSlug}
      clientId={clientId}
      clientEmail={clientEmail}
      clientName={clientName}
    />
  );
}

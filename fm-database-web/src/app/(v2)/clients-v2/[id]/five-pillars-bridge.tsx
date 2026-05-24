"use client";

/**
 * Bridge from the server-component v2 client page to the FmFivePillars
 * primitive, wiring the "Send check-in" handler.
 *
 * Per coach confirmation: clicking "Send check-in" routes to the legacy
 * client overview where the MessageTemplatesPanel lives, with a query
 * param hinting at the check-in template. The panel doesn't yet read the
 * hint (small follow-up); the route gets the coach to the right surface.
 */
import { useRouter } from "next/navigation";
import {
  FmFivePillars,
  type FivePillarsValue,
  type DerivedFivePillars,
} from "@/components/fm";

export function FmFivePillarsWithSendCheckIn({
  latest,
  latestSessionAt,
  derived,
  daysSinceLastEntry,
  clientId,
}: {
  latest: FivePillarsValue | null;
  latestSessionAt?: string | null;
  derived?: DerivedFivePillars | null;
  daysSinceLastEntry: number | null;
  clientId: string;
}) {
  const router = useRouter();
  return (
    <FmFivePillars
      latest={latest}
      latestSessionAt={latestSessionAt}
      derived={derived}
      daysSinceLastEntry={daysSinceLastEntry}
      onSendCheckIn={() =>
        // For now both "Ask client via WhatsApp" and "Capture from check-in"
        // route to the v2 Analyse tab — coach picks Check-in card to record.
        // Phase 3.5 splits these into a templates-panel modal vs the direct
        // check-in form.
        router.push(`/clients-v2/${clientId}/analyse`)
      }
    />
  );
}

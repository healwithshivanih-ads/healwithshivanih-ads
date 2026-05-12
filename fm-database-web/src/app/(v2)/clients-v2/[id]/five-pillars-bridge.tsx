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
import { FmFivePillars, type FivePillarsValue } from "@/components/fm";

export function FmFivePillarsWithSendCheckIn({
  latest,
  daysSinceLastEntry,
  clientId,
}: {
  latest: FivePillarsValue | null;
  daysSinceLastEntry: number | null;
  clientId: string;
}) {
  const router = useRouter();
  return (
    <FmFivePillars
      latest={latest}
      daysSinceLastEntry={daysSinceLastEntry}
      onSendCheckIn={() =>
        router.push(`/clients/${clientId}?tab=overview&templates=check_in`)
      }
    />
  );
}

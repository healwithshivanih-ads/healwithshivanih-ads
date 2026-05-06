import { Badge } from "@/components/ui/badge";
import type { EvidenceTier } from "@/lib/fmdb/types";

const LABEL: Record<EvidenceTier, string> = {
  strong: "Strong",
  plausible_emerging: "Plausible / emerging",
  fm_specific_thin: "FM-specific (thin)",
  confirm_with_clinician: "Confirm w/ clinician",
};

const CLASS: Record<EvidenceTier, string> = {
  strong: "bg-green-100 text-green-900 border-green-300",
  plausible_emerging: "bg-yellow-100 text-yellow-900 border-yellow-300",
  fm_specific_thin: "bg-orange-100 text-orange-900 border-orange-300",
  confirm_with_clinician: "bg-red-100 text-red-900 border-red-300",
};

export function EvidenceTierBadge({ tier }: { tier?: EvidenceTier }) {
  if (!tier) return null;
  return (
    <Badge variant="outline" className={CLASS[tier]}>
      {LABEL[tier]}
    </Badge>
  );
}

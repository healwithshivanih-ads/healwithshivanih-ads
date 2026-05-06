import { Badge } from "@/components/ui/badge";
import type { PlanStatus } from "@/lib/fmdb/types";

const LABEL: Record<PlanStatus, string> = {
  draft: "Draft",
  ready_to_publish: "Ready",
  published: "Published",
  superseded: "Superseded",
  revoked: "Revoked",
};

const CLASS: Record<PlanStatus, string> = {
  draft: "bg-gray-100 text-gray-800 border-gray-300",
  ready_to_publish: "bg-yellow-100 text-yellow-900 border-yellow-300",
  published: "bg-green-100 text-green-900 border-green-300",
  superseded: "bg-orange-100 text-orange-900 border-orange-300",
  revoked: "bg-red-100 text-red-900 border-red-300",
};

export function PlanStatusBadge({ status }: { status?: PlanStatus }) {
  if (!status) return null;
  return (
    <Badge variant="outline" className={CLASS[status]}>
      {LABEL[status]}
    </Badge>
  );
}

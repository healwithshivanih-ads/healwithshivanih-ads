import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EvidenceTierBadge } from "@/components/evidence-tier-badge";
import type { BaseEntity, CatalogueKind } from "@/lib/fmdb/types";

const KINDS_WITH_DETAIL: ReadonlySet<CatalogueKind> = new Set([
  "topics",
  "supplements",
  "protocols",
  "titration_protocols",
  "lab_tests",
  "lab_panels",
]);

export function CatalogueTable({
  kind,
  rows,
}: {
  kind: CatalogueKind;
  rows: BaseEntity[];
}) {
  const sorted = [...rows].sort((a, b) =>
    (a.display_name ?? a.slug).localeCompare(b.display_name ?? b.slug)
  );
  const linkable = KINDS_WITH_DETAIL.has(kind);

  return (
    <div className="border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Evidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => {
            const nameCell = (
              <div className="flex flex-col">
                <span>{row.display_name ?? row.slug}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{row.slug}</span>
              </div>
            );
            return (
              <TableRow key={row.slug}>
                <TableCell>
                  {linkable ? (
                    <Link
                      href={`/catalogue/${kind}/${row.slug}`}
                      className="hover:underline"
                    >
                      {nameCell}
                    </Link>
                  ) : (
                    nameCell
                  )}
                </TableCell>
                <TableCell>
                  <EvidenceTierBadge tier={row.evidence_tier} />
                </TableCell>
              </TableRow>
            );
          })}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={2} className="text-muted-foreground italic">
                No entries.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

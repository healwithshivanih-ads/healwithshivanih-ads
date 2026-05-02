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
            <TableHead>Slug</TableHead>
            <TableHead>Display name</TableHead>
            <TableHead>Evidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => {
            const cell = (
              <span className="font-mono text-xs">{row.slug}</span>
            );
            return (
              <TableRow key={row.slug}>
                <TableCell>
                  {linkable ? (
                    <Link
                      href={`/catalogue/${kind}/${row.slug}`}
                      className="hover:underline"
                    >
                      {cell}
                    </Link>
                  ) : (
                    cell
                  )}
                </TableCell>
                <TableCell>{row.display_name ?? "—"}</TableCell>
                <TableCell>
                  <EvidenceTierBadge tier={row.evidence_tier} />
                </TableCell>
              </TableRow>
            );
          })}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground italic">
                No entries.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

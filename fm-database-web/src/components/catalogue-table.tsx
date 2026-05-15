"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
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

// Pull a searchable haystack from an entity. Search covers display_name,
// slug, aliases, summary/description, and category — enough for the coach
// to find "B12" or "MTHFR" or "high serum b12" without remembering the
// exact slug.
function buildHaystack(row: BaseEntity & Record<string, unknown>): string {
  const parts: string[] = [
    String(row.display_name ?? ""),
    String(row.slug ?? ""),
    String(row.summary ?? ""),
    String(row.description ?? ""),
    String(row.category ?? ""),
  ];
  const aliases = row.aliases;
  if (Array.isArray(aliases)) parts.push(aliases.join(" "));
  const statement = row.statement;
  if (typeof statement === "string") parts.push(statement);
  return parts.join(" ").toLowerCase();
}

export function CatalogueTable({
  kind,
  rows,
}: {
  kind: CatalogueKind;
  rows: BaseEntity[];
}) {
  const [query, setQuery] = useState("");
  const linkable = KINDS_WITH_DETAIL.has(kind);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) =>
      (a.display_name ?? a.slug).localeCompare(b.display_name ?? b.slug)
    );
    if (!q) return sorted;
    const terms = q.split(/\s+/).filter(Boolean);
    return sorted.filter((row) => {
      const hay = buildHaystack(row as BaseEntity & Record<string, unknown>);
      return terms.every((t) => hay.includes(t));
    });
  }, [rows, query]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          placeholder={`Search ${rows.length} entries (name, slug, alias, summary)…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-md"
        />
        {query && (
          <span className="text-xs text-muted-foreground">
            {filtered.length} match{filtered.length === 1 ? "" : "es"}
          </span>
        )}
      </div>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row) => {
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
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="text-muted-foreground italic">
                  {query ? "No matches." : "No entries."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

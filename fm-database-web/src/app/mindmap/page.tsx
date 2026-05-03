import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import {
  loadAllMindMaps,
  countMindMapNodes,
} from "@/lib/fmdb/loader-extras";

export const dynamic = "force-dynamic";

export default async function MindMapsPage() {
  const maps = await loadAllMindMaps();
  const sorted = [...maps].sort((a, b) =>
    (a.display_name ?? a.slug).localeCompare(b.display_name ?? b.slug)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Mind Maps</h1>
        <p className="text-muted-foreground mt-1">
          Curated mind maps from the catalogue.
        </p>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No mind maps in the catalogue.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Nodes</TableHead>
                <TableHead>Linked</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((m) => {
                const counts = countMindMapNodes(m.tree);
                return (
                  <TableRow key={m.slug}>
                    <TableCell>
                      <Link
                        href={`/mindmap/${m.slug}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {m.display_name ?? m.slug}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{counts.total}</TableCell>
                    <TableCell className="text-sm">
                      {counts.linked} / {counts.total - counts.linked} unlinked
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground line-clamp-2">
                      {m.description ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

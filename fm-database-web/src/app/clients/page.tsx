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
import { loadAllClients, loadAllPlans } from "@/lib/fmdb/loader";
import { getPlansRoot } from "@/lib/fmdb/paths";

export const dynamic = "force-dynamic";

const ACTIVE_BUCKETS = new Set(["draft", "ready_to_publish", "published"]);

export default async function ClientsPage() {
  const [clients, plans] = await Promise.all([loadAllClients(), loadAllPlans()]);

  const activePlanCount = (cid: string) =>
    plans.filter(
      (p) =>
        p.client_id === cid &&
        ACTIVE_BUCKETS.has(p.status ?? p._bucket ?? "")
    ).length;

  const sorted = [...clients].sort((a, b) =>
    (a.client_id ?? "").localeCompare(b.client_id ?? "")
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Clients</h1>
        <p className="text-muted-foreground mt-1">
          Reading from <code className="font-mono">{getPlansRoot()}/clients/</code>.
          Read-only.
        </p>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No clients found. Create one with the Streamlit UI or{" "}
            <code>fmdb client-new</code>.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Age band</TableHead>
                <TableHead>Sex</TableHead>
                <TableHead>Intake</TableHead>
                <TableHead>Conditions</TableHead>
                <TableHead>Active plans</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((c) => (
                <TableRow key={c.client_id}>
                  <TableCell>
                    <Link
                      href={`/clients/${c.client_id}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {c.client_id}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{c.age_band ?? "—"}</TableCell>
                  <TableCell className="text-sm">{c.sex ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {c.intake_date ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {(c.active_conditions ?? []).length}
                  </TableCell>
                  <TableCell className="text-sm">
                    {activePlanCount(c.client_id)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

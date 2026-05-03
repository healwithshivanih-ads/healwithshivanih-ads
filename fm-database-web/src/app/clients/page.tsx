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
import { NewClientForm } from "./new-client-form";

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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Clients</h1>
          <p className="text-muted-foreground mt-1">
            Reading from{" "}
            <code className="font-mono text-xs">
              {getPlansRoot()}/clients/
            </code>
            .
          </p>
        </div>
        <NewClientForm />
      </div>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No clients yet. Click <strong>+ New client</strong> above to create
            one.
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Age band</TableHead>
                <TableHead>Sex</TableHead>
                <TableHead>Intake</TableHead>
                <TableHead>Conditions</TableHead>
                <TableHead>Active plans</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((c) => {
                const href = `/clients/${c.client_id}`;
                return (
                  <TableRow
                    key={c.client_id}
                    className="cursor-pointer hover:bg-muted/50"
                  >
                    <TableCell>
                      <Link
                        href={href}
                        className="font-mono text-xs hover:underline"
                      >
                        {c.client_id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="hover:underline">
                        {(c as { display_name?: string }).display_name ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="block">
                        {c.age_band ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="block">
                        {c.sex ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="block">
                        {c.intake_date ?? "—"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="block">
                        {(c.active_conditions ?? []).length}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={href} className="block">
                        {activePlanCount(c.client_id)}
                      </Link>
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

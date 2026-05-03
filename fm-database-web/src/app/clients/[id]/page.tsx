import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  loadClientById,
  loadClientSessions,
} from "@/lib/fmdb/loader-extras";
import { loadAllPlans } from "@/lib/fmdb/loader";
import fs from "node:fs/promises";
import path from "node:path";
import { getPlansRoot } from "@/lib/fmdb/paths";

export const dynamic = "force-dynamic";

function fmtMeasurements(m: Record<string, unknown> | undefined): string | null {
  if (!m) return null;
  const parts: string[] = [];
  if (m.height_cm) parts.push(`${m.height_cm} cm`);
  if (m.weight_kg) parts.push(`${m.weight_kg} kg`);
  if (m.waist_cm) parts.push(`waist ${m.waist_cm}cm`);
  if (m.hip_cm) parts.push(`hip ${m.hip_cm}cm`);
  if (m.blood_pressure) parts.push(`BP ${String(m.blood_pressure)}`);
  if (m.resting_heart_rate) parts.push(`HR ${m.resting_heart_rate}`);
  return parts.length ? parts.join(" · ") : null;
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [client, sessions, allPlans] = await Promise.all([
    loadClientById(id),
    loadClientSessions(id),
    loadAllPlans(),
  ]);

  if (!client) notFound();

  const plans = allPlans.filter((p) => p.client_id === id);
  const measurements = fmtMeasurements(
    client.measurements as Record<string, unknown> | undefined
  );

  // List uploaded files from clients/<id>/files/ if the folder exists
  const filesDir = path.join(getPlansRoot(), "clients", id, "files");
  let uploadedFiles: string[] = [];
  try {
    uploadedFiles = await fs.readdir(filesDir);
  } catch {
    // folder doesn't exist yet — fine
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/clients"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← All clients
        </Link>
        <h1 className="text-3xl font-bold mt-1">
          {client.display_name ?? client.client_id}
        </h1>
        <p className="text-muted-foreground text-sm font-mono">
          {client.client_id} · {client.age_band ?? "—"} · {client.sex ?? "—"} ·
          intake {client.intake_date ?? "—"}
        </p>
      </div>

      {/* ── Action bar ── */}
      <div className="flex flex-wrap gap-3 p-4 rounded-lg border bg-muted/30">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Next steps</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Run an assessment to upload lab reports / food journals and generate
            a draft plan. Files are stored under{" "}
            <code className="font-mono">
              fm-plans/clients/{id}/files/
            </code>{" "}
            automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center shrink-0">
          <Link href={`/assess?client=${id}`}>
            <Button>🧠 Run assessment</Button>
          </Link>
          <Link href={`/plans/new?client=${id}`}>
            <Button variant="outline">＋ New plan</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Bio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {measurements && (
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Measurements
                </div>
                <div>{measurements}</div>
              </div>
            )}
            {client.notes && (
              <div>
                <div className="text-xs uppercase text-muted-foreground">Notes</div>
                <div className="whitespace-pre-wrap">{client.notes}</div>
              </div>
            )}
            {client.goals && client.goals.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground">Goals</div>
                <ul className="list-disc list-inside">
                  {client.goals.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clinical</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {client.medical_history && client.medical_history.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Medical history
                </div>
                <ul className="list-disc list-inside">
                  {client.medical_history.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
            {client.active_conditions && client.active_conditions.length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Active conditions
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {client.active_conditions.map((c) => (
                    <Badge key={c} variant="outline">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {(client.medications ??
              (client.current_medications as string[] | undefined) ??
              []
            ).length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Medications
                </div>
                <ul className="list-disc list-inside">
                  {(client.medications ??
                    (client.current_medications as string[]) ??
                    []
                  ).map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            {(client.allergies ??
              (client.known_allergies as string[] | undefined) ??
              []
            ).length > 0 && (
              <div>
                <div className="text-xs uppercase text-muted-foreground">
                  Allergies
                </div>
                <ul className="list-disc list-inside">
                  {(client.allergies ??
                    (client.known_allergies as string[]) ??
                    []
                  ).map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plans ({plans.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plans yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Period start</TableHead>
                  <TableHead>Version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((p) => (
                  <TableRow key={p.slug}>
                    <TableCell>
                      <Link
                        href={`/plans/${p.slug}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {p.slug}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.status ?? p._bucket}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.plan_period_start ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.version ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Uploaded files ── */}
      <Card>
        <CardHeader>
          <CardTitle>Uploaded files ({uploadedFiles.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {uploadedFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No files yet. Lab reports and food journals are uploaded during the{" "}
              <Link href={`/assess?client=${id}`} className="underline">
                assessment workflow
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-1">
              {uploadedFiles.sort().map((f) => (
                <li key={f} className="text-sm font-mono text-muted-foreground">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions ({sessions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Selected topics</TableHead>
                  <TableHead>Generated plan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s, i) => (
                  <TableRow key={s.session_id ?? i}>
                    <TableCell className="font-mono text-xs">
                      {s.session_id ?? `#${i + 1}`}
                    </TableCell>
                    <TableCell className="text-sm">{s.date ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {(s.selected_topics ?? []).join(", ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.generated_plan_slug ? (
                        <Link
                          href={`/plans/${s.generated_plan_slug}`}
                          className="font-mono text-xs hover:underline"
                        >
                          {s.generated_plan_slug}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

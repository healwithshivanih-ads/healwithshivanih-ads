import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadAllClients } from "@/lib/fmdb/loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const FMDB_ROOT = "/Users/shivani/code/healwithshivanih-ads/fm-database";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

async function createPlan(formData: FormData): Promise<void> {
  "use server";
  const clientId = formData.get("client_id") as string;
  const slug = formData.get("slug") as string;

  if (!clientId || !slug) throw new Error("client_id and slug are required");

  const py = path.join(FMDB_ROOT, ".venv/bin/python");

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(py, ["-m", "fmdb.cli", "plan-new", clientId, slug], {
      cwd: FMDB_ROOT,
      timeout: 30_000,
    });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `plan-new exited ${code}`));
    });
    proc.on("error", reject);
  });

  revalidatePath("/plans");
  redirect(`/plans/${slug}`);
}

export default async function NewPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client: preselectedClient } = await searchParams;
  const clients = await loadAllClients();

  const today = todayStr();
  const defaultClientId = preselectedClient ?? clients[0]?.client_id ?? "";
  const defaultSlug = defaultClientId
    ? `${defaultClientId}-${today}-plan`
    : `plan-${today}`;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link href="/plans" className="text-xs text-muted-foreground hover:underline">
          ← All plans
        </Link>
        <h1 className="text-3xl font-bold mt-1">New plan</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create draft plan</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createPlan} className="space-y-4">
            {/* Client */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="client_id">
                Client
              </label>
              <select
                id="client_id"
                name="client_id"
                defaultValue={defaultClientId}
                className="border rounded-md px-3 py-2 text-sm bg-background"
                required
              >
                {clients.length === 0 && (
                  <option value="">— no clients yet —</option>
                )}
                {clients.map((c) => (
                  <option key={c.client_id} value={c.client_id}>
                    {c.display_name ?? c.client_id} ({c.client_id})
                  </option>
                ))}
              </select>
            </div>

            {/* Slug */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="slug">
                Plan slug{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  (unique identifier, no spaces)
                </span>
              </label>
              <input
                id="slug"
                name="slug"
                defaultValue={defaultSlug}
                required
                pattern="[a-z0-9-]+"
                title="lowercase letters, digits, and hyphens only"
                className="border rounded-md px-3 py-2 text-sm font-mono bg-background"
              />
              <p className="text-xs text-muted-foreground">
                Use format: <code className="font-mono">{defaultClientId || "cl-001"}-YYYY-MM-DD-topic</code>
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <Button type="submit">Create draft plan →</Button>
              <Link href={preselectedClient ? `/clients/${preselectedClient}` : "/plans"}>
                <Button variant="outline" type="button">Cancel</Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

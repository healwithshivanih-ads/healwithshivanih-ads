import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadAllClients } from "@/lib/fmdb/loader";
import { loadClientSessions } from "@/lib/fmdb/loader-extras";
import { generateDraftFromSuggestions } from "@/lib/fmdb/anthropic";
import { parseSessionType } from "@/lib/fmdb/session-utils";
import { NewPlanWizard } from "./new-plan-wizard";

export const dynamic = "force-dynamic";

const FMDB_ROOT = path.resolve(process.cwd(), "..", "fm-database");

// ── Server actions ────────────────────────────────────────────────────────────

async function createBlankAction(formData: FormData): Promise<void> {
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

async function generateDraftAction(
  clientId: string,
  sessionId: string
): Promise<{ ok: boolean; slug?: string; error?: string }> {
  "use server";
  try {
    const result = await generateDraftFromSuggestions({
      client_id: clientId,
      session_id: sessionId,
      picks: {}, // empty = all defaults = include everything
    });
    if (result.ok && result.slug) {
      revalidatePath("/plans");
      return { ok: true, slug: result.slug };
    }
    return { ok: false, error: result.error ?? "generate-draft.py returned ok=false" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function NewPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client: preselectedClient } = await searchParams;
  const clients = await loadAllClients();

  const today = new Date().toISOString().slice(0, 10);
  const defaultClientId = preselectedClient ?? clients[0]?.client_id ?? "";
  const defaultSlug = defaultClientId
    ? `${defaultClientId}-${today}-plan`
    : `plan-${today}`;

  // Load and filter sessions for the pre-selected client
  type RawSession = {
    session_id?: string;
    date?: string;
    presenting_complaints?: string;
    selected_topics?: string[];
    selected_symptoms?: string[];
    generated_plan_slug?: string | null;
    ai_analysis?: {
      likely_drivers?: unknown[];
      supplement_suggestions?: unknown[];
      synthesis_notes?: string;
    };
  };

  let assessSessions: import("@/app/assess/actions").SessionSummary[] = [];

  if (preselectedClient) {
    try {
      const rawSessions = await loadClientSessions(preselectedClient) as RawSession[];

      assessSessions = rawSessions
        .filter((s) => {
          const type = parseSessionType(s.presenting_complaints);
          if (type !== "intake") return false;
          const analysis = s.ai_analysis ?? {};
          const driverCount = Array.isArray(analysis.likely_drivers) ? analysis.likely_drivers.length : 0;
          const suppCount = Array.isArray(analysis.supplement_suggestions) ? analysis.supplement_suggestions.length : 0;
          return driverCount > 0 || suppCount > 0;
        })
        .map((s) => {
          const analysis = s.ai_analysis ?? {};
          const drivers = Array.isArray(analysis.likely_drivers) ? analysis.likely_drivers : [];
          const supps = Array.isArray(analysis.supplement_suggestions) ? analysis.supplement_suggestions : [];
          return {
            session_id: s.session_id,
            date: s.date,
            presenting_complaints: s.presenting_complaints,
            selected_topics: s.selected_topics ?? [],
            selected_symptoms: s.selected_symptoms ?? [],
            generated_plan_slug: s.generated_plan_slug ?? null,
            plan_exists: false, // checked lazily in wizard — not needed here
            driver_count: drivers.length,
            supplement_count: supps.length,
            synthesis_notes: analysis.synthesis_notes
              ? String(analysis.synthesis_notes).slice(0, 300)
              : undefined,
            session_type: "intake" as const,
            requested_labs: [],
          };
        });
    } catch {
      // no sessions dir yet — leave assessSessions empty
    }
  }

  return (
    <NewPlanWizard
      clients={clients.map((c) => ({
        client_id: c.client_id,
        display_name: c.display_name ?? null,
      }))}
      preselectedClientId={defaultClientId}
      defaultSlug={defaultSlug}
      today={today}
      assessSessions={assessSessions}
      generateDraftAction={generateDraftAction}
      createBlankAction={createBlankAction}
    />
  );
}

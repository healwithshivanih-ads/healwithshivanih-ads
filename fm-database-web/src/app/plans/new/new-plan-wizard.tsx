"use client";

/**
 * NewPlanWizard — interactive new-plan page.
 *
 * Phase A (session picker):
 *   If the client has full_assessment sessions with AI data, show them as
 *   cards. Coach picks one → "Generate pre-filled draft" calls
 *   generateDraftAction → redirects to /plans/<slug>.
 *
 * Phase B (blank draft):
 *   Always shown below the session picker (or alone if no sessions).
 *   Coach fills client + slug → creates empty YAML, same as before.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SessionSummary } from "@/app/assess/actions";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ClientOption {
  client_id: string;
  display_name?: string | null;
}

interface Props {
  clients: ClientOption[];
  preselectedClientId: string;
  defaultSlug: string;
  today: string;
  /** Full-assessment sessions that have AI data (driver_count > 0 || supplement_count > 0) */
  assessSessions: SessionSummary[];
  /** Server actions passed as props to keep this file pure client */
  generateDraftAction: (clientId: string, sessionId: string) => Promise<{ ok: boolean; slug?: string; error?: string }>;
  createBlankAction: (formData: FormData) => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso?: string) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return iso; }
}

function topicsList(s: SessionSummary) {
  return (s.selected_topics ?? []).slice(0, 4).join(", ") || null;
}

// ── Session card ──────────────────────────────────────────────────────────────

function SessionCard({
  session,
  selected,
  onSelect,
}: {
  session: SessionSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const topics = topicsList(session);
  const hasPlan = session.plan_exists && session.generated_plan_slug;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-xl border-2 px-4 py-3 transition-all",
        selected
          ? "border-primary bg-primary/5"
          : "border-border bg-background hover:border-primary/40 hover:bg-muted/30"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Selection indicator */}
        <div className={cn(
          "mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center",
          selected ? "border-primary" : "border-muted-foreground/40"
        )}>
          {selected && <div className="h-2 w-2 rounded-full bg-primary" />}
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{fmt(session.date)}</span>
            {hasPlan && (
              <Badge variant="secondary" className="text-[10px]">
                ✓ plan generated
              </Badge>
            )}
          </div>

          {/* Stats chips */}
          <div className="flex flex-wrap gap-1.5">
            {session.driver_count > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#2B2D42]/10 text-[#2B2D42] font-medium">
                🔍 {session.driver_count} driver{session.driver_count !== 1 ? "s" : ""}
              </span>
            )}
            {session.supplement_count > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">
                💊 {session.supplement_count} supplement{session.supplement_count !== 1 ? "s" : ""}
              </span>
            )}
            {(session.selected_topics ?? []).length > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border">
                🏷 {(session.selected_topics ?? []).length} topic{(session.selected_topics ?? []).length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Topics */}
          {topics && (
            <p className="text-xs text-muted-foreground truncate">{topics}{(session.selected_topics ?? []).length > 4 ? " …" : ""}</p>
          )}

          {/* Synthesis snippet */}
          {session.synthesis_notes && (
            <p className="text-xs text-muted-foreground italic line-clamp-2 leading-relaxed">
              &ldquo;{session.synthesis_notes}&rdquo;
            </p>
          )}

          {/* Existing plan warning */}
          {hasPlan && (
            <p className="text-[10px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 inline-block">
              ⚠ This session already generated{" "}
              <Link
                href={`/plans/${session.generated_plan_slug}`}
                className="underline"
                onClick={(e) => e.stopPropagation()}
              >
                {session.generated_plan_slug}
              </Link>
              {" — "}a new draft will be created alongside it.
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function NewPlanWizard({
  clients,
  preselectedClientId,
  defaultSlug,
  today,
  assessSessions,
  generateDraftAction,
  createBlankAction,
}: Props) {
  const router = useRouter();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    assessSessions.length > 0 ? (assessSessions[0].session_id ?? null) : null
  );
  const [generating, startGenerating] = useTransition();
  const [genError, setGenError] = useState<string | null>(null);
  const [blankClientId, setBlankClientId] = useState(preselectedClientId);

  // Derive default slug for blank form based on selected client
  const blankDefaultSlug = blankClientId ? `${blankClientId}-${today}-plan` : defaultSlug;

  function handleGenerate() {
    if (!selectedSessionId) return;
    setGenError(null);
    startGenerating(async () => {
      const result = await generateDraftAction(preselectedClientId, selectedSessionId);
      if (result.ok && result.slug) {
        router.push(`/plans/${result.slug}`);
      } else {
        setGenError(result.error ?? "Unknown error");
      }
    });
  }

  const selectedSession = assessSessions.find(s => s.session_id === selectedSessionId);

  return (
    <div className="max-w-2xl space-y-8">
      {/* ── Back + title ── */}
      <div>
        <Link
          href={preselectedClientId ? `/clients/${preselectedClientId}` : "/plans"}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← {preselectedClientId ? "Back to client" : "All plans"}
        </Link>
        <h1 className="text-3xl font-bold mt-1">New plan</h1>
      </div>

      {/* ══════════════════════════════════════════════════════════════
           PHASE A — seed from assessment session
         ══════════════════════════════════════════════════════════════ */}
      {assessSessions.length > 0 && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">✨</span>
              <CardTitle className="text-base">Generate pre-filled draft from assessment</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Pick an assessment session below — the plan will be pre-populated with
              all drivers, supplements, lifestyle, nutrition, labs and education the AI suggested.
              You can edit anything in the plan editor afterwards.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Session cards */}
            <div className="space-y-2">
              {assessSessions.map((s) => (
                <SessionCard
                  key={s.session_id}
                  session={s}
                  selected={selectedSessionId === s.session_id}
                  onSelect={() => setSelectedSessionId(s.session_id ?? null)}
                />
              ))}
            </div>

            {/* What will be included preview */}
            {selectedSession && (
              <div className="rounded-lg bg-muted/40 border px-3 py-2.5 text-xs space-y-1">
                <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">What will be included from this session</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                  {selectedSession.driver_count > 0 && <span>✓ {selectedSession.driver_count} hypothesised driver{selectedSession.driver_count !== 1 ? "s" : ""}</span>}
                  {selectedSession.supplement_count > 0 && <span>✓ {selectedSession.supplement_count} supplement{selectedSession.supplement_count !== 1 ? "s" : ""}</span>}
                  {(selectedSession.selected_topics ?? []).length > 0 && <span>✓ {(selectedSession.selected_topics ?? []).length} topic{(selectedSession.selected_topics ?? []).length !== 1 ? "s" : ""}</span>}
                  <span>✓ Lifestyle suggestions</span>
                  <span>✓ Nutrition block</span>
                  <span>✓ Lab follow-ups</span>
                  <span>✓ Education modules</span>
                  <span>✓ AI synthesis notes</span>
                </div>
              </div>
            )}

            {/* Error */}
            {genError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {genError}
              </div>
            )}

            {/* CTA */}
            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={handleGenerate}
                disabled={!selectedSessionId || generating}
                className="gap-2"
              >
                {generating ? (
                  <>
                    <span className="animate-spin text-sm">⏳</span>
                    Generating…
                  </>
                ) : (
                  "✨ Generate pre-filled draft →"
                )}
              </Button>
              <span className="text-xs text-muted-foreground">No AI call — instant</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════
           PHASE B — blank draft (always shown)
         ══════════════════════════════════════════════════════════════ */}
      <Card className={assessSessions.length > 0 ? "border-dashed opacity-80" : undefined}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {assessSessions.length > 0 ? "Or create a blank draft" : "Create draft plan"}
          </CardTitle>
          {assessSessions.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Start with an empty plan and fill the tabs manually.
            </p>
          )}
        </CardHeader>
        <CardContent>
          <form action={createBlankAction} className="space-y-4">
            {/* Client — only show picker if no client was pre-selected */}
            {!preselectedClientId ? (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium" htmlFor="client_id">Client</label>
                <select
                  id="client_id"
                  name="client_id"
                  defaultValue={blankClientId}
                  onChange={(e) => setBlankClientId(e.target.value)}
                  className="border rounded-md px-3 py-2 text-sm bg-background"
                  required
                >
                  {clients.length === 0 && <option value="">— no clients yet —</option>}
                  {clients.map((c) => (
                    <option key={c.client_id} value={c.client_id}>
                      {c.display_name ?? c.client_id} ({c.client_id})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              /* hidden field so the form still submits client_id */
              <input type="hidden" name="client_id" value={preselectedClientId} />
            )}

            {/* Slug */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="slug">
                Plan slug{" "}
                <span className="text-muted-foreground font-normal text-xs">(unique identifier, no spaces)</span>
              </label>
              <input
                id="slug"
                name="slug"
                defaultValue={blankDefaultSlug}
                required
                pattern="[a-z0-9-]+"
                title="lowercase letters, digits, and hyphens only"
                className="border rounded-md px-3 py-2 text-sm font-mono bg-background"
              />
              <p className="text-xs text-muted-foreground">
                Format: <code className="font-mono">{blankClientId || "cl-001"}-YYYY-MM-DD-topic</code>
              </p>
            </div>

            <div className="flex gap-3 pt-1">
              <Button type="submit" variant={assessSessions.length > 0 ? "outline" : "default"}>
                Create blank draft →
              </Button>
              <Link href={preselectedClientId ? `/clients/${preselectedClientId}` : "/plans"}>
                <Button variant="ghost" type="button">Cancel</Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* No sessions at all — prompt to run an assess first */}
      {assessSessions.length === 0 && preselectedClientId && (
        <p className="text-xs text-muted-foreground text-center">
          💡 Run an assessment in the{" "}
          <Link href={`/clients/${preselectedClientId}`} className="underline hover:text-foreground">
            Assess tab
          </Link>{" "}
          first to get AI-suggested drivers, supplements and lifestyle recommendations
          pre-filled into the plan automatically.
        </p>
      )}
    </div>
  );
}

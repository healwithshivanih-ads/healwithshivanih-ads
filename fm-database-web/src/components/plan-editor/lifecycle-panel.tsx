"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PlanStatusBadge } from "@/components/plan-status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// Note: submitPlan + publishPlan moved out — primary submit/publish surface
// is the InlineStatusBar at the top of the v2 plan editor page. This file
// keeps only secondary lifecycle actions.
import {
  revokePlan,
  supersedePlan,
  comparePlanVersions,
  renderPlan,
  renderLabOrders,
  createSuccessor,
  generateFollowUpPlan,
} from "@/lib/server-actions/plan-lifecycle";
import type { SectionDiff } from "@/lib/fmdb/plan-version-compare";
import { PlanVersionDiffView } from "@/components/plan-editor/plan-version-diff-view";
import { ClientLetterButton } from "@/components/client-widgets/client-letter-button";
import { saveAsTemplateAction } from "@/lib/server-actions/plans";
import type { PlanStatus } from "@/lib/fmdb/types";

interface StatusEvent {
  state?: PlanStatus | string;
  by?: string;
  at?: string;
  reason?: string;
}

interface CatalogueSnapshot {
  git_sha?: string | null;
  snapshot_date?: string | null;
}

interface LifecyclePanelProps {
  slug: string;
  clientId?: string;
  status: PlanStatus | undefined;
  version?: number;
  catalogueSnapshot?: CatalogueSnapshot | null;
  statusHistory: StatusEvent[];
  supersedes?: string;
  allPlanSlugs: string[];
}

function downloadAs(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function LifecyclePanel({
  slug,
  clientId,
  status,
  version,
  catalogueSnapshot,
  statusHistory,
  supersedes,
  allPlanSlugs,
}: LifecyclePanelProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"lifecycle" | "export">("lifecycle");

  // Shared pending state
  const [isPending, startTransition] = useTransition();

  // Export tab state
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewFmt, setPreviewFmt] = useState<"markdown" | "html">("markdown");

  // Lab order sheet export state
  const [labPending, startLabTransition] = useTransition();
  const [labPreview, setLabPreview] = useState<string | null>(null);

  // Lifecycle tab state
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [successorSlug, setSuccessorSlug] = useState("");
  const [followUpSlug, setFollowUpSlug] = useState("");
  const [followUpPhase, setFollowUpPhase] = useState("");
  const [followUpPending, startFollowUpTransition] = useTransition();
  const [followUpSummary, setFollowUpSummary] = useState<string | null>(null);
  // Pre-populate diff selects: if this plan supersedes another, default A = supersedes, B = current
  const [diffA, setDiffA] = useState(supersedes ?? slug);
  const [diffB, setDiffB] = useState(supersedes ? slug : "");
  const [diffSections, setDiffSections] = useState<SectionDiff[] | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Save as template state
  const [templateName, setTemplateName] = useState(slug);
  const [templateDesc, setTemplateDesc] = useState("");
  const [templateTags, setTemplateTags] = useState("");
  const [templateSaving, startTemplateSaveTransition] = useTransition();

  function notify(ok: boolean, text: string) {
    setMessage({ kind: ok ? "ok" : "err", text });
    if (ok) toast.success(text);
    else toast.error(text);
  }

  function refreshAfterMutate() {
    setReason("");
    setConfirmChecked(false);
    router.refresh();
  }

  // handleActivate + handlePublish removed 2026-05-18.
  // Submit + Publish flow lives in InlineStatusBar (sticky bar at top of
  // the v2 plan editor). Keeping two parallel Activate buttons on the same
  // page confused coaches who hit Plan Actions tab AND the sticky bar.

  function handleRevoke() {
    startTransition(async () => {
      const r = await revokePlan(slug, reason);
      notify(r.ok, r.ok ? "Plan archived." : r.error ?? "Archive failed.");
      if (r.ok) refreshAfterMutate();
    });
  }

  function handleSupersede() {
    startTransition(async () => {
      if (!successorSlug.trim()) { notify(false, "Enter the successor slug."); return; }
      const r = await supersedePlan(successorSlug, reason);
      notify(r.ok, r.ok ? `Superseded by ${successorSlug}.` : r.error ?? "Supersede failed.");
      if (r.ok) { setSuccessorSlug(""); refreshAfterMutate(); }
    });
  }

  function handleCreateSuccessor() {
    startTransition(async () => {
      if (!successorSlug.trim()) { notify(false, "Enter a slug for the successor draft."); return; }
      const r = await createSuccessor(slug, successorSlug);
      notify(r.ok, r.ok ? `Successor draft created at ${successorSlug}.` : r.error ?? "Failed to create successor.");
      if (r.ok) refreshAfterMutate();
    });
  }

  function handleFollowUp() {
    if (!followUpSlug.trim()) { notify(false, "Enter a slug for the follow-up plan."); return; }
    setFollowUpSummary(null);
    startFollowUpTransition(async () => {
      const r = await generateFollowUpPlan(slug, followUpSlug.trim(), followUpPhase.trim(), clientId ?? "");
      if (r.ok) {
        notify(true, `Follow-up plan created: ${r.newSlug}`);
        setFollowUpSummary(r.adjustmentSummary ?? null);
        router.push(
          clientId
            ? `/clients-v2/${clientId}/plan/edit/${r.newSlug}`
            : `/plans/${r.newSlug}`,
        );
      } else {
        notify(false, r.error ?? "Failed to generate follow-up plan.");
      }
    });
  }

  function handleDiff() {
    startTransition(async () => {
      setDiffError(null);
      if (!diffA || !diffB) { notify(false, "Pick two plans to compare."); return; }
      const r = await comparePlanVersions(diffA, diffB);
      if (r.ok) {
        setDiffSections(r.sections ?? []);
      } else {
        setDiffSections(null);
        setDiffError(r.error ?? "Compare failed.");
        notify(false, r.error ?? "Compare failed.");
      }
    });
  }

  function handleLabExport(fmt: "markdown" | "html", action: "download" | "preview") {
    startLabTransition(async () => {
      const r = await renderLabOrders(slug, fmt);
      if (!r.ok || !r.content) { notify(false, r.error ?? "No lab orders on this plan."); return; }
      if (action === "download") {
        const ext = fmt === "html" ? "html" : "md";
        const mime = fmt === "html" ? "text/html" : "text/markdown";
        downloadAs(`${slug}-lab-orders.${ext}`, r.content, mime);
      } else {
        setLabPreview(r.content);
      }
    });
  }

  function handleRender(fmt: "markdown" | "html", action: "download" | "preview") {
    startTransition(async () => {
      const r = await renderPlan(slug, fmt);
      if (!r.ok || !r.content) { notify(false, r.error ?? "Render failed."); return; }
      if (action === "download") {
        const ext = fmt === "html" ? "html" : "md";
        const mime = fmt === "html" ? "text/html" : "text/markdown";
        downloadAs(`${slug}-v${version ?? 0}.${ext}`, r.content, mime);
      } else {
        setPreviewFmt(fmt);
        setPreviewText(r.content);
      }
    });
  }

  const sha = catalogueSnapshot?.git_sha ?? null;
  const snapDate = catalogueSnapshot?.snapshot_date ?? null;
  const otherSlugs = allPlanSlugs.filter((s) => s !== slug);

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-base sr-only">Plan actions</CardTitle>
        {/* Tab bar.
            Chat tab removed — the floating 💬 bubble is the same component
            and is reachable from any tab, so the duplicate was just noise.
            Export renamed → "Plan brief" so it isn't confused with the
            client-facing letter under the Communicate tab (different
            audience, different output). */}
        <div className="flex gap-1 border-b">
          {([
            ["lifecycle", "🚀 Lifecycle"],
            ["export", "📄 Plan brief (internal)"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-xs font-medium -mb-px border-b-2 transition-colors ${
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 text-sm pt-4">

        {/* ══════════════════════════════════════════════════════
            LIFECYCLE TAB
        ══════════════════════════════════════════════════════ */}
        {tab === "lifecycle" && (
          <>
            {/* Header strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground mb-1">Status</div>
                <PlanStatusBadge status={status} />
              </div>
              <div>
                <div className="text-muted-foreground mb-1">Version</div>
                <div className="font-mono">v{version ?? 0}</div>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">Snapshot date</div>
                <div className="font-mono">{snapDate ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground mb-1">Catalogue SHA</div>
                <div className="font-mono">{sha ?? "—"}</div>
              </div>
            </div>
            {supersedes && (
              <p className="text-xs text-muted-foreground">
                Supersedes <span className="font-mono">{supersedes}</span>.
              </p>
            )}

            {/* Status history */}
            <div>
              <div className="text-xs font-medium mb-1">📜 Status history</div>
              {statusHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground">No transitions yet.</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {[...statusHistory].reverse().map((ev, i) => (
                    <li key={i} className="flex items-center gap-2 flex-wrap">
                      <PlanStatusBadge status={ev.state as PlanStatus} />
                      <span className="text-muted-foreground">
                        by <span className="font-medium text-foreground">{ev.by ?? "—"}</span>
                      </span>
                      <span className="font-mono text-muted-foreground">{ev.at ?? ""}</span>
                      {ev.reason && <span className="italic text-muted-foreground">— {ev.reason}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Inline message */}
            {message && (
              <div className={`rounded-md border p-2 text-xs ${
                message.kind === "ok"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-red-300 bg-red-50 text-red-900"
              }`}>
                {message.text}
              </div>
            )}

            {/* ── Draft / ready_to_publish: pointer to the sticky bar ──
                The submit/publish actions live in the InlineStatusBar at the
                top of the v2 plan editor page. This panel is for SECONDARY
                lifecycle actions only (follow-up generation, revoke, diff,
                export, save-as-template). Avoiding two parallel Activate
                buttons that confused coaches in real use. */}
            {(status === "draft" || status === "ready_to_publish") && (
              <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-700">
                <div className="font-semibold">Submit & Publish</div>
                <p className="text-slate-600">
                  Use the <span className="font-mono text-[11px]">✅ Submit for publish</span>{" "}
                  button at the top of this page. This tab now only holds advanced
                  lifecycle actions (revoke, diff, export, save-as-template).
                </p>
              </div>
            )}

            {/* ── Active (published): follow-up + v2 + archived danger zone ── */}
            {status === "published" && (
              <div className="space-y-3">
                {/* ✨ AI Follow-up plan — most common next step */}
                <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/40 p-3">
                  <div className="text-xs font-semibold text-violet-900">✨ Generate next-phase plan</div>
                  <p className="text-xs text-muted-foreground">
                    AI adjusts doses, labs, and lifestyle based on check-in notes — ready to review as a new draft.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">New plan slug</label>
                      <Input
                        placeholder={`${slug}-phase2`}
                        value={followUpSlug}
                        onChange={(e) => setFollowUpSlug(e.target.value)}
                        className="mt-0.5 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Phase weeks (optional)</label>
                      <Input
                        placeholder="e.g. 3–8"
                        value={followUpPhase}
                        onChange={(e) => setFollowUpPhase(e.target.value)}
                        className="mt-0.5 text-xs"
                      />
                    </div>
                  </div>
                  <Button size="sm" className="bg-violet-700 hover:bg-violet-800 text-white"
                    onClick={handleFollowUp} disabled={followUpPending || !followUpSlug.trim()}>
                    {followUpPending ? "✨ Generating…" : "✨ Generate next-phase plan →"}
                  </Button>
                  {followUpSummary && (
                    <div className="rounded-md bg-violet-50 border border-violet-200 px-3 py-2 text-xs text-violet-800">
                      <p className="font-medium mb-1">AI adjustments made:</p>
                      <p>{followUpSummary}</p>
                    </div>
                  )}
                </div>

                {/* Create v2 manually */}
                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-xs font-semibold">📝 Create v2 manually</div>
                  <p className="text-xs text-muted-foreground">
                    Clone this plan into a new blank draft and edit from scratch.
                  </p>
                  <Input
                    placeholder={`${slug}-v2`}
                    value={successorSlug}
                    onChange={(e) => setSuccessorSlug(e.target.value)}
                    className="text-xs font-mono"
                  />
                  <Button size="sm" variant="outline" onClick={handleCreateSuccessor} disabled={isPending || !successorSlug.trim()}>
                    📝 Create v2 draft
                  </Button>
                </div>

                {/* Archive — buried in a danger zone */}
                <details className="group">
                  <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground list-none flex items-center gap-1">
                    <span className="transition-transform group-open:rotate-90 text-xs">▶</span>
                    Archive this plan
                  </summary>
                  <div className="mt-2 space-y-2 rounded-md border border-red-200 bg-red-50/40 p-3">
                    <p className="text-xs text-muted-foreground">
                      Archives the plan — use when you&apos;re replacing it with a new version or the client has finished.
                    </p>
                    <Input
                      placeholder="Reason (required)"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="text-xs"
                    />
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={confirmChecked}
                        onChange={(e) => setConfirmChecked(e.target.checked)}
                      />
                      Archive this plan (cannot be undone)
                    </label>
                    <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50"
                      onClick={handleRevoke}
                      disabled={isPending || !confirmChecked || !reason.trim()}>
                      {isPending ? "Archiving…" : "Archive plan"}
                    </Button>
                  </div>
                </details>
              </div>
            )}

            {(status === "superseded" || status === "revoked") && (
              <div className="rounded-md border border-muted bg-muted/40 p-3 text-xs text-muted-foreground">
                This plan is <span className="font-medium">{status === "revoked" ? "archived" : status}</span>.
                It&apos;s read-only. Create a new draft from the client page if needed.
              </div>
            )}

            {/* Save as Template — published plans only */}
            {status === "published" && (
              <details className="group/tmpl">
                <summary className="flex items-center gap-2 cursor-pointer select-none list-none rounded-md border bg-muted/30 px-3 py-2.5 text-xs font-semibold text-foreground hover:bg-muted/50">
                  <span className="transition-transform group-open/tmpl:rotate-90 text-muted-foreground text-xs">▶</span>
                  💾 Save as template
                </summary>
                <div className="mt-2 space-y-3 p-3 rounded-md border bg-card">
                  <p className="text-[11px] text-muted-foreground">
                    Save this published plan as a reusable coach template for future similar clients.
                    The template will appear in the template picker when creating a new plan.
                  </p>
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">Template name</label>
                      <Input
                        className="text-xs"
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        placeholder="e.g. Hashimoto Protocol v1"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">Description</label>
                      <textarea
                        className="w-full rounded-md border bg-background px-3 py-2 text-xs min-h-[60px] resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                        value={templateDesc}
                        onChange={(e) => setTemplateDesc(e.target.value)}
                        placeholder="Describe when to use this template…"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-0.5">Tags (comma-separated)</label>
                      <Input
                        className="text-xs"
                        value={templateTags}
                        onChange={(e) => setTemplateTags(e.target.value)}
                        placeholder="thyroid, autoimmune, hashimoto"
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={templateSaving || !templateName.trim()}
                    onClick={() => {
                      startTemplateSaveTransition(async () => {
                        const tags = templateTags
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean);
                        const res = await saveAsTemplateAction({
                          planSlug: slug,
                          templateName: templateName.trim(),
                          description: templateDesc.trim(),
                          tags,
                        });
                        if (res.ok) {
                          toast.success(`Template "${templateName.trim()}" saved!`);
                        } else {
                          toast.error(res.error ?? "Failed to save template");
                        }
                      });
                    }}
                  >
                    {templateSaving ? "Saving…" : "💾 Save template"}
                  </Button>
                </div>
              </details>
            )}

            {/* Compare versions — structured card view */}
            <details className="group/diff" open={!!(supersedes && diffSections !== null)}>
              <summary className="flex items-center gap-2 cursor-pointer select-none list-none rounded-md border bg-muted/30 px-3 py-2.5 text-xs font-semibold text-foreground hover:bg-muted/50">
                <span className="transition-transform group-open/diff:rotate-90 text-muted-foreground text-xs">▶</span>
                📋 Compare versions
                {supersedes && (
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    vs <span className="font-mono">{supersedes}</span>
                  </span>
                )}
              </summary>
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 block">Plan A (base)</label>
                    <Select value={diffA} onValueChange={(v) => { setDiffA(v ?? ""); setDiffSections(null); setDiffError(null); }}>
                      <SelectTrigger className="text-xs"><SelectValue placeholder="Plan A" /></SelectTrigger>
                      <SelectContent>
                        {allPlanSlugs.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5 block">Plan B (compare to)</label>
                    <Select value={diffB} onValueChange={(v) => { setDiffB(v ?? ""); setDiffSections(null); setDiffError(null); }}>
                      <SelectTrigger className="text-xs"><SelectValue placeholder="Plan B" /></SelectTrigger>
                      <SelectContent>
                        {allPlanSlugs.filter((s) => s !== diffA).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={handleDiff} disabled={isPending || !diffA || !diffB || diffA === diffB}>
                  {isPending ? "Comparing…" : "Compare →"}
                </Button>
                {diffError && (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                    {diffError}
                  </div>
                )}
                {diffSections !== null && (
                  <PlanVersionDiffView
                    sections={diffSections}
                    labelA={diffA}
                    labelB={diffB}
                  />
                )}
              </div>
            </details>
          </>
        )}

        {/* ══════════════════════════════════════════════════════
            EXPORT TAB
        ══════════════════════════════════════════════════════ */}
        {tab === "export" && (
          <>
            {/* Lab order sheet — separate client-facing doc, pre-protocol */}
            <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50/40 p-3">
              <div className="text-xs font-medium text-blue-900">🧪 Lab order sheet</div>
              <p className="text-[11px] text-muted-foreground">
                Generates a clean client-facing lab request doc from this plan&apos;s Labs tab —
                send to the client <em>before</em> the protocol is finalised so results inform the plan.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="border-blue-400 text-blue-800 hover:bg-blue-50"
                  disabled={labPending} onClick={() => handleLabExport("html", "download")}>
                  {labPending ? "Generating…" : "⬇ Download (print-ready)"}
                </Button>
                <Button size="sm" variant="outline" className="border-blue-400 text-blue-800 hover:bg-blue-50"
                  disabled={labPending} onClick={() => handleLabExport("markdown", "download")}>
                  ⬇ Markdown
                </Button>
                <Button size="sm" variant="ghost"
                  disabled={labPending} onClick={() => handleLabExport("markdown", "preview")}>
                  👁 Preview
                </Button>
              </div>
              {labPreview !== null && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[10px]">Lab order sheet</Badge>
                    <Button size="sm" variant="ghost" onClick={() => setLabPreview(null)}>Dismiss</Button>
                  </div>
                  <pre className="overflow-auto bg-muted p-3 text-[11px] max-h-96 whitespace-pre-wrap">
                    {labPreview}
                  </pre>
                </div>
              )}
            </div>

            {/* Structured plan export */}
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">📄 Structured plan export</div>
              <p className="text-[11px] text-muted-foreground">
                Exports the supplement protocol, nutrition guidance, and lifestyle practices
                from the plan — slugs replaced with plain English, coach notes stripped.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => handleRender("markdown", "download")} disabled={isPending}>
                  ⬇ Markdown
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleRender("html", "download")} disabled={isPending}>
                  ⬇ HTML (print-ready)
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleRender("markdown", "preview")} disabled={isPending}>
                  👁 Preview
                </Button>
              </div>
              {previewText !== null && (
                <div className="mt-2">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[10px]">{previewFmt}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => setPreviewText(null)}>Dismiss</Button>
                  </div>
                  <pre className="overflow-auto bg-muted p-3 text-[11px] max-h-96 whitespace-pre-wrap">
                    {previewText}
                  </pre>
                </div>
              )}
            </div>

            {/* AI meal plan — full 4-type selector */}
            <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50/40 p-3">
              <div className="text-xs font-medium text-emerald-800">❤️ Generate client documents</div>
              <p className="text-[11px] text-muted-foreground">
                Meal plan, supplement guide, coaching plan, or all-in-one. Uses the client&apos;s
                dietary preferences and plan data. Saves to disk — revisit any time.
              </p>
              <ClientLetterButton planSlug={slug} clientId={clientId ?? ""} />
            </div>
          </>
        )}

        {/* Chat tab removed in favour of the floating 💬 bubble, which
            embeds the same PlanChatPanel and is reachable from any tab. */}

      </CardContent>
    </Card>
  );
}

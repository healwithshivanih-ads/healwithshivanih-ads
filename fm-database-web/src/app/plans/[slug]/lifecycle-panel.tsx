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
import {
  submitPlan,
  publishPlan,
  revokePlan,
  supersedePlan,
  diffPlans,
  renderPlan,
  renderLabOrders,
  createSuccessor,
  generateFollowUpPlan,
} from "./lifecycle-actions";
import { ClientLetterButton } from "@/app/clients/[id]/client-letter-button";
import { PlanChatPanel } from "./plan-chat-panel";
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
  const [tab, setTab] = useState<"lifecycle" | "export" | "chat">("lifecycle");

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
  const [diffA, setDiffA] = useState(slug);
  const [diffB, setDiffB] = useState("");
  const [diffText, setDiffText] = useState<string | null>(null);

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

  function handleSubmit() {
    startTransition(async () => {
      const r = await submitPlan(slug, reason);
      notify(r.ok, r.ok ? "Plan submitted." : r.error ?? "Submit failed.");
      if (r.ok) refreshAfterMutate();
    });
  }

  function handlePublish() {
    startTransition(async () => {
      const r = await publishPlan(slug, reason);
      const v = (r.plan?.version as number | undefined) ?? version;
      notify(
        r.ok,
        r.ok
          ? `Plan published v${v ?? "?"}. Catalogue SHA frozen at ${r.git_sha ?? "—"}.`
          : r.error ?? "Publish failed."
      );
      if (r.ok) refreshAfterMutate();
    });
  }

  function handleRevoke() {
    startTransition(async () => {
      const r = await revokePlan(slug, reason);
      notify(r.ok, r.ok ? "Plan revoked." : r.error ?? "Revoke failed.");
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
        router.push(`/plans/${r.newSlug}`);
      } else {
        notify(false, r.error ?? "Failed to generate follow-up plan.");
      }
    });
  }

  function handleDiff() {
    startTransition(async () => {
      if (!diffA || !diffB) { notify(false, "Pick two plans to diff."); return; }
      const r = await diffPlans(diffA, diffB);
      if (r.ok) setDiffText(r.diff || "(no differences)");
      else notify(false, r.error ?? "Diff failed.");
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
        {/* Tab bar */}
        <div className="flex gap-1 border-b">
          {([
            ["lifecycle", "🚀 Lifecycle"],
            ["export", "📤 Export"],
            ["chat", "💬 Chat"],
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

            {/* Draft → Submit */}
            {status === "draft" && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="text-xs font-medium">📤 Submit for publishing</div>
                <p className="text-xs text-muted-foreground">
                  Runs plan-check. Blocked if any CRITICAL findings.
                </p>
                <Input
                  placeholder="Submit note (optional)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button size="sm" onClick={handleSubmit} disabled={isPending}>
                  {isPending ? "Submitting…" : "Submit for publishing"}
                </Button>
              </div>
            )}

            {/* Ready → Publish */}
            {status === "ready_to_publish" && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50/60 p-3">
                <div className="text-xs font-medium">🚀 Publish</div>
                <p className="text-xs text-muted-foreground">
                  Irreversible. Bumps version, freezes catalogue git SHA.
                </p>
                <Input
                  placeholder="Publish note (optional)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                  />
                  I understand this is irreversible.
                </label>
                <Button size="sm" onClick={handlePublish} disabled={isPending || !confirmChecked}>
                  {isPending ? "Publishing…" : "Publish now"}
                </Button>
              </div>
            )}

            {/* Published → Revoke / Supersede */}
            {status === "published" && (
              <div className="space-y-3">
                <div className="space-y-2 rounded-md border border-red-300 bg-red-50/60 p-3">
                  <div className="text-xs font-medium">🛑 Revoke</div>
                  <p className="text-xs text-muted-foreground">Reason required.</p>
                  <Input
                    placeholder="Reason for revoking (required)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={confirmChecked}
                      onChange={(e) => setConfirmChecked(e.target.checked)}
                    />
                    I understand this is irreversible.
                  </label>
                  <Button size="sm" variant="destructive" onClick={handleRevoke}
                    disabled={isPending || !confirmChecked || !reason.trim()}>
                    {isPending ? "Revoking…" : "Revoke"}
                  </Button>
                </div>

                {/* ✨ AI Follow-up plan */}
                <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/40 p-3">
                  <div className="text-xs font-medium text-violet-900">✨ Generate follow-up plan (next phase)</div>
                  <p className="text-xs text-muted-foreground">
                    AI reads the current plan + check-in notes and generates an adjusted plan for the next phase —
                    progressing doses, updating labs, and refining lifestyle based on how the client responded.
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
                    {followUpPending ? "✨ Generating…" : "✨ Generate AI follow-up plan →"}
                  </Button>
                  {followUpSummary && (
                    <div className="rounded-md bg-violet-50 border border-violet-200 px-3 py-2 text-xs text-violet-800">
                      <p className="font-medium mb-1">AI adjustments made:</p>
                      <p>{followUpSummary}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-xs font-medium">🆕 Manual successor / Supersede</div>
                  <p className="text-xs text-muted-foreground">
                    Clone this plan into a blank new draft, or publish a ready successor and flip this to superseded.
                  </p>
                  <Input
                    placeholder="Successor slug"
                    value={successorSlug}
                    onChange={(e) => setSuccessorSlug(e.target.value)}
                  />
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" onClick={handleCreateSuccessor} disabled={isPending}>
                      Clone to draft
                    </Button>
                    <Button size="sm" onClick={handleSupersede} disabled={isPending}>
                      Publish + supersede
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {(status === "superseded" || status === "revoked") && (
              <div className="rounded-md border border-muted bg-muted/40 p-3 text-xs text-muted-foreground">
                This plan is <span className="font-medium">{status}</span> — terminal state.
              </div>
            )}

            {/* Diff viewer */}
            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">🔬 Diff two plans</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Select value={diffA} onValueChange={(v) => setDiffA(v ?? "")}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Plan A" /></SelectTrigger>
                  <SelectContent>
                    {allPlanSlugs.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={diffB} onValueChange={(v) => setDiffB(v ?? "")}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Plan B" /></SelectTrigger>
                  <SelectContent>
                    {otherSlugs.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button size="sm" variant="outline" onClick={handleDiff} disabled={isPending || !diffB}>
                Show diff
              </Button>
              {diffText !== null && (
                <pre className="overflow-auto bg-muted p-3 text-[11px] max-h-96 font-mono whitespace-pre">
                  {diffText}
                </pre>
              )}
            </div>
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

        {/* ══════════════════════════════════════════════════════
            CHAT TAB
        ══════════════════════════════════════════════════════ */}
        {tab === "chat" && (
          <PlanChatPanel
            slug={slug}
            clientId={clientId ?? ""}
            isLocked={status !== "draft"}
          />
        )}

      </CardContent>
    </Card>
  );
}

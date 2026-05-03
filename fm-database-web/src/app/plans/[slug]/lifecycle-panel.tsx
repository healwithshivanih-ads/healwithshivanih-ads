"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  createSuccessor,
} from "./lifecycle-actions";
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
  status,
  version,
  catalogueSnapshot,
  statusHistory,
  supersedes,
  allPlanSlugs,
}: LifecyclePanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<
    { kind: "ok" | "err"; text: string } | null
  >(null);
  const [reason, setReason] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [successorSlug, setSuccessorSlug] = useState("");
  const [diffA, setDiffA] = useState(slug);
  const [diffB, setDiffB] = useState("");
  const [diffText, setDiffText] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewFmt, setPreviewFmt] = useState<"markdown" | "html">("markdown");

  function notify(ok: boolean, text: string) {
    setMessage({ kind: ok ? "ok" : "err", text });
  }

  function refreshAfterMutate() {
    setReason("");
    setConfirmChecked(false);
    router.refresh();
  }

  function handleSubmit() {
    startTransition(async () => {
      const r = await submitPlan(slug, reason);
      notify(r.ok, r.ok ? "Submitted to ready_to_publish." : r.error ?? "Submit failed.");
      if (r.ok) refreshAfterMutate();
    });
  }

  function handlePublish() {
    startTransition(async () => {
      const r = await publishPlan(slug, reason);
      notify(
        r.ok,
        r.ok
          ? `Published. Catalogue SHA frozen at ${r.git_sha ?? "—"}.`
          : r.error ?? "Publish failed."
      );
      if (r.ok) refreshAfterMutate();
    });
  }

  function handleRevoke() {
    startTransition(async () => {
      const r = await revokePlan(slug, reason);
      notify(r.ok, r.ok ? "Revoked." : r.error ?? "Revoke failed.");
      if (r.ok) refreshAfterMutate();
    });
  }

  function handleSupersede() {
    // The user is on the OLD published plan; we ask for the NEW slug that
    // supersedes it. supersedePlan operates on the new slug.
    startTransition(async () => {
      if (!successorSlug.trim()) {
        notify(false, "Enter the successor slug.");
        return;
      }
      const r = await supersedePlan(successorSlug, reason);
      notify(
        r.ok,
        r.ok
          ? `Superseded by ${successorSlug}.`
          : r.error ?? "Supersede failed."
      );
      if (r.ok) {
        setSuccessorSlug("");
        refreshAfterMutate();
      }
    });
  }

  function handleCreateSuccessor() {
    startTransition(async () => {
      if (!successorSlug.trim()) {
        notify(false, "Enter a slug for the successor draft.");
        return;
      }
      const r = await createSuccessor(slug, successorSlug);
      notify(
        r.ok,
        r.ok
          ? `Created successor draft ${successorSlug}.`
          : r.error ?? "Failed to create successor."
      );
      if (r.ok) refreshAfterMutate();
    });
  }

  function handleDiff() {
    startTransition(async () => {
      if (!diffA || !diffB) {
        notify(false, "Pick two plans to diff.");
        return;
      }
      const r = await diffPlans(diffA, diffB);
      if (r.ok) {
        setDiffText(r.diff || "(no differences)");
      } else {
        notify(false, r.error ?? "Diff failed.");
      }
    });
  }

  function handleRender(fmt: "markdown" | "html", action: "download" | "preview") {
    startTransition(async () => {
      const r = await renderPlan(slug, fmt);
      if (!r.ok || !r.content) {
        notify(false, r.error ?? "Render failed.");
        return;
      }
      if (action === "download") {
        const ext = fmt === "html" ? "html" : "md";
        const mime = fmt === "html" ? "text/html" : "text/markdown";
        const v = version ?? 0;
        downloadAs(`${slug}-v${v}.${ext}`, r.content, mime);
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
      <CardHeader className="pb-3">
        <CardTitle className="text-base">🚀 Lifecycle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {/* ----- Header strip ----- */}
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
            This plan supersedes <span className="font-mono">{supersedes}</span>.
          </p>
        )}

        {/* ----- Status history ----- */}
        <div>
          <div className="text-xs font-medium mb-1">📜 Status history</div>
          {statusHistory.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No transitions yet — plan is still in its initial state.
            </p>
          ) : (
            <ul className="space-y-1 text-xs">
              {[...statusHistory].reverse().map((ev, i) => (
                <li key={i} className="flex items-center gap-2 flex-wrap">
                  <PlanStatusBadge status={ev.state as PlanStatus} />
                  <span className="text-muted-foreground">
                    by <span className="font-medium text-foreground">{ev.by ?? "—"}</span>
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {ev.at ?? ""}
                  </span>
                  {ev.reason && (
                    <span className="italic text-muted-foreground">
                      — {ev.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ----- Inline messages ----- */}
        {message && (
          <div
            className={`rounded-md border p-2 text-xs ${
              message.kind === "ok"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                : "border-red-300 bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200"
            }`}
          >
            <div className="whitespace-pre-wrap">{message.text}</div>
          </div>
        )}

        {/* ----- State-aware actions ----- */}
        {status === "draft" && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="text-xs font-medium">📤 Submit for publishing</div>
            <p className="text-xs text-muted-foreground">
              Runs plan-check; refused if any CRITICAL findings.
            </p>
            <Input
              placeholder="Submit note (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={isPending}
            >
              {isPending ? "Submitting…" : "Submit for publishing"}
            </Button>
          </div>
        )}

        {status === "ready_to_publish" && (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 p-3">
            <div className="text-xs font-medium">🚀 Publish</div>
            <p className="text-xs text-muted-foreground">
              Irreversible. Bumps version, freezes catalogue snapshot to current
              git SHA.
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
            <Button
              type="button"
              size="sm"
              onClick={handlePublish}
              disabled={isPending || !confirmChecked}
            >
              {isPending ? "Publishing…" : "Publish now"}
            </Button>
          </div>
        )}

        {status === "published" && (
          <div className="space-y-3">
            <div className="space-y-2 rounded-md border border-red-300 bg-red-50/60 dark:bg-red-950/20 p-3">
              <div className="text-xs font-medium">🛑 Revoke</div>
              <p className="text-xs text-muted-foreground">
                Marks this plan as revoked. Reason required.
              </p>
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
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={handleRevoke}
                disabled={isPending || !confirmChecked || !reason.trim()}
              >
                {isPending ? "Revoking…" : "Revoke"}
              </Button>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="text-xs font-medium">🆕 Successor / Supersede</div>
              <p className="text-xs text-muted-foreground">
                Create a draft that supersedes this plan, OR — if you already
                have a ready_to_publish successor — publish it and flip this
                one to superseded.
              </p>
              <Input
                placeholder="Successor slug"
                value={successorSlug}
                onChange={(e) => setSuccessorSlug(e.target.value)}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCreateSuccessor}
                  disabled={isPending}
                >
                  Create successor draft
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSupersede}
                  disabled={isPending}
                >
                  Publish + supersede
                </Button>
              </div>
            </div>
          </div>
        )}

        {(status === "superseded" || status === "revoked") && (
          <div className="rounded-md border border-muted bg-muted/40 p-3 text-xs text-muted-foreground">
            This plan is <span className="font-medium">{status}</span> —
            terminal state. No further transitions available.
          </div>
        )}

        {/* ----- Client-facing render ----- */}
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-xs font-medium">📄 Client-facing export</div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleRender("markdown", "download")}
              disabled={isPending}
            >
              ⬇ Markdown
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleRender("html", "download")}
              disabled={isPending}
            >
              ⬇ HTML (print-ready)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleRender("markdown", "preview")}
              disabled={isPending}
            >
              👁 Preview
            </Button>
          </div>
          {previewText !== null && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <Badge variant="outline" className="text-[10px]">
                  {previewFmt}
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setPreviewText(null)}
                >
                  Dismiss
                </Button>
              </div>
              <pre className="overflow-auto bg-muted p-3 text-[11px] max-h-96 whitespace-pre-wrap">
                {previewText}
              </pre>
            </div>
          )}
        </div>

        {/* ----- Diff viewer ----- */}
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-xs font-medium">🔬 Diff two plans</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Select value={diffA} onValueChange={(v) => setDiffA(v ?? "")}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Plan A" />
              </SelectTrigger>
              <SelectContent>
                {allPlanSlugs.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={diffB} onValueChange={(v) => setDiffB(v ?? "")}>
              <SelectTrigger className="text-xs">
                <SelectValue placeholder="Plan B" />
              </SelectTrigger>
              <SelectContent>
                {otherSlugs.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleDiff}
            disabled={isPending || !diffB}
          >
            Show diff
          </Button>
          {diffText !== null && (
            <pre className="overflow-auto bg-muted p-3 text-[11px] max-h-96 font-mono whitespace-pre">
              {diffText}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

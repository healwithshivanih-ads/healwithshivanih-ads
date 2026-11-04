"use client";

/**
 * PlanUpdateDraftsPanel — the drafted "your plan changed" emails, and the only
 * place they can be sent from.
 *
 * A quick edit to a published plan (a supplement added, a dose changed, a
 * practice dropped) is diffed by the 07:30 digest and drafted into
 * `_plan_change_drafts.yaml`. The digest listed those drafts from August on,
 * but the restructure left nowhere to act on them, so they sat pending for
 * months. Rows reach this panel through `collectDecisions` (kind
 * `plan_update`): in care, on the plan the client is following now, ≤14 days.
 *
 * Read before send: the email body is shown on Preview, never hidden behind a
 * one-click approve. A row that stops something cannot go without a line of
 * context, because a bare "stop taking X" reads as though something went wrong.
 */
import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  approvePlanChangeDraftAction,
  dismissPlanChangeDraftAction,
  previewPlanChangeDraftAction,
  type PlanChangeDraft,
} from "@/lib/server-actions/plan-change-notify";
import { describeChange } from "@/lib/fmdb/plan-change-diff";
import { FmPanel } from "@/components/fm";

const pill = (primary: boolean, enabled = true): CSSProperties => ({
  border: primary ? "none" : "1px solid var(--fm-border)",
  background: primary ? (enabled ? "#6b8e6b" : "var(--fm-border)") : "transparent",
  color: primary ? "#fff" : "var(--fm-text-secondary)",
  borderRadius: "var(--fm-radius-pill)",
  padding: "5px 14px",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: enabled ? "pointer" : "not-allowed",
  fontFamily: "inherit",
});

function DraftRow({ draft, onDone }: { draft: PlanChangeDraft; onDone: (id: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState(draft.reason ?? "");
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);

  const needsReason = draft.needs_reason && !reason.trim();
  const ageDays = Math.max(0, Math.round((Date.now() - Date.parse(draft.created_at)) / 86_400_000));

  function showPreview() {
    startTransition(async () => {
      const res = await previewPlanChangeDraftAction(draft.id, reason);
      if (res.ok) setPreview({ subject: res.subject ?? "", body: res.body ?? "" });
      else toast.error(res.error || "Could not build the email");
    });
  }

  function send() {
    startTransition(async () => {
      const res = await approvePlanChangeDraftAction(draft.id, reason);
      if (res.ok) {
        toast.success(`Queued for ${draft.client_name}; it goes out within a minute`);
        onDone(draft.id);
      } else {
        toast.error(
          res.error === "client_has_no_email"
            ? `${draft.client_name} has no email on file`
            : res.error || "Could not send that",
        );
      }
    });
  }

  function dismiss() {
    startTransition(async () => {
      const res = await dismissPlanChangeDraftAction(draft.id);
      if (res.ok) {
        toast.success(`Dismissed; nothing sent to ${draft.client_name}`);
        onDone(draft.id);
      } else toast.error(res.error || "Could not dismiss that");
    });
  }

  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <Link
          href={`/clients-v2/${draft.client_id}/plan`}
          style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)", textDecoration: "none" }}
        >
          {draft.client_name}
        </Link>
        <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
          {ageDays === 0 ? "changed today" : `changed ${ageDays}d ago`}
        </span>
      </div>
      <ul style={{ margin: "6px 0 8px", paddingLeft: 18, fontSize: 12.5, color: "var(--fm-text-secondary)" }}>
        {draft.changes.map((c) => (
          <li key={`${c.kind}:${c.key}`}>{describeChange(c)}</li>
        ))}
      </ul>

      {draft.needs_reason && (
        <textarea
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setPreview(null);
          }}
          rows={2}
          placeholder="Why it's stopping, in a line, e.g. “Your bloating has settled, so we no longer need it.”"
          style={{
            width: "100%",
            padding: "6px 9px",
            fontSize: 12.5,
            fontFamily: "inherit",
            border: `1px solid ${needsReason ? "rgba(179, 64, 42, 0.5)" : "var(--fm-border)"}`,
            borderRadius: "var(--fm-radius-sm)",
            marginBottom: 8,
            resize: "vertical",
          }}
        />
      )}

      {preview && (
        <div
          style={{
            marginBottom: 8,
            padding: "8px 10px",
            background: "var(--fm-surface-alt, rgba(0,0,0,0.03))",
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12.5,
            lineHeight: 1.55,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{preview.subject}</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{preview.body}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {preview ? (
          <button
            type="button"
            onClick={send}
            disabled={pending || needsReason}
            title={needsReason ? "Add a line of context first" : "Email this to the client"}
            style={pill(true, !pending && !needsReason)}
          >
            {pending ? "Sending…" : "Approve & send"}
          </button>
        ) : (
          <button type="button" onClick={showPreview} disabled={pending} style={pill(true, !pending)}>
            {pending ? "Loading…" : "Read the email"}
          </button>
        )}
        <button type="button" onClick={dismiss} disabled={pending} style={pill(false, !pending)}>
          Dismiss, don&apos;t send
        </button>
      </div>
    </div>
  );
}

export function PlanUpdateDraftsPanel({ drafts }: { drafts: PlanChangeDraft[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const visible = drafts.filter((d) => !done.has(d.id));
  if (visible.length === 0) return null;

  return (
    <FmPanel style={{ padding: "12px 14px", marginBottom: 16 }}>
      <div style={{ fontSize: 12, color: "var(--fm-text-secondary)", marginBottom: 10 }}>
        You edited a live plan in a way the client has to act on. Nothing goes out until you read the email and send it.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((d) => (
          <DraftRow key={d.id} draft={d} onDone={(id) => setDone((s) => new Set(s).add(id))} />
        ))}
      </div>
    </FmPanel>
  );
}

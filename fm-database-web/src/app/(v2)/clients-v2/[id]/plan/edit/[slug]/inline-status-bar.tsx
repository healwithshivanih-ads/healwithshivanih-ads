"use client";

/**
 * InlineStatusBar — sticky-ish header at the top of the plan editor.
 *
 * Replaces the 🚀 Lifecycle tab's primary action surface. Shows current
 * status badge + the right next-action button for the current state:
 *
 *   draft               → Submit for publish (runs plan-check first;
 *                         blocks on CRITICAL)
 *   ready_to_publish    → Publish (with irreversible-confirm checkbox)
 *   published           → "Plan is live — see Advanced section below
 *                         to revoke / supersede / generate successor"
 *   superseded / revoked→ read-only banner
 *
 * The full lifecycle surface (revoke / supersede / diff / export /
 * save-as-template) lives in a collapsed <details> at the bottom of
 * the editor — coach doesn't need to scroll past it daily.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { submitPlan, publishPlan } from "@/lib/server-actions/plan-lifecycle";

interface Props {
  planSlug: string;
  status?: string;
  version?: number;
  catalogueSnapshot?: { git_sha?: string; snapshot_date?: string } | null;
}

const STATUS_META: Record<string, { label: string; tone: string; emoji: string }> = {
  draft:              { label: "Draft",              tone: "#475569", emoji: "📝" },
  ready_to_publish:   { label: "Ready to publish",   tone: "#b45309", emoji: "⚡" },
  published:          { label: "Active",             tone: "#059669", emoji: "✅" },
  superseded:         { label: "Superseded",         tone: "#6b7280", emoji: "📁" },
  revoked:            { label: "Revoked",            tone: "#991b1b", emoji: "🚫" },
};

export function InlineStatusBar({
  planSlug,
  status,
  version,
  catalogueSnapshot,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmPublish, setConfirmPublish] = useState(false);

  const meta = STATUS_META[status ?? "draft"] ?? STATUS_META.draft;

  const onSubmit = () => {
    start(async () => {
      const r = await submitPlan(planSlug);
      if (r.ok) {
        toast.success("✅ Plan-check passed — plan is ready to publish");
        router.refresh();
      } else {
        toast.error(r.error ?? "Submit failed — see plan-check panel");
      }
    });
  };

  const onPublish = () => {
    if (!confirmPublish) {
      toast.warning("Tick the irreversible-confirm box first");
      return;
    }
    start(async () => {
      const r = await publishPlan(planSlug);
      if (r.ok) {
        const publishedVersion =
          (r.plan as { version?: number } | null | undefined)?.version;
        toast.success(
          `🚀 Plan published${publishedVersion != null ? ` v${publishedVersion}` : ""} — now active for client`,
        );
        router.refresh();
      } else {
        toast.error(r.error ?? "Publish failed");
      }
    });
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
        padding: "10px 14px",
        background: "var(--fm-surface)",
        border: `2px solid ${meta.tone}33`,
        borderLeft: `4px solid ${meta.tone}`,
        borderRadius: "var(--fm-radius-md)",
        marginBottom: 12,
      }}
    >
      {/* Status badge */}
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          padding: "4px 10px",
          background: `${meta.tone}1A`,
          color: meta.tone,
          borderRadius: "var(--fm-radius-pill)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {meta.emoji} {meta.label}
      </span>

      {version != null && (
        <span style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)" }}>
          v{version}
        </span>
      )}

      {catalogueSnapshot?.git_sha != null && catalogueSnapshot.git_sha !== "" && (
        <span style={{ fontSize: 10, color: "var(--fm-text-tertiary)", fontFamily: "var(--fm-font-mono)" }}>
          {/* git_sha may be number when YAML parses an unquoted hex-looking
              value (e.g. "0829934") as int. Coerce defensively. */}
          catalogue {String(catalogueSnapshot.git_sha).slice(0, 7)}
          {catalogueSnapshot.snapshot_date ? ` @ ${catalogueSnapshot.snapshot_date}` : ""}
        </span>
      )}

      {/* Action(s) — right-aligned */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {status === "draft" && (
          <>
            <span style={{ fontSize: 11, color: "var(--fm-text-tertiary)" }}>
              Next: pass plan-check →
            </span>
            <button
              onClick={onSubmit}
              disabled={pending}
              style={primaryBtn(pending)}
            >
              {pending ? "⏳ Checking…" : "✅ Submit for publish"}
            </button>
          </>
        )}

        {status === "ready_to_publish" && (
          <>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--fm-text-secondary)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={confirmPublish}
                onChange={(e) => setConfirmPublish(e.target.checked)}
              />
              I&apos;ve reviewed the plan — publish is irreversible
            </label>
            <button
              onClick={onPublish}
              disabled={pending || !confirmPublish}
              style={primaryBtn(pending || !confirmPublish)}
            >
              {pending ? "⏳ Publishing…" : "🚀 Publish (activate)"}
            </button>
          </>
        )}

        {status === "published" && (
          <span style={{ fontSize: 11.5, color: "#059669", fontWeight: 600 }}>
            Plan is live. Use Advanced ↓ to revoke or supersede.
          </span>
        )}

        {(status === "superseded" || status === "revoked") && (
          <span style={{ fontSize: 11.5, color: meta.tone, fontWeight: 600 }}>
            Read-only.
          </span>
        )}
      </div>
    </div>
  );
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 700,
    padding: "7px 14px",
    background: disabled ? "var(--fm-bg-cool, #e5e7eb)" : "var(--fm-primary)",
    color: disabled ? "var(--fm-text-tertiary)" : "#fff",
    border: 0,
    borderRadius: "var(--fm-radius-sm)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
  };
}

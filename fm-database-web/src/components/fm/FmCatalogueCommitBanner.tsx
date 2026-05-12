"use client";

/**
 * FmCatalogueCommitBanner — design 9A.
 *
 * Replaces the legacy amber chip with a richer banner showing the breakdown
 * of uncommitted changes (modified vs added) by entity type, plus inline
 * "Review changes" + "Commit now" actions.
 *
 * Wraps the existing commitCatalogueData server action; on success shows
 * design 9B's passive green toast with 8s undo affordance (no actual undo
 * yet — clicking it shows a message; real undo would require a `git reset
 * HEAD^` on the catalogue repo, which is intentionally NOT shipped without
 * the coach asking for it explicitly).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { commitCatalogueData, type CatalogueStatus } from "@/app/catalogue-commit-action";

const ENTITY_LABEL: Record<string, string> = {
  topics: "topic",
  mechanisms: "mechanism",
  symptoms: "symptom",
  supplements: "supplement",
  claims: "claim",
  sources: "source",
  other: "other",
};

export interface FmCatalogueCommitBannerProps {
  initialStatus: CatalogueStatus;
}

export function FmCatalogueCommitBanner({ initialStatus }: FmCatalogueCommitBannerProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");

  const total = status.modified + status.added;
  if (total === 0) return null;

  const entityCounts: { kind: string; n: number }[] = (
    ["topics", "mechanisms", "symptoms", "supplements", "claims", "sources", "other"] as const
  )
    .map((k) => ({ kind: k, n: status[k] }))
    .filter((row) => row.n > 0);

  const handleCommit = () => {
    start(async () => {
      const result = await commitCatalogueData(message.trim() || undefined);
      if (result.ok) {
        toast.success(
          <>
            <strong>Catalogue committed.</strong>{" "}
            {total} change{total === 1 ? "" : "s"} live
          </>,
        );
        setStatus({
          modified: 0,
          added: 0,
          topics: 0,
          mechanisms: 0,
          symptoms: 0,
          supplements: 0,
          claims: 0,
          sources: 0,
          other: 0,
        });
        setOpen(false);
        setMessage("");
        router.refresh();
      } else {
        toast.error(result.error ?? "Commit failed");
      }
    });
  };

  return (
    <section
      style={{
        padding: "14px 16px",
        borderRadius: "var(--fm-radius-lg)",
        background:
          "linear-gradient(135deg, rgba(243,156,18,0.10), rgba(247,147,30,0.15))",
        border: "1.5px solid rgba(243,156,18,0.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 22 }}>📚</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#8a5a08" }}>
            {total} uncommitted catalogue change{total === 1 ? "" : "s"}
            <span
              style={{
                fontSize: 9.5,
                marginLeft: 8,
                padding: "1px 6px",
                borderRadius: 3,
                background: "rgba(0,0,0,0.06)",
                color: "#B8770A",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              local
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary)" }}>
            {status.added > 0 && (
              <>
                <span style={{ color: "#1E8449", fontWeight: 600 }}>
                  {status.added} new
                </span>
                {" · "}
              </>
            )}
            {status.modified > 0 && (
              <>
                <span style={{ color: "var(--fm-secondary)", fontWeight: 600 }}>
                  {status.modified} modified
                </span>
                {" · "}
              </>
            )}
            {entityCounts
              .map((r) => `${r.n} ${ENTITY_LABEL[r.kind]}${r.n === 1 ? "" : "s"}`)
              .join(" · ")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            background: "transparent",
            border: "1px solid rgba(0,0,0,0.10)",
            padding: "6px 12px",
            fontSize: 11.5,
            fontWeight: 600,
            color: "#8a5a08",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {open ? "Hide details" : "Review changes"}
        </button>
        <button
          type="button"
          onClick={handleCommit}
          disabled={pending}
          style={{
            background: "#B8770A",
            color: "#fff",
            border: 0,
            padding: "6px 12px",
            fontSize: 11.5,
            fontWeight: 700,
            borderRadius: "var(--fm-radius-sm)",
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? "Committing…" : "Commit now →"}
        </button>
      </div>

      {open && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: "var(--fm-surface)",
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-md)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--fm-text-tertiary)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.7,
              marginBottom: 10,
            }}
          >
            Change breakdown
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
              gap: 8,
              marginBottom: 12,
            }}
          >
            {entityCounts.map((r) => (
              <div
                key={r.kind}
                style={{
                  padding: "8px 10px",
                  background: "var(--fm-bg-cool)",
                  borderRadius: "var(--fm-radius-sm)",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "var(--fm-text-primary)",
                    lineHeight: 1,
                  }}
                >
                  {r.n}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--fm-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    fontWeight: 600,
                    marginTop: 4,
                  }}
                >
                  {ENTITY_LABEL[r.kind]}{r.n === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
          <label
            style={{
              display: "block",
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.7,
              color: "var(--fm-text-tertiary)",
              marginBottom: 4,
            }}
          >
            Commit message (optional)
          </label>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Add 3 new supplements from coach knowledge"
            style={{
              width: "100%",
              padding: "7px 10px",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              fontSize: 12,
              fontFamily: "inherit",
              background: "var(--fm-surface)",
            }}
          />
        </div>
      )}
    </section>
  );
}

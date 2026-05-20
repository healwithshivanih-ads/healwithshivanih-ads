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
import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  commitCatalogueData,
  getCatalogueFileDiff,
  type CatalogueStatus,
  type CatalogueFile,
  type CatalogueFileKind,
} from "@/app/catalogue-commit-action";

const ENTITY_LABEL: Record<string, string> = {
  topics: "topic",
  mechanisms: "mechanism",
  symptoms: "symptom",
  supplements: "supplement",
  claims: "claim",
  sources: "source",
  other: "other",
};

const KIND_TO_BUCKET: Record<CatalogueFileKind, string> = {
  topic: "topics",
  mechanism: "mechanisms",
  symptom: "symptoms",
  supplement: "supplements",
  claim: "claims",
  source: "sources",
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
  // Which entity bucket is "drilled in" — clicking a tile expands its
  // file list inline. Null = all collapsed. Click the same tile again
  // to collapse.
  const [drilledKind, setDrilledKind] = useState<string | null>(null);
  // Currently-open file-diff modal, if any.
  const [openFile, setOpenFile] = useState<CatalogueFile | null>(null);

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
          files: [],
        });
        setOpen(false);
        setMessage("");
        setDrilledKind(null);
        setOpenFile(null);
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
                fontSize: 10,
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
          <div style={{ fontSize: 12, color: "var(--fm-text-secondary)" }}>
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
            fontSize: 12,
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
            fontSize: 12,
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
            {entityCounts.map((r) => {
              const active = drilledKind === r.kind;
              return (
                <button
                  key={r.kind}
                  type="button"
                  onClick={() => setDrilledKind(active ? null : r.kind)}
                  style={{
                    padding: "8px 10px",
                    background: active ? "rgba(184,119,10,0.14)" : "var(--fm-bg-cool)",
                    borderRadius: "var(--fm-radius-sm)",
                    textAlign: "center",
                    cursor: "pointer",
                    border: active ? "1px solid rgba(184,119,10,0.4)" : "1px solid transparent",
                    fontFamily: "inherit",
                    transition: "background 0.1s",
                  }}
                  title={`Click to see which ${ENTITY_LABEL[r.kind]}${r.n === 1 ? "" : "s"} will be committed`}
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
                    {ENTITY_LABEL[r.kind]}{r.n === 1 ? "" : "s"} {active ? "▴" : "▾"}
                  </div>
                </button>
              );
            })}
          </div>

          {/* File list for the drilled-in entity. Each row is clickable
              → opens the diff modal so coach can see exactly what's
              changing before committing. */}
          {drilledKind && (
            <div
              style={{
                marginBottom: 12,
                background: "var(--fm-bg-cool)",
                border: "1px solid var(--fm-border-light)",
                borderRadius: "var(--fm-radius-sm)",
                padding: "8px 10px",
                maxHeight: 220,
                overflowY: "auto",
                display: "grid",
                gap: 4,
              }}
            >
              {status.files
                .filter((f) => KIND_TO_BUCKET[f.kind] === drilledKind)
                .map((f) => {
                  const isNew = f.status.includes("?");
                  return (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => setOpenFile(f)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 8px",
                        background: "var(--fm-surface)",
                        border: "1px solid var(--fm-border-light)",
                        borderRadius: "var(--fm-radius-sm)",
                        fontSize: 12,
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "inherit",
                      }}
                      title="Click to view diff"
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                          padding: "1px 6px",
                          borderRadius: 3,
                          background: isNew
                            ? "rgba(30, 132, 73, 0.12)"
                            : "rgba(184, 119, 10, 0.12)",
                          color: isNew ? "#1E8449" : "#8a5a08",
                          minWidth: 38,
                          textAlign: "center",
                        }}
                      >
                        {isNew ? "new" : "edit"}
                      </span>
                      <span style={{ fontWeight: 600 }}>{f.slug}</span>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--fm-text-tertiary)" }}>
                        view diff →
                      </span>
                    </button>
                  );
                })}
            </div>
          )}
          <label
            style={{
              display: "block",
              fontSize: 11,
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

      {openFile && (
        <CatalogueDiffModal
          file={openFile}
          onClose={() => setOpenFile(null)}
        />
      )}
    </section>
  );
}

/** Modal showing the git diff (or full content for new files) for one
 *  catalogue file. Loads on mount; ESC closes. */
function CatalogueDiffModal({
  file,
  onClose,
}: {
  file: CatalogueFile;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<
    { mode: "new" | "modified"; content: string } | { error: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await getCatalogueFileDiff(file.path);
      if (cancelled) return;
      if (r.ok) setData({ mode: r.mode, content: r.content });
      else setData({ error: r.error });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [file.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const mode = data && "mode" in data ? data.mode : null;
  const error = data && "error" in data ? data.error : null;
  const content = data && "content" in data ? data.content : "";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.5)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          maxWidth: 1000,
          width: "100%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid #f1f5f9",
            background: "linear-gradient(180deg, #fffaf0 0%, #fff 100%)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {mode === "new" ? "🆕 New file" : "✏️ Diff"} · {file.slug}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "var(--fm-font-mono)" }}>
              {file.path}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: 0,
              fontSize: 22,
              cursor: "pointer",
              color: "#94a3b8",
              padding: "4px 10px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: 16,
            background: "#fafafa",
          }}
        >
          {loading && (
            <div style={{ fontSize: 12, color: "#94a3b8", padding: 12 }}>
              Loading diff…
            </div>
          )}
          {!loading && error && (
            <div
              style={{
                padding: 12,
                background: "#fef2f2",
                border: "1px solid #fca5a5",
                borderRadius: 6,
                color: "#7f1d1d",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
          {!loading && content && (
            <pre
              style={{
                margin: 0,
                fontSize: 12,
                lineHeight: 1.55,
                fontFamily: "var(--fm-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
                whiteSpace: "pre-wrap",
                wordWrap: "break-word",
              }}
            >
              {colorize(content)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/** Cheap inline diff colouring — additions green, deletions red, hunk
 *  headers blue, everything else plain. Splits on lines and wraps each
 *  in a styled span. Avoids pulling in a full diff library for what's
 *  effectively a read-only viewer. */
function colorize(text: string): React.ReactNode {
  return text.split("\n").map((line, i) => {
    let bg: string | undefined;
    let color: string | undefined;
    if (line.startsWith("+++") || line.startsWith("---")) {
      color = "#6b7280";
    } else if (line.startsWith("+")) {
      bg = "rgba(16, 185, 129, 0.10)";
      color = "#065f46";
    } else if (line.startsWith("-")) {
      bg = "rgba(239, 68, 68, 0.10)";
      color = "#7f1d1d";
    } else if (line.startsWith("@@")) {
      bg = "rgba(59, 130, 246, 0.10)";
      color = "#1e3a8a";
    }
    return (
      <span
        key={i}
        style={{
          display: "block",
          background: bg,
          color,
          padding: "0 4px",
        }}
      >
        {line || " "}
      </span>
    );
  });
}

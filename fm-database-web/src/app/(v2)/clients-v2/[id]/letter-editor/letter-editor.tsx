"use client";

/**
 * Dual-palette letter editor — Group D7e in the design bundle.
 *
 * App chrome (orange/slate) wraps a Deep Mind canvas (bone bg, indigo
 * type, rose accent, Libre Baskerville serif). Three columns:
 *   LEFT  · section nav auto-detected from markdown ## headings
 *   MID   · the letter canvas with the editable markdown
 *   RIGHT · validation report from the Haiku QA pass with accept-rewrite
 *           toggles
 *
 * Save writes back through the same saveMealPlan() server action as
 * the SendPackage flow — single source of truth on disk.
 */
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  saveMealPlan,
  generateClientLetter,
  type LetterType,
  type LetterValidationChange,
} from "@/lib/server-actions/plan-lifecycle";

// Deep Mind brand palette — only used inside the letter canvas.
const DEEP_MIND = {
  bone: "#f6f1e8",
  bonePaper: "#fbf8f2",
  indigo: "#2a2545",
  indigoMid: "#5b5266",
  rose: "#c45a73",
  border: "#e0d6c4",
};

interface Section {
  id: string;
  level: 1 | 2 | 3;
  title: string;
  lineStart: number;
}

function parseSections(md: string): Section[] {
  const lines = md.split("\n");
  const out: Section[] = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(#{1,3})\s+(.+?)\s*$/);
    if (m) {
      const level = m[1].length as 1 | 2 | 3;
      const title = m[2];
      const id = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
      out.push({ id: `${id}-${i}`, level, title, lineStart: i });
    }
  });
  return out;
}

export function LetterEditor({
  clientId,
  clientName,
  clientEmail,
  planSlug,
  letterType,
  letterIcon,
  letterLabel,
  initialMarkdown,
  initialHtml,
  initialValidation,
}: {
  clientId: string;
  clientName: string;
  clientEmail?: string;
  planSlug: string;
  letterType: LetterType;
  letterIcon: string;
  letterLabel: string;
  initialMarkdown: string;
  initialHtml: string | null;
  initialValidation: LetterValidationChange[];
}) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [validation, setValidation] = useState(initialValidation);
  const [acceptedRewrites, setAcceptedRewrites] = useState<Set<number>>(
    new Set(),
  );
  const [pending, startSave] = useTransition();
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  // 🪄 Regenerate-with-AI state.  Two-step: clicking the button arms
  // the confirm modal; only the modal's explicit "Yes, regenerate"
  // actually fires generateClientLetter with forceRegenerate=true.
  // This is deliberately heavy-handed because a regen burns ~$0.20
  // and wipes any in-progress edits the coach hasn't saved.
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [regenerating, startRegen] = useTransition();

  const sections = useMemo(() => parseSections(markdown), [markdown]);
  const wordCount = useMemo(
    () => markdown.split(/\s+/).filter(Boolean).length,
    [markdown],
  );

  const isDirty = markdown !== initialMarkdown;

  const onSave = () => {
    startSave(async () => {
      // Strip rewrites the coach already accepted from the validation
      // report — accepting means "apply + drop from queue".
      const remaining = validation.filter((_, i) => !acceptedRewrites.has(i));
      const res = await saveMealPlan(
        planSlug,
        clientId,
        markdown,
        // We don't regenerate HTML on save — preview button below
        // re-renders with the markdown. Keep the prior HTML.
        initialHtml,
        letterType,
        remaining,
      );
      if (res.ok) {
        toast.success("Letter saved");
        setValidation(remaining);
        setAcceptedRewrites(new Set());
        setLastSavedAt(
          new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      } else {
        toast.error(`Save failed: ${res.error}`);
      }
    });
  };

  const onRegenerate = () => {
    setRegenConfirmOpen(false);
    startRegen(async () => {
      try {
        const res = await generateClientLetter(
          planSlug,
          clientId,
          undefined,        // weightLoss — let the AI re-pick from plan
          letterType,
          undefined,        // coachNotes — fresh regen, no carry-over
          true,             // forceRegenerate — bypass cache
        );
        if (!res.ok || !res.markdown) {
          toast.error(`Regenerate failed: ${res.error ?? "unknown error"}`);
          return;
        }
        // Replace local state with the fresh AI output. acceptedRewrites
        // is cleared since the old validation report is now stale.
        setMarkdown(res.markdown);
        setValidation(res.validation_report ?? []);
        setAcceptedRewrites(new Set());
        setLastSavedAt(
          new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
        toast.success(
          `🪄 Letter regenerated — ${res.markdown.split(/\s+/).filter(Boolean).length} words`,
        );
      } catch (e) {
        toast.error(`Regenerate failed: ${(e as Error).message.slice(0, 120)}`);
      }
    });
  };

  const onApplyRewrite = (index: number) => {
    const change = validation[index];
    if (!change?.rewrite) return;
    // Find the original_tip in the markdown and replace with the rewrite.
    const idx = markdown.indexOf(change.original_tip);
    if (idx === -1) {
      toast.error(
        "Couldn't find the original line — maybe already edited. Toggle the accept switch to mark applied.",
      );
      return;
    }
    setMarkdown(
      markdown.slice(0, idx) +
        change.rewrite +
        markdown.slice(idx + change.original_tip.length),
    );
    setAcceptedRewrites((s) => new Set(s).add(index));
    toast.success("Rewrite applied — Save to persist.");
  };

  const onSend = () => {
    if (isDirty) {
      toast.error("Save the letter first, then send from Communicate.");
      return;
    }
    router.push(`/clients-v2/${clientId}/communicate`);
  };

  return (
    <div
      className="fm-v2"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 15, 20, 0.55)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          maxWidth: 1400,
          maxHeight: 920,
          background: "var(--fm-surface)",
          borderRadius: "var(--fm-radius-md)",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.30)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* APP-palette chrome top bar */}
        <div
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid var(--fm-border)",
            background: "var(--fm-surface)",
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexShrink: 0,
          }}
        >
          <Link
            href={`/clients-v2/${clientId}/communicate`}
            aria-label="Close editor"
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--fm-radius-sm)",
              border: "1px solid var(--fm-border)",
              background: "var(--fm-surface)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              textDecoration: "none",
              color: "var(--fm-text-secondary)",
              fontSize: 13,
            }}
          >
            ✕
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {letterIcon} {letterLabel}
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--fm-text-tertiary)",
                  fontWeight: 500,
                  marginLeft: 8,
                }}
              >
                · {clientName} · plan{" "}
                <span style={{ fontFamily: "var(--fm-font-mono)" }}>
                  {planSlug}
                </span>
                {isDirty && (
                  <span
                    style={{
                      marginLeft: 8,
                      padding: "1px 7px",
                      fontSize: 9.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      borderRadius: "var(--fm-radius-pill)",
                      background: "rgba(184, 119, 10, 0.10)",
                      color: "#8a560a",
                    }}
                  >
                    unsaved
                  </span>
                )}
                {!isDirty && lastSavedAt && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 10,
                      color: "#1e8449",
                    }}
                  >
                    ✓ saved {lastSavedAt}
                  </span>
                )}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Link
              href={`/clients-v2/${clientId}/plan/edit/${planSlug}`}
              style={{
                padding: "6px 12px",
                fontSize: 11.5,
                fontWeight: 600,
                background: "var(--fm-surface)",
                border: "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-sm)",
                color: "var(--fm-text-secondary)",
                textDecoration: "none",
              }}
            >
              👁 Preview / HTML
            </Link>
            <button
              type="button"
              onClick={() => setRegenConfirmOpen(true)}
              disabled={regenerating}
              title="Rebuild the letter from scratch using the current plan"
              style={{
                padding: "6px 12px",
                fontSize: 11.5,
                fontWeight: 700,
                background: regenerating
                  ? "var(--fm-bg-cool)"
                  : "rgba(110, 76, 200, 0.10)",
                border: "1px solid rgba(110, 76, 200, 0.40)",
                borderRadius: "var(--fm-radius-sm)",
                color: regenerating
                  ? "var(--fm-text-tertiary)"
                  : "#5a3fb0",
                cursor: regenerating ? "wait" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {regenerating ? "🪄 Regenerating…" : "🪄 Regenerate with AI"}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={pending || !isDirty}
              style={{
                padding: "6px 14px",
                fontSize: 11.5,
                fontWeight: 700,
                background: "var(--fm-surface)",
                border: "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-sm)",
                color: "var(--fm-text-primary)",
                cursor: pending ? "wait" : isDirty ? "pointer" : "default",
                fontFamily: "inherit",
                opacity: isDirty ? 1 : 0.5,
              }}
            >
              {pending ? "Saving…" : "💾 Save draft"}
            </button>
            <button
              type="button"
              onClick={onSend}
              style={{
                padding: "6px 14px",
                fontSize: 11.5,
                fontWeight: 700,
                background: "var(--fm-primary)",
                color: "#fff",
                border: 0,
                borderRadius: "var(--fm-radius-sm)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              title={
                clientEmail
                  ? `Send to ${clientEmail} from Communicate`
                  : "Send via Communicate"
              }
            >
              ✉ Send to client →
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "200px minmax(0, 1fr) 360px",
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* LEFT · APP palette section nav */}
          <aside
            style={{
              padding: 16,
              background: "var(--fm-bg-cool)",
              borderRight: "1px solid var(--fm-border-light)",
              overflow: "auto",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "var(--fm-text-tertiary)",
                marginBottom: 8,
              }}
            >
              Sections
            </div>
            {sections.length === 0 ? (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--fm-text-tertiary)",
                  fontStyle: "italic",
                }}
              >
                No section headers yet. Add{" "}
                <code style={{ fontFamily: "var(--fm-font-mono)" }}>## Title</code>{" "}
                lines to structure.
              </div>
            ) : (
              sections.map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: "6px 10px",
                    paddingLeft: 10 + (s.level - 1) * 10,
                    fontSize: 11.5,
                    marginBottom: 3,
                    borderRadius: "var(--fm-radius-sm)",
                    color: "var(--fm-text-secondary)",
                    fontWeight: s.level === 1 ? 700 : s.level === 2 ? 600 : 500,
                    cursor: "default",
                  }}
                  title={s.title}
                >
                  {s.title}
                </div>
              ))
            )}
            <div
              style={{
                marginTop: 16,
                padding: 10,
                background: "var(--fm-surface)",
                border: "1px solid var(--fm-border-light)",
                borderRadius: "var(--fm-radius-sm)",
                fontSize: 10.5,
                color: "var(--fm-text-secondary)",
                lineHeight: 1.5,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  color: "var(--fm-text-tertiary)",
                  marginBottom: 4,
                }}
              >
                Word count
              </div>
              <strong style={{ color: "var(--fm-text-primary)", fontSize: 14 }}>
                {wordCount.toLocaleString()}
              </strong>{" "}
              / target 1,100–1,400
            </div>
          </aside>

          {/* MID · DEEP MIND palette letter canvas */}
          <main
            style={{
              background: DEEP_MIND.bone,
              padding: "24px 0",
              overflow: "auto",
            }}
          >
            <div
              style={{
                maxWidth: 760,
                margin: "0 auto",
                background: DEEP_MIND.bonePaper,
                padding: "40px 56px",
                boxShadow: "0 2px 20px rgba(42, 37, 69, 0.10)",
                fontFamily: '"Libre Baskerville", Georgia, serif',
                color: DEEP_MIND.indigo,
                lineHeight: 1.7,
                borderRadius: 6,
                border: `1px solid ${DEEP_MIND.border}`,
              }}
            >
              <div
                style={{
                  fontSize: 9.5,
                  letterSpacing: 2,
                  color: DEEP_MIND.indigoMid,
                  marginBottom: 18,
                  textTransform: "uppercase",
                }}
              >
                Shivani Hari · Functional Medicine
              </div>
              <textarea
                value={markdown}
                onChange={(e) => setMarkdown(e.target.value)}
                spellCheck
                style={{
                  width: "100%",
                  minHeight: 520,
                  resize: "vertical",
                  border: 0,
                  outline: "none",
                  background: "transparent",
                  fontFamily: 'ui-monospace, "SF Mono", monospace',
                  fontSize: 12.5,
                  lineHeight: 1.65,
                  color: DEEP_MIND.indigo,
                  whiteSpace: "pre-wrap",
                }}
              />
              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: `1px dashed ${DEEP_MIND.border}`,
                  fontSize: 10,
                  color: DEEP_MIND.indigoMid,
                  fontFamily: "system-ui, sans-serif",
                  fontStyle: "italic",
                }}
              >
                Plain markdown — preview opens the brand-rendered HTML in
                a new tab via the Lifecycle button. The Send button on
                Communicate is the canonical email path.
              </div>
            </div>
          </main>

          {/* RIGHT · APP palette AI validation report */}
          <aside
            style={{
              padding: 16,
              background: "var(--fm-surface)",
              borderLeft: "1px solid var(--fm-border-light)",
              overflow: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: 14 }}>🔎</span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: "var(--fm-text-secondary)",
                }}
              >
                AI checks
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 9.5,
                  padding: "2px 8px",
                  border: "1px solid var(--fm-border)",
                  borderRadius: "var(--fm-radius-pill)",
                  color: "var(--fm-text-tertiary)",
                  fontFamily: "var(--fm-font-mono)",
                }}
              >
                validation_report.json
              </span>
            </div>
            <div
              style={{
                marginBottom: 14,
                fontSize: 10.5,
                color: "var(--fm-text-tertiary)",
              }}
            >
              {validation.length === 0
                ? "No suggestions from the Haiku QA pass — letter validated clean."
                : `${validation.length} ${validation.length === 1 ? "finding" : "findings"} · accept rewrites you agree with, then Save.`}
            </div>
            {validation.map((c, i) => {
              const accepted = acceptedRewrites.has(i);
              const tone =
                c.score <= 2
                  ? { fg: "#B8770A", bg: "rgba(184,119,10,0.06)", label: "needs work" }
                  : c.score === 3
                    ? { fg: "#5a3fb0", bg: "rgba(110,76,200,0.06)", label: "suggestion" }
                    : { fg: "#1e8449", bg: "rgba(46,204,113,0.06)", label: "pass" };
              return (
                <div
                  key={i}
                  style={{
                    marginBottom: 10,
                    padding: 12,
                    background: tone.bg,
                    border: `1px solid ${tone.fg}30`,
                    borderLeft: `3px solid ${tone.fg}`,
                    borderRadius: "var(--fm-radius-sm)",
                    opacity: accepted ? 0.6 : 1,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 9.5,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: 0.7,
                        color: tone.fg,
                      }}
                    >
                      {tone.label}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        color: "var(--fm-text-tertiary)",
                      }}
                    >
                      score {c.score}/5
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--fm-text-secondary)",
                      fontStyle: "italic",
                      marginBottom: 6,
                      padding: "4px 6px",
                      background: "var(--fm-surface)",
                      borderRadius: "var(--fm-radius-sm)",
                    }}
                  >
                    finds: &ldquo;{c.original_tip.slice(0, 160)}
                    {c.original_tip.length > 160 ? "…" : ""}&rdquo;
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--fm-text-secondary)",
                      lineHeight: 1.5,
                      marginBottom: c.rewrite ? 8 : 0,
                    }}
                  >
                    {c.reason}
                  </div>
                  {c.rewrite && (
                    <>
                      <div
                        style={{
                          fontSize: 10.5,
                          padding: "6px 8px",
                          background: "var(--fm-bg-cool)",
                          border: "1px solid var(--fm-border-light)",
                          borderRadius: "var(--fm-radius-sm)",
                          marginBottom: 6,
                          lineHeight: 1.55,
                          color: "var(--fm-text-primary)",
                        }}
                      >
                        <strong style={{ fontSize: 9, color: tone.fg }}>
                          REWRITE
                        </strong>{" "}
                        — &ldquo;{c.rewrite}&rdquo;
                      </div>
                      <button
                        type="button"
                        onClick={() => onApplyRewrite(i)}
                        disabled={accepted}
                        style={{
                          width: "100%",
                          padding: "5px 10px",
                          fontSize: 11,
                          fontWeight: 700,
                          background: accepted ? "var(--fm-bg-cool)" : tone.fg,
                          color: accepted ? "var(--fm-text-tertiary)" : "#fff",
                          border: 0,
                          borderRadius: "var(--fm-radius-sm)",
                          cursor: accepted ? "default" : "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {accepted ? "✓ Applied — Save to persist" : "Apply rewrite to letter"}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </aside>
        </div>
      </div>

      {/* 🪄 Regenerate confirmation modal — overlays the editor.
          Two-step confirm because regen burns ~$0.20 + wipes unsaved
          edits. Coach has to click "Yes, regenerate" before the AI
          call fires. */}
      {regenConfirmOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setRegenConfirmOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 15, 20, 0.65)",
            zIndex: 250,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            style={{
              maxWidth: 460,
              background: "var(--fm-surface)",
              border: "1.5px solid rgba(110, 76, 200, 0.40)",
              borderRadius: "var(--fm-radius-md)",
              padding: "24px 26px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.30)",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 10 }}>🪄</div>
            <h2
              style={{
                fontFamily: "var(--fm-font-display)",
                fontSize: 18,
                fontWeight: 400,
                margin: "0 0 8px",
                color: "var(--fm-text-primary)",
                letterSpacing: "-0.2px",
              }}
            >
              Regenerate this letter with AI?
            </h2>
            <p
              style={{
                fontSize: 12.5,
                color: "var(--fm-text-secondary)",
                lineHeight: 1.55,
                margin: "0 0 14px",
              }}
            >
              The {letterLabel.toLowerCase()} will be rebuilt from scratch
              against the current plan ({planSlug}).{" "}
              {isDirty && (
                <strong style={{ color: "#c0392b" }}>
                  Your unsaved edits will be replaced.
                </strong>
              )}{" "}
              Existing AI validation findings will reset. Cost ≈ $0.20,
              time ~60–120s.
            </p>
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={() => setRegenConfirmOpen(false)}
                style={{
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border)",
                  borderRadius: "var(--fm-radius-sm)",
                  color: "var(--fm-text-secondary)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onRegenerate}
                style={{
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  background: "#5a3fb0",
                  color: "#fff",
                  border: 0,
                  borderRadius: "var(--fm-radius-sm)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                🪄 Yes, regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

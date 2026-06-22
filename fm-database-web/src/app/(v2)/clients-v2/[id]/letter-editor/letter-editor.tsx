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
  reRenderClientLetter,
  generatePhaseMealPlanAction,
  refineLetter,
  type ChatTurn,
  type LetterType,
  type LetterValidationChange,
} from "@/lib/server-actions/plan-lifecycle";
import { SendToClientButton } from "@/components/plan-editor/send-to-client-modal";

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
  phase,
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
  /** Phase letters (letterType === "meal_plan_phase") need this so the
   *  save + regenerate actions hit the right per-phase filenames
   *  (<planSlug>-meal_plan-wkN-M.md) rather than a non-existent
   *  <planSlug>-meal_plan_phase.md. Null/undefined for non-phase letters. */
  phase?: { startWeek: number; endWeek: number } | null;
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
  // 🔄 Re-render (no API): save current markdown, then re-run only the
  // deterministic HTML assembly (brand wrap, portion plate, supplement
  // schedule with current plan timing, print buttons). $0 — no Sonnet,
  // no Haiku. Use after manual edits or a plan-data / rule change.
  const [rerendering, startRerender] = useTransition();

  const onRerender = () => {
    if (letterType === "meal_plan_phase") {
      toast.error("Phase letters: use Regenerate. Re-render covers the main letter types.");
      return;
    }
    startRerender(async () => {
      try {
        // Persist the current editor markdown first so the script reads
        // the latest text from disk (html=null forces a fresh build).
        await saveMealPlan(planSlug, clientId, markdown, null, letterType);
        const res = await reRenderClientLetter(planSlug, clientId, letterType);
        if (!res.ok || !res.markdown) {
          toast.error(`Re-render failed: ${res.error ?? "unknown error"}`);
          return;
        }
        setMarkdown(res.markdown);
        setLastSavedAt(
          new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        );
        toast.success("🔄 Re-rendered (no API, $0) — HTML, plate & schedule refreshed");
      } catch (e) {
        toast.error(`Re-render failed: ${(e as Error).message.slice(0, 120)}`);
      }
    });
  };

  // 💬 AI Refine chat — coach types freeform feedback ("too much ragi —
  // swap some for jowar / bajra") and the AI rewrites the relevant
  // sections in place. Uses the existing refineLetter() server action
  // (Sonnet refine prompt with full markdown context). Two modes:
  //   - discuss: AI explains what it WOULD change, no rewrite yet (Haiku)
  //   - finalise: AI rewrites the WHOLE document + saves to disk (Sonnet, ~$0.15+)
  // We default to DISCUSS — it's the cheap path and never touches disk, so an
  // exploratory edit doesn't pay for a full Sonnet rewrite. The coach flips to
  // Finalise (and clicks Apply) only when she actually wants the rewrite to
  // land. History is per-letter, lost on page refresh (acceptable — the
  // markdown changes ARE persisted on disk).
  const [refineHistory, setRefineHistory] = useState<ChatTurn[]>([]);
  const [refineDraft, setRefineDraft] = useState("");
  const [refineMode, setRefineMode] = useState<"discuss" | "finalise">("discuss");
  const [refining, startRefine] = useTransition();
  const [lastRefineReply, setLastRefineReply] = useState<string | null>(null);

  const onRefine = () => {
    const msg = refineDraft.trim();
    if (!msg) return;
    setRefineDraft("");
    setLastRefineReply(null);
    // Optimistic: append user turn immediately so the chat reads naturally
    // even while Sonnet is streaming.
    const optimistic: ChatTurn[] = [
      ...refineHistory,
      { role: "user", content: msg },
    ];
    setRefineHistory(optimistic);
    startRefine(async () => {
      try {
        const res = await refineLetter(
          markdown,
          msg,
          refineHistory,        // server gets prior history; client message is the new turn
          planSlug,
          clientId,
          refineMode,
        );
        if (!res.ok) {
          setRefineHistory([
            ...optimistic,
            {
              role: "assistant",
              content: `⚠ ${res.error ?? "Refine failed"}`,
            },
          ]);
          toast.error(res.error ?? "Refine failed");
          return;
        }
        const reply = res.reply ?? "(no reply)";
        setRefineHistory([
          ...optimistic,
          { role: "assistant", content: reply },
        ]);
        setLastRefineReply(reply);
        // Finalise mode + markdown returned → swap in the new letter.
        if (
          res.mode === "finalise" &&
          res.markdown &&
          !res.no_update
        ) {
          setMarkdown(res.markdown);
          // Mark as just-saved (refine already wrote to disk via the
          // saveMealPlan call inside refineLetter).
          setLastSavedAt(new Date().toISOString());
          toast.success("Letter updated by AI");
          // Refresh so the new mtime / saved-letters probe on Communicate
          // picks up the change.
          router.refresh();
        } else if (res.mode === "discuss") {
          toast.success("AI replied — review and Apply when ready");
        }
      } catch (err) {
        setRefineHistory([
          ...optimistic,
          {
            role: "assistant",
            content: `⚠ ${(err as Error).message}`,
          },
        ]);
        toast.error((err as Error).message);
      }
    });
  };

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
        phase,
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
        // Phase letters live on a different code path (generate-client-letter
        // doesn't know the week-range filenames). Branch on letterType.
        let markdownOut: string | null = null;
        let validationOut: LetterValidationChange[] = [];
        let errOut: string | null = null;
        if (letterType === "meal_plan_phase") {
          if (!phase) {
            toast.error(
              "This phase letter is missing its week range — reopen from Communicate.",
            );
            return;
          }
          const res = await generatePhaseMealPlanAction(
            planSlug,
            clientId,
            phase.startWeek,
            phase.endWeek,
            undefined,   // coachNotes — fresh regen, no carry-over
            true,        // forceRegenerate — bypass cache
          );
          if (res.ok && res.markdown) {
            markdownOut = res.markdown;
            // Phase action doesn't currently emit a validation report;
            // clear stale entries.
            validationOut = [];
          } else if (!res.ok) {
            errOut = res.error ?? "unknown error";
          }
        } else {
          const res = await generateClientLetter(
            planSlug,
            clientId,
            undefined,        // weightLoss — let the AI re-pick from plan
            letterType,
            undefined,        // coachNotes — fresh regen, no carry-over
            true,             // forceRegenerate — bypass cache
          );
          if (res.ok && res.markdown) {
            markdownOut = res.markdown;
            validationOut = res.validation_report ?? [];
          } else if (!res.ok) {
            errOut = res.error ?? "unknown error";
          }
        }
        if (!markdownOut) {
          toast.error(`Regenerate failed: ${errOut ?? "unknown error"}`);
          return;
        }
        // Replace local state with the fresh AI output. acceptedRewrites
        // is cleared since the old validation report is now stale.
        setMarkdown(markdownOut);
        setValidation(validationOut);
        setAcceptedRewrites(new Set());
        setLastSavedAt(
          new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
        toast.success(
          `🪄 Letter regenerated — ${markdownOut.split(/\s+/).filter(Boolean).length} words`,
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

  // onSend removed 2026-05-19 — was just pushing to Communicate which
  // confused the coach (looked like the button did nothing). Replaced
  // with the SendToClientButton component (compose-preview-send modal
  // via Gmail SMTP, plan HTML pre-rendered as inline body). Same
  // component used at the bottom of the Communicate tab.

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
                  fontSize: 11,
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
                      fontSize: 10,
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
            {/* Preview opens the brand-rendered HTML for the CURRENT
                letterType in a new tab. Was incorrectly linking to
                /plan/edit/<slug> — fixed 2026-05-19. Phase letters
                need ?phase_start + ?phase_end so the API route can
                resolve the per-fortnight filename. */}
            <a
              href={
                letterType === "meal_plan_phase" && phase
                  ? `/api/letter/${clientId}/${planSlug}/${letterType}?phase_start=${phase.startWeek}&phase_end=${phase.endWeek}`
                  : `/api/letter/${clientId}/${planSlug}/${letterType}`
              }
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: "var(--fm-surface)",
                border: "1px solid var(--fm-border)",
                borderRadius: "var(--fm-radius-sm)",
                color: "var(--fm-text-secondary)",
                textDecoration: "none",
              }}
            >
              👁 Preview / HTML
            </a>
            <button
              type="button"
              onClick={onRerender}
              disabled={rerendering || regenerating}
              title="Re-render the HTML from the current text — refreshes plate, supplement schedule & formatting. No API, free."
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 700,
                background: rerendering ? "var(--fm-bg-cool)" : "rgba(47, 106, 60, 0.10)",
                border: "1px solid rgba(47, 106, 60, 0.40)",
                borderRadius: "var(--fm-radius-sm)",
                color: rerendering ? "var(--fm-text-tertiary)" : "#2f6a3c",
                cursor: rerendering ? "wait" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {rerendering ? "🔄 Re-rendering…" : "🔄 Re-render (free)"}
            </button>
            <button
              type="button"
              onClick={() => setRegenConfirmOpen(true)}
              disabled={regenerating}
              title="Rebuild the letter from scratch using the current plan"
              style={{
                padding: "6px 12px",
                fontSize: 12,
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
                fontSize: 12,
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
            {/* Send to client — opens the compose-preview-send modal
                inline (Gmail SMTP, plan HTML rendered as inline body).
                If the letter has unsaved edits, show a toast prompting
                Save first; otherwise the modal opens directly. */}
            {isDirty ? (
              <button
                type="button"
                onClick={() =>
                  toast.error(
                    "Save the letter first, then click Send.",
                  )
                }
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  background: "var(--fm-primary)",
                  color: "#fff",
                  border: 0,
                  borderRadius: "var(--fm-radius-sm)",
                  cursor: "pointer",
                  opacity: 0.55,
                  fontFamily: "inherit",
                }}
                title="Save first, then send"
              >
                ✉ Send to client →
              </button>
            ) : (
              <SendToClientButton
                planSlug={planSlug}
                clientId={clientId}
                clientEmail={clientEmail}
                clientName={clientName}
                // Send the CURRENT letter being reviewed (e.g. the
                // meal_plan_phase for Wks 3-4), not the consolidated.
                letterType={letterType as
                  | "consolidated"
                  | "supplement_plan"
                  | "lifestyle_guide"
                  | "exercise_plan"
                  | "recipes"
                  | "meal_plan_phase"}
                phase={phase ?? undefined}
              />
            )}
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
                    fontSize: 12,
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
                fontSize: 11,
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
                  fontSize: 10,
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
                  fontSize: 13,
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
                  fontSize: 10,
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
                fontSize: 11,
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
                        fontSize: 10,
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
                      fontSize: 11,
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
                          fontSize: 11,
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

            {/* 💬 AI Refine — freeform feedback chat.  Coach types things
                like "too much ragi, swap some for jowar / bajra" or
                "tone it down on the supplement section, she's already
                tired of taking pills".
                Default = Discuss (cheap Haiku, no write); flip to Finalise
                for the full Sonnet rewrite-to-disk when ready. */}
            <div
              style={{
                marginTop: 22,
                paddingTop: 16,
                borderTop: "1px dashed var(--fm-border)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 14 }}>💬</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: "var(--fm-text-secondary)",
                  }}
                >
                  Tell the AI to fix something
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--fm-text-tertiary)",
                  marginBottom: 10,
                  lineHeight: 1.5,
                }}
              >
                Plain-English feedback (e.g. <em>&quot;too much ragi — swap
                some for jowar or bajra&quot;</em>, <em>&quot;cut the lecture
                tone in week 2&quot;</em>, <em>&quot;add a no-onion
                no-garlic line to the travel section&quot;</em>). AI rewrites
                the relevant sections and saves to disk.
              </div>

              {/* Mode toggle — finalise (default, edits in place) /
                  discuss (chat-only, no save) */}
              <div
                style={{
                  display: "inline-flex",
                  background: "var(--fm-bg-cool)",
                  border: "1px solid var(--fm-border)",
                  borderRadius: "var(--fm-radius-pill)",
                  padding: 2,
                  marginBottom: 10,
                  fontSize: 11,
                }}
              >
                {(["finalise", "discuss"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRefineMode(m)}
                    disabled={refining}
                    style={{
                      padding: "3px 10px",
                      border: 0,
                      borderRadius: "var(--fm-radius-pill)",
                      background:
                        refineMode === m ? "var(--fm-primary)" : "transparent",
                      color:
                        refineMode === m ? "#fff" : "var(--fm-text-secondary)",
                      fontWeight: 700,
                      cursor: refining ? "wait" : "pointer",
                    }}
                  >
                    {m === "finalise" ? "✏ Apply" : "🗨 Discuss"}
                  </button>
                ))}
              </div>

              {/* History */}
              {refineHistory.length > 0 && (
                <div
                  style={{
                    maxHeight: 280,
                    overflow: "auto",
                    marginBottom: 10,
                    padding: "8px 10px",
                    background: "var(--fm-bg-warm)",
                    borderRadius: "var(--fm-radius-sm)",
                    border: "1px solid var(--fm-border-light)",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  {refineHistory.map((t, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 12,
                        lineHeight: 1.55,
                        padding: "6px 9px",
                        borderRadius: 6,
                        background:
                          t.role === "user"
                            ? "rgba(255, 107, 53, 0.10)"
                            : "var(--fm-surface)",
                        borderLeft:
                          t.role === "user"
                            ? "2px solid var(--fm-primary)"
                            : "2px solid var(--fm-border)",
                        color:
                          t.role === "user"
                            ? "var(--fm-text-primary)"
                            : "var(--fm-text-secondary)",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          marginBottom: 2,
                          color:
                            t.role === "user"
                              ? "var(--fm-primary)"
                              : "var(--fm-text-tertiary)",
                        }}
                      >
                        {t.role === "user" ? "You" : "AI"}
                      </div>
                      {t.content}
                    </div>
                  ))}
                </div>
              )}

              <textarea
                value={refineDraft}
                onChange={(e) => setRefineDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.metaKey || e.ctrlKey) &&
                    !refining
                  ) {
                    e.preventDefault();
                    onRefine();
                  }
                }}
                placeholder="Too much ragi being included — swap some for jowar or bajra…"
                disabled={refining}
                rows={3}
                style={{
                  width: "100%",
                  padding: 8,
                  fontSize: 12,
                  fontFamily: "inherit",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border)",
                  borderRadius: "var(--fm-radius-sm)",
                  resize: "vertical",
                  lineHeight: 1.5,
                }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 6,
                  fontSize: 10,
                  color: "var(--fm-text-tertiary)",
                }}
              >
                <span>⌘+Enter to send</span>
                <button
                  type="button"
                  onClick={onRefine}
                  disabled={refining || !refineDraft.trim()}
                  style={{
                    padding: "6px 14px",
                    fontSize: 11,
                    fontWeight: 700,
                    background:
                      refining || !refineDraft.trim()
                        ? "var(--fm-bg-cool)"
                        : "var(--fm-primary)",
                    color:
                      refining || !refineDraft.trim()
                        ? "var(--fm-text-tertiary)"
                        : "#fff",
                    border: 0,
                    borderRadius: "var(--fm-radius-sm)",
                    cursor:
                      refining || !refineDraft.trim() ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {refining
                    ? "AI rewriting…"
                    : refineMode === "finalise"
                      ? "Apply ✏"
                      : "Discuss 🗨"}
                </button>
              </div>
              {lastRefineReply && refineMode === "finalise" && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: "var(--fm-text-tertiary)",
                    fontStyle: "italic",
                  }}
                >
                  ✓ Letter on disk has been updated.
                </div>
              )}
            </div>
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
                fontSize: 13,
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

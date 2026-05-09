"use client";

/**
 * SendPackageButton — batch letter generator for the Documents tab.
 *
 * Lets the coach pick which letter types to generate (checkboxes, default:
 * Meal Plan + Supplement Guide) and generates all selected types in sequence
 * with a single click. Per-type progress is shown inline.
 *
 * Uses the same generateClientLetter + loadMealPlan actions as ClientLetterButton,
 * but without the weight-loss questionnaire or refinement chat — quick delivery flow.
 *
 * Features:
 * - 👁 Per-type inline iframe preview (toggle, one at a time)
 * - 📧 Email compose panel after all checked types are done
 */

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  generateClientLetter,
  loadMealPlan,
  type LetterType,
  type LetterValidationChange,
} from "@/app/plans/[slug]/lifecycle-actions";
import {
  sendClientLettersAction,
  updateClientFieldsAction,
} from "@/app/api/email/actions";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PackageType {
  type: LetterType;
  label: string;
  emoji: string;
  desc: string;
  defaultChecked: boolean;
}

const PACKAGE_TYPES: PackageType[] = [
  {
    type: "meal_plan",
    label: "Meal Plan",
    emoji: "🍽",
    desc: "12-week personalised meal plan with Indian recipes",
    defaultChecked: true,
  },
  {
    type: "supplement_plan",
    label: "Supplement Guide",
    emoji: "💊",
    desc: "Visual supplement schedule with timing + rationale",
    defaultChecked: true,
  },
  {
    type: "lifestyle_guide",
    label: "Lifestyle Guide",
    emoji: "🌿",
    desc: "Habits, education, lab tracking & lifestyle practices",
    defaultChecked: false,
  },
  {
    type: "exercise_plan",
    label: "Exercise Plan (detailed)",
    emoji: "🏃",
    desc: "Optional 12-week phased movement plan with weekly schedules + cycle-aware modifications. Send only to clients who want depth.",
    defaultChecked: false,
  },
  {
    type: "consolidated",
    label: "Full Wellness Letter",
    emoji: "📄",
    desc: "All sections combined — includes a simple cycle-aware exercise schedule for clients who don't want the detailed plan",
    defaultChecked: false,
  },
];

type TypeStatus = "idle" | "pending" | "done" | "error";

interface TypeState {
  checked: boolean;
  status: TypeStatus;
  errorMsg?: string;
  savedAt?: string | null;    // ISO timestamp from disk
  htmlBlob?: string | null;   // for download + preview
  mdBlob?: string | null;     // for download
  editOpen?: boolean;         // is the edit pane open?
  editText?: string | null;   // editable copy of mdBlob (null = not yet opened)
  validationReport?: LetterValidationChange[] | null;  // tips rewritten by Haiku QA pass
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function letterFileStem(planSlug: string, type: LetterType): string {
  return type === "consolidated" ? planSlug : `${planSlug}-${type}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SendPackageButtonProps {
  planSlug: string;
  clientId: string;
  clientEmail?: string;
  clientName?: string;
}

export function SendPackageButton({ planSlug, clientId, clientEmail, clientName }: SendPackageButtonProps) {
  // Per-type state
  const [types, setTypes] = useState<Record<LetterType, TypeState>>(() =>
    Object.fromEntries(
      PACKAGE_TYPES.map((p) => [
        p.type,
        { checked: p.defaultChecked, status: "idle" as TypeStatus },
      ])
    ) as Record<LetterType, TypeState>
  );

  const [coachNotes, setCoachNotes] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [, startTransition] = useTransition();

  // Feature 1: preview state — which type has preview open (one at a time)
  const [previewOpenFor, setPreviewOpenFor] = useState<LetterType | null>(null);

  // Feature 2: email compose state
  const [emailPanelOpen, setEmailPanelOpen] = useState(false);
  const router = useRouter();
  // Local mirror of the client's email — initialised from the prop, then
  // updated immediately after a successful send so reopening the panel
  // pre-fills with the freshly-saved address. Without this, `clientEmail`
  // stayed stale (the prop is fixed at parent-render time) and the To
  // field flashed empty after every save → reopen.
  const [currentClientEmail, setCurrentClientEmail] = useState<string>(clientEmail ?? "");
  const [emailTo, setEmailTo] = useState(currentClientEmail);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailIntro, setEmailIntro] = useState(
    `Hi ${clientName?.split(" ")[0] ?? "there"},\n\nPlease find your personalised plan attached below. Let me know if you have any questions.\n\nWith care,\nShivani`
  );
  const [emailInclude, setEmailInclude] = useState<Record<LetterType, boolean>>(
    Object.fromEntries(PACKAGE_TYPES.map((p) => [p.type, true])) as Record<LetterType, boolean>
  );
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Load saved letters on mount
  useEffect(() => {
    void (async () => {
      const results = await Promise.allSettled(
        PACKAGE_TYPES.map((p) => loadMealPlan(planSlug, clientId, p.type))
      );
      setTypes((prev) => {
        const next = { ...prev };
        PACKAGE_TYPES.forEach((p, i) => {
          const r = results[i];
          if (r.status === "fulfilled" && r.value.savedAt) {
            next[p.type] = {
              ...next[p.type],
              status: "done",
              savedAt: r.value.savedAt,
              htmlBlob: r.value.html ?? null,
              mdBlob: r.value.markdown ?? null,
              validationReport: r.value.validationReport ?? null,
            };
          }
        });
        return next;
      });
    })();
  }, [planSlug, clientId]);

  const checkedTypes = PACKAGE_TYPES.filter((p) => types[p.type].checked);
  const anyChecked = checkedTypes.length > 0;
  const anyPending = Object.values(types).some((t) => t.status === "pending");
  const allDone = checkedTypes.length > 0 && checkedTypes.every((p) => types[p.type].status === "done");

  // Done types (for email include checkboxes)
  const doneTypes = PACKAGE_TYPES.filter((p) => types[p.type].status === "done" && types[p.type].htmlBlob);

  const handleGenerate = () => {
    if (!anyChecked || isGenerating) return;
    runGenerate(checkedTypes, false);
  };

  /**
   * Force-regenerate a single letter type. Bypasses both the disk cache
   * and the cross-reference (extract-from-consolidated) logic — sends the
   * full plan back to the AI so the generated content reflects any plan
   * changes since the cached letter was produced.
   */
  const handleRegenerateOne = (pkgType: LetterType) => {
    if (isGenerating) return;
    const pkg = PACKAGE_TYPES.find((p) => p.type === pkgType);
    if (!pkg) return;
    runGenerate([pkg], true);
  };

  const runGenerate = (pkgs: typeof PACKAGE_TYPES, force: boolean) => {
    setIsGenerating(true);

    // Reset errors/pending for the targeted types
    setTypes((prev) => {
      const next = { ...prev };
      for (const p of pkgs) {
        next[p.type] = { ...next[p.type], status: "pending", errorMsg: undefined };
      }
      return next;
    });

    startTransition(async () => {
      for (const pkg of pkgs) {
        try {
          const result = await generateClientLetter(
            planSlug,
            clientId,
            undefined,        // weightLossParams — not used in quick package flow
            pkg.type,
            coachNotes.trim() || undefined,
            force,
          );
          setTypes((prev) => ({
            ...prev,
            [pkg.type]: {
              ...prev[pkg.type],
              status: result.ok ? "done" : "error",
              errorMsg: result.ok ? undefined : (result.error ?? "Unknown error"),
              htmlBlob: result.ok ? (result.html ?? null) : prev[pkg.type].htmlBlob,
              mdBlob: result.ok ? (result.markdown ?? null) : prev[pkg.type].mdBlob,
              savedAt: result.ok ? new Date().toISOString() : prev[pkg.type].savedAt,
              validationReport: result.ok ? (result.validation_report ?? null) : prev[pkg.type].validationReport,
            },
          }));
          if (!result.ok) {
            toast.error(`${pkg.label} failed: ${result.error?.slice(0, 80)}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setTypes((prev) => ({
            ...prev,
            [pkg.type]: {
              ...prev[pkg.type],
              status: "error",
              errorMsg: msg.slice(0, 120),
            },
          }));
          toast.error(`${pkg.label}: ${msg.slice(0, 80)}`);
        }
      }
      setIsGenerating(false);
    });
  };

  // Open email panel — fixed default subject (the inline body covers the
  // letter type already; keeping the subject simple looks cleaner in the
  // recipient's inbox than "… — Full Wellness Letter").
  const handleOpenEmailPanel = () => {
    setEmailSubject("Your Personalised Wellness Plan");
    // Reset include to all done types
    const next = Object.fromEntries(PACKAGE_TYPES.map((p) => [p.type, false])) as Record<LetterType, boolean>;
    for (const p of doneTypes) next[p.type] = true;
    setEmailInclude(next);
    setEmailTo(currentClientEmail);
    setEmailPanelOpen(true);
    setEmailError(null);
  };

  const handleSendEmail = async () => {
    if (!emailTo.trim()) {
      setEmailError("Please enter a recipient email address.");
      return;
    }
    setIsSendingEmail(true);
    setEmailError(null);

    // Hand the raw letter HTMLs to the server action — it runs each one
    // through buildEmailSafeBody (strips <script>, @import fonts, @media
    // print, universal CSS resets; inlines remaining styles via juice;
    // returns just <body> contents) before wrapping them in a single
    // outer envelope. The pre-flatten body we used to build here had
    // nested <html> tags + un-inlined <style> rules that Gmail mangled.
    const selectedLetters = doneTypes
      .filter((p) => emailInclude[p.type] && types[p.type].htmlBlob)
      .map((p) => ({ label: p.label, html: types[p.type].htmlBlob! }));

    // Attach the same letters as full standalone HTML files. The inline
    // body is for reading; the attachments are for the recipient to
    // open in a browser when they want the per-week / per-supplement
    // 🖨 print buttons (which can't run inside email — no JS).
    const safeName = (clientName ?? "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "client";
    const attachments = doneTypes
      .filter((p) => emailInclude[p.type] && types[p.type].htmlBlob)
      .map((p) => ({
        filename: `${safeName}-${p.type}.html`,
        html: types[p.type].htmlBlob!,
      }));

    try {
      const result = await sendClientLettersAction({
        to: emailTo.trim(),
        subject: emailSubject,
        intro: emailIntro,
        letters: selectedLetters,
        attachments,
      });
      if (result.ok) {
        toast.success(`Email sent to ${emailTo.trim()}`);
        // If the coach typed an email that wasn't already on the client's
        // profile, persist it so the next send auto-fills. Update the
        // local mirror IMMEDIATELY (so reopening the panel before the
        // server round-trip completes still pre-fills correctly) and
        // call router.refresh() so the rest of the page (contact widget
        // etc.) picks up the new value via fresh server-component data.
        const typed = emailTo.trim();
        if (typed && typed !== currentClientEmail) {
          setCurrentClientEmail(typed);
          try {
            await updateClientFieldsAction(clientId, { email: typed });
            router.refresh();
          } catch { /* non-fatal */ }
        }
        setEmailPanelOpen(false);
      } else {
        setEmailError(result.error ?? "Failed to send email.");
      }
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Count saved types for the collapsed trigger label
  const savedCount = PACKAGE_TYPES.filter((p) => types[p.type].savedAt).length;

  return (
    <div className="space-y-3">
      {/* ── Trigger button ── */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold border transition-all hover:shadow-sm"
        style={{
          borderColor: "var(--brand-indigo, #2B2D42)",
          color: "var(--brand-indigo, #2B2D42)",
          background: isOpen ? "rgba(43,45,66,0.05)" : "white",
        }}
      >
        📤 Send package
        {savedCount > 0 && !isOpen && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
            {savedCount} saved
          </span>
        )}
        <span className="text-xs opacity-50">{isOpen ? "▲" : "▼"}</span>
      </button>

      {/* ── Package builder ── */}
      {isOpen && (
        <div
          className="rounded-xl border p-4 space-y-4"
          style={{ borderColor: "var(--brand-lavender, #8D99AE)", background: "var(--brand-bone, #FAF8F5)" }}
        >
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--brand-indigo, #2B2D42)" }}>
              Choose what to generate
            </p>
            <p className="text-xs mt-0.5 text-muted-foreground">
              Meal Plan + Supplement Guide are pre-selected — the standard delivery for most clients.
            </p>
          </div>

          {/* Type checkboxes */}
          <div className="space-y-2">
            {PACKAGE_TYPES.map((pkg) => {
              const state = types[pkg.type];
              const isChecked = state.checked;
              const statusIcon =
                state.status === "pending" ? "⏳"
                : state.status === "done" ? "✅"
                : state.status === "error" ? "❌"
                : null;
              const isPreviewOpen = previewOpenFor === pkg.type;

              return (
                <div
                  key={pkg.type}
                  className="rounded-lg border transition-all"
                  style={{
                    borderColor: isChecked ? "var(--brand-indigo, #2B2D42)" : "var(--border)",
                    background: isChecked ? "rgba(43,45,66,0.04)" : "white",
                  }}
                >
                  <div className="flex items-start gap-3 p-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) =>
                        setTypes((prev) => ({
                          ...prev,
                          [pkg.type]: { ...prev[pkg.type], checked: e.target.checked },
                        }))
                      }
                      disabled={isGenerating}
                      className="mt-0.5 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">
                          {pkg.emoji} {pkg.label}
                        </span>
                        {statusIcon && (
                          <span className="text-xs">{statusIcon}</span>
                        )}
                        {state.status === "done" && state.savedAt && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                            ✓ Saved {new Date(state.savedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                        {state.status === "done" && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleRegenerateOne(pkg.type); }}
                            disabled={isGenerating}
                            title="Force fresh AI regeneration (ignores cache + cross-references)"
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-amber-300 text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                          >
                            🔄 Regenerate
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{pkg.desc}</p>

                      {/* Error message */}
                      {state.status === "error" && state.errorMsg && (
                        <p className="text-xs text-red-600 mt-1 rounded bg-red-50 border border-red-200 px-2 py-1">
                          {state.errorMsg}
                        </p>
                      )}

                      {/* Validation report — Haiku QA pass rewrites */}
                      {state.status === "done" && state.validationReport && state.validationReport.length > 0 && (
                        <details className="mt-2 text-xs rounded border border-amber-200 bg-amber-50">
                          <summary className="px-2 py-1.5 cursor-pointer font-medium text-amber-900 hover:bg-amber-100/60 rounded">
                            🔍 {state.validationReport.length} generic {state.validationReport.length === 1 ? "tip" : "tips"} rewritten
                          </summary>
                          <ul className="px-3 py-2 space-y-2 max-h-64 overflow-y-auto">
                            {state.validationReport.map((change, i) => (
                              <li key={i} className="border-l-2 border-amber-300 pl-2">
                                <div className="text-[10px] uppercase tracking-wide text-amber-700">
                                  Score {change.score}/5 · {change.reason}
                                </div>
                                <div className="text-red-700 line-through text-[11px] mt-0.5">
                                  {change.original_tip}
                                </div>
                                {change.rewrite ? (
                                  <div className="text-emerald-800 text-[11px] mt-0.5">
                                    → {change.rewrite}
                                  </div>
                                ) : (
                                  <div className="text-muted-foreground italic text-[11px] mt-0.5">
                                    (deleted — couldn't be made specific)
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}

                      {/* Download + Preview buttons once done */}
                      {state.status === "done" && (state.htmlBlob || state.mdBlob) && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {state.htmlBlob && (
                            <button
                              onClick={() =>
                                downloadAs(
                                  `${letterFileStem(planSlug, pkg.type)}.html`,
                                  state.htmlBlob!,
                                  "text/html"
                                )
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border hover:bg-muted transition-colors"
                            >
                              ⬇ HTML
                            </button>
                          )}
                          {state.mdBlob && (
                            <button
                              onClick={() =>
                                downloadAs(
                                  `${letterFileStem(planSlug, pkg.type)}.md`,
                                  state.mdBlob!,   // already updated by "Apply edits"
                                  "text/markdown"
                                )
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border hover:bg-muted transition-colors"
                            >
                              ⬇ Markdown{state.editText && state.editText !== state.mdBlob ? " ✎" : ""}
                            </button>
                          )}
                          {/* Feature 1: Preview toggle */}
                          {state.htmlBlob && (
                            <button
                              onClick={() =>
                                setPreviewOpenFor(isPreviewOpen ? null : pkg.type)
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border hover:bg-muted transition-colors"
                              style={
                                isPreviewOpen
                                  ? { background: "rgba(43,45,66,0.08)", borderColor: "var(--brand-indigo, #2B2D42)" }
                                  : {}
                              }
                            >
                              {isPreviewOpen ? "✕ Close preview" : "👁 Preview"}
                            </button>
                          )}
                          {/* ✏️ Edit letter */}
                          {state.mdBlob && (
                            <button
                              onClick={() =>
                                setTypes((prev) => ({
                                  ...prev,
                                  [pkg.type]: {
                                    ...prev[pkg.type],
                                    editOpen: !prev[pkg.type].editOpen,
                                    editText: prev[pkg.type].editOpen
                                      ? prev[pkg.type].editText
                                      : (prev[pkg.type].editText ?? prev[pkg.type].mdBlob ?? ""),
                                  },
                                }))
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border hover:bg-muted transition-colors"
                              style={
                                state.editOpen
                                  ? { background: "rgba(232,168,124,0.15)", borderColor: "#E8A87C" }
                                  : {}
                              }
                            >
                              {state.editOpen ? "✕ Close editor" : "✏️ Edit"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ✏️ Inline markdown editor */}
                  {state.editOpen && (
                    <div className="px-3 pb-3 space-y-2">
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                        <span>✏️ Edit markdown — changes apply to your download. HTML preview reflects the original AI version.</span>
                      </div>
                      <textarea
                        rows={18}
                        value={state.editText ?? state.mdBlob ?? ""}
                        onChange={(e) =>
                          setTypes((prev) => ({
                            ...prev,
                            [pkg.type]: { ...prev[pkg.type], editText: e.target.value },
                          }))
                        }
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1"
                        spellCheck={false}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            setTypes((prev) => ({
                              ...prev,
                              [pkg.type]: {
                                ...prev[pkg.type],
                                mdBlob: prev[pkg.type].editText ?? prev[pkg.type].mdBlob,
                              },
                            }))
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-md border hover:bg-muted transition-colors"
                          style={{ borderColor: "#E8A87C", color: "#c47a3a" }}
                        >
                          💾 Apply edits to download
                        </button>
                        <button
                          onClick={() =>
                            setTypes((prev) => ({
                              ...prev,
                              [pkg.type]: {
                                ...prev[pkg.type],
                                editText: prev[pkg.type].mdBlob,
                              },
                            }))
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-3 py-1.5 rounded-md border hover:bg-muted transition-colors text-muted-foreground"
                        >
                          ↺ Reset
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Feature 1: Inline iframe preview */}
                  {isPreviewOpen && state.htmlBlob && (
                    <div className="px-3 pb-3">
                      <iframe
                        srcDoc={state.htmlBlob}
                        className="w-full border rounded-lg mt-2"
                        style={{ height: "500px" }}
                        title={`Preview: ${pkg.label}`}
                        sandbox="allow-same-origin"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Coach notes */}
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Coach notes (optional) — woven into all selected letters
            </label>
            <textarea
              rows={2}
              value={coachNotes}
              onChange={(e) => setCoachNotes(e.target.value)}
              placeholder="e.g. Soak methi seeds overnight and drink the water first thing. She can't tolerate raw salads — serve all veg lightly cooked."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1"
              disabled={isGenerating}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={handleGenerate}
              disabled={!anyChecked || isGenerating}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--brand-indigo, #2B2D42)" }}
            >
              {isGenerating ? (
                <>
                  <span className="animate-spin text-base">⏳</span>
                  Generating{checkedTypes.length > 1 ? ` (${checkedTypes.filter((p) => types[p.type].status === "done").length + 1}/${checkedTypes.length})` : ""}…
                </>
              ) : (
                <>📤 Generate {anyChecked ? `${checkedTypes.length} letter${checkedTypes.length !== 1 ? "s" : ""}` : "0 letters"}</>
              )}
            </button>

            {allDone && checkedTypes.length > 0 && (
              <span className="text-xs font-medium text-emerald-700">
                ✅ All generated — ready to share
              </span>
            )}

            <p className="text-[11px] text-muted-foreground">
              Each letter takes 2–3 min. Saved automatically for future downloads.
            </p>
          </div>

          {/* Feature 2: Email button + compose panel.
              Shown when at least one letter is generated. The recipient
              field is editable inside the panel — clientEmail (from
              client.yaml) just pre-fills it; if absent, the coach types
              one in manually. The earlier `allDone && clientEmail` gate
              was too strict — it hid the button whenever any checked
              type wasn't yet generated, or when no email was on file. */}
          {doneTypes.length > 0 && (
            <div
              className="rounded-lg border p-3 space-y-3"
              style={{ borderColor: "var(--brand-lavender, #8D99AE)", background: "white" }}
            >
              {!emailPanelOpen ? (
                <button
                  onClick={handleOpenEmailPanel}
                  className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg border transition-all hover:shadow-sm"
                  style={{
                    borderColor: "var(--brand-indigo, #2B2D42)",
                    color: "var(--brand-indigo, #2B2D42)",
                    background: "white",
                  }}
                >
                  📧 Email to client
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold" style={{ color: "var(--brand-indigo, #2B2D42)" }}>
                      📧 Compose email
                    </p>
                    <button
                      onClick={() => setEmailPanelOpen(false)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      ✕ Cancel
                    </button>
                  </div>

                  {/* To */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">To:</label>
                    <input
                      type="email"
                      value={emailTo}
                      onChange={(e) => setEmailTo(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
                      placeholder="client@example.com"
                    />
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Subject:</label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
                    />
                  </div>

                  {/* Intro message */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">Intro message:</label>
                    <textarea
                      rows={4}
                      value={emailIntro}
                      onChange={(e) => setEmailIntro(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1"
                    />
                  </div>

                  {/* Which letters to include */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground block mb-1">
                      Include letters:
                    </label>
                    <div className="space-y-1">
                      {doneTypes.map((pkg) => (
                        <label key={pkg.type} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={emailInclude[pkg.type]}
                            onChange={(e) =>
                              setEmailInclude((prev) => ({ ...prev, [pkg.type]: e.target.checked }))
                            }
                            className="rounded"
                          />
                          <span className="text-sm">
                            {pkg.emoji} {pkg.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Error */}
                  {emailError && (
                    <p className="text-xs text-red-600 rounded bg-red-50 border border-red-200 px-2 py-1">
                      {emailError}
                    </p>
                  )}

                  {/* Send button */}
                  <button
                    onClick={handleSendEmail}
                    disabled={isSendingEmail || !emailTo.trim() || doneTypes.filter((p) => emailInclude[p.type]).length === 0}
                    className="inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: "var(--brand-indigo, #2B2D42)" }}
                  >
                    {isSendingEmail ? (
                      <>
                        <span className="animate-spin text-base">⏳</span>
                        Sending…
                      </>
                    ) : (
                      <>📤 Send email</>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

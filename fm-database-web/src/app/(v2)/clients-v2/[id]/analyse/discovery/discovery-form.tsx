"use client";

/**
 * DiscoveryForm v2 — design C2 with full lab catalog.
 *
 * Lab panels: all 16 from src/lib/fmdb/lab-panels.ts (the same list the
 * legacy /clients/[id] discovery form uses). Each panel card:
 *   - Header chip toggles ALL labs in the panel on/off
 *   - Click body → expands inline list of labs with individual checkboxes,
 *     cost chip per lab (₹ / ₹₹ / ₹₹₹), and a "specialty" tag for
 *     labs that need a third-party FM provider (DUTCH, OAT, NMR, etc.)
 *   - Panel count badge updates as labs toggle
 *
 * 6 panels start pre-selected (DEFAULT_DISCOVERY_PANELS). Sex-specific
 * panels filter out when the client's sex doesn't match.
 *
 * Saves through saveSessionAction with session_type "discovery" and the
 * flat list of selected lab names as requested_labs.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSessionAction } from "@/lib/server-actions/assess";
import { SendDiscoveryLabsButton } from "../send-discovery-labs-button";
import {
  FmField,
  FmInput,
  FmTextarea,
  FmPillGroup,
  FmFormSection,
  type FmPillOption,
} from "@/components/fm";
import {
  LAB_PANELS,
  DEFAULT_DISCOVERY_PANELS,
  type LabPanel,
  type LabSex,
} from "@/lib/fmdb/lab-panels";
import { useFormDraft } from "@/lib/fmdb/use-form-draft";
import { FmFormDraftClear } from "@/components/fm";

const PRIMARY = "#B8770A";

const FOOD_JOURNAL: FmPillOption[] = [
  { value: "3", label: "3 days" },
  { value: "5", label: "5 days" },
  { value: "7", label: "7 days" },
];

const OUTCOMES: FmPillOption[] = [
  { value: "good_fit", label: "✅ Good fit · move to Intake", tint: "#1E8449" },
  { value: "needs_time", label: "🤔 Needs time to decide", tint: "#3a4250" },
  { value: "not_fit", label: "🚫 Not a fit", tint: "#E74C3C" },
];

export function DiscoveryForm({
  clientId,
  displayName,
  clientSex,
  clientEmail = null,
  prefillChiefConcern = "",
  prefillExtraPanels = [],
  prefillDetectionLabel = "",
  savedLabs = [],
}: {
  clientId: string;
  displayName: string;
  clientSex?: LabSex | null;
  clientEmail?: string | null;
  /** Draft chief concern composed from active_conditions + notes + goals
   *  on the client.yaml. Coach edits freely; serves as a "save me the
   *  re-typing" starting point. */
  prefillChiefConcern?: string;
  /** Lab panel groups derived from condition keywords (Thyroid →
   *  Thyroid Function; Insulin Resistance → Blood Sugar & Insulin; etc.) —
   *  merged with DEFAULT_DISCOVERY_PANELS for the initial selection. */
  prefillExtraPanels?: string[];
  /** Plain-English summary of what was pre-filled, surfaced in a banner
   *  above the form. */
  prefillDetectionLabel?: string;
  /** requested_labs from the most-recent saved discovery session, if any.
   *  When non-empty this is the SINGLE SOURCE OF TRUTH for the initial
   *  selection — the form hydrates from it instead of the condition→panel
   *  prefill, so the checkboxes here, the saved session, and the Overview
   *  "send labs" card never diverge. The prefill only seeds a brand-new
   *  discovery that has never been saved. */
  savedLabs?: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  // After save lands, we keep the coach on this page (not redirect to
  // /analyse) and show a clear "saved — what next?" success screen with
  // the Send labs CTAs front-and-centre. The redirect was hiding the
  // fact that the labs are SAVED but NOT YET SENT until the coach hits
  // 📧 / 💬 on the lab-list buttons.
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [savedLabCount, setSavedLabCount] = useState<number>(0);

  // Date of the discovery call — defaults to today; coach can change if
  // she's logging a past call. Whatever's in this field is what gets
  // saved to session_date.
  const [sessionDate, setSessionDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  // Chief concern starts pre-filled from the intake data; coach edits
  // freely. The draft restore (useFormDraft) will overwrite this if a
  // saved in-progress draft exists for this client.
  const [chiefConcern, setChiefConcern] = useState(prefillChiefConcern);
  const [clientWords, setClientWords] = useState("");
  const [foodDays, setFoodDays] = useState<string>("7");
  const [outcome, setOutcome] = useState<string>("good_fit");
  // Auto-expand any panels added by the condition→panel mapper so the
  // coach can see what was added at a glance (rather than having to spot
  // a count-badge change on a collapsed card).
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(
    // Standard Lab Panels (the bundles) open by default — it's the primary
    // section; plus any panels the condition→panel mapper added.
    () => new Set(["Standard Lab Panels", ...prefillExtraPanels]),
  );

  // Filter to panels relevant for this client's sex (if known).
  const visiblePanels = useMemo(
    () =>
      LAB_PANELS.filter((p) => !p.sex || !clientSex || p.sex === clientSex),
    [clientSex],
  );

  // Selected lab names — flat set across panels. The initial set is the
  // union of DEFAULT_DISCOVERY_PANELS + any extra panels suggested by the
  // condition→panel mapper (Thyroid → Thyroid Function etc.) so a client
  // who already has active_conditions on file gets the right panel set
  // pre-ticked instead of the generic default.
  const initialLabs = useMemo(() => {
    // Single source of truth: a saved discovery session's requested_labs
    // wins over the condition→panel prefill. Hydrate verbatim so the
    // checkboxes mirror exactly what's on the saved session (and what the
    // Overview "send labs" card will send). The prefill below only seeds a
    // discovery that has never been saved.
    if (savedLabs.length > 0) return new Set(savedLabs);
    const includeGroups = new Set<string>([
      ...DEFAULT_DISCOVERY_PANELS,
      ...prefillExtraPanels,
    ]);
    const out = new Set<string>();
    for (const p of visiblePanels) {
      const groupDefault = includeGroups.has(p.group);
      for (const l of p.labs) {
        if (l.sex && clientSex && l.sex !== clientSex) continue;
        // Per-item default (the standard bundles — KFT, LFT, …) is pre-ticked
        // on every fresh discovery regardless of group.
        if (l.default) {
          out.add(l.name);
          continue;
        }
        // Group-level default: pick the group's non-specialty markers (the FM
        // core — insulin/HOMA-IR, hsCRP — plus any condition-matched panels).
        if (groupDefault && !l.specialty) out.add(l.name);
      }
    }
    return out;
  }, [visiblePanels, clientSex, prefillExtraPanels, savedLabs]);
  const [selectedLabs, setSelectedLabs] = useState<Set<string>>(initialLabs);

  // The lab selection and the call date are deliberately NOT persisted in the
  // localStorage draft.
  //
  // - Labs: their single source of truth is the saved discovery session
  //   (the `savedLabs` prop, read back by created_at recency). Routing the
  //   selection through the draft is what re-introduced the "my marker edits
  //   reset on reopen" bug — a stale draft re-hydrated OVER the freshly-saved
  //   server list. With labs out of the draft, savedLabs always wins.
  // - Date: always defaults to today on a fresh open. A stale restored date
  //   was landing saves on the wrong calendar day (e.g. yesterday), which the
  //   recency read-back then masked.
  //
  // The draft now only protects the genuinely re-typed free-text fields.
  // Key bumped v3 → v4 so any lingering v3 draft (which still carries stale
  // labs/date under a signature-based key) is discarded on first load.
  const draftKey = `fm-discovery-draft-v4-${clientId}`;
  const { clearDraft, hasSavedDraft } = useFormDraft(
    draftKey,
    { chiefConcern, clientWords, foodDays, outcome },
    {
      chiefConcern: setChiefConcern,
      clientWords: setClientWords,
      foodDays: setFoodDays,
      outcome: setOutcome,
    },
  );

  const togglePanel = (group: string) =>
    setExpandedPanels((s) => {
      const next = new Set(s);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const toggleLab = (name: string) =>
    setSelectedLabs((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const togglePanelAll = (p: LabPanel) => {
    const relevant = p.labs.filter(
      (l) => !l.sex || !clientSex || l.sex === clientSex,
    );
    const allOn = relevant.every((l) => selectedLabs.has(l.name));
    setSelectedLabs((s) => {
      const next = new Set(s);
      for (const l of relevant) {
        if (allOn) next.delete(l.name);
        else next.add(l.name);
      }
      return next;
    });
  };

  // Per-panel counts
  function panelStats(p: LabPanel) {
    const relevant = p.labs.filter(
      (l) => !l.sex || !clientSex || l.sex === clientSex,
    );
    const selected = relevant.filter((l) => selectedLabs.has(l.name)).length;
    return { selected, total: relevant.length };
  }

  const totalLabs = selectedLabs.size;
  const panelsTouched = visiblePanels.filter(
    (p) => panelStats(p).selected > 0,
  ).length;

  const onSave = () => {
    // No chief-concern gate: the data already lives on client.yaml
    // (active_conditions + notes + goals) and was pre-filled into this
    // textarea on mount. If the coach has cleared it or hasn't added
    // anything new, we still save — the discovery session is meaningful
    // even when the only intake-time concern is what's on the client
    // record.
    start(async () => {
      const outcomeLabel =
        OUTCOMES.find((o) => o.value === outcome)?.label ?? outcome;
      const concern = chiefConcern.trim();
      const summary = [
        concern ? `Chief concern: ${concern}` : "Chief concern: (see client profile — active conditions + notes)",
        clientWords.trim() ? `In client's words: ${clientWords.trim()}` : "",
        `Food journal requested: ${foodDays} days`,
        `Outcome: ${outcomeLabel}`,
        totalLabs > 0
          ? `Labs requested (${totalLabs} markers across ${panelsTouched} panels):\n${[...selectedLabs].map((l) => "  • " + l).join("\n")}`
          : "No labs ordered",
      ]
        .filter(Boolean)
        .join("\n");
      // presenting_complaints field gets the chief concern when provided,
      // else a hint pointing the reader at the client profile.
      const presenting = concern
        ? `[session_type: discovery_consultation] ${concern}`
        : `[session_type: discovery_consultation] (See client profile for active conditions + notes)`;

      try {
        const result = await saveSessionAction({
          client_id: clientId,
          session_type: "discovery",
          session_date: sessionDate,
          coach_notes: summary,
          presenting_complaints: presenting,
          requested_labs: [...selectedLabs],
        });
        if (result.ok) {
          clearDraft();
          toast.success(
            `Discovery saved for ${displayName.split(" ")[0]} — now send labs ↓`,
          );
          // Hand off to the in-form success screen so the coach sees
          // clearly that the labs are saved + still needs to be SENT.
          setSavedSessionId(result.session_id ?? null);
          setSavedLabCount(totalLabs);
          // Refresh server data (sessions list) in the background — coach
          // can still navigate away via the success screen's back link.
          router.refresh();
        } else {
          console.error("saveSessionAction returned error:", result);
          toast.error(result.error ?? "Save failed — see browser console", {
            duration: 8000,
          });
        }
      } catch (err) {
        console.error("saveSessionAction threw:", err);
        toast.error(
          `Save failed: ${err instanceof Error ? err.message : String(err)}`,
          { duration: 8000 },
        );
      }
    });
  };

  // ── Post-save success screen ────────────────────────────────────────
  // Replaces the form once a save succeeds. The Send labs buttons live
  // ON THIS PAGE so it's obvious the labs are saved-but-not-yet-sent —
  // not buried under a redirect-and-toast.
  if (savedSessionId) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div
          style={{
            padding: "20px 22px",
            background:
              "linear-gradient(135deg, rgba(30, 132, 73, 0.12), rgba(30, 132, 73, 0.04))",
            border: "1px solid rgba(30, 132, 73, 0.45)",
            borderRadius: "var(--fm-radius-md)",
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              marginBottom: 4,
              color: "#1E8449",
            }}
          >
            ✅ Discovery saved for {displayName.split(" ")[0]}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--fm-text-secondary)",
              lineHeight: 1.55,
            }}
          >
            Session <code style={{ fontSize: 12 }}>{savedSessionId}</code> is
            on file with <strong>{savedLabCount} lab marker
            {savedLabCount === 1 ? "" : "s"}</strong> queued.
          </div>
        </div>

        {savedLabCount > 0 && (
          <div
            style={{
              padding: "16px 18px",
              background: "var(--fm-surface)",
              border: "2px solid var(--fm-primary)",
              borderRadius: "var(--fm-radius-md)",
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              🔬 Send the lab list to {displayName.split(" ")[0]}
            </div>
            <p
              style={{
                fontSize: 13,
                color: "var(--fm-text-secondary)",
                margin: "0 0 12px",
                lineHeight: 1.55,
              }}
            >
              Labs are <strong>saved but not yet sent</strong>. Pick a channel
              below — preview first if you want to review before it goes out.
            </p>
            <SendDiscoveryLabsButton
              sessionId={savedSessionId}
              clientId={clientId}
              clientEmail={clientEmail}
              labCount={savedLabCount}
            />
          </div>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              setSavedSessionId(null);
              setSavedLabCount(0);
              // Re-fetch server data so the savedLabs prop (and therefore the
              // checkboxes) reflect the session we just saved, not the value
              // captured at the original page load.
              router.refresh();
            }}
            style={{
              padding: "8px 14px",
              background: "var(--fm-surface)",
              color: "var(--fm-text-primary)",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ↩︎ Edit discovery again
          </button>
          <button
            type="button"
            onClick={() => router.push(`/clients-v2/${clientId}/analyse`)}
            style={{
              padding: "8px 14px",
              background: PRIMARY,
              color: "#fff",
              border: 0,
              borderRadius: "var(--fm-radius-sm)",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Done · back to Analyse →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Pre-fill banner ──────────────────────────────────────────
          When the coach already entered active_conditions / notes / goals
          while creating the client, we pre-fill the chief concern textarea
          AND pre-tick the relevant lab panels (Thyroid → Thyroid Function,
          Insulin Resistance → Blood Sugar & Insulin, etc.). The banner
          tells the coach what was pulled in + from where so nothing
          happens silently. */}
      {prefillDetectionLabel && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            background:
              "linear-gradient(135deg, rgba(184, 119, 10, 0.10), rgba(184, 119, 10, 0.03))",
            border: "1px solid rgba(184, 119, 10, 0.35)",
            borderRadius: "var(--fm-radius-md)",
            fontSize: 12,
            color: "var(--fm-text-primary)",
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 16 }}>✨</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>Pre-filled from {displayName.split(" ")[0]}&apos;s intake</strong>
            {" — "}
            <span style={{ color: "var(--fm-text-secondary)" }}>
              {prefillDetectionLabel}. Chief concern + lab panels below
              reflect what you already captured. Edit anything before saving.
            </span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <FmFormDraftClear
          onClear={() => {
            // Clear reverts to the intake-derived prefill (not blank) so
            // the coach doesn't have to re-type fields she's already
            // captured during client creation.
            setChiefConcern(prefillChiefConcern);
            setClientWords("");
            setFoodDays("7");
            setOutcome("good_fit");
            setSelectedLabs(new Set(initialLabs));
            clearDraft();
          }}
          hasDraft={hasSavedDraft}
          title="Clear every field and discard the saved in-progress draft"
        />
      </div>
      <FmFormSection
        title="Chief concern"
        description="Pre-filled from the active conditions + notes you captured at intake. Add anything new from today's call — or leave as-is and save."
      >
        <FmField
          label="Date of call"
          hint="Defaults to today — change if you're logging a past call. This date is what shows as 'Last contact'."
        >
          {({ id }) => (
            <FmInput
              id={id}
              type="date"
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
              style={{ maxWidth: 200 }}
            />
          )}
        </FmField>
        <FmField label="Coach summary">
          {({ id }) => (
            <FmTextarea
              id={id}
              value={chiefConcern}
              onChange={(e) => setChiefConcern(e.target.value)}
              placeholder="e.g. Fatigue + 6 kg unintentional weight gain over 9 months. Foggy in afternoon. Cycles still regular but heavier."
              rows={3}
              minLength={1}
            />
          )}
        </FmField>
        <FmField
          label="In client's words"
          hint="optional — direct quote helps the Intake call"
        >
          {({ id }) => (
            <FmTextarea
              id={id}
              value={clientWords}
              onChange={(e) => setClientWords(e.target.value)}
              placeholder={`"My energy crashes around 3 pm. I used to work out 4× a week, now I can barely manage walks."`}
              rows={3}
            />
          )}
        </FmField>
      </FmFormSection>

      <FmFormSection
        title={`Lab order · ${totalLabs} selected`}
        description="Standard bundles (KFT, LFT, Lipid Profile, CBC…) come first — each shows the tests it includes. FM-specific add-on markers follow. Header chip toggles a whole group; checkbox toggles per item. ₹ / ₹₹ / ₹₹₹ = cost band. ★ = specialty (third-party FM lab)."
      >
        <div style={{ display: "grid", gap: 8 }}>
          {visiblePanels.map((p) => {
            const stats = panelStats(p);
            const expanded = expandedPanels.has(p.group);
            const allOn = stats.selected === stats.total && stats.total > 0;
            const someOn = stats.selected > 0 && !allOn;
            return (
              <div
                key={p.group}
                style={{
                  border: `1.5px solid ${
                    allOn ? PRIMARY : someOn ? `${PRIMARY}80` : "var(--fm-border-light)"
                  }`,
                  borderRadius: "var(--fm-radius-md)",
                  background: allOn || someOn ? `${PRIMARY}08` : "var(--fm-surface)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => togglePanelAll(p)}
                    title={allOn ? "Clear panel" : "Select all in panel"}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      background: "transparent",
                      border: 0,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{p.icon}</span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: allOn || someOn ? PRIMARY : "var(--fm-text-primary)",
                      }}
                    >
                      {p.group}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--fm-text-tertiary)",
                        fontWeight: 600,
                      }}
                    >
                      {stats.selected}/{stats.total}
                    </span>
                  </button>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => togglePanel(p.group)}
                    style={{
                      fontSize: 12,
                      color: "var(--fm-text-secondary)",
                      background: "transparent",
                      border: "1px solid var(--fm-border)",
                      padding: "4px 10px",
                      borderRadius: "var(--fm-radius-sm)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontWeight: 600,
                    }}
                  >
                    {expanded ? "Hide" : "Show"} labs
                    <span
                      style={{
                        marginLeft: 4,
                        fontSize: 10,
                        display: "inline-block",
                        transform: expanded ? "rotate(180deg)" : "none",
                        transition: "transform 160ms",
                      }}
                    >
                      ▾
                    </span>
                  </button>
                </div>
                {expanded && (
                  <div
                    style={{
                      padding: "0 12px 12px",
                      display: "grid",
                      // Bundle items carry a component sub-line, so give them a
                      // single full-width column; plain markers stay 2-up.
                      gridTemplateColumns: p.labs.some((l) => l.components)
                        ? "1fr"
                        : "1fr 1fr",
                      gap: 4,
                    }}
                  >
                    {p.labs
                      .filter((l) => !l.sex || !clientSex || l.sex === clientSex)
                      .map((l) => {
                        const on = selectedLabs.has(l.name);
                        return (
                          <button
                            key={l.name}
                            type="button"
                            onClick={() => toggleLab(l.name)}
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 8,
                              padding: "6px 10px",
                              background: on
                                ? "var(--fm-surface)"
                                : "transparent",
                              border: `1px solid ${on ? PRIMARY : "var(--fm-border-light)"}`,
                              borderRadius: "var(--fm-radius-sm)",
                              cursor: "pointer",
                              fontFamily: "inherit",
                              textAlign: "left",
                              fontSize: 12,
                            }}
                          >
                            <span
                              style={{
                                width: 14,
                                height: 14,
                                borderRadius: 3,
                                border: `1.5px solid ${on ? PRIMARY : "var(--fm-border)"}`,
                                background: on ? PRIMARY : "transparent",
                                color: "#fff",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 9,
                                fontWeight: 700,
                                flexShrink: 0,
                                marginTop: 1,
                              }}
                            >
                              {on && "✓"}
                            </span>
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                display: "flex",
                                flexDirection: "column",
                                gap: 2,
                              }}
                            >
                              <span
                                style={{
                                  color: on
                                    ? "var(--fm-text-primary)"
                                    : "var(--fm-text-secondary)",
                                  fontWeight: on ? 600 : 500,
                                }}
                              >
                                {l.icon ? `${l.icon} ` : ""}
                                {l.name}
                              </span>
                              {l.components && l.components.length > 0 && (
                                <span
                                  title={l.components.join(", ")}
                                  style={{
                                    fontSize: 10,
                                    color: "var(--fm-text-tertiary)",
                                    lineHeight: 1.3,
                                  }}
                                >
                                  incl. {l.components.slice(0, 3).join(" · ")}
                                  {l.components.length > 3
                                    ? ` +${l.components.length - 3} more`
                                    : ""}
                                </span>
                              )}
                            </span>
                            {l.specialty && (
                              <span
                                title="Specialty — third-party FM lab"
                                style={{
                                  fontSize: 10,
                                  color: "#5a3fb0",
                                  fontWeight: 700,
                                }}
                              >
                                ★
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: 10,
                                color: "var(--fm-text-tertiary)",
                                fontWeight: 600,
                                fontFamily: "var(--fm-font-mono)",
                              }}
                            >
                              {l.cost}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Manual / custom lab entry — escape hatch for any test that
            isn't in our 16-panel catalogue. Coach types the lab name +
            optional inline note, hit Enter, lands as a custom marker
            in the requested_labs list with a "(custom)" suffix so the
            audit trail is obvious. */}
        <CustomLabInput
          onAdd={(name) => {
            const tagged = `${name} (custom)`;
            setSelectedLabs((prev) => new Set([...prev, tagged]));
          }}
          existing={selectedLabs}
        />

        <div
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            display: "flex",
            justifyContent: "space-between",
            borderTop: "1px dashed var(--fm-border-light)",
            paddingTop: 8,
            marginTop: 4,
          }}
        >
          <span>
            {panelsTouched} group{panelsTouched === 1 ? "" : "s"} touched ·{" "}
            {totalLabs} test{totalLabs === 1 ? "" : "s"} selected
          </span>
          <span style={{ fontWeight: 700, color: "var(--fm-text-secondary)" }}>
            Home draw available · client books direct with Thyrocare
          </span>
        </div>
      </FmFormSection>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <FmFormSection title="Food journal duration">
          <FmField
            label="Days"
            hint="7 captures weekend variability — recommended for hormonal cases"
          >
            {() => (
              <FmPillGroup
                options={FOOD_JOURNAL}
                value={foodDays}
                onChange={(v) => setFoodDays(v)}
              />
            )}
          </FmField>
        </FmFormSection>
        <FmFormSection title="Discovery outcome">
          <FmField label="Coach call">
            {() => (
              <FmPillGroup
                options={OUTCOMES}
                value={outcome}
                onChange={(v) => setOutcome(v)}
              />
            )}
          </FmField>
        </FmFormSection>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          padding: "12px 0",
        }}
      >
        <button
          type="button"
          onClick={() => router.push(`/clients-v2/${clientId}/analyse`)}
          style={{
            padding: "8px 14px",
            background: "var(--fm-surface)",
            color: "var(--fm-text-primary)",
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          style={{
            padding: "8px 16px",
            background: PRIMARY,
            color: "#fff",
            border: 0,
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            fontWeight: 700,
            cursor: pending ? "wait" : "pointer",
            fontFamily: "inherit",
            opacity: pending ? 0.6 : 1,
          }}
          title="Save the discovery session and lab list"
        >
          {pending ? "Saving…" : "💾 Save discovery & order labs →"}
        </button>
      </div>
    </div>
  );
}

/**
 * CustomLabInput — text-input affordance below the panel grid for any
 * lab that's NOT in our catalogue. Enter or click "Add" appends as
 * "<name> (custom)" so the suffix marks it as outside the standard
 * panel set. Prevents duplicates against the existing selected set
 * (case-insensitive match).
 */
function CustomLabInput({
  onAdd,
  existing,
}: {
  onAdd: (name: string) => void;
  existing: Set<string>;
}) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const duplicate =
    !!trimmed &&
    [...existing].some(
      (e) => e.toLowerCase().replace(/\s*\(custom\)$/i, "") === trimmed.toLowerCase(),
    );
  const valid = trimmed.length >= 2 && !duplicate;

  const submit = () => {
    if (!valid) return;
    onAdd(trimmed);
    setValue("");
  };

  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px",
        background: "var(--fm-bg-warm)",
        border: "1px dashed var(--fm-border)",
        borderRadius: "var(--fm-radius-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--fm-text-secondary)" }}>
          ➕ Add a custom lab (not in the panels above)
        </span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="e.g. Antibody panel — anti-TPO IgG / oxLDL / Folate (Serum)"
          style={{
            flex: 1,
            padding: "7px 10px",
            fontSize: 12,
            border: "1px solid var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            fontFamily: "inherit",
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!valid}
          style={{
            padding: "7px 14px",
            fontSize: 12,
            fontWeight: 700,
            background: valid ? "var(--fm-primary)" : "var(--fm-border-light)",
            color: valid ? "#fff" : "var(--fm-text-tertiary)",
            border: 0,
            borderRadius: "var(--fm-radius-sm)",
            cursor: valid ? "pointer" : "not-allowed",
            fontFamily: "inherit",
          }}
        >
          Add
        </button>
      </div>
      {duplicate && (
        <div style={{ fontSize: 11, color: "#c0392b", marginTop: 4 }}>
          Already on the list
        </div>
      )}
    </div>
  );
}

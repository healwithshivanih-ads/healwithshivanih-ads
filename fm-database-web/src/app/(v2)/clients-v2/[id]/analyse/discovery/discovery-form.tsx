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
import { saveSessionAction } from "@/app/assess/actions";
import {
  FmField,
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
}: {
  clientId: string;
  displayName: string;
  clientSex?: LabSex | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [chiefConcern, setChiefConcern] = useState("");
  const [clientWords, setClientWords] = useState("");
  const [foodDays, setFoodDays] = useState<string>("7");
  const [outcome, setOutcome] = useState<string>("good_fit");
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set());

  // Filter to panels relevant for this client's sex (if known).
  const visiblePanels = useMemo(
    () =>
      LAB_PANELS.filter((p) => !p.sex || !clientSex || p.sex === clientSex),
    [clientSex],
  );

  // Selected lab names — flat set across panels.
  const initialLabs = useMemo(() => {
    const out = new Set<string>();
    for (const p of visiblePanels) {
      if (DEFAULT_DISCOVERY_PANELS.has(p.group)) {
        for (const l of p.labs) {
          // Default: pick everything in default panels EXCEPT specialty +
          // sex-mismatch labs. Coach can toggle on individual specialty
          // labs from the expanded view.
          if (l.specialty) continue;
          if (l.sex && clientSex && l.sex !== clientSex) continue;
          out.add(l.name);
        }
      }
    }
    return out;
  }, [visiblePanels, clientSex]);
  const [selectedLabs, setSelectedLabs] = useState<Set<string>>(initialLabs);

  // Persist a serialisable mirror of selectedLabs so the draft survives reloads.
  // Set<string> doesn't roundtrip through JSON, so we use a derived array.
  const selectedLabsArr = useMemo(() => [...selectedLabs], [selectedLabs]);
  const setSelectedLabsArr = (arr: string[]) => setSelectedLabs(new Set(arr));

  const { clearDraft, hasSavedDraft } = useFormDraft(
    `fm-discovery-draft-${clientId}`,
    { chiefConcern, clientWords, foodDays, outcome, selectedLabsArr },
    {
      chiefConcern: setChiefConcern,
      clientWords: setClientWords,
      foodDays: setFoodDays,
      outcome: setOutcome,
      selectedLabsArr: setSelectedLabsArr,
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
    if (!chiefConcern.trim()) {
      toast.error("Add a chief concern first");
      return;
    }
    start(async () => {
      const outcomeLabel =
        OUTCOMES.find((o) => o.value === outcome)?.label ?? outcome;
      const summary = [
        `Chief concern: ${chiefConcern.trim()}`,
        clientWords.trim() ? `In client's words: ${clientWords.trim()}` : "",
        `Food journal requested: ${foodDays} days`,
        `Outcome: ${outcomeLabel}`,
        totalLabs > 0
          ? `Labs requested (${totalLabs} markers across ${panelsTouched} panels):\n${[...selectedLabs].map((l) => "  • " + l).join("\n")}`
          : "No labs ordered",
      ]
        .filter(Boolean)
        .join("\n");

      const result = await saveSessionAction({
        client_id: clientId,
        session_type: "discovery",
        coach_notes: summary,
        presenting_complaints: `[session_type: discovery_consultation] ${chiefConcern.trim()}`,
        requested_labs: [...selectedLabs],
      });
      if (result.ok) {
        clearDraft();
        toast.success(
          `Discovery saved for ${displayName.split(" ")[0]} — ${totalLabs} labs queued`,
        );
        router.push(`/clients-v2/${clientId}/analyse`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Save failed");
      }
    });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <FmFormDraftClear
          onClear={() => {
            setChiefConcern("");
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
        description="What brought them in today? Single paragraph is enough."
      >
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
        title={`Recommended lab panel · ${totalLabs} of all selected`}
        description="Click any panel to expand. Header chip toggles the whole panel; checkbox toggles per lab. ₹ / ₹₹ / ₹₹₹ indicates cost band. ★ specialty labs need a third-party FM provider."
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
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: allOn || someOn ? PRIMARY : "var(--fm-text-primary)",
                      }}
                    >
                      {p.group}
                    </span>
                    <span
                      style={{
                        fontSize: 10.5,
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
                      fontSize: 11.5,
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
                      gridTemplateColumns: "1fr 1fr",
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
                              alignItems: "center",
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
                              fontSize: 11.5,
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
                              }}
                            >
                              {on && "✓"}
                            </span>
                            <span
                              style={{
                                flex: 1,
                                color: on
                                  ? "var(--fm-text-primary)"
                                  : "var(--fm-text-secondary)",
                                fontWeight: on ? 600 : 500,
                              }}
                            >
                              {l.name}
                            </span>
                            {l.specialty && (
                              <span
                                title="Specialty — third-party FM lab"
                                style={{
                                  fontSize: 9.5,
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
            fontSize: 10.5,
            color: "var(--fm-text-tertiary)",
            display: "flex",
            justifyContent: "space-between",
            borderTop: "1px dashed var(--fm-border-light)",
            paddingTop: 8,
            marginTop: 4,
          }}
        >
          <span>
            {panelsTouched} panel{panelsTouched === 1 ? "" : "s"} touched ·{" "}
            {totalLabs} marker{totalLabs === 1 ? "" : "s"} total
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
          disabled={pending || !chiefConcern.trim()}
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
        <div style={{ fontSize: 10.5, color: "#c0392b", marginTop: 4 }}>
          Already on the list
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * DiscoveryForm v2 — curated FM lab panel + food journal duration +
 * chief concern + outcome chip.
 *
 * Per design C2. Wraps saveSessionAction with session_type "discovery".
 * The chosen labs are passed as requested_labs so the dashboard
 * "labs_pending" signal can pick the client up after Discovery.
 *
 * Lab catalog is a curated subset of the 15-panel legacy LAB_PANELS list —
 * the 6 most-common FM panels for first-touch labs. Coach falls through
 * to legacy for niche panels (DUTCH, OAT, NMR lipoprofile etc.) until
 * Phase 3.5 ports the full catalog.
 */
import { useState, useTransition } from "react";
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

const PRIMARY = "#B8770A";

// 6 curated FM panels. Each label = group · count of labs included.
const LAB_PANELS = [
  {
    id: "thyroid",
    label: "🦋 Thyroid full",
    labs: ["TSH", "Free T3", "Free T4", "Reverse T3", "TPO Antibodies", "Thyroglobulin Antibodies"],
  },
  {
    id: "metabolic",
    label: "🍬 Metabolic / IR",
    labs: ["Fasting Glucose", "Fasting Insulin", "HbA1c", "Triglycerides"],
  },
  {
    id: "inflammation",
    label: "🔥 Inflammation",
    labs: ["hsCRP", "Homocysteine", "ESR", "Ferritin"],
  },
  {
    id: "lipid",
    label: "💧 Lipid full + ApoB",
    labs: ["Total Cholesterol", "LDL-C", "HDL-C", "Triglycerides", "ApoB", "Lp(a)"],
  },
  {
    id: "nutrients",
    label: "🌱 Core nutrients",
    labs: ["Vitamin D (25-OH)", "Vitamin B12", "RBC Folate", "Ferritin", "Serum Iron", "TIBC"],
  },
  {
    id: "hpa",
    label: "⚡ HPA + adrenal",
    labs: ["AM Cortisol", "PM Cortisol", "DHEA-S"],
  },
] as const;

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
}: {
  clientId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [chiefConcern, setChiefConcern] = useState("");
  const [clientWords, setClientWords] = useState("");
  const [panels, setPanels] = useState<string[]>(["thyroid", "metabolic", "nutrients"]);
  const [foodDays, setFoodDays] = useState<string>("7");
  const [outcome, setOutcome] = useState<string>("good_fit");

  const togglePanel = (id: string) =>
    setPanels((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  // Flatten selected panels into the lab name list saved on the session.
  const selectedLabs = LAB_PANELS.flatMap((p) =>
    panels.includes(p.id) ? p.labs : [],
  );
  const labsCount = selectedLabs.length;
  const panelsCount = panels.length;

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
        labsCount > 0
          ? `Labs requested: ${labsCount} markers across ${panelsCount} panels (${panels.join(", ")})`
          : "No labs ordered",
      ]
        .filter(Boolean)
        .join("\n");

      const result = await saveSessionAction({
        client_id: clientId,
        session_type: "discovery",
        coach_notes: summary,
        presenting_complaints: `[session_type: discovery_consultation] ${chiefConcern.trim()}`,
        requested_labs: selectedLabs,
      });
      if (result.ok) {
        toast.success(`Discovery saved for ${displayName.split(" ")[0]} — ${labsCount} labs queued`);
        router.push(`/clients-v2/${clientId}/analyse`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Save failed");
      }
    });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 0 }}>
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
              placeholder={`"My energy crashes around 3pm. I used to work out 4x a week, now I can barely manage walks."`}
              rows={3}
            />
          )}
        </FmField>
      </FmFormSection>

      <FmFormSection
        title="Recommended lab panel"
        description="Pick the FM panels for this client's case. Client books direct with Thyrocare; we don't route payment for labs."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {LAB_PANELS.map((p) => {
            const sel = panels.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePanel(p.id)}
                style={{
                  padding: "8px 12px",
                  borderRadius: "var(--fm-radius-md)",
                  border: `1.5px solid ${sel ? PRIMARY : "var(--fm-border-light)"}`,
                  background: sel ? `${PRIMARY}10` : "var(--fm-surface)",
                  color: sel ? PRIMARY : "var(--fm-text-secondary)",
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
                title={p.labs.join(" · ")}
              >
                {p.label}
                <span style={{ marginLeft: 6, fontSize: 9.5, opacity: 0.7 }}>
                  · {p.labs.length} markers
                </span>
              </button>
            );
          })}
        </div>
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
            {panelsCount} panel{panelsCount === 1 ? "" : "s"} selected · {labsCount}{" "}
            marker{labsCount === 1 ? "" : "s"} total
          </span>
          <span style={{ fontWeight: 700, color: "var(--fm-text-secondary)" }}>
            Home draw available · ₹3k–5k typical
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
          style={btnStyle("ghost")}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !chiefConcern.trim()}
          style={{
            ...btnStyle("primary"),
            background: PRIMARY,
            borderColor: PRIMARY,
          }}
        >
          {pending ? "Saving…" : "💾 Save discovery & order labs →"}
        </button>
      </div>
    </div>
  );
}

function btnStyle(kind: "primary" | "ghost"): React.CSSProperties {
  if (kind === "ghost") {
    return {
      padding: "8px 14px",
      background: "var(--fm-surface)",
      color: "var(--fm-text-primary)",
      border: "1px solid var(--fm-border)",
      borderRadius: "var(--fm-radius-sm)",
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
      fontFamily: "inherit",
    };
  }
  return {
    padding: "8px 16px",
    color: "#fff",
    border: 0,
    borderRadius: "var(--fm-radius-sm)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

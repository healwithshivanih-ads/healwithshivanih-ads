"use client";

/**
 * TriadDetectionBanner (v0.75.4) — detects when intake signals point to
 * the MCAS-POTS-EDS / long-COVID / mould-CIRS family of conditions and
 * surfaces a banner on the Full Assessment page.
 *
 * Detection rule: if 2 or more of these are positive →
 *   • MCAS:      histamine_signals ticked ≥ 3 (or "diagnosed MCAS" tick)
 *   • Beighton:  self-score ≥ 3 OR coach verified hypermobile=true
 *   • POTS:      coach-verified pots_pattern=true OR lean_test_symptoms ≥ 3
 *   • PEM:       pem_screen ticked ≥ 2
 *   • Mould:     mould_exposure ticked ≥ 2
 *
 * The banner surfaces the case + offers a one-click "Add the triad
 * topics to the AI's context" action — selecting:
 *   mast-cell-activation-syndrome
 *   postural-orthostatic-tachycardia-syndrome
 *   ehlers-danlos-hypermobility
 *   post-exertional-malaise-mecfs
 *
 * These are the v0.74 / v0.75 catalogue topics we added. The AI
 * synthesiser then biases toward triad-aware framing instead of treating
 * each finding in isolation.
 */
import { useMemo } from "react";

interface Props {
  histamineSignals?: string[];
  beightonSelfScore?: string[];
  leanTestSymptoms?: string[];
  pemScreen?: string[];
  mouldExposure?: string[];
  /** Coach-verified physical exam findings — overrides self-report when present. */
  physicalExamFindings?: Array<{
    kind: string;
    assessed_at?: string;
    result?: Record<string, unknown>;
  }>;
  /** Currently-selected topics; we don't re-add ones already there. */
  selectedTopics: string[];
  /** Append the suggested triad topic slugs to the current selection. */
  onAddTopics: (slugs: string[]) => void;
}

const TRIAD_TOPIC_SLUGS = [
  "mast-cell-activation-syndrome",
  "postural-orthostatic-tachycardia-syndrome",
  "ehlers-danlos-hypermobility",
  "post-exertional-malaise-mecfs",
];

export function TriadDetectionBanner({
  histamineSignals,
  beightonSelfScore,
  leanTestSymptoms,
  pemScreen,
  mouldExposure,
  physicalExamFindings,
  selectedTopics,
  onAddTopics,
}: Props) {
  const {
    show,
    positives,
    mcasHits,
    beightonHits,
    beightonVerifiedHypermobile,
    potsVerified,
    leanHits,
    pemHits,
    mouldHits,
  } = useMemo(() => {
    const h = histamineSignals ?? [];
    const b = beightonSelfScore ?? [];
    const l = leanTestSymptoms ?? [];
    const p = pemScreen ?? [];
    const m = mouldExposure ?? [];
    const findings = physicalExamFindings ?? [];

    // Coach-verified findings override self-report when present.
    const latestBeighton = findings
      .filter((f) => f.kind === "beighton")
      .sort((a, b2) => (b2.assessed_at ?? "").localeCompare(a.assessed_at ?? ""))[0];
    const latestLean = findings
      .filter((f) => f.kind === "nasa_lean_test")
      .sort((a, b2) => (b2.assessed_at ?? "").localeCompare(a.assessed_at ?? ""))[0];

    const beightonVerifiedHypermobile = Boolean(latestBeighton?.result?.hypermobile);
    const potsVerified = Boolean(latestLean?.result?.pots_pattern);

    const mcasHits = h.length;
    const beightonHits = b.length;
    const leanHits = l.filter((s) => s && s !== "felt completely fine").length;
    const pemHits = p.length;
    const mouldHits = m.length;

    const mcasPositive = mcasHits >= 3 || h.some((s) => s.toLowerCase().includes("mcas"));
    const beightonPositive = beightonHits >= 3 || beightonVerifiedHypermobile;
    const potsPositive = potsVerified || leanHits >= 3;
    const pemPositive = pemHits >= 2;
    const mouldPositive = mouldHits >= 2;

    const positives = [
      mcasPositive && "mcas",
      beightonPositive && "beighton",
      potsPositive && "pots",
      pemPositive && "pem",
      mouldPositive && "mould",
    ].filter(Boolean) as string[];

    return {
      show: positives.length >= 2,
      positives,
      mcasHits,
      beightonHits,
      beightonVerifiedHypermobile,
      potsVerified,
      leanHits,
      pemHits,
      mouldHits,
    };
  }, [histamineSignals, beightonSelfScore, leanTestSymptoms, pemScreen, mouldExposure, physicalExamFindings]);

  if (!show) return null;

  const alreadyAdded = TRIAD_TOPIC_SLUGS.every((s) => selectedTopics.includes(s));
  const toAdd = TRIAD_TOPIC_SLUGS.filter((s) => !selectedTopics.includes(s));

  const labelFor = (key: string) => {
    switch (key) {
      case "mcas":
        return `🔥 MCAS / histamine — ${mcasHits} signals ticked`;
      case "beighton":
        return beightonVerifiedHypermobile
          ? "🦋 Hypermobility — Beighton verified positive"
          : `🦋 Hypermobility — ${beightonHits}/5 self-ticked`;
      case "pots":
        return potsVerified
          ? "🩺 POTS — verified positive on NASA lean test"
          : `🩺 Orthostatic — ${leanHits} standing-tolerance symptoms`;
      case "pem":
        return `💥 PEM — ${pemHits} chips ticked (ME/CFS / long COVID pattern)`;
      case "mould":
        return `🏚 Mould / environmental — ${mouldHits} exposure markers`;
      default:
        return key;
    }
  };

  return (
    <div
      style={{
        padding: 14,
        background: "rgba(255, 107, 53, 0.07)",
        border: "1.5px solid rgba(255, 107, 53, 0.4)",
        borderRadius: "var(--fm-radius-md)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>🔬</span>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#9a3412" }}>
          Triad pattern detected — consider MCAS / POTS / EDS framing
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#7c2d12", lineHeight: 1.55 }}>
        {positives.length} of 5 intake signals are positive. The MCAS-POTS-EDS
        cluster commonly co-travels — addressing them as one connected pattern
        usually outperforms treating each in isolation.
      </div>
      <ul style={{ margin: 0, paddingLeft: 22, fontSize: 12, color: "#7c2d12", lineHeight: 1.6 }}>
        {positives.map((p) => (
          <li key={p}>{labelFor(p)}</li>
        ))}
      </ul>
      {alreadyAdded ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            background: "rgba(34, 197, 94, 0.12)",
            border: "1px solid rgba(34, 197, 94, 0.35)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 11.5,
            fontWeight: 600,
            color: "#15803d",
            width: "fit-content",
          }}
        >
          ✓ Triad topics already in your selection
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onAddTopics(toAdd)}
          style={{
            padding: "7px 14px",
            fontSize: 12,
            fontWeight: 700,
            background: "#ff6b35",
            color: "#fff",
            border: "none",
            borderRadius: "var(--fm-radius-sm)",
            cursor: "pointer",
            fontFamily: "inherit",
            width: "fit-content",
          }}
        >
          ✨ Add {toAdd.length} triad topic{toAdd.length === 1 ? "" : "s"} to AI context
        </button>
      )}
      <div style={{ fontSize: 10.5, color: "#9a3412", lineHeight: 1.5 }}>
        Topics added: {TRIAD_TOPIC_SLUGS.join(" · ")}. AI synthesiser will frame
        drivers + supplements + lifestyle around the triad rather than treating
        each finding in isolation.
      </div>
    </div>
  );
}

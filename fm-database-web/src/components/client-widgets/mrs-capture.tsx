"use client";

/**
 * MrsCapture — 11-item Menopause Rating Scale input, grouped into its three
 * subscales. Mirrors the pill-button style already used inline in the live
 * check-in form (`analyse/checkin/checkin-form.tsx`'s protein/lab buttons),
 * not the dead `FivePillarsCapture` component. Controlled — no local state.
 */
import {
  MRS_ITEMS,
  MRS_RATING_LABELS,
  type MenopauseRatingScaleData,
  type MrsSubscale,
} from "@/lib/fmdb/mrs-score";

const PRIMARY = "#1E8449";

const SUBSCALE_TITLES: Record<MrsSubscale, string> = {
  somaticVegetative: "Somato-vegetative",
  psychological: "Psychological",
  urogenital: "Urogenital",
};

interface Props {
  value: MenopauseRatingScaleData;
  onChange: (v: MenopauseRatingScaleData) => void;
}

export function MrsCapture({ value, onChange }: Props) {
  function set(key: keyof MenopauseRatingScaleData, v: number) {
    const current = value[key];
    // Re-clicking the selected rating clears it — same toggle-off
    // convention as the rest of the check-in form's pill buttons.
    const next = { ...value };
    if (current === v) {
      delete next[key];
    } else {
      next[key] = v;
    }
    onChange(next);
  }

  const subscales: MrsSubscale[] = ["somaticVegetative", "psychological", "urogenital"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {subscales.map((subscale) => (
        <div key={subscale}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--fm-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: 0.4,
              marginBottom: 6,
            }}
          >
            {SUBSCALE_TITLES[subscale]}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {MRS_ITEMS.filter((i) => i.subscale === subscale).map((item) => {
              const selected = value[item.key];
              return (
                <div
                  key={item.key}
                  style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--fm-text-secondary)",
                      minWidth: 220,
                      flex: "1 1 220px",
                    }}
                  >
                    {item.label}
                  </span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {MRS_RATING_LABELS.map((label, score) => {
                      const sel = selected === score;
                      return (
                        <button
                          key={score}
                          type="button"
                          title={label}
                          onClick={() => set(item.key, score)}
                          style={{
                            padding: "4px 9px",
                            borderRadius: "var(--fm-radius-pill)",
                            fontSize: 11,
                            fontWeight: 600,
                            background: sel ? PRIMARY : "var(--fm-surface)",
                            color: sel ? "#fff" : "var(--fm-text-secondary)",
                            border: sel
                              ? "1px solid transparent"
                              : "1px solid var(--fm-border-light)",
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {score}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

"use client";

/**
 * CoachRecommendationsPanel — quick, off-catalogue product/remedy tips the
 * coach wants the client to see in the app ("Aquaphor for dry lips").
 *
 * NOT a supplement (no dosing / schedule) and NOT catalogue-bound — just a
 * personal pick with an optional buy link. Writes straight into the live plan
 * (coach_recommendations[]) via editCoachRecommendation + audit, and re-stages
 * to the client app through the reconciler.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FmPanel } from "@/components/fm";
import { editCoachRecommendation } from "@/lib/server-actions/plan-lifecycle";

export interface CoachRecommendationRow {
  title: string;
  forWhat: string;
  note: string;
  buyUrl: string;
}

export function CoachRecommendationsPanel({
  planSlug,
  recommendations,
}: {
  planSlug: string;
  recommendations: CoachRecommendationRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [forWhat, setForWhat] = useState("");
  const [note, setNote] = useState("");
  const [buyUrl, setBuyUrl] = useState("");

  const inputStyle: React.CSSProperties = {
    fontSize: 11.5,
    padding: "5px 8px",
    border: "1px solid var(--fm-border)",
    borderRadius: "var(--fm-radius-sm)",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 9.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--fm-text-tertiary)",
    marginBottom: 2,
    display: "block",
  };

  const onAdd = () => {
    if (!title.trim()) {
      toast.error("Give the recommendation a name");
      return;
    }
    start(async () => {
      const r = await editCoachRecommendation(planSlug, {
        add: { title: title.trim(), forWhat: forWhat.trim(), note: note.trim(), buyUrl: buyUrl.trim() },
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`💡 ${title.trim()} added`);
      setTitle("");
      setForWhat("");
      setNote("");
      setBuyUrl("");
      setAdding(false);
      router.refresh();
    });
  };

  const onRemove = (i: number, name: string) => {
    start(async () => {
      const r = await editCoachRecommendation(planSlug, { removeIndex: i });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`🗑 ${name} removed`);
      router.refresh();
    });
  };

  return (
    <FmPanel
      title="💡 Quick recommendations"
      subtitle="Personal product / remedy tips for this client — shown in their app under “Shivani's picks”. Not supplements, not on a schedule."
    >
      <div style={{ display: "grid", gap: 8 }}>
        {recommendations.length === 0 && !adding && (
          <p style={{ fontSize: 12, color: "var(--fm-text-tertiary)", margin: 0 }}>
            No picks yet — e.g. “Aquaphor for dry lips”.
          </p>
        )}

        {recommendations.map((r, i) => (
          <div
            key={`${r.title}-${i}`}
            style={{
              padding: "9px 12px",
              background: "var(--fm-bg-cool)",
              border: "1px solid var(--fm-border)",
              borderRadius: "var(--fm-radius-sm)",
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fm-text-primary)" }}>
                {r.title}
                {r.forWhat && (
                  <span style={{ fontWeight: 500, color: "var(--fm-text-secondary)" }}> · for {r.forWhat}</span>
                )}
              </div>
              {r.note && (
                <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary)", marginTop: 2 }}>{r.note}</div>
              )}
              {r.buyUrl && (
                <a
                  href={r.buyUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 11, color: "var(--fm-primary)", textDecoration: "underline" }}
                >
                  buy link ↗
                </a>
              )}
            </div>
            <button
              onClick={() => onRemove(i, r.title)}
              disabled={pending}
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: "var(--fm-radius-sm)",
                cursor: pending ? "wait" : "pointer",
                fontFamily: "inherit",
                border: "1px solid var(--fm-border)",
                background: "var(--fm-surface)",
                color: "var(--fm-text-secondary)",
              }}
            >
              🗑
            </button>
          </div>
        ))}

        {adding ? (
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(47, 125, 79, 0.06)",
              border: "1px solid rgba(47, 125, 79, 0.40)",
              borderRadius: "var(--fm-radius-sm)",
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={labelStyle}>Recommendation</label>
                <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Aquaphor" />
              </div>
              <div>
                <label style={labelStyle}>For (what it helps)</label>
                <input style={inputStyle} value={forWhat} onChange={(e) => setForWhat(e.target.value)} placeholder="dry, cracked lips" />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Note (how to use — optional)</label>
              <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="dab on at bedtime + after washing" />
            </div>
            <div>
              <label style={labelStyle}>Buy link (optional)</label>
              <input style={inputStyle} value={buyUrl} onChange={(e) => setBuyUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={onAdd}
                disabled={pending}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "5px 14px",
                  borderRadius: "var(--fm-radius-sm)",
                  cursor: pending ? "wait" : "pointer",
                  fontFamily: "inherit",
                  border: "1px solid var(--fm-primary)",
                  background: "var(--fm-primary)",
                  color: "#fff",
                }}
              >
                {pending ? "Adding…" : "Add pick"}
              </button>
              <button
                onClick={() => setAdding(false)}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "5px 12px",
                  borderRadius: "var(--fm-radius-sm)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  border: "1px solid var(--fm-border)",
                  background: "var(--fm-surface)",
                  color: "var(--fm-text-secondary)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: "8px 12px",
              borderRadius: "var(--fm-radius-sm)",
              border: "1px dashed var(--fm-primary)",
              background: "transparent",
              color: "var(--fm-primary)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ➕ Add a recommendation
          </button>
        )}
      </div>
    </FmPanel>
  );
}

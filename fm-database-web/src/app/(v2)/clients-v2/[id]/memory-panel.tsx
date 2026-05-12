/**
 * MemoryPanel — surfaces the cumulative profile the AI has built up about
 * this client via plan-chat client_patch writes.
 *
 * The plan chat (plan-chat.py + plan-chat-actions.ts) accumulates four
 * fields into client.yaml whenever the coach drops enduring info:
 *   - dietary_preference (replace)
 *   - foods_to_avoid     (append)
 *   - non_negotiables    (append)
 *   - reported_triggers  (append)
 *
 * Each turn shows a 👤 chip; this panel is the at-a-glance roll-up so
 * coach can see the full memory without scrolling chat history. Read-
 * only — edits still go through the chat (the natural surface) or the
 * profile editor.
 *
 * If all four fields are blank, the panel is hidden (no clutter for
 * brand-new clients).
 */
import { FmPanel } from "@/components/fm";

interface Props {
  dietaryPreference?: string;
  foodsToAvoid?: string;
  nonNegotiables?: string;
  reportedTriggers?: string;
}

interface Field {
  label: string;
  emoji: string;
  value: string;
  description: string;
}

function buildFields(p: Props): Field[] {
  const out: Field[] = [];
  if (p.dietaryPreference?.trim()) {
    out.push({
      label: "Dietary preference",
      emoji: "🥗",
      value: p.dietaryPreference.trim(),
      description: "Hard constraint on every nutrition suggestion.",
    });
  }
  if (p.foodsToAvoid?.trim()) {
    out.push({
      label: "Foods to avoid",
      emoji: "🚫",
      value: p.foodsToAvoid.trim(),
      description: "Never appears in nutrition.add or meal timing.",
    });
  }
  if (p.nonNegotiables?.trim()) {
    out.push({
      label: "Non-negotiables",
      emoji: "⭐",
      value: p.nonNegotiables.trim(),
      description: "Worked around in the plan, not removed.",
    });
  }
  if (p.reportedTriggers?.trim()) {
    out.push({
      label: "Reported triggers",
      emoji: "⚡",
      value: p.reportedTriggers.trim(),
      description: "n=1 lived evidence — weighted heavily in protocol picks.",
    });
  }
  return out;
}

export function MemoryPanel(props: Props) {
  const fields = buildFields(props);
  if (fields.length === 0) return null;

  return (
    <FmPanel
      title="🧠 What the AI knows about this client"
      subtitle="Built up from plan-chat conversations. Tell the AI new info there — it persists across all future plans + letters."
    >
      <div style={{ display: "grid", gap: 10 }}>
        {fields.map((f) => (
          <div
            key={f.label}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              columnGap: 10,
              rowGap: 2,
              padding: "8px 10px",
              background: "var(--fm-bg-cool)",
              border: "1px solid var(--fm-border-light)",
              borderRadius: "var(--fm-radius-sm)",
            }}
          >
            <span style={{ fontSize: 16, lineHeight: "20px" }}>{f.emoji}</span>
            <div>
              <div
                style={{
                  fontSize: 10.5,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontWeight: 700,
                  color: "var(--fm-text-tertiary)",
                  marginBottom: 2,
                }}
              >
                {f.label}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--fm-text-primary)",
                  lineHeight: 1.4,
                  wordBreak: "break-word",
                }}
              >
                {f.value}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--fm-text-tertiary)",
                  fontStyle: "italic",
                  marginTop: 2,
                }}
              >
                {f.description}
              </div>
            </div>
          </div>
        ))}
      </div>
    </FmPanel>
  );
}

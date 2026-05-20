/**
 * ClientSnapshotCard — context for the coach when editing/approving a plan.
 *
 * Server component. Pure read — shows what the client.yaml says without
 * any interaction. Sits above the plan editor so coach can sanity-check
 * who they're prescribing for before scrolling into the protocol.
 *
 * Collapsible <details> — defaults to open since this is the primary
 * decision-making context. Coach can collapse if they want more vertical
 * room for the editor.
 */
import { FmPanel } from "@/components/fm";

interface LabValue {
  test_name?: string;
  value?: number | string;
  unit?: string;
}
interface HealthSnapshot {
  date?: string;
  lab_values?: LabValue[];
}

interface Props {
  client: {
    client_id?: string;
    display_name?: string;
    sex?: string;
    age_band?: string;
    date_of_birth?: string;
    active_conditions?: string[];
    medical_history?: string[];
    current_medications?: string[];
    known_allergies?: string[];
    goals?: string[];
    dietary_preference?: string;
    foods_to_avoid?: string;
    non_negotiables?: string;
    city?: string;
    country?: string;
    health_snapshots?: HealthSnapshot[];
    next_contact_date?: string;
  } | null;
  lastContactDate?: string;
  sessionCount?: number;
}

function chip(label: string, tone: "neutral" | "warn" | "info" = "neutral"): React.CSSProperties {
  void label;
  const palette = {
    neutral: { bg: "var(--fm-bg-cool, #f1f5f9)", color: "var(--fm-text-secondary)" },
    warn:    { bg: "rgba(245, 158, 11, 0.12)", color: "#92400e" },
    info:    { bg: "rgba(46, 110, 213, 0.08)", color: "#1d4ed8" },
  }[tone];
  return {
    display: "inline-block",
    fontSize: 11,
    padding: "2px 8px",
    background: palette.bg,
    color: palette.color,
    borderRadius: "var(--fm-radius-pill)",
    marginRight: 5,
    marginBottom: 4,
  };
}

function deriveAge(dob?: string): number | undefined {
  if (!dob) return undefined;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function flattenLatestLabs(
  snapshots: HealthSnapshot[] | undefined,
): Array<{ name: string; value: string; unit: string; date: string }> {
  if (!snapshots || snapshots.length === 0) return [];
  // For each test_name, keep the MOST RECENT value.
  const byName = new Map<string, { value: string; unit: string; date: string }>();
  for (const snap of snapshots) {
    const date = snap.date ?? "";
    for (const lv of snap.lab_values ?? []) {
      const name = (lv.test_name ?? "").trim();
      if (!name) continue;
      const existing = byName.get(name);
      if (!existing || (date && date > existing.date)) {
        byName.set(name, {
          value: lv.value != null ? String(lv.value) : "?",
          unit: lv.unit ?? "",
          date,
        });
      }
    }
  }
  return [...byName.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function ClientSnapshotCard({ client, lastContactDate, sessionCount }: Props) {
  if (!client) {
    return (
      <FmPanel title="🩺 Client snapshot" tight>
        <p style={{ fontSize: 12, color: "var(--fm-text-tertiary)", margin: 0 }}>
          No client linked to this plan.
        </p>
      </FmPanel>
    );
  }

  const name = client.display_name ?? client.client_id ?? "?";
  const age = deriveAge(client.date_of_birth);
  const labs = flattenLatestLabs(client.health_snapshots);

  return (
    <details
      open
      style={{
        background: "var(--fm-surface)",
        border: "1px solid var(--fm-border)",
        borderRadius: "var(--fm-radius-md)",
        padding: "12px 16px",
        marginBottom: 12,
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontWeight: 700,
          fontSize: 14,
          listStyle: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>🩺 Client snapshot — {name}</span>
        <span
          style={{
            fontSize: 11,
            color: "var(--fm-text-tertiary)",
            fontWeight: 500,
          }}
        >
          {age != null ? `${age}y · ` : client.age_band ? `${client.age_band} · ` : ""}
          {client.sex ?? ""}
          {client.city || client.country
            ? ` · ${[client.city, client.country].filter(Boolean).join(", ")}`
            : ""}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--fm-text-tertiary)" }}>
          {lastContactDate ? `Last contact ${lastContactDate}` : "No sessions yet"}
          {sessionCount != null ? ` · ${sessionCount} session${sessionCount === 1 ? "" : "s"}` : ""}
        </span>
      </summary>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
        {/* LEFT — bio / clinical */}
        <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
          {client.active_conditions && client.active_conditions.length > 0 && (
            <div>
              <div style={kvLabel()}>Active conditions</div>
              <div>
                {client.active_conditions.map((c, i) => (
                  <span key={i} style={chip(c, "warn")}>{c}</span>
                ))}
              </div>
            </div>
          )}
          {client.medical_history && client.medical_history.length > 0 && (
            <div>
              <div style={kvLabel()}>Medical history</div>
              <div>
                {client.medical_history.map((c, i) => (
                  <span key={i} style={chip(c, "neutral")}>{c}</span>
                ))}
              </div>
            </div>
          )}
          {client.current_medications && client.current_medications.length > 0 && (
            <div>
              <div style={kvLabel()}>Medications</div>
              <div>
                {client.current_medications.map((c, i) => (
                  <span key={i} style={chip(c, "info")}>{c}</span>
                ))}
              </div>
            </div>
          )}
          {client.known_allergies && client.known_allergies.length > 0 && (
            <div>
              <div style={kvLabel()}>Allergies</div>
              <div>
                {client.known_allergies.map((c, i) => (
                  <span key={i} style={chip(c, "warn")}>{c}</span>
                ))}
              </div>
            </div>
          )}
          {client.goals && client.goals.length > 0 && (
            <div>
              <div style={kvLabel()}>Goals</div>
              <div style={{ fontSize: 12 }}>{client.goals.join(" · ")}</div>
            </div>
          )}
        </div>

        {/* RIGHT — diet / labs on file */}
        <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
          {(client.dietary_preference ||
            client.foods_to_avoid ||
            client.non_negotiables) && (
            <div>
              <div style={kvLabel()}>Diet</div>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                {client.dietary_preference && (
                  <span style={chip(client.dietary_preference, "info")}>
                    {client.dietary_preference}
                  </span>
                )}
                {client.foods_to_avoid && (
                  <div style={{ marginTop: 4, color: "var(--fm-text-secondary)" }}>
                    <em>Avoids:</em> {client.foods_to_avoid}
                  </div>
                )}
                {client.non_negotiables && (
                  <div style={{ marginTop: 2, color: "var(--fm-text-secondary)" }}>
                    <em>Non-negotiables:</em> {client.non_negotiables}
                  </div>
                )}
              </div>
            </div>
          )}
          {labs.length > 0 && (
            <div>
              <div style={kvLabel()}>Labs on file ({labs.length})</div>
              <div
                style={{
                  fontSize: 11,
                  maxHeight: 140,
                  overflowY: "auto",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                  padding: "6px 8px",
                  background: "var(--fm-surface-2, rgba(0,0,0,0.02))",
                  display: "grid",
                  gap: 3,
                }}
              >
                {labs.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto",
                      gap: 8,
                      fontFamily: "var(--fm-font-mono)",
                      fontSize: 11,
                    }}
                  >
                    <span style={{ color: "var(--fm-text-secondary)" }}>{l.name}</span>
                    <span style={{ fontWeight: 600 }}>
                      {l.value} {l.unit}
                    </span>
                    <span style={{ color: "var(--fm-text-tertiary)" }}>{l.date}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "var(--fm-text-tertiary)", marginTop: 4 }}>
                ✦ AI uses these to avoid re-proposing labs already on file.
              </div>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function kvLabel(): React.CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "var(--fm-text-tertiary)",
    marginBottom: 3,
  };
}

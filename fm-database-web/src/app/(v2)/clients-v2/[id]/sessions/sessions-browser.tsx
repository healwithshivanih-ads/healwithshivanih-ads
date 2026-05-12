"use client";

/**
 * SessionsBrowser — two-pane sessions viewer.
 *
 * LEFT pane: filter chips + scrollable list of every session, newest
 *   first. Each row clickable; selection lives in URL ?sid=.
 *
 * RIGHT pane: inspector for the selected session. Falls back to "pick
 *   a session" when no session is selected.
 *
 * Filters: session_type chips (All / Discovery / Intake / Check-in /
 *   Quick note). Filter param lives in URL ?type= for shareability.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { SessionSummary } from "@/app/assess/actions";
import { FmPanel } from "@/components/fm";
import { SessionBriefModal } from "@/app/clients/[id]/session-brief-modal";

const TYPE_META: Record<
  string,
  { label: string; emoji: string; tone: string }
> = {
  discovery: { label: "Discovery", emoji: "🔍", tone: "#D6A2A2" },
  intake: { label: "Intake / Full", emoji: "📋", tone: "#2B2D42" },
  check_in: { label: "Check-in", emoji: "💬", tone: "#8D99AE" },
  quick_note: { label: "Quick note", emoji: "📝", tone: "#E8A87C" },
};

const FILTER_CHIPS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "intake", label: "📋 Intake / Full" },
  { id: "discovery", label: "🔍 Discovery" },
  { id: "check_in", label: "💬 Check-in" },
  { id: "quick_note", label: "📝 Quick note" },
];

function relAge(dateStr: string | undefined): string {
  if (!dateStr) return "";
  try {
    const days = Math.round(
      (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (days <= 0) return "today";
    if (days === 1) return "1d ago";
    if (days < 30) return `${days}d ago`;
    if (days < 365) return `${Math.round(days / 30)}mo ago`;
    return `${Math.round(days / 365)}y ago`;
  } catch {
    return "";
  }
}

function stripTag(s?: string): string {
  if (!s) return "";
  return s.replace(/^\[(?:session_type|source):[^\]]+\]\s*/i, "").trim();
}

export function SessionsBrowser({
  clientId,
  displayName,
  sessions,
  selectedSid,
  filterType,
  clientAgeBand,
  clientSex,
  clientConditions,
  clientMedications,
}: {
  clientId: string;
  displayName: string;
  sessions: SessionSummary[];
  selectedSid?: string;
  filterType?: string;
  clientAgeBand?: string | null;
  clientSex?: string | null;
  clientConditions?: string[];
  clientMedications?: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [briefSid, setBriefSid] = useState<string | null>(null);

  const activeFilter = filterType ?? "all";

  const filtered = useMemo(() => {
    if (activeFilter === "all") return sessions;
    return sessions.filter((s) => s.session_type === activeFilter);
  }, [sessions, activeFilter]);

  const selected =
    sessions.find((s) => s.session_id === selectedSid) ?? filtered[0] ?? null;

  function setFilter(id: string) {
    const next = new URLSearchParams(params);
    if (id === "all") next.delete("type");
    else next.set("type", id);
    // Reset sid when filter changes so we don't keep a hidden session selected
    next.delete("sid");
    router.replace(`/clients-v2/${clientId}/sessions?${next.toString()}`);
  }

  function selectSid(sid: string | undefined) {
    const next = new URLSearchParams(params);
    if (sid) next.set("sid", sid);
    else next.delete("sid");
    router.replace(`/clients-v2/${clientId}/sessions?${next.toString()}`);
  }

  // Counts per filter
  const counts: Record<string, number> = {
    all: sessions.length,
    discovery: sessions.filter((s) => s.session_type === "discovery").length,
    intake: sessions.filter((s) => s.session_type === "intake").length,
    check_in: sessions.filter((s) => s.session_type === "check_in").length,
    quick_note: sessions.filter((s) => s.session_type === "quick_note").length,
  };

  if (sessions.length === 0) {
    return (
      <FmPanel
        style={{
          textAlign: "center",
          padding: "40px 24px",
          background:
            "linear-gradient(135deg, var(--fm-bg-warm), var(--fm-surface) 70%)",
          borderColor: "rgba(255, 107, 53, 0.25)",
          borderWidth: 2,
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>🗓</div>
        <h2
          style={{
            fontFamily: "var(--fm-font-display)",
            fontSize: 22,
            fontWeight: 400,
            margin: "0 0 6px",
            letterSpacing: "-0.3px",
          }}
        >
          No sessions on record for {displayName.split(" ")[0]}
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "var(--fm-text-secondary)",
            margin: "0 0 18px",
          }}
        >
          Start a Discovery, Intake or Full Assessment from the Analyse tab.
        </p>
        <Link
          href={`/clients-v2/${clientId}/analyse`}
          style={{
            display: "inline-block",
            background: "var(--fm-primary)",
            color: "#fff",
            padding: "9px 18px",
            fontSize: 13,
            fontWeight: 700,
            borderRadius: "var(--fm-radius-sm)",
            textDecoration: "none",
          }}
        >
          Open Analyse →
        </Link>
      </FmPanel>
    );
  }

  return (
    <div className="fm-v2-2col" style={{ gridTemplateColumns: "340px minmax(0, 1fr)" }}>
      {/* LEFT — filter chips + session list */}
      <aside className="fm-v2-2col-rail" style={{ padding: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 5,
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          {FILTER_CHIPS.map((c) => {
            const isActive = activeFilter === c.id;
            const count = counts[c.id] ?? 0;
            const disabled = count === 0;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => !disabled && setFilter(c.id)}
                disabled={disabled}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 10px",
                  background: isActive ? "var(--fm-primary)" : "var(--fm-surface)",
                  color: isActive
                    ? "#fff"
                    : disabled
                      ? "var(--fm-text-tertiary)"
                      : "var(--fm-text-secondary)",
                  border: `1px solid ${isActive ? "var(--fm-primary)" : "var(--fm-border)"}`,
                  borderRadius: "var(--fm-radius-pill)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: disabled ? "default" : "pointer",
                  fontFamily: "inherit",
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {c.label}
                <span style={{ fontSize: 9, opacity: 0.7 }}>{count}</span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "grid",
            gap: 6,
          }}
        >
          {filtered.map((s) => {
            const meta = TYPE_META[s.session_type] ?? TYPE_META.intake;
            const isSelected = selected?.session_id === s.session_id;
            return (
              <button
                key={s.session_id ?? s.date}
                type="button"
                onClick={() => selectSid(s.session_id)}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "10px 12px",
                  background: isSelected
                    ? "var(--fm-bg-warm)"
                    : "var(--fm-surface)",
                  border: `1px solid ${isSelected ? "var(--fm-primary)" : "var(--fm-border-light)"}`,
                  borderRadius: "var(--fm-radius-sm)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "left",
                  width: "100%",
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: meta.tone,
                    marginTop: 5,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: "var(--fm-text-primary)",
                      }}
                    >
                      {meta.emoji} {meta.label}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--fm-text-tertiary)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {relAge(s.date)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--fm-text-tertiary)",
                      fontFamily: "var(--fm-font-mono)",
                      marginTop: 1,
                    }}
                  >
                    {s.date}
                  </div>
                  {(s.driver_count > 0 ||
                    s.supplement_count > 0 ||
                    s.plan_exists) && (
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        marginTop: 4,
                        fontSize: 9.5,
                        color: "var(--fm-text-secondary)",
                      }}
                    >
                      {s.driver_count > 0 && (
                        <span>🧬 {s.driver_count}</span>
                      )}
                      {s.supplement_count > 0 && (
                        <span>💊 {s.supplement_count}</span>
                      )}
                      {s.plan_exists && <span>📋 plan</span>}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div
              style={{
                padding: "10px 12px",
                fontSize: 11.5,
                color: "var(--fm-text-tertiary)",
                background: "var(--fm-bg-cool)",
                borderRadius: "var(--fm-radius-sm)",
                textAlign: "center",
              }}
            >
              No sessions in this filter.
            </div>
          )}
        </div>
      </aside>

      {/* RIGHT — inspector */}
      <div style={{ minWidth: 0 }}>
        {selected ? (
          <SessionInspector
            clientId={clientId}
            session={selected}
            onOpenBrief={(sid) => setBriefSid(sid)}
          />
        ) : (
          <FmPanel>
            <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>
              Pick a session on the left to inspect.
            </div>
          </FmPanel>
        )}
      </div>

      {/* Session brief modal (print / save-as-PDF for doctor hand-off) */}
      {briefSid && (() => {
        const briefSession = sessions.find(
          (s, i) => (s.session_id ?? `idx-${i}`) === briefSid,
        );
        if (!briefSession) return null;
        return (
          <SessionBriefModal
            session={briefSession}
            clientName={displayName}
            clientAgeBand={clientAgeBand ?? null}
            clientSex={clientSex ?? null}
            clientConditions={clientConditions ?? []}
            clientMedications={clientMedications ?? []}
            onClose={() => setBriefSid(null)}
          />
        );
      })()}
    </div>
  );
}

function SessionInspector({
  clientId,
  session,
  onOpenBrief,
}: {
  clientId: string;
  session: SessionSummary;
  onOpenBrief: (sid: string) => void;
}) {
  const meta = TYPE_META[session.session_type] ?? TYPE_META.intake;
  const presenting = stripTag(session.presenting_complaints);
  const symptoms = session.selected_symptoms ?? [];
  const topics = session.selected_topics ?? [];
  const drivers = session.likely_drivers ?? [];
  const supps = session.supplement_suggestions ?? [];
  const reqLabs = session.requested_labs ?? [];
  const expectedReports = session.expected_reports ?? [];
  const fp = session.five_pillars;
  const ifmTimeline = session.ifm_timeline ?? [];
  const synthesis = session.synthesis_notes ?? "";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Header card */}
      <FmPanel>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 10.5,
                color: "var(--fm-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              {session.date} · {relAge(session.date)}
            </div>
            <h2
              style={{
                fontFamily: "var(--fm-font-display)",
                fontSize: 22,
                fontWeight: 400,
                margin: "0 0 4px",
                letterSpacing: "-0.3px",
                color: "var(--fm-text-primary)",
              }}
            >
              {meta.emoji} {meta.label}
            </h2>
            <div
              style={{
                fontSize: 10.5,
                color: "var(--fm-text-tertiary)",
                fontFamily: "var(--fm-font-mono)",
              }}
            >
              {session.session_id}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {session.session_id && (
              <button
                type="button"
                onClick={() => onOpenBrief(session.session_id!)}
                title="Print or save as PDF — for sharing with a doctor / specialist"
                style={{
                  padding: "7px 14px",
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: "var(--fm-surface)",
                  color: "var(--fm-text-primary)",
                  border: "1px solid var(--fm-border)",
                  borderRadius: "var(--fm-radius-sm)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                📄 Brief / Print
              </button>
            )}
            {session.generated_plan_slug && (
              <Link
                href={`/clients-v2/${clientId}/plan/edit/${session.generated_plan_slug}`}
                style={{
                  padding: "7px 14px",
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: "var(--fm-primary)",
                  color: "#fff",
                  borderRadius: "var(--fm-radius-sm)",
                  textDecoration: "none",
                }}
              >
                📋 Open generated plan →
              </Link>
            )}
          </div>
        </div>
        {presenting && (
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.55,
              padding: "10px 12px",
              background: "var(--fm-bg-warm)",
              borderLeft: "3px solid var(--fm-primary)",
              borderRadius: "0 var(--fm-radius-sm) var(--fm-radius-sm) 0",
              marginTop: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            <strong style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--fm-primary)" }}>
              Presenting
            </strong>
            <div style={{ marginTop: 4 }}>{presenting}</div>
          </div>
        )}
      </FmPanel>

      {/* AI synthesis */}
      {synthesis && (
        <FmPanel title="🧠 AI synthesis" subtitle="The coach's working hypothesis from this session.">
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.65,
              whiteSpace: "pre-wrap",
              color: "var(--fm-text-primary)",
            }}
          >
            {synthesis}
          </div>
        </FmPanel>
      )}

      {/* Drivers */}
      {drivers.length > 0 && (
        <FmPanel title={`🧬 Likely drivers (${drivers.length})`}>
          <div style={{ display: "grid", gap: 8 }}>
            {drivers.map((d, i) => {
              const conf = d.confidence;
              const confDisplay =
                typeof conf === "number"
                  ? `${Math.round(conf * 100)}%`
                  : conf
                    ? String(conf)
                    : null;
              return (
                <div
                  key={i}
                  style={{
                    padding: "10px 12px",
                    background: "var(--fm-surface)",
                    border: "1px solid var(--fm-border-light)",
                    borderRadius: "var(--fm-radius-sm)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: "var(--fm-text-primary)",
                      }}
                    >
                      {d.mechanism ?? d.mechanism_slug ?? "—"}
                    </span>
                    {confDisplay && (
                      <span
                        style={{
                          padding: "2px 8px",
                          background: "rgba(110, 76, 200, 0.10)",
                          color: "#5a3fb0",
                          borderRadius: "var(--fm-radius-pill)",
                          fontSize: 10.5,
                          fontWeight: 700,
                        }}
                      >
                        {confDisplay}
                      </span>
                    )}
                  </div>
                  {d.reasoning && (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--fm-text-secondary)",
                        marginTop: 4,
                        lineHeight: 1.55,
                      }}
                    >
                      {d.reasoning}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </FmPanel>
      )}

      {/* Supplement suggestions */}
      {supps.length > 0 && (
        <FmPanel title={`💊 Supplement suggestions (${supps.length})`}>
          <div style={{ display: "grid", gap: 6 }}>
            {supps.map((s, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 12px",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                  {s.name ?? s.supplement_slug ?? "—"}
                  {s.dose && (
                    <span
                      style={{
                        fontWeight: 500,
                        color: "var(--fm-text-secondary)",
                        marginLeft: 6,
                      }}
                    >
                      · {s.dose}
                    </span>
                  )}
                  {s.timing && (
                    <span
                      style={{
                        fontWeight: 500,
                        color: "var(--fm-text-tertiary)",
                        marginLeft: 6,
                      }}
                    >
                      · {s.timing}
                    </span>
                  )}
                </div>
                {s.rationale && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--fm-text-secondary)",
                      marginTop: 3,
                      lineHeight: 1.55,
                    }}
                  >
                    {s.rationale}
                  </div>
                )}
              </div>
            ))}
          </div>
        </FmPanel>
      )}

      {/* Symptoms + topics chips */}
      {(symptoms.length > 0 || topics.length > 0) && (
        <FmPanel title="🎯 Picked for analysis">
          {symptoms.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <ChipLabel>Symptoms</ChipLabel>
              <ChipRow items={symptoms} tone="primary" />
            </div>
          )}
          {topics.length > 0 && (
            <div>
              <ChipLabel>Conditions / topics</ChipLabel>
              <ChipRow items={topics} />
            </div>
          )}
        </FmPanel>
      )}

      {/* Labs requested + expected reports */}
      {(reqLabs.length > 0 || expectedReports.length > 0) && (
        <FmPanel
          title="🧪 Labs + reports"
          subtitle="Tests requested + reports expected from this session."
        >
          {reqLabs.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <ChipLabel>Requested labs</ChipLabel>
              <ChipRow items={reqLabs} />
            </div>
          )}
          {expectedReports.length > 0 && (
            <div>
              <ChipLabel>Expected reports</ChipLabel>
              <ChipRow items={expectedReports} />
            </div>
          )}
        </FmPanel>
      )}

      {/* Five pillars */}
      {fp && Object.values(fp).some((v) => v != null) && (
        <FmPanel title="🌿 Five pillars snapshot">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
              gap: 6,
            }}
          >
            <Pillar label="Sleep h" v={fp.sleep_hours} />
            <Pillar label="Sleep 1–5" v={fp.sleep_quality} />
            <Pillar label="Stress" v={fp.stress_level} />
            <Pillar label="Movement d/wk" v={fp.movement_days_per_week} />
            <Pillar label="Nutrition" v={fp.nutrition_quality} />
            <Pillar label="Connection" v={fp.connection_quality} />
          </div>
        </FmPanel>
      )}

      {/* IFM timeline events */}
      {ifmTimeline.length > 0 && (
        <FmPanel
          title={`🕰 IFM timeline events (${ifmTimeline.length})`}
          subtitle="ATM-classified life events the AI pulled from intake history."
        >
          <div style={{ display: "grid", gap: 6 }}>
            {ifmTimeline.map((ev, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 12px",
                  background: "var(--fm-surface)",
                  border: "1px solid var(--fm-border-light)",
                  borderRadius: "var(--fm-radius-sm)",
                  fontSize: 11.5,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--fm-text-tertiary)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  {ev.year ?? ev.date ?? "—"} · {ev.atm ?? "?"}
                </div>
                <div style={{ marginTop: 2, fontWeight: 600 }}>{ev.event}</div>
                {ev.rationale && (
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "var(--fm-text-tertiary)",
                      marginTop: 2,
                    }}
                  >
                    {ev.rationale}
                  </div>
                )}
              </div>
            ))}
          </div>
        </FmPanel>
      )}

      {/* Footer link out */}
      <div style={{ display: "flex", gap: 10, fontSize: 11 }}>
        <Link
          href={`/clients-v2/${clientId}/analyse`}
          style={{
            color: "var(--fm-text-secondary)",
            textDecoration: "underline",
          }}
        >
          ↗ Record a new session
        </Link>
      </div>
    </div>
  );
}

function ChipLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9.5,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        fontWeight: 700,
        color: "var(--fm-text-tertiary)",
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

function ChipRow({
  items,
  tone = "neutral",
}: {
  items: string[];
  tone?: "primary" | "neutral";
}) {
  const styles =
    tone === "primary"
      ? {
          bg: "rgba(255, 107, 53, 0.10)",
          fg: "var(--fm-primary)",
        }
      : { bg: "var(--fm-bg-cool)", fg: "var(--fm-text-secondary)" };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {items.map((s, i) => (
        <span
          key={`${s}-${i}`}
          style={{
            padding: "3px 9px",
            borderRadius: "var(--fm-radius-pill)",
            background: styles.bg,
            color: styles.fg,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function Pillar({ label, v }: { label: string; v?: number | null }) {
  const has = v != null && !Number.isNaN(v);
  return (
    <div
      style={{
        padding: "8px 10px",
        background: has ? "var(--fm-bg-cool)" : "var(--fm-surface)",
        border: "1px solid var(--fm-border-light)",
        borderRadius: "var(--fm-radius-sm)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: "var(--fm-text-tertiary)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: has ? "var(--fm-text-primary)" : "var(--fm-text-tertiary)",
          marginTop: 2,
        }}
      >
        {has ? v : "—"}
      </div>
    </div>
  );
}

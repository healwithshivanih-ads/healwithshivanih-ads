"use client";

/**
 * FmSessionTimeline — Phase 3 / design C7.
 *
 * Sticky right rail on the Analyse tab. Vertical card list of prior
 * sessions newest first. Dot colour = session type tint. Each card
 * starts collapsed; click to expand into synthesis notes + supplements
 * suggested + drivers identified.
 *
 * Expects sessions sorted DESC (newest first). Driver / supplement
 * arrays are optional — coach-visible only when populated.
 */
import { useState } from "react";
import { FM_SESSION_TYPES, type FmSessionTypeId } from "./FmSessionTypePicker";

export interface FmSessionTimelineEntry {
  /** Stable id for keys + open-state tracking. */
  id: string;
  /** Type drives the dot colour + icon. */
  type: FmSessionTypeId | string;
  /** "May 1" or ISO date. */
  date: string;
  /** Optional full ISO timestamp (created_at) — when present, renders
   *  HH:MM IST next to the date so multiple runs on the same day are
   *  distinguishable. */
  timestamp?: string;
  /** Pre-computed relative age string e.g. "11 days ago". */
  age?: string;
  /** Title shown next to the date. */
  title: string;
  /** Short summary (1–2 sentences). */
  summary?: string;
  /** Optional driver labels surfaced when expanded. */
  drivers?: string[];
  /** Optional supplement names suggested in this session. */
  supplements?: string[];
  /** Optional click handler — opens the full session detail. */
  href?: string;
}

export interface FmSessionTimelineProps {
  entries: FmSessionTimelineEntry[];
  /** Index of the entry expanded by default (defaults to 0 = newest). */
  initialOpen?: number;
  /** Title shown above the list — default "Session timeline". */
  title?: string;
}

export function FmSessionTimeline({
  entries,
  initialOpen = 0,
  title = "Session timeline",
}: FmSessionTimelineProps) {
  const [openIndex, setOpenIndex] = useState<number>(initialOpen);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 1,
            color: "var(--fm-text-secondary)",
          }}
        >
          {title}
        </div>
        <span style={{ fontSize: 10.5, color: "var(--fm-text-tertiary)" }}>
          {entries.length} on record
        </span>
      </div>

      {entries.length === 0 ? (
        <div
          style={{
            padding: 18,
            border: "1px dashed var(--fm-border)",
            borderRadius: "var(--fm-radius-sm)",
            fontSize: 12,
            color: "var(--fm-text-tertiary)",
            textAlign: "center",
          }}
        >
          No prior sessions yet.
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          {/* vertical connector line */}
          <div
            style={{
              position: "absolute",
              left: 6,
              top: 8,
              bottom: 8,
              width: 1,
              background: "var(--fm-border-light)",
            }}
          />
          {entries.map((s, i) => {
            const t = FM_SESSION_TYPES.find((x) => x.id === s.type) ?? {
              tint: "var(--fm-text-tertiary)",
              icon: "📌",
            };
            const isOpen = i === openIndex;
            return (
              <div key={s.id} style={{ position: "relative", paddingLeft: 22, marginBottom: 14 }}>
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 6,
                    width: 13,
                    height: 13,
                    borderRadius: "50%",
                    background: t.tint,
                    border: "2px solid var(--fm-surface)",
                    boxShadow: "0 0 0 1px var(--fm-border-light)",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? -1 : i)}
                  style={{
                    width: "100%",
                    background: "var(--fm-surface)",
                    border: `1px solid ${isOpen ? `${t.tint}60` : "var(--fm-border-light)"}`,
                    borderRadius: "var(--fm-radius-md)",
                    padding: 10,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    color: "inherit",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      marginBottom: isOpen ? 8 : 2,
                    }}
                  >
                    <span style={{ fontSize: 11 }}>{t.icon}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: t.tint }}>
                      {s.title}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--fm-text-tertiary)",
                        marginLeft: "auto",
                      }}
                    >
                      {s.date}
                      {s.timestamp && (() => {
                        // Render the HH:MM IST tag next to the date so
                        // multiple synthesis runs on the same day are
                        // distinguishable at a glance.
                        try {
                          const d = new Date(s.timestamp);
                          if (Number.isNaN(d.getTime())) return null;
                          const t = d.toLocaleTimeString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          });
                          return ` · ${t} IST`;
                        } catch {
                          return null;
                        }
                      })()}
                      {s.age && ` · ${s.age}`}
                    </span>
                  </div>
                  {!isOpen && (
                    <div
                      style={{
                        fontSize: 10.5,
                        color: "var(--fm-text-tertiary)",
                        fontWeight: 500,
                      }}
                    >
                      Tap to expand
                    </div>
                  )}
                  {isOpen && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {s.summary && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--fm-text-secondary)",
                            lineHeight: 1.55,
                          }}
                        >
                          {s.summary}
                        </div>
                      )}
                      {(s.drivers?.length ?? 0) > 0 && (
                        <div>
                          <div
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: 0.7,
                              color: "var(--fm-text-tertiary)",
                              marginBottom: 4,
                            }}
                          >
                            Drivers identified
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {(s.drivers ?? []).map((d) => (
                              <span
                                key={d}
                                style={{
                                  fontSize: 10,
                                  padding: "2px 8px",
                                  background: "var(--fm-bg-cool)",
                                  borderRadius: "var(--fm-radius-pill)",
                                  color: "var(--fm-text-secondary)",
                                  fontWeight: 500,
                                }}
                              >
                                {d}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {(s.supplements?.length ?? 0) > 0 && (
                        <div>
                          <div
                            style={{
                              fontSize: 9,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: 0.7,
                              color: "var(--fm-text-tertiary)",
                              marginBottom: 4,
                            }}
                          >
                            Supplements suggested
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gap: 3,
                              fontSize: 10.5,
                              color: "var(--fm-text-secondary)",
                            }}
                          >
                            {(s.supplements ?? []).map((x) => (
                              <div key={x}>• {x}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {s.href && (
                        <a
                          href={s.href}
                          style={{
                            fontSize: 11,
                            color: "var(--fm-primary)",
                            fontWeight: 600,
                            textDecoration: "none",
                            marginTop: 4,
                          }}
                        >
                          Open full session →
                        </a>
                      )}
                    </div>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

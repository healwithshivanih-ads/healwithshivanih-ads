"use client";

/**
 * FoundingMemberCard — Sequoya "Founding 20" on the client overview.
 *
 * Founder view:   mark / unmark founding (join date + the PRIVATE locked
 *                 Sequoya+ rate), the places counter, and the one gifted
 *                 Foundation session: pick or add the recipient → link + a
 *                 WhatsApp message the founder forwards → live status.
 * Recipient view: "gifted by …" with the call 1 / call 2 / joined recorder and
 *                 the 7-day credit deadline that call 2 starts.
 *
 * Everything on this card is coach-only. The rate shown here never leaves the
 * Mac (not projected to Fly, not in any client payload).
 */

import { useCallback, useEffect, useState } from "react";
import { FmPanel } from "@/components/fm";
import { copyText } from "@/lib/copy-text";
import type { FoundingState } from "@/lib/server-actions/founding";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const muted = { fontSize: 12.5, color: "var(--fm-muted, #6f6a5d)", lineHeight: 1.45 } as const;
const input = {
  fontSize: 13,
  padding: "5px 8px",
  borderRadius: 8,
  border: "1px solid var(--fm-border-light, #e6e1d6)",
  background: "var(--fm-surface, #fff)",
} as const;

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function human(ymd: string | null): string {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function waHref(phone: string, text: string): string {
  const clean = phone.replace(/\D+/g, "");
  const e164 = clean.length === 10 ? `91${clean}` : clean;
  return `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
}

function Chip({ tone, children }: { tone: "ok" | "warn" | "muted" | "brand"; children: React.ReactNode }) {
  const c = {
    ok: ["rgba(47,122,63,0.12)", "#2f7a3f"],
    warn: ["rgba(179,64,42,0.10)", "#b3402a"],
    muted: ["rgba(0,0,0,0.05)", "var(--fm-muted, #6f6a5d)"],
    brand: ["rgba(201,74,119,0.10)", "#a33a60"],
  }[tone];
  return (
    <span style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, background: c[0], color: c[1] }}>
      {children}
    </span>
  );
}

export function FoundingMemberCard({ clientId }: { clientId: string }) {
  const [state, setState] = useState<FoundingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  // mark form
  const [joinedOn, setJoinedOn] = useState(istToday());
  const [rate, setRate] = useState("150000");
  // gift form
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [pick, setPick] = useState("");
  const [rName, setRName] = useState("");
  const [rMobile, setRMobile] = useState("");
  const [rEmail, setREmail] = useState("");
  const [waText, setWaText] = useState("");
  const [copied, setCopied] = useState("");
  // recipient step recorder
  const [stepDate, setStepDate] = useState(istToday());

  const load = useCallback(async () => {
    const { loadFoundingState } = await import("@/lib/server-actions/founding");
    const out = await loadFoundingState(clientId);
    if (out.ok) {
      setState(out.state);
      if (out.state.rateInr) setRate(String(out.state.rateInr));
      if (out.state.joinedOn) setJoinedOn(out.state.joinedOn);
    } else setError(out.error);
  }, [clientId]);

  useEffect(() => {
    load().catch(() => setError("could not load founding status"));
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const setFounding = (founding: boolean) =>
    run(async () => {
      if (!founding && !window.confirm("Remove the founding-member mark (and the locked rate) from this client?")) return;
      const { setFoundingMember } = await import("@/lib/server-actions/founding");
      const out = await setFoundingMember(clientId, founding ? { founding, joinedOn, rateInr: Number(rate) } : { founding });
      if (!out.ok) throw new Error(out.error);
      setNote(
        `${founding ? "Marked" : "Unmarked"} — ${out.placesTaken} of 20 places taken.` +
          (out.counter.ok ? " Website counter updated." : ` Website counter NOT updated (${out.counter.error}).`),
      );
      await load();
    });

  const issue = () =>
    run(async () => {
      const { issueFoundingGift } = await import("@/lib/server-actions/founding");
      const out = await issueFoundingGift(
        clientId,
        mode === "existing"
          ? { kind: "existing", clientId: pick }
          : { kind: "new", name: rName, mobile: rMobile, email: rEmail },
      );
      if (!out.ok) throw new Error(out.error);
      setWaText(out.waText);
      await load();
    });

  const showMessage = () =>
    run(async () => {
      const { foundingGiftMessage } = await import("@/lib/server-actions/founding");
      const out = await foundingGiftMessage(clientId);
      if (!out.ok) throw new Error(out.error);
      setWaText(out.waText);
    });

  const revoke = () =>
    run(async () => {
      if (!window.confirm("Revoke this gift? The recipient's link will go back to the normal paid Foundation page.")) return;
      const { revokeFoundingGift } = await import("@/lib/server-actions/founding");
      const out = await revokeFoundingGift(clientId);
      if (!out.ok) throw new Error(out.error);
      setWaText("");
      await load();
    });

  const record = (step: "call_1" | "call_2" | "joined") =>
    run(async () => {
      const { recordGiftStep } = await import("@/lib/server-actions/founding");
      const out = await recordGiftStep(clientId, step, stepDate);
      if (!out.ok) throw new Error(out.error);
      await load();
    });

  const copy = async (what: string, text: string) => {
    try {
      await copyText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      /* clipboard denied */
    }
  };

  if (!state) return null;

  // ── recipient of a gift ────────────────────────────────────────────────────
  if (state.received) {
    const r = state.received;
    return (
      <FmPanel title="🎁 Gifted Foundation session" subtitle={`A Sequoya founding gift from ${r.founderName || r.founderId}`}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip tone={r.call1On ? "ok" : "muted"}>{r.call1On ? `✓ Call 1 ${human(r.call1On)}` : "○ Call 1 (history)"}</Chip>
            <Chip tone={r.call2On ? "ok" : "muted"}>{r.call2On ? `✓ Call 2 ${human(r.call2On)}` : "○ Call 2 (lab review)"}</Chip>
            <Chip tone={r.joinedOn ? "ok" : "muted"}>{r.joinedOn ? `✓ Joined ${human(r.joinedOn)}` : "○ Joined Sequoya"}</Chip>
          </div>
          {r.progress && <div style={{ fontSize: 13 }}>{r.progress.label}</div>}
          {r.creditDeadline && !r.joinedOn && (
            <div style={{ fontSize: 13, color: r.creditDeadline >= istToday() ? "#2f7a3f" : "#b3402a" }}>
              {r.creditDeadline >= istToday()
                ? `₹12,000 credit if they join by ${human(r.creditDeadline)} (7 days after call 2).`
                : `Credit window closed ${human(r.creditDeadline)} — joining now is full price.`}
            </div>
          )}
          {!r.call1On && <div style={muted}>Gift must be used (first call held) by {human(r.expiresOn)}.</div>}
          {!r.joinedOn && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input type="date" value={stepDate} max={istToday()} onChange={(e) => setStepDate(e.target.value)} style={input} />
              {!r.call1On && (
                <button className="fm-btn" disabled={busy} onClick={() => record("call_1")}>
                  Call 1 done
                </button>
              )}
              {r.call1On && !r.call2On && (
                <button className="fm-btn" disabled={busy} onClick={() => record("call_2")}>
                  Call 2 done
                </button>
              )}
              <button className="fm-btn" disabled={busy} onClick={() => record("joined")}>
                Joined Sequoya
              </button>
            </div>
          )}
          <div style={muted}>
            Call 2 also reveals their Starting Map in the app. Their credit is 7 days from call 2 — not the usual 15 —
            and they are left out of the automatic call follow-up emails. &ldquo;Joined Sequoya&rdquo; only records the
            date for the credit — set their sign-up status as usual.
          </div>
          {error && <div style={{ fontSize: 12.5, color: "#b3402a" }}>{error}</div>}
        </div>
      </FmPanel>
    );
  }

  // ── founder / potential founder ────────────────────────────────────────────
  const placesLine = `${state.placesTaken} of ${state.placesTotal} founding places taken`;
  return (
    <FmPanel
      title="🌲 Sequoya founding member"
      subtitle={state.founding ? `Founding member since ${human(state.joinedOn)} · ${placesLine}` : placesLine}
    >
      <div style={{ display: "grid", gap: 12 }}>
        {!state.founding ? (
          <>
            <div style={muted}>
              The first 20 who sign up for Sequoya (2–31 Jan 2027) get a gifted Foundation session for someone they
              love, a locked Sequoya+ rate, and a founding mark in their app.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: 12.5 }}>
                Joined{" "}
                <input type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} style={input} />
              </label>
              <label style={{ fontSize: 12.5 }}>
                Sequoya+ rate ₹{" "}
                <input
                  inputMode="numeric"
                  value={rate}
                  onChange={(e) => setRate(e.target.value.replace(/\D+/g, ""))}
                  style={{ ...input, width: 100 }}
                />
              </label>
              <button
                className="fm-btn"
                disabled={busy || state.placesTaken >= state.placesTotal}
                onClick={() => setFounding(true)}
              >
                {busy ? "…" : "🌲 Mark as founding member"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Chip tone="brand">Founding member</Chip>
              <Chip tone="muted">
                🔒 Locked Sequoya+ rate {state.rateInr ? inr(state.rateInr) : "—"} · coach-only
              </Chip>
              <button className="fm-btn" disabled={busy} onClick={() => setFounding(false)} style={{ marginLeft: "auto", fontSize: 12 }}>
                Unmark
              </button>
            </div>

            {/* the one gift */}
            {state.gift ? (
              <div style={{ display: "grid", gap: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(201,74,119,0.05)" }}>
                <div style={{ fontSize: 13.5 }}>
                  🎁 Gifted Foundation session →{" "}
                  <a href={`/clients-v2/${state.gift.recipientId}`} style={{ fontWeight: 600 }}>
                    {state.gift.recipientName}
                  </a>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Chip
                    tone={
                      state.gift.progress?.status === "expired"
                        ? "warn"
                        : state.gift.progress?.status === "joined"
                          ? "ok"
                          : "brand"
                    }
                  >
                    {state.gift.progress?.label ?? `Issued ${human(state.gift.issuedOn)}`}
                  </Chip>
                </div>
                {state.gift.progress?.creditDeadline && state.gift.progress.status === "call_2_done" && (
                  <div style={{ fontSize: 12.5, color: "#2f7a3f" }}>
                    Credit deadline: {human(state.gift.progress.creditDeadline)}
                  </div>
                )}
                {state.gift.link && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="fm-btn" onClick={() => copy("link", state.gift!.link!)}>
                      {copied === "link" ? "✓ Copied" : "📋 Copy gift link"}
                    </button>
                    <button className="fm-btn" disabled={busy} onClick={showMessage}>
                      💬 Message for {state.firstName}
                    </button>
                    {(state.gift.progress?.status === "issued" || state.gift.progress?.status === "expired") && (
                      <button className="fm-btn" disabled={busy} onClick={revoke} style={{ fontSize: 12 }}>
                        Revoke
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(0,0,0,0.03)" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>🎁 Gift a Foundation session</div>
                <div style={muted}>
                  One per founder, for a family member or friend (not themselves). No price shown anywhere; must be
                  used by 30 Apr 2027.
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 12.5 }}>
                  <label>
                    <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> New person
                  </label>
                  <label>
                    <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> Already in
                    my records
                  </label>
                </div>
                {mode === "new" ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input placeholder="Their name" value={rName} onChange={(e) => setRName(e.target.value)} style={input} />
                    <input placeholder="Mobile" value={rMobile} onChange={(e) => setRMobile(e.target.value)} style={{ ...input, width: 140 }} />
                    <input placeholder="Email (optional)" value={rEmail} onChange={(e) => setREmail(e.target.value)} style={input} />
                  </div>
                ) : (
                  <select value={pick} onChange={(e) => setPick(e.target.value)} style={input}>
                    <option value="">Choose…</option>
                    {state.candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.id})
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="fm-btn"
                  disabled={busy || (mode === "existing" ? !pick : !rName.trim())}
                  onClick={issue}
                  style={{ justifySelf: "start" }}
                >
                  {busy ? "Preparing…" : "🎁 Create gift link"}
                </button>
              </div>
            )}

            {waText && (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={muted}>Send this to {state.firstName} to forward:</div>
                <textarea readOnly value={waText} rows={7} style={{ ...input, width: "100%", fontFamily: "inherit" }} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="fm-btn" onClick={() => copy("msg", waText)}>
                    {copied === "msg" ? "✓ Copied" : "📋 Copy message"}
                  </button>
                  {state.mobileNumber && (
                    <a className="fm-btn" href={waHref(state.mobileNumber, waText)} target="_blank" rel="noreferrer">
                      💬 Send to {state.firstName} on WhatsApp
                    </a>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        {note && <div style={{ fontSize: 12.5, color: "#2f7a3f" }}>{note}</div>}
        {error && <div style={{ fontSize: 12.5, color: "#b3402a" }}>{error}</div>}
      </div>
    </FmPanel>
  );
}

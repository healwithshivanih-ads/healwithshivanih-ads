/**
 * CycleTrackingPanel — coach-owned menstrual-cycle dates on the v2 Overview.
 *
 * Piece B foundation. The intake form seeds period start / end / cycle
 * length once; thereafter the coach refreshes them here from whatever the
 * client mentions in a check-in, WhatsApp or call (clients reliably know
 * "my period started the 5th" — they do NOT reliably know "LMP" or how to
 * count days from it). A current period-start date is what the cycle-aware
 * test recommender will time luteal-phase draws from.
 *
 * Only renders for menstruating / perimenopausal clients.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FmPanel } from "@/components/fm";
import { updateCycleTracking } from "@/lib/server-actions/clients";
import { sendCycleDateCheckAction } from "@/lib/server-actions/cycle-date-collector";

interface Props {
  clientId: string;
  cycleStatus?: string;
  lastMenstrualPeriod?: string;
  lastPeriodEndDate?: string;
  cycleLengthDays?: number;
  cycleRegularity?: string;
  lastCycleAskSent?: string;
  /** B8 — when cycle_status is null we still want to surface the panel
   *  for female clients in the 35-65 band as a "pick your stage" prompt,
   *  AND auto-derive a hint when the intake's menstrual_notes prose
   *  mentions "perimenopause" / "postmenopause" / "still cycling". */
  sex?: string;
  ageYears?: number;
  menstrualNotes?: string;
}

const REGULARITY: { v: string; label: string }[] = [
  { v: "", label: "Not recorded" },
  { v: "regular", label: "Regular" },
  { v: "irregular", label: "Irregular" },
  { v: "very_irregular", label: "Very irregular" },
];

function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function addDays(iso: string, n: number): string | null {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysSince(iso: string): number | null {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

export function CycleTrackingPanel(p: Props) {
  const cycling =
    p.cycleStatus === "menstruating" || p.cycleStatus === "perimenopausal";
  const postmenopausal = p.cycleStatus === "postmenopausal";

  // Postmenopausal: cycle tracking doesn't apply. Render a compact
  // status tile instead of the LMP / cycle-length / next-period form
  // (which is meaningless when she hasn't menstruated in 12+ months).
  // Hormone-axis context is still relevant (E2/progesterone/FSH stays
  // on her labs list), but the cycle dates DON'T need refreshing.
  if (postmenopausal) {
    return (
      <FmPanel
        title="🌙 Hormonal stage"
        subtitle="Cycle tracking doesn't apply — labs and hormone work continue."
      >
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(168, 85, 247, 0.06)",
            border: "1px solid rgba(168, 85, 247, 0.22)",
            borderRadius: 8,
            fontSize: 14,
            lineHeight: 1.5,
            color: "var(--fm-text-primary)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 18 }}>🌙</span>
          <div>
            <strong>Postmenopausal</strong>
            <div style={{ fontSize: 12, color: "var(--fm-text-secondary)", marginTop: 2 }}>
              FSH / E2 / progesterone labs still relevant for HRT decisions and
              bone / cardiovascular risk reads. No cycle-date refresh needed.
            </div>
          </div>
        </div>
      </FmPanel>
    );
  }

  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(p.lastMenstrualPeriod ?? "");
  const [end, setEnd] = useState(p.lastPeriodEndDate ?? "");
  const [len, setLen] = useState(
    p.cycleLengthDays ? String(p.cycleLengthDays) : ""
  );
  const [reg, setReg] = useState(p.cycleRegularity ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");

  // B8 — when cycle_status is not set on a female client of any age,
  // surface a prompt rather than silently hiding the panel. Helps coach
  // catch the gap (Kshitija cl-010 — menstrual_notes literally said
  // "Perimenopause. Sometimes in 3 months and sometimes in 6 months"
  // but cycle_status was null so the panel never rendered). Auto-derives
  // a suggested status from menstrual_notes when possible.
  const isFemale = (p.sex ?? "").toLowerCase() === "f" ||
    (p.sex ?? "").toLowerCase() === "female";
  const noStatus = !p.cycleStatus;
  if (!cycling && noStatus && isFemale) {
    const notes = (p.menstrualNotes ?? "").toLowerCase();
    let suggested: "perimenopausal" | "postmenopausal" | "menstruating" | null = null;
    let suggestedFrom = "";
    if (/postmenopaus|post-menopaus|menopaus.{0,30}(complete|ended|finished)/i.test(notes)) {
      suggested = "postmenopausal";
      suggestedFrom = "menstrual_notes mentions postmenopause";
    } else if (/perimenopaus/i.test(notes)) {
      suggested = "perimenopausal";
      suggestedFrom = "menstrual_notes mentions perimenopause";
    } else if (/(still|currently)\s+(cycling|menstruating)|regular\s+period/i.test(notes)) {
      suggested = "menstruating";
      suggestedFrom = "menstrual_notes describes regular cycles";
    }
    return (
      <FmPanel
        title="🩸 Hormonal stage — not set"
        subtitle="Cycle / menopause status is unrecorded. Set it so the cycle-aware test recommender + hormone interpretations work."
      >
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.30)",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--fm-text-primary)",
            display: "grid",
            gap: 8,
          }}
        >
          {suggested ? (
            <div>
              <strong>Suggestion:</strong>{" "}
              <em>{suggested}</em>{" "}
              <span style={{ color: "var(--fm-text-tertiary)" }}>
                ({suggestedFrom})
              </span>
            </div>
          ) : (
            <div>
              No menstrual notes on file. Ask the client and set the
              status — it changes hormone lab interpretation + meal-plan
              framing significantly.
            </div>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 600,
              background: "#b45309",
              color: "white",
              border: 0,
              borderRadius: 5,
              cursor: "pointer",
              width: "fit-content",
            }}
          >
            🩸 Set hormonal stage + cycle dates
          </button>
          {editing && (
            <div
              style={{
                marginTop: 6,
                padding: "10px 12px",
                background: "rgba(255,255,255,0.7)",
                border: "1px solid rgba(245, 158, 11, 0.30)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--fm-text-secondary)",
              }}
            >
              Use the <strong>✏️ Edit identity</strong> button on the client
              header to set <code>cycle_status</code>, then come back here
              to log Day-1 dates and cycle length. (A direct picker for the
              stage on this panel is a planned upgrade.)
            </div>
          )}
        </div>
      </FmPanel>
    );
  }

  if (!cycling) return null;

  const nextPeriod =
    p.lastMenstrualPeriod && p.cycleLengthDays
      ? addDays(p.lastMenstrualPeriod, p.cycleLengthDays)
      : null;
  const ageStart = p.lastMenstrualPeriod
    ? daysSince(p.lastMenstrualPeriod)
    : null;
  const stale =
    ageStart != null &&
    p.cycleLengthDays != null &&
    ageStart > p.cycleLengthDays + 10;
  const missing = !p.lastMenstrualPeriod || !p.cycleLengthDays;
  const regLabel =
    REGULARITY.find((r) => r.v === (p.cycleRegularity ?? ""))?.label ?? "—";

  // ── Cycle-aware test timing ──────────────────────────────────────────────
  // Progesterone + oestradiol are only meaningful mid-luteal (~7 days before
  // the next period). Compute the draw date from the current cycle dates.
  let lutealDraw: string | null = null;
  let lutealDay: number | null = null;
  let drawStatus: "upcoming" | "now" | "next-cycle" = "upcoming";
  if (p.lastMenstrualPeriod && p.cycleLengthDays && !stale) {
    const base = addDays(p.lastMenstrualPeriod, p.cycleLengthDays - 7);
    if (base) {
      const age = daysSince(base); // today − base
      if (age == null || age <= 0) {
        lutealDraw = base;
        drawStatus = "upcoming";
      } else if (age <= 4) {
        lutealDraw = base;
        drawStatus = "now";
      } else {
        lutealDraw = addDays(base, p.cycleLengthDays);
        drawStatus = "next-cycle";
      }
      lutealDay = p.cycleLengthDays - 6;
    }
  }

  async function save() {
    setSaving(true);
    setErr("");
    const r = await updateCycleTracking({
      client_id: p.clientId,
      last_menstrual_period: start || "",
      last_period_end_date: end || "",
      cycle_length_days: len ? parseInt(len, 10) : null,
      cycle_regularity: reg || "",
    });
    setSaving(false);
    if (r.ok) {
      setEditing(false);
      router.refresh();
    } else {
      setErr(r.error);
    }
  }

  async function sendCheck() {
    setSending(true);
    setSendMsg("");
    const r = await sendCycleDateCheckAction(p.clientId);
    setSending(false);
    if (r.ok) {
      setSendMsg("✓ Sent — her date reply will auto-fill this.");
      router.refresh();
    } else {
      setSendMsg("⚠ " + (r.error ?? "Send failed"));
    }
  }

  return (
    <FmPanel title="🩸 Menstrual cycle">
      {!editing ? (
        <div className="space-y-1.5 text-sm">
          <Row label="Period started (Day 1)" value={fmtDate(p.lastMenstrualPeriod)} />
          <Row label="Bleeding ended" value={fmtDate(p.lastPeriodEndDate)} />
          <Row
            label="Cycle length"
            value={p.cycleLengthDays ? `${p.cycleLengthDays} days` : "—"}
          />
          <Row label="Regularity" value={regLabel} />
          {nextPeriod && (
            <Row label="Next period ~" value={fmtDate(nextPeriod)} />
          )}

          {stale && (
            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[12px] text-amber-800">
              Period started {ageStart} days ago — a new cycle has likely begun.
              Refresh these dates after her next period so test timing stays
              accurate.
            </p>
          )}
          {missing && !stale && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Add the period start date and cycle length to compute cycle timing.
            </p>
          )}

          {lutealDraw && (
            <div className="mt-2 rounded border border-indigo-200 bg-indigo-50 px-2.5 py-2 text-[12px] space-y-1">
              <p className="font-semibold text-indigo-900">
                📋 Luteal hormone panel — timing
              </p>
              <p className="text-indigo-900">
                Progesterone + oestradiol are only meaningful mid-luteal (~7 days
                before her next period).{" "}
                {drawStatus === "now" ? (
                  <>
                    Her luteal window is <strong>open now</strong> — draw within
                    the next day or two (cycle day ~{lutealDay}).
                  </>
                ) : drawStatus === "next-cycle" ? (
                  <>
                    This cycle&apos;s window has passed — next opportunity{" "}
                    <strong>{fmtDate(lutealDraw)}</strong> (cycle day ~
                    {lutealDay}).
                  </>
                ) : (
                  <>
                    Target draw: <strong>{fmtDate(lutealDraw)}</strong> (cycle
                    day ~{lutealDay}).
                  </>
                )}
              </p>
              <p className="text-indigo-700">
                More precise: LH ovulation strips from day 12 — draw 7 days after
                the surge. Best when her cycle length varies. A mid-luteal
                progesterone also confirms she ovulated this cycle.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 text-[12px] font-medium text-indigo-600 hover:underline"
          >
            ✏️ Edit cycle dates
          </button>

          <div className="mt-3 border-t pt-2.5">
            <button
              type="button"
              onClick={sendCheck}
              disabled={sending}
              className={`text-[12px] font-medium hover:underline disabled:opacity-50 ${
                stale ? "text-rose-600" : "text-indigo-600"
              }`}
            >
              📲 {sending ? "Sending…" : "Send period-date check (WhatsApp)"}
            </button>
            {sendMsg ? (
              <p className="mt-1 text-[11px] text-muted-foreground">{sendMsg}</p>
            ) : p.lastCycleAskSent ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Last asked {fmtDate(p.lastCycleAskSent)} — her dated reply
                auto-fills the period start.
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Asks the client by WhatsApp; her dated reply auto-fills the
                period start.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-muted-foreground text-[12px]">
              Period started — first day of full flow (Day 1)
            </span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground text-[12px]">
              Bleeding ended — last day of real flow, not spotting
            </span>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 w-full rounded border px-2 py-1"
            />
          </label>
          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-muted-foreground text-[12px]">
                Cycle length (days)
              </span>
              <input
                type="number"
                min={20}
                max={60}
                value={len}
                onChange={(e) => setLen(e.target.value)}
                placeholder="28"
                className="mt-1 w-full rounded border px-2 py-1"
              />
            </label>
            <label className="block flex-1">
              <span className="text-muted-foreground text-[12px]">
                Regularity
              </span>
              <select
                value={reg}
                onChange={(e) => setReg(e.target.value)}
                className="mt-1 w-full rounded border px-2 py-1"
              >
                {REGULARITY.map((r) => (
                  <option key={r.v} value={r.v}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {err && <p className="text-[12px] text-red-600">{err}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded bg-indigo-600 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setErr("");
                setStart(p.lastMenstrualPeriod ?? "");
                setEnd(p.lastPeriodEndDate ?? "");
                setLen(p.cycleLengthDays ? String(p.cycleLengthDays) : "");
                setReg(p.cycleRegularity ?? "");
              }}
              className="rounded border px-3 py-1.5 text-[13px] font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </FmPanel>
  );
}

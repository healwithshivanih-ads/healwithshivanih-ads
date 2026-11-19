"use client";

/**
 * The Everything tab's own screens in the new front: your supplements, order
 * supplements, weight and blood pressure, and your trip. They post to the
 * same routes the old app uses (/api/app-body, /api/app-travel) and never
 * name the coach. Wording follows the prototype (docs/client-app-redesign).
 */

import { useEffect, useState } from "react";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { SqCard, SqIcon } from "./sq-ui";

const REPLY = "Your coach replies within 24 hours.";

/* ---------- supplements ---------- */

export function SqSuppsSheet({ data }: { data: ClientAppData }) {
  const now = data.supplements;
  const next = data.upcomingSupplements ?? [];
  if (!now.length && !next.length) {
    return (
      <SqCard>
        <p className="sq-sub">There are no supplements in your plan right now.</p>
      </SqCard>
    );
  }
  return (
    <>
      <SqCard>
        <div className="sq-list">
          {now.map((s) => (
            <div key={s.id} className="sq-li sq-li-static">
              <span className="sq-li-body">
                <b>{s.name}</b>
                <small>{[s.dose, s.timing].filter(Boolean).join(" · ")}</small>
                {s.why && <small>{s.why}</small>}
              </span>
            </div>
          ))}
        </div>
      </SqCard>
      {next.length > 0 && (
        <SqCard title="Starting next week">
          <div className="sq-list">
            {next.map((s) => (
              <div key={s.id} className="sq-li sq-li-static">
                <span className="sq-li-body">
                  <b>{s.name}</b>
                  <small>{[s.dose, s.timing].filter(Boolean).join(" · ")}</small>
                </span>
              </div>
            ))}
          </div>
        </SqCard>
      )}
    </>
  );
}

type OrderState = "" | "open" | "done";
export interface OrderRow {
  id: string;
  name: string;
  buyUrl?: string;
  shop: string;
}

export function shopOf(url?: string): string {
  if (!url) return "";
  if (/vitaone/i.test(url)) return "VitaOne";
  if (/fmnutrition/i.test(url)) return "FM Nutrition";
  if (/amazon|amzn/i.test(url)) return "Amazon";
  if (/iherb/i.test(url)) return "iHerb";
  return "Shop page";
}

export function orderRows(data: ClientAppData): OrderRow[] {
  const rows: OrderRow[] = [...data.supplements, ...(data.upcomingSupplements ?? [])].map((s) => ({
    id: s.id,
    name: s.startsNextWeek ? `${s.name} (starts next week)` : s.name,
    buyUrl: s.buyUrl,
    shop: shopOf(s.buyUrl),
  }));
  for (const r of data.remedies) {
    if (r.assigned && r.buyUrl) rows.push({ id: "rx-" + r.slug, name: r.name, buyUrl: r.buyUrl, shop: shopOf(r.buyUrl) });
  }
  return rows;
}

function useOrdered(data: ClientAppData) {
  const key = `sq.orders.${data.clientId}.${data.planSlug}`;
  const [map, setMap] = useState<Record<string, OrderState>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setMap(JSON.parse(raw) as Record<string, OrderState>);
    } catch {
      /* private mode: start fresh */
    }
  }, [key]);
  const set = (next: Record<string, OrderState>) => {
    setMap(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };
  return [map, set] as const;
}

export function SqOrderSheet({ data, onAsk }: { data: ClientAppData; onAsk: () => void }) {
  const rows = orderRows(data);
  const [st, setSt] = useOrdered(data);
  const all = rows.length > 0 && rows.every((r) => st[r.id] === "done");
  const put = (id: string, v: OrderState) => setSt({ ...st, [id]: v });
  return (
    <>
      <p className="sq-sub">Each one opens its own shop page, where you pay. Come back and tick it once it is ordered.</p>
      <SqCard>
        <div className="sq-list">
          {rows.map((r) => {
            const s = st[r.id] ?? "";
            return (
              <div key={r.id} className="sq-li sq-li-static sq-ord">
                <span className="sq-li-body">
                  <b>{r.name}</b>
                  <small>{r.buyUrl ? r.shop : "Ask your coach where to get this one"}</small>
                  {s === "done" && (
                    <span className="sq-status">
                      <SqIcon name="check" /> Ordered
                    </span>
                  )}
                  {s === "open" && <small>Shop page opened</small>}
                </span>
                {s === "done" ? (
                  <button type="button" className="sq-link" onClick={() => put(r.id, "")}>
                    Undo
                  </button>
                ) : s === "open" || !r.buyUrl ? (
                  <button type="button" className="sq-btn sq-btn-solid sq-btn-small" onClick={() => put(r.id, "done")}>
                    I&rsquo;ve ordered it
                  </button>
                ) : (
                  <a
                    className="sq-btn sq-btn-solid sq-btn-small"
                    href={r.buyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => put(r.id, "open")}
                  >
                    Buy
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </SqCard>
      {all ? (
        <p className="sq-status">
          <SqIcon name="check" /> All ordered
        </p>
      ) : (
        <div className="sq-prow">
          <button
            type="button"
            className="sq-btn sq-btn-quiet"
            onClick={() => setSt(Object.fromEntries(rows.map((r) => [r.id, "done" as OrderState])))}
          >
            I already have them all
          </button>
          {rows.some((r) => !r.buyUrl) && (
            <button type="button" className="sq-btn sq-btn-quiet" onClick={onAsk}>
              Ask my coach
            </button>
          )}
        </div>
      )}
      <p className="sq-sub sq-small">The shop page shows the real price.</p>
    </>
  );
}

/* ---------- weight and blood pressure ---------- */

export interface VitalsCheck {
  error?: string;
  weightKg?: number;
  sys?: number;
  dia?: number;
  high?: boolean;
}

/** The prototype's rules: weight 25–250 kg; BP as "118/76", top 70–260,
 *  bottom 40–160, top higher than bottom. 180/120 or more is a high reading. */
export function checkVitals(wRaw: string, pRaw: string): VitalsCheck {
  const w = wRaw.trim().replace(/\s*kgs?$/i, "");
  const p = pRaw.trim();
  if (!w && !p) return { error: "Enter at least one of the two." };
  const out: VitalsCheck = {};
  if (w) {
    const n = parseFloat(w);
    if (!/^\d{2,3}(\.\d{1,2})?$/.test(w) || n < 25 || n > 250) {
      return { error: "That weight does not look right. Enter it in kg, like 68.5." };
    }
    out.weightKg = n;
  }
  if (p) {
    const m = p.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if (!m) return { error: "Blood pressure goes in as two numbers, like 118/76." };
    const a = +m[1];
    const b = +m[2];
    if (a <= b) return { error: "The first number is the higher one, like 118/76." };
    if (a < 70 || a > 260 || b < 40 || b > 160) return { error: "Those numbers do not look right. Check the reading, like 118/76." };
    out.sys = a;
    out.dia = b;
    out.high = a >= 180 || b >= 120;
  }
  return out;
}

function shortDate(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function weightLine(hist: { date: string; weightKg: number | null }[]): string {
  const ws = hist.filter((h) => h.weightKg != null);
  if (ws.length < 2) return "Log it twice to see the change.";
  const a = ws[0];
  const b = ws[ws.length - 1];
  const d = Math.abs((b.weightKg as number) - (a.weightKg as number)).toFixed(1);
  if (d === "0.0") return `${b.weightKg} kg, the same as on ${shortDate(a.date)}.`;
  const dir = (b.weightKg as number) < (a.weightKg as number) ? "down" : "up";
  return `${b.weightKg} kg, ${dir} ${d} kg since ${shortDate(a.date)}.`;
}

export function SqVitalsSheet({ data, todayYmd }: { data: ClientAppData; todayYmd: string }) {
  const [w, setW] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<VitalsCheck | null>(null);
  const [hist, setHist] = useState(data.body.history);

  const save = async () => {
    const c = checkVitals(w, p);
    if (c.error) {
      setErr(c.error); // what was typed stays in the boxes
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/app-body", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, weight_kg: c.weightKg ?? null, bp_systolic: c.sys ?? null, bp_diastolic: c.dia ?? null }),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (!res.ok || !out.ok) throw new Error();
      setSaved(c);
      setHist((h) => [
        ...h.filter((x) => x.date !== todayYmd),
        {
          date: todayYmd,
          weightKg: c.weightKg ?? h.find((x) => x.date === todayYmd)?.weightKg ?? null,
          waistCm: null,
          hipCm: null,
          bpSystolic: c.sys ?? null,
          bpDiastolic: c.dia ?? null,
          moodScore: null,
        },
      ]);
      setW("");
      setP("");
    } catch {
      setErr("That did not save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const rows = hist.filter((h) => h.weightKg != null || h.bpSystolic != null).slice(-12).reverse();
  return (
    <>
      <SqCard>
        <label className="sq-sec" htmlFor="sq-vw">
          Weight in kg
        </label>
        <input id="sq-vw" className="sq-dinput" inputMode="decimal" placeholder="68.5" value={w} onChange={(e) => setW(e.target.value)} />
        <label className="sq-sec" htmlFor="sq-vb">
          Blood pressure
        </label>
        <input id="sq-vb" className="sq-dinput" inputMode="numeric" placeholder="118/76" value={p} onChange={(e) => setP(e.target.value)} />
      </SqCard>
      {err && (
        <p className="sq-err" role="alert">
          {err}
        </p>
      )}
      {saved && (
        <p className="sq-status" role="status">
          <SqIcon name="check" /> Saved today: {[saved.weightKg != null && `${saved.weightKg} kg`, saved.sys && `${saved.sys}/${saved.dia}`].filter(Boolean).join(" · ")}
        </p>
      )}
      {saved?.high && (
        <section className="sq-soft">
          That is a high reading. Sit quietly for five minutes and measure again. If it stays this high, see a doctor today.
        </section>
      )}
      <div className="sq-prow">
        <button type="button" className="sq-btn sq-btn-solid" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {rows.length > 0 && (
        <SqCard title="Your entries">
          <div className="sq-list">
            {rows.map((h) => (
              <div key={h.date} className="sq-li sq-li-static">
                <span className="sq-li-body">
                  <b>{h.date === todayYmd ? "Today" : shortDate(h.date)}</b>
                  <small>
                    {[h.weightKg != null && `${h.weightKg} kg`, h.bpSystolic != null && `${h.bpSystolic}/${h.bpDiastolic}`].filter(Boolean).join(" · ")}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </SqCard>
      )}
      <p className="sq-sub sq-small">{weightLine(hist)} Your coach sees these too.</p>
    </>
  );
}

/* ---------- travel ---------- */

/** Home shows the Travelling card from the day of travel, not before. */
export function travellingNow(data: ClientAppData, todayYmd: string): boolean {
  const t = data.travel;
  return !!t && t.kind === "travel" && t.from <= todayYmd && todayYmd <= t.to;
}

export function tripDates(from: string, to: string): string {
  return `${shortDate(from)} to ${shortDate(to)}`;
}

export function SqTripSheet({ data, todayYmd, onEatOut }: { data: ClientAppData; todayYmd: string; onEatOut?: () => void }) {
  const t = data.travel && data.travel.kind === "travel" ? data.travel : null;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [where, setWhere] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ from: string; to: string } | null>(null);
  const [ended, setEnded] = useState<"" | "over" | "cancelled">("");

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/app-travel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, ...body }),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !out.ok) throw new Error(out.error || "");
      return true;
    } catch {
      setErr("That did not send. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (ended) {
    return (
      <section className="sq-soft" role="status">
        {ended === "cancelled" ? "Trip cancelled. Your plan carries on as usual." : "Welcome back. Your plan carries on as usual."}
      </section>
    );
  }

  const cur = sent ?? (t ? { from: t.from, to: t.to } : null);
  if (cur) {
    const started = cur.from <= todayYmd;
    return (
      <>
        <p className="sq-status">
          <SqIcon name="check" /> Sent to your coach
        </p>
        <section className="sq-soft">
          Travelling {tripDates(cur.from, cur.to)}. {REPLY}
        </section>
        {err && <p className="sq-err">{err}</p>}
        <div className="sq-prow">
          {onEatOut && (
            <button type="button" className="sq-btn sq-btn-solid" onClick={onEatOut}>
              Eating-out guide
            </button>
          )}
          <button
            type="button"
            className="sq-btn sq-btn-quiet"
            disabled={busy}
            onClick={async () => {
              if (await post({ cancelled: true })) setEnded(started ? "over" : "cancelled");
            }}
          >
            {started ? "The trip is over" : "Cancel the trip"}
          </button>
        </div>
      </>
    );
  }

  const send = async () => {
    if (!from || !to) return setErr("Fill in both dates.");
    if (to < from) return setErr("The day you are back comes after the day you leave.");
    if (to < todayYmd) return setErr("Those dates have already passed.");
    if (await post({ kind: "travel", from, to, location: where.trim(), context: "" })) setSent({ from, to });
  };
  return (
    <>
      <p className="sq-sub">Your coach sees the dates and can adjust your plan for the days you are away.</p>
      <SqCard>
        <label className="sq-sec" htmlFor="sq-tf">
          Leaving on
        </label>
        <input id="sq-tf" className="sq-dinput" type="date" min={todayYmd} value={from} onChange={(e) => setFrom(e.target.value)} />
        <label className="sq-sec" htmlFor="sq-tt">
          Back on
        </label>
        <input id="sq-tt" className="sq-dinput" type="date" min={from || todayYmd} value={to} onChange={(e) => setTo(e.target.value)} />
        <label className="sq-sec" htmlFor="sq-tw">
          Where to (if you like)
        </label>
        <input id="sq-tw" className="sq-dinput" placeholder="Goa" value={where} onChange={(e) => setWhere(e.target.value)} />
      </SqCard>
      {err && (
        <p className="sq-err" role="alert">
          {err}
        </p>
      )}
      <div className="sq-prow">
        <button type="button" className="sq-btn sq-btn-solid" disabled={busy} onClick={send}>
          {busy ? "Sending…" : "Send to my coach"}
        </button>
      </div>
    </>
  );
}

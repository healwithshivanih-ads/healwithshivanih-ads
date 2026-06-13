"use client";

/**
 * Shared UI pieces: header, bottom nav, meal rows, supplement logging,
 * week strip, rings, plate diagram, food tiers, remedy cards & library.
 * Faithful port of components.jsx / components2.jsx from the design.
 */

import { useEffect, useState } from "react";
import type { AppRemedy, PlateItem } from "@/lib/fmdb/client-app";
import { Icon, Mark, useOchre, REMEDY_CAT, DOSHA_LABEL } from "./ochre-context";

// ── avatar (photo with initials fallback) ────────────────────────────────────

/** Renders the client's photo when one exists, falling back to initials on a
 *  null URL or a load error. Shared by the header button and the account card. */
export function AppAvatar({
  photoUrl,
  initials,
  imgClass,
  phClass,
}: {
  photoUrl: string | null;
  initials: string;
  imgClass: string;
  phClass: string;
}) {
  const [failed, setFailed] = useState(false);
  if (photoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={imgClass} src={photoUrl} alt="" onError={() => setFailed(true)} />
    );
  }
  return <span className={phClass}>{initials}</span>;
}

// ── header + nav ─────────────────────────────────────────────────────────────

export function Header({ alert, onAccount }: { alert: boolean; onAccount: () => void }) {
  const { account } = useOchre();
  return (
    <header className="appbar">
      <div className="masthead">
        <span className="mark">
          <Mark />
        </span>
        <span className="wordmark">
          The <em>Ochre</em> Tree
        </span>
      </div>
      <button className="avatar-btn" onClick={onAccount} aria-label="Your account">
        <AppAvatar photoUrl={account.photoUrl} initials={account.avatar} imgClass="ph-img" phClass="ph" />
        {alert && <span className="badge" />}
      </button>
    </header>
  );
}

const TABS = [
  { id: "today", label: "Today", icon: "today" },
  { id: "plan", label: "Plan", icon: "plan" },
  { id: "progress", label: "Progress", icon: "progress" },
  { id: "coach", label: "Coach", icon: "coach" },
];

export function BottomNav({
  active,
  onChange,
  coachAlert,
}: {
  active: string;
  onChange: (tab: string) => void;
  coachAlert: boolean;
}) {
  return (
    <nav className="bottomnav">
      {TABS.map((t) => (
        <button key={t.id} className={"tab" + (active === t.id ? " active" : "")} onClick={() => onChange(t.id)}>
          <span className="ic">
            <Icon name={t.icon} size={23} />
          </span>
          <span className="tl-label">{t.label}</span>
          {t.id === "coach" && coachAlert && <span className="dot-badge" />}
        </button>
      ))}
    </nav>
  );
}

// ── generic bits ─────────────────────────────────────────────────────────────

export function Section({
  title,
  children,
  action,
  onAction,
}: {
  title: string;
  children: React.ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {action && (
          <button className="link" onClick={onAction}>
            {action}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function Tile({
  icon,
  t1,
  t2,
  onClick,
  accent,
}: {
  icon: string;
  t1: string;
  t2: string;
  onClick?: () => void;
  accent?: boolean;
}) {
  return (
    <button
      className="tile"
      onClick={onClick}
      style={{ width: "100%", textAlign: "left", border: "none", cursor: onClick ? "pointer" : "default", font: "inherit" }}
    >
      <span className="ico" style={accent ? { background: "var(--ochre-tint)", color: "var(--ochre)" } : undefined}>
        <Icon name={icon} size={21} />
      </span>
      <span className="info" style={{ flex: 1 }}>
        <span className="t1" style={{ display: "block" }}>{t1}</span>
        <span className="t2" style={{ display: "block" }}>{t2}</span>
      </span>
      {onClick && (
        <span className="chev">
          <Icon name="chev" size={18} />
        </span>
      )}
    </button>
  );
}

export function Accordion({ items }: { items: { t?: string; q?: string; b?: string; a?: string }[] }) {
  const [open, setOpen] = useState(-1);
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {items.map((it, i) => (
        <div className="acc" key={i}>
          <button className="acc-head" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
            {it.t ?? it.q}
            <span className="chev">
              <Icon name="chev" size={18} />
            </span>
          </button>
          <div className={"acc-body" + (open === i ? " open" : "")}>
            <div>
              <p>{it.b ?? it.a}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MiniRating({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="mini-rating">
      {Array.from({ length: max }).map((_, i) => (
        <i key={i} className={i < value ? "" : "off"} />
      ))}
    </div>
  );
}

// ── meal thumbnail + week strip ──────────────────────────────────────────────

export function MealThumb({ slot, size = 56, radius = 14 }: { slot: string; size?: number; radius?: number }) {
  const { mealExtra } = useOchre();
  const img = mealExtra[slot]?.imageUrl;
  const grad = mealExtra[slot]?.grad ?? "linear-gradient(140deg,#e3cf9a,#9a8a4f)";
  return (
    <span
      className="meal-thumb"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: img ? `center / cover no-repeat url(${img})` : grad,
      }}
    >
      {!img && (
        <span className="mt-cam">
          <Icon name="forkKnife" size={size > 90 ? 18 : 14} style={{ color: "rgba(255,255,255,.92)" }} />
        </span>
      )}
    </span>
  );
}

export function WeekStrip({ selected, onSelect }: { selected: number; onSelect: (i: number) => void }) {
  const { weekStrip } = useOchre();
  return (
    <div className="weekstrip">
      {weekStrip.map((d, i) => (
        <button
          key={i}
          className={"daytile" + (d.today ? " today" : "") + (selected === i && !d.today ? " sel" : "")}
          onClick={() => onSelect(i)}
        >
          <span className="dow">{d.dow}</span>
          <span className="num">{d.num}</span>
          <span className="dot" />
        </button>
      ))}
    </div>
  );
}

// ── daily ring + progress arc ────────────────────────────────────────────────

export function DailyRing({ done, total, size = 64 }: { done: number; total: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  const [dash, setDash] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDash(circ * pct), 140);
    return () => clearTimeout(t);
  }, [pct, circ]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="daily-ring">
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="var(--forest)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ - dash}
        transform={`rotate(-90 ${c} ${c})`}
        style={{ transition: "stroke-dashoffset .9s cubic-bezier(.2,.7,.3,1)" }}
      />
      <text x={c} y={c + 1} textAnchor="middle" dominantBaseline="middle" fontFamily="Georgia, serif" fontSize={size * 0.3} fill="var(--ink)">
        {done}
      </text>
      <text x={c} y={c + size * 0.2} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.13} fill="var(--muted)">
        of {total}
      </text>
    </svg>
  );
}

export function ProgressArc({ week, total }: { week: number; total: number }) {
  const r = 52,
    cx = 64,
    cy = 64;
  const circ = Math.PI * r;
  const pct = Math.min(week / total, 1);
  const [dash, setDash] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDash(circ * pct), 120);
    return () => clearTimeout(t);
  }, [pct, circ]);
  return (
    <div className="arc-wrap">
      <svg width="128" height="78" viewBox="0 0 128 78">
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--line)" strokeWidth="9" strokeLinecap="round" />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="var(--forest)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - dash}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.7,.3,1)" }}
        />
        <text x="64" y="56" textAnchor="middle" fontFamily="Georgia, serif" fontSize="30" fill="var(--ink)">
          {week}
        </text>
      </svg>
      <div className="arc-cap">
        Week {week} of {total}
      </div>
      <div className="arc-sub">{Math.round(pct * 100)}% through your plan</div>
    </div>
  );
}

// ── supplement logging ───────────────────────────────────────────────────────

interface SuppLike {
  id: string;
  name: string;
  dose: string;
  slot: string;
  timing: string;
}

export function SuppRow({
  supp,
  logged,
  takenAt,
  onToggle,
  isRemedy,
  onOpen,
}: {
  supp: SuppLike;
  logged: boolean;
  takenAt?: string;
  onToggle: (id: string) => void;
  isRemedy?: boolean;
  onOpen?: () => void;
}) {
  const [pop, setPop] = useState(false);
  const handle = () => {
    if (!logged) {
      setPop(true);
      setTimeout(() => setPop(false), 420);
    }
    onToggle(supp.id);
  };
  return (
    <div className="supp">
      <button
        className={"tick" + (logged ? " on" : "") + (pop ? " pop" : "")}
        onClick={handle}
        aria-pressed={logged}
        aria-label={logged ? `${supp.name} taken` : `Mark ${supp.name} as taken`}
      >
        <Icon name="checkBold" size={17} style={{ color: "#fff" }} />
      </button>
      <span className="info" onClick={isRemedy && onOpen ? onOpen : undefined} style={isRemedy && onOpen ? { cursor: "pointer" } : undefined}>
        <span className={"name" + (logged ? " done" : "")}>
          {supp.name}
          {isRemedy && <span className="supp-remedy-tag">Remedy</span>}
        </span>
        {logged ? <span className="taken-at">Taken · {takenAt}</span> : <span className="dose">{supp.dose}</span>}
      </span>
      <span className={"badge" + (supp.slot === "Bedtime" ? " forest" : "")}>{supp.timing}</span>
    </div>
  );
}

export function SupplementSlots({
  logged,
  onToggle,
  onLogAll,
  onOpenRemedy,
}: {
  logged: Record<string, string>;
  onToggle: (id: string) => void;
  onLogAll: () => void;
  onOpenRemedy?: (r: AppRemedy) => void;
}) {
  const { supplements, slotOrder, remedies } = useOchre();
  const slotGlyph: Record<string, string> = { Morning: "sun", "With meals": "bowl", Bedtime: "moon" };
  const suppRemedies = remedies.filter((r) => r.supplementLike && r.assigned && r.daily);
  return (
    <div className="card" style={{ padding: "4px 4px 12px" }}>
      {slotOrder.map((slot) => {
        const items = supplements
          .filter((s) => s.slot === slot && !s.asNeeded)
          .sort((a, b) => a.chronoRank - b.chronoRank);
        const rems = suppRemedies.filter((r) => (r.suppSlot ?? r.when) === slot);
        if (!items.length && !rems.length) return null;
        return (
          <div key={slot}>
            <div className="slot-label">
              <span className="glyph">
                <Icon name={slotGlyph[slot]} size={15} />
              </span>
              {slot}
            </div>
            <div style={{ padding: "0 10px" }}>
              {items.map((s) => (
                <SuppRow key={s.id} supp={s} logged={!!logged[s.id]} takenAt={logged[s.id]} onToggle={onToggle} />
              ))}
              {rems.map((r) => {
                const id = "rx-" + r.slug;
                return (
                  <SuppRow
                    key={id}
                    isRemedy
                    supp={{ id, name: r.name, dose: r.dose, slot, timing: r.suppTiming ?? r.when ?? "" }}
                    logged={!!logged[id]}
                    takenAt={logged[id]}
                    onToggle={onToggle}
                    onOpen={onOpenRemedy ? () => onOpenRemedy(r) : undefined}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
      <div style={{ padding: "0 10px" }}>
        <button className="log-all" onClick={onLogAll}>
          <Icon name="check" size={17} /> Log everything for today
        </button>
      </div>
    </div>
  );
}

// ── phase ribbon ─────────────────────────────────────────────────────────────

export function PhaseRibbon() {
  const { planRef } = useOchre();
  const ph = planRef.phase;
  const cur = ph.list[ph.currentIdx];
  return (
    <div className="phase-card">
      <div className="phase-ribbon">
        {ph.list.map((p, i) => {
          const state = i < ph.currentIdx ? "done" : i === ph.currentIdx ? "now" : "next";
          return (
            <div key={i} className={"phase-step " + state}>
              <div className="ph-dot">{i < ph.currentIdx ? <Icon name="check" size={13} style={{ color: "#fff" }} /> : i + 1}</div>
              <div className="ph-name">{p.name}</div>
              <div className="ph-weeks">{p.weeks}</div>
            </div>
          );
        })}
      </div>
      {cur && (
        <div className="phase-now">
          <span className="pn-tag">You’re here · {cur.name}</span>
          <span className="pn-note">{cur.note}</span>
        </div>
      )}
    </div>
  );
}

// ── the plate ────────────────────────────────────────────────────────────────

const PLATE_FILL: Record<string, string> = {
  forest: "var(--forest)",
  ochre: "var(--ochre)",
  sand: "#c4ad77",
  gold: "#d3a24f",
  clay: "#b5746a",
};

function platePath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p0 = ((a0 - 90) * Math.PI) / 180;
  const p1 = ((a1 - 90) * Math.PI) / 180;
  const x0 = cx + r * Math.cos(p0);
  const y0 = cy + r * Math.sin(p0);
  const x1 = cx + r * Math.cos(p1);
  const y1 = cy + r * Math.sin(p1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;
}

export function PlateDiagram() {
  const { planRef } = useOchre();
  const wedges = planRef.plate;
  const accents = planRef.accents;
  const items: PlateItem[] = [...wedges, ...accents];
  const [sel, setSel] = useState(0);
  const cx = 100,
    cy = 100,
    R = 92;
  let acc = 0;
  const arcs = wedges.map((s) => {
    const a0 = acc;
    acc += (s.pct / 100) * 360;
    return { s, a0, a1: acc };
  });
  const cur = items[sel];
  return (
    <div className="plate-card">
      <div className="plate-stage">
        <svg width="200" height="200" viewBox="0 0 200 200" className="plate-svg">
          <circle cx={cx} cy={cy} r={R + 5} fill="none" stroke="var(--line)" strokeWidth="2" />
          {arcs.map(({ s, a0, a1 }, i) => (
            <path
              key={i}
              d={platePath(cx, cy, R, a0, a1)}
              fill={PLATE_FILL[s.tone]}
              stroke="var(--paper)"
              strokeWidth="2.5"
              opacity={sel === i ? 1 : 0.82}
              onClick={() => setSel(i)}
              style={{ cursor: "pointer" }}
            />
          ))}
          {arcs.map(({ s, a0, a1 }, i) => {
            const mid = (a0 + a1) / 2;
            const rr = R * 0.6;
            const x = cx + rr * Math.cos(((mid - 90) * Math.PI) / 180);
            const y = cy + rr * Math.sin(((mid - 90) * Math.PI) / 180);
            return (
              <text key={i} x={x} y={y + 4} textAnchor="middle" fontFamily="Georgia, serif" fontSize={s.pct >= 50 ? 19 : 14} fill="#fff" style={{ pointerEvents: "none" }}>
                {s.pct === 50 ? "½" : "¼"}
              </text>
            );
          })}
        </svg>
        {accents.map((a, i) => {
          const idx = wedges.length + i;
          return (
            <button
              key={a.key}
              className={"plate-accent " + a.key + (sel === idx ? " on" : "")}
              style={{ ["--ac" as string]: PLATE_FILL[a.tone] }}
              onClick={() => setSel(idx)}
              aria-label={a.label}
            >
              <Icon name={a.icon ?? "leaf"} size={17} style={{ color: "#fff" }} />
            </button>
          );
        })}
      </div>

      <div className="plate-legend">
        {items.map((s, i) => (
          <button key={i} className={"pl-chip" + (sel === i ? " on" : "")} onClick={() => setSel(i)}>
            <span className="pl-dot" style={{ background: PLATE_FILL[s.tone] }} />
            {s.label}
          </button>
        ))}
      </div>

      {cur && (
        <div className="plate-detail">
          <div className="pd-top">
            <span className="pd-label">{cur.label}</span>
            <span className="pd-portion">{cur.portion}</span>
          </div>
          <div className="pd-note">{cur.note}</div>
          <div className="pill-list" style={{ marginTop: 10 }}>
            {cur.examples.map((e, i) => (
              <span className="food-pill" key={i}>
                {e}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── oils + food tiers ────────────────────────────────────────────────────────

export function OilGuide() {
  const { planRef } = useOchre();
  const o = planRef.oils;
  return (
    <div className="oil-card">
      <div className="oil-cols">
        <div className="oil-col use">
          <div className="oil-head">
            <Icon name="check" size={14} /> Cook with these
          </div>
          {o.use.map((x, i) => (
            <div className="oil-item" key={i}>
              {x}
            </div>
          ))}
        </div>
        <div className="oil-col avoid">
          <div className="oil-head">
            <Icon name="moon" size={13} /> Leave these out
          </div>
          {o.avoid.map((x, i) => (
            <div className="oil-item" key={i}>
              {x}
            </div>
          ))}
        </div>
      </div>
      <div className="oil-note">{o.note}</div>
    </div>
  );
}

const TIER_META = {
  eat: { label: "Eat freely", tone: "forest", icon: "check", verdict: "Yes — eat freely." },
  sometimes: { label: "Sometimes", tone: "sand", icon: "clock", verdict: "In small amounts is fine." },
  avoid: { label: "Leave out for now", tone: "ochre", icon: "moon", verdict: "Best left out for now." },
} as const;

export function FoodTiers() {
  const { planRef } = useOchre();
  const foods = planRef.foods;
  const lf = planRef.letterFoods;
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const match = (s: string) => s.toLowerCase().includes(query);

  // ── letter-parity mode: the issued letter spells out its own food groups —
  // render them verbatim so the app and the letter can never disagree.
  if (lf) {
    let hit: "enjoy" | "easy" | null = null;
    if (query) {
      if (lf.enjoy.some((g) => g.items.some(match) || match(g.label))) hit = "enjoy";
      else if (lf.easy.some(match)) hit = "easy";
    }
    return (
      <div>
        <div className="food-search">
          <Icon name="search" size={17} style={{ color: "var(--muted)" }} />
          <input className="journal" placeholder="Is this okay to eat?" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button className="fs-clear" onClick={() => setQ("")}>
              ✕
            </button>
          )}
        </div>
        {query && (
          <div className={"food-verdict " + (hit === "enjoy" ? "forest" : hit === "easy" ? "ochre" : "none")}>
            {hit === "enjoy" ? (
              <span>
                <Icon name="check" size={15} /> <strong>Yes — build your meals around it.</strong>
              </span>
            ) : hit === "easy" ? (
              <span>
                <Icon name="moon" size={15} /> <strong>Go easy on this for now.</strong>
              </span>
            ) : (
              <span>
                <Icon name="sparkle" size={15} /> Not on your list — keep the shape of the plate, or ask the co-pilot.
              </span>
            )}
          </div>
        )}
        <div className="tier forest">
          <div className="tier-head">
            <span className="tier-bar" /> {lf.enjoyTitle}
          </div>
          {lf.enjoy
            .filter((g) => !query || g.items.some(match) || match(g.label))
            .map((g, gi) => (
              <div key={gi} style={{ marginTop: gi ? 10 : 0 }}>
                {g.label && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--forest-deep)", margin: "0 2px 6px" }}>{g.label}</div>
                )}
                <div className="pill-list">
                  {(query ? g.items.filter(match) : g.items).map((f, i) => (
                    <span className="food-pill tier-pill forest" key={i}>
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            ))}
        </div>
        {(!query || lf.easy.some(match)) && (
          <div className="tier ochre">
            <div className="tier-head">
              <span className="tier-bar" /> {lf.easyTitle}
            </div>
            <div className="pill-list">
              {(query ? lf.easy.filter(match) : lf.easy).map((f, i) => (
                <span className="food-pill tier-pill ochre" key={i} style={{ textDecoration: "none" }}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── fallback: 3-tier view assembled from the plan's nutrition fields ──
  let hit: keyof typeof TIER_META | null = null;
  if (query) {
    for (const tier of ["eat", "sometimes", "avoid"] as const) {
      if (foods[tier].some(match)) {
        hit = tier;
        break;
      }
    }
  }
  return (
    <div>
      <div className="food-search">
        <Icon name="search" size={17} style={{ color: "var(--muted)" }} />
        <input className="journal" placeholder="Is this okay to eat?" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button className="fs-clear" onClick={() => setQ("")}>
            ✕
          </button>
        )}
      </div>
      {query && (
        <div className={"food-verdict " + (hit ? TIER_META[hit].tone : "none")}>
          {hit ? (
            <span>
              <Icon name={TIER_META[hit].icon} size={15} /> <strong>{TIER_META[hit].verdict}</strong>
            </span>
          ) : (
            <span>
              <Icon name="sparkle" size={15} /> Not on your list — build it on the plate, or ask the co-pilot.
            </span>
          )}
        </div>
      )}
      {(["eat", "sometimes", "avoid"] as const).map((tier) => {
        const items = query ? foods[tier].filter(match) : foods[tier];
        if (query && !items.length) return null;
        const m = TIER_META[tier];
        return (
          <div className={"tier " + m.tone} key={tier}>
            <div className="tier-head">
              <span className="tier-bar" /> {m.label}
            </div>
            <div className="pill-list">
              {items.map((f, i) => (
                <span className={"food-pill tier-pill " + m.tone} key={i}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <div className="tier-why">{planRef.avoidWhy}</div>
    </div>
  );
}

// ── remedies ─────────────────────────────────────────────────────────────────

export function RemedyCard({ remedy, onOpen }: { remedy: AppRemedy; onOpen: (r: AppRemedy) => void }) {
  const cat = REMEDY_CAT[remedy.category] ?? REMEDY_CAT.other;
  const ext = remedy.route === "external";
  const icon = remedy.icon || cat.icon;
  const bal = remedy.bal ?? [];
  return (
    <button className="remedy-card" onClick={() => onOpen(remedy)}>
      <span className={"rc-ico" + (ext ? " ext" : "")}>
        <Icon name={icon} size={20} />
      </span>
      <div className="rc-body">
        <div className="rc-name">
          {remedy.name}
          {remedy.assigned && !remedy.alternative && <span className="rc-pick">Picked for you</span>}
          {remedy.alternative && <span className="rc-soon">Swap option</span>}
          {remedy.stub && <span className="rc-soon">Coming soon</span>}
        </div>
        <div className="rc-also">
          {cat.label}
          {remedy.also ? " · " + remedy.also : ""}
        </div>
        <div className="rc-line">
          {remedy.assigned && remedy.why
            ? remedy.why
            : remedy.whyFor || remedy.summary.split(". ")[0] + "."}
        </div>
        <div className="rc-foot">
          <span className={"rc-badge " + (ext ? "route-ext" : "route-int")}>
            <Icon name={ext ? "hand" : "bowl"} size={11} /> {ext ? "Apply / inhale" : "By mouth"}
          </span>
          {bal.length > 0 && (
            <span className="rc-badge dosha">
              <Icon name="sparkle" size={11} /> Balances {bal.map((d) => DOSHA_LABEL[d] ?? d).join(" · ")}
            </span>
          )}
          {remedy.when && (
            <span className="rc-when">
              <Icon name="clock" size={11} /> {remedy.when}
            </span>
          )}
        </div>
      </div>
      <span className="rc-chev">
        <Icon name="chev" size={18} />
      </span>
    </button>
  );
}

"use client";

/* ======================================================================
   The Ochre Tree — "This week's menu" + 🛒 grocery list + ingredient swaps
   ----------------------------------------------------------------------
   The whole week at a glance (so groceries can be bought ahead), fed by
   the same letter-parity weekTables the Today tab uses. The shopping
   list is the coach-generated structured file (AppGrocery) — categorised
   the way an Indian shopping trip works, with tick-off persistence on
   the phone (localStorage, per plan + week).

   SWAPS: every grocery item that belongs to a curated equivalence group
   (swap_groups.yaml, pre-gated server-side against this client's avoid
   tier + dietary preference) gets a "Can't find it?" affordance. Choosing
   an alternative persists on the phone and annotates both the shopping
   list and the week's menu ("Jowar roti → use ragi"). No server write,
   no AI — the offered swaps are always plan-compliant by construction.
   ====================================================================== */

import { useEffect, useMemo, useState } from "react";
import type { AppGrocery, AppWeekMenu, GroceryItem } from "@/lib/fmdb/client-app";
import { findSwapMember, type AppSwapGroup } from "@/lib/fmdb/swaps";
import { Icon, useOchre } from "./ochre-context";
import { TravelCard, TravelFlagButton } from "./ochre-travel";

/* ---- swap persistence (localStorage + same-tab event) ----------------- */

type SwapMap = Record<string, string>; // member name → chosen alternative name

const SWAP_EVENT = "ochre-swaps-changed";

function swapKey(clientId: string, planSlug: string): string {
  return `ochre.swaps.${clientId}.${planSlug}`;
}

function readSwaps(key: string): SwapMap {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}

function writeSwaps(key: string, swaps: SwapMap): void {
  try {
    localStorage.setItem(key, JSON.stringify(swaps));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new CustomEvent(SWAP_EVENT));
}

function useSwaps(): [SwapMap, (next: SwapMap) => void] {
  const data = useOchre();
  const key = swapKey(data.clientId, data.planSlug);
  const [swaps, setSwaps] = useState<SwapMap>({});
  useEffect(() => {
    setSwaps(readSwaps(key));
    const onChange = () => setSwaps(readSwaps(key));
    window.addEventListener(SWAP_EVENT, onChange);
    return () => window.removeEventListener(SWAP_EVENT, onChange);
  }, [key]);
  const save = (next: SwapMap) => {
    setSwaps(next);
    writeSwaps(key, next);
  };
  return [swaps, save];
}

/** The swap chosen for whatever ingredient `text` refers to, if any. */
function activeSwapFor(text: string, groups: AppSwapGroup[], swaps: SwapMap): string | null {
  const hit = findSwapMember(text, groups);
  if (!hit) return null;
  const to = swaps[hit.member.name];
  return to && to !== hit.member.name ? to : null;
}

/* ---- week menu section (Plan tab) ----------------------------------- */

export function WeekMenuSection({
  openGrocery,
  openPortions,
}: {
  openGrocery: () => void;
  openPortions?: () => void;
}) {
  const data = useOchre();
  const [swaps] = useSwaps();
  const menus = data.weekMenus;
  const currentIdx = Math.max(
    0,
    menus.findIndex((m) => m.current),
  );
  const [wk, setWk] = useState(currentIdx);
  const menu: AppWeekMenu | undefined = menus[wk] ?? menus[0];
  if (!menu) return null;
  const sample = data.menuIsSample;

  return (
    <div>
      <TravelCard />
      {sample && (
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, margin: "0 0 10px" }}>
          One example week to show the shape of your days — mix and match freely from your
          food lists. Nothing here is day-bound.
        </div>
      )}
      {menus.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {menus.map((m, i) => (
            <button
              key={m.week}
              className={"wm-pill" + (i === wk ? " on" : "")}
              onClick={() => setWk(i)}
            >
              Week {m.week}
              {m.current ? " · now" : ""}
            </button>
          ))}
        </div>
      )}

      {openPortions && (
        <button type="button" className="portion-key-link" onClick={openPortions}>
          <Icon name="bowl" size={14} />
          What does <b>1 bowl</b>, <b>½ cup</b> or <b>1 katori</b> mean?
        </button>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        {menu.days.map((d, di) => (
          <div key={d.dow} className={"wm-day" + (!sample && d.today ? " today" : "")}>
            <div className="wm-dow">
              {/* sample menus are illustrative — no real dates, no "today" */}
              <span>{sample ? `Day ${di + 1}` : d.dow}</span>
              {!sample && d.dateLabel && <small>{d.dateLabel}</small>}
              {!sample && d.today && <em>today</em>}
            </div>
            <div className="wm-slots">
              {d.slots.map((s, i) => {
                const swapTo = activeSwapFor(s.dish, data.swapGroups, swaps);
                return (
                  <div key={i} className="wm-slot">
                    <span className="wm-slotname">{s.slot}</span>
                    <span className="wm-dish">
                      {(s.components?.length ? s.components : [{ title: s.dish }]).map((c, ci, arr) => (
                        <span key={ci} className="wm-comp">
                          {c.title}
                          {c.portion && <span className="wm-portion">{c.portion}</span>}
                          {ci < arr.length - 1 && <span className="wm-plus"> + </span>}
                        </span>
                      ))}
                      {swapTo && <span className="wm-swapnote">→ use {swapTo.toLowerCase()}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {data.travel?.active ? (
        <div className="card-quiet soon" style={{ marginTop: 10 }}>
          <Icon name="bag" size={16} style={{ color: "var(--ochre)" }} />
          <span>
            Shopping list paused while you travel — it&apos;s back the day you return.
          </span>
        </div>
      ) : data.grocery ? (
        <button className="gro-launch" onClick={openGrocery}>
          <span className="gro-launch-ico" aria-hidden="true">
            <Icon name="bag" size={18} />
          </span>
          <span className="gro-launch-body">
            <span className="gro-launch-title">Shopping list for the week</span>
            <span className="gro-launch-meta">Everything above, sorted for the market — tick off as you buy</span>
          </span>
          <span className="chev">
            <Icon name="chev" size={18} />
          </span>
        </button>
      ) : (
        <div className="card-quiet soon" style={{ marginTop: 10 }}>
          <Icon name="bag" size={16} style={{ color: "var(--ochre)" }} />
          <span>
            A tick-off <strong>shopping list</strong> for this menu is on its way from{" "}
            {data.coach.name.split(" ")[0]}.
          </span>
        </div>
      )}

      <TravelFlagButton />
    </div>
  );
}

/* ---- grocery overlay -------------------------------------------------- */

const CATEGORY_ORDER = [
  "Grains & atta",
  "Dals & legumes",
  "Vegetables & fresh",
  "Dairy",
  "Nuts, seeds & dry fruit",
  "Spices & masala",
  "Other",
];

export function GroceryOverlay({ onClose }: { onClose: () => void }) {
  const data = useOchre();
  const grocery: AppGrocery | null = data.grocery;
  const menus = data.weekMenus;
  const currentWeek = menus.find((m) => m.current)?.week ?? grocery?.weeks[0]?.week ?? 1;
  const [wk, setWk] = useState(
    Math.max(
      0,
      (grocery?.weeks ?? []).findIndex((w) => w.week === currentWeek),
    ),
  );
  const STORE = `ochre.grocery.${data.clientId}.${data.planSlug}`;
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [swaps, saveSwaps] = useSwaps();
  const [swapOpen, setSwapOpen] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setTicked(JSON.parse(raw));
    } catch {
      /* fresh */
    }
  }, [STORE]);

  const save = (next: Record<string, boolean>) => {
    setTicked(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  };

  const week = grocery?.weeks[wk] ?? grocery?.weeks[0];
  const grouped = useMemo(() => {
    const by: Record<string, GroceryItem[]> = {};
    for (const it of week?.items ?? []) {
      const cat = CATEGORY_ORDER.includes(it.category) ? it.category : "Other";
      (by[cat] ??= []).push(it);
    }
    return by;
  }, [week]);

  if (!grocery || !week) return null;

  const keyOf = (cat: string, item: string) => `${week.week}|${cat}|${item}`;
  const fresh = CATEGORY_ORDER.filter((c) => (grouped[c] ?? []).some((i) => !i.staple));
  const staples = CATEGORY_ORDER.flatMap((c) => (grouped[c] ?? []).filter((i) => i.staple).map((i) => ({ ...i, _cat: c })));
  const total = (week.items ?? []).filter((i) => !i.staple).length;
  const done = (week.items ?? []).filter((i) => !i.staple && ticked[keyOf(CATEGORY_ORDER.includes(i.category) ? i.category : "Other", i.item)]).length;

  const renderRow = (i: GroceryItem, cat: string) => {
    const k = keyOf(cat, i.item);
    const on = !!ticked[k];
    const swapHit = findSwapMember(i.item, data.swapGroups);
    const alternatives = swapHit ? swapHit.group.members.filter((m) => m.name !== swapHit.member.name) : [];
    const chosen = swapHit ? swaps[swapHit.member.name] : undefined;
    const isOpen = swapOpen === k;
    return (
      <div key={k}>
        <div className="gro-row" role="button" tabIndex={0} onClick={() => save({ ...ticked, [k]: !on })}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") save({ ...ticked, [k]: !on }); }}>
          <span className={"check-sq2" + (on ? " on" : "")} style={on ? { background: "var(--forest)", borderColor: "var(--forest)" } : undefined}>
            {on && <Icon name="checkBold" size={13} style={{ color: "#fff" }} />}
          </span>
          <span className="gro-body">
            <span className={"gro-item" + (on ? " done" : "")}>
              {i.item}
              {chosen && <span className="gro-swapped">→ {chosen}</span>}
            </span>
            {i.for && i.for.length > 0 && <span className="gro-for">for {i.for.slice(0, 3).join(", ")}</span>}
          </span>
          {i.qty && <span className="gro-qty">{i.qty}</span>}
          {alternatives.length > 0 && (
            <span
              className={"gro-swapbtn" + (chosen ? " active" : "")}
              role="button"
              aria-label={`Swap options for ${i.item}`}
              onClick={(e) => {
                e.stopPropagation();
                setSwapOpen(isOpen ? null : k);
              }}
            >
              ⇄
            </span>
          )}
        </div>
        {isOpen && swapHit && (
          <div className="gro-swappanel">
            <div className="gro-swaphead">
              Can&apos;t find it? Any of these work — all on your plan.
              {swapHit.group.note && <em> {swapHit.group.note}</em>}
            </div>
            <div className="gro-swapopts">
              <button
                className={"gro-swapopt" + (!chosen ? " on" : "")}
                onClick={() => {
                  const next = { ...swaps };
                  delete next[swapHit.member.name];
                  saveSwaps(next);
                  setSwapOpen(null);
                }}
              >
                <strong>{swapHit.member.name}</strong>
                <span>as planned</span>
              </button>
              {alternatives.map((alt) => (
                <button
                  key={alt.name}
                  className={"gro-swapopt" + (chosen === alt.name ? " on" : "")}
                  onClick={() => {
                    saveSwaps({ ...swaps, [swapHit.member.name]: alt.name });
                    setSwapOpen(null);
                  }}
                >
                  <strong>{alt.name}</strong>
                  {alt.note && <span>{alt.note}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="overlay-scroll">
      <button className="back-link" onClick={onClose} style={{ margin: "0 0 4px" }}>
        <Icon name="arrowLeft" size={18} /> Back to plan
      </button>
      <div className="overlay-pad" style={{ paddingTop: 4 }}>
        <div className="eyebrow">
          Shopping list · {done}/{total} ticked
        </div>
        <h2 className="h-serif" style={{ fontSize: 24, margin: "8px 0 0", lineHeight: 1.2 }}>
          {data.menuIsSample ? "Your weekly groceries" : `Week ${week.week} groceries`}
        </h2>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          Quantities are for one person — multiply for the family pot. Tap ⇄ on any
          item you can&apos;t find for a plan-approved swap.
        </div>

        {grocery.weeks.length > 1 && (
          <div style={{ display: "flex", gap: 8, margin: "12px 0 0" }}>
            {grocery.weeks.map((w, i) => (
              <button key={w.week} className={"wm-pill" + (i === wk ? " on" : "")} onClick={() => setWk(i)}>
                Week {w.week}
              </button>
            ))}
          </div>
        )}

        {fresh.map((cat) => (
          <div key={cat} style={{ marginTop: 18 }}>
            <div className="gro-cat">{cat}</div>
            <div className="card" style={{ overflow: "hidden" }}>
              {(grouped[cat] ?? []).filter((i) => !i.staple).map((i) => renderRow(i, cat))}
            </div>
          </div>
        ))}

        {staples.length > 0 && (
          <details style={{ marginTop: 18 }}>
            <summary className="gro-cat" style={{ cursor: "pointer", listStyle: "none" }}>
              You likely have these · {staples.length} ▾
            </summary>
            <div className="card" style={{ overflow: "hidden", marginTop: 8 }}>
              {staples.map((i) => renderRow(i, i._cat))}
            </div>
          </details>
        )}

        <div className="muted" style={{ fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>
          Built from your meal plan{grocery.generated_at ? ` · updated ${new Date(grocery.generated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}. Need a swap
          that isn&apos;t listed? Ask {data.coach.name.split(" ")[0]} on WhatsApp.
        </div>
      </div>
    </div>
  );
}

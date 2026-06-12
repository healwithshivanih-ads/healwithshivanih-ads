"use client";

/* ======================================================================
   The Ochre Tree — "Order everything" (one screen, one sitting)
   ----------------------------------------------------------------------
   The compliance killer isn't the links — it's nine separate decisions.
   This turns ordering into a checklist: every supplement (+ any assigned
   remedy that needs buying) grouped by retailer, each with its
   coach-referral link and a "mark as ordered" tick that persists on the
   phone (localStorage, per plan — unlike daily ticks it does NOT reset).

   Items without a curated link group under "Ask Shivani" with a one-tap
   WhatsApp message listing exactly what's missing.
   ====================================================================== */

import { useEffect, useMemo, useState } from "react";
import { Icon, useOchre } from "./ochre-context";

interface OrderItem {
  id: string;
  name: string;
  dose?: string;
  buyUrl?: string;
  retailer: string;
}

function retailerOf(url?: string): string {
  if (!url) return "ask";
  if (/vitaone/i.test(url)) return "VitaOne";
  if (/fmnutrition/i.test(url)) return "FM Nutrition";
  if (/amazon/i.test(url)) return "Amazon";
  if (/iherb/i.test(url)) return "iHerb";
  return "Other";
}

const RETAILER_ORDER = ["VitaOne", "FM Nutrition", "Amazon", "iHerb", "Other"];

function useOrderItems(): OrderItem[] {
  const data = useOchre();
  return useMemo(() => {
    const items: OrderItem[] = data.supplements.map((s) => ({
      id: s.id,
      name: s.name,
      dose: s.dose,
      buyUrl: s.buyUrl,
      retailer: retailerOf(s.buyUrl),
    }));
    for (const r of data.remedies) {
      if (r.assigned && r.buyUrl)
        items.push({ id: "rx-" + r.slug, name: r.name, buyUrl: r.buyUrl, retailer: retailerOf(r.buyUrl) });
    }
    return items;
  }, [data.supplements, data.remedies]);
}

/* ---- launch card (Plan tab, under the supplements list) -------------- */

export function OrderLaunchCard({ openOrder }: { openOrder: () => void }) {
  const data = useOchre();
  const items = useOrderItems();
  const STORE = `ochre.orders.${data.clientId}.${data.planSlug}`;
  const [done, setDone] = useState(0);
  useEffect(() => {
    try {
      const t = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, boolean>;
      setDone(items.filter((i) => t[i.id]).length);
    } catch {
      /* fresh */
    }
  }, [STORE, items]);
  if (!items.length) return null;
  return (
    <button className="ord-launch" onClick={openOrder}>
      <span className="ord-launch-ico" aria-hidden="true">
        <Icon name="bag" size={18} />
      </span>
      <span className="ord-launch-body">
        <span className="ord-launch-title">Order everything</span>
        <span className="ord-launch-meta">
          {done > 0 ? `${done} of ${items.length} ordered — keep going` : `All ${items.length} items, one sitting · tick off as you order`}
        </span>
      </span>
      <span className="chev">
        <Icon name="chev" size={18} />
      </span>
    </button>
  );
}

/* ---- the overlay ------------------------------------------------------ */

export function OrderOverlay({ onClose }: { onClose: () => void }) {
  const data = useOchre();
  const items = useOrderItems();
  const STORE = `ochre.orders.${data.clientId}.${data.planSlug}`;
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

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

  const linked = items.filter((i) => i.buyUrl);
  const unlinked = items.filter((i) => !i.buyUrl);
  const done = items.filter((i) => ticked[i.id]).length;
  const firstName = data.coach.name.split(" ")[0];

  const waText = encodeURIComponent(
    `Hi ${firstName} 🙏 Could you help me order these from my plan?\n` +
      unlinked
        .filter((i) => !ticked[i.id])
        .map((i) => `• ${i.name}${i.dose ? ` (${i.dose})` : ""}`)
        .join("\n"),
  );
  const waHref = `https://wa.me/${data.coach.whatsappNumber}?text=${waText}`;

  const row = (i: OrderItem) => {
    const on = !!ticked[i.id];
    return (
      <div key={i.id} className="ord-row">
        <button
          className={"check-sq2" + (on ? " on" : "")}
          style={on ? { background: "var(--forest)", borderColor: "var(--forest)" } : undefined}
          onClick={() => save({ ...ticked, [i.id]: !on })}
          aria-pressed={on}
          aria-label={on ? `${i.name} ordered` : `Mark ${i.name} as ordered`}
        >
          {on && <Icon name="checkBold" size={13} style={{ color: "#fff" }} />}
        </button>
        <span className="ord-body" onClick={() => save({ ...ticked, [i.id]: !on })}>
          <span className={"ord-name" + (on ? " done" : "")}>{i.name}</span>
          {i.dose && <span className="ord-dose">{i.dose}</span>}
        </span>
        {i.buyUrl && (
          <a className="ord-buy" href={i.buyUrl} target="_blank" rel="noreferrer">
            <Icon name="bag" size={13} /> Order
          </a>
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
          Your order list · {done}/{items.length} ordered
        </div>
        <h2 className="h-serif" style={{ fontSize: 24, margin: "8px 0 0", lineHeight: 1.2 }}>
          Order everything in one sitting
        </h2>
        <div className="ord-progress">
          <span style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
        </div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
          Every link is {firstName}&apos;s checked pick for that exact item. Tick each one
          as you order — your list remembers where you stopped.
        </div>

        {RETAILER_ORDER.filter((ret) => linked.some((i) => i.retailer === ret)).map((ret) => (
          <div key={ret} style={{ marginTop: 18 }}>
            <div className="gro-cat">
              {ret} · {linked.filter((i) => i.retailer === ret).length}
            </div>
            <div className="card" style={{ overflow: "hidden" }}>
              {linked.filter((i) => i.retailer === ret).map(row)}
            </div>
          </div>
        ))}

        {unlinked.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div className="gro-cat">Ask {firstName} · {unlinked.length}</div>
            <div className="card" style={{ overflow: "hidden" }}>
              {unlinked.map(row)}
            </div>
            <a className="wa-btn" href={waHref} target="_blank" rel="noreferrer" style={{ marginTop: 10 }}>
              <Icon name="whatsapp" size={18} /> Ask {firstName} where to get these
            </a>
          </div>
        )}

        {done === items.length && items.length > 0 && (
          <div className="card-quiet" style={{ marginTop: 18, padding: "13px 15px", display: "flex", gap: 10, alignItems: "center" }}>
            <Icon name="checkBold" size={16} style={{ color: "var(--forest)" }} />
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              All ordered — beautifully done. Supplements usually arrive within a week;
              start each one as it lands.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

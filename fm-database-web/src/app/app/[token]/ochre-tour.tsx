"use client";

/**
 * TourOverlay — the in-app Getting-Started tour ("how your tree works").
 *
 * A full-screen vertical snap deck: one card per idea (welcome → baseline →
 * the five tabs → the growing tree → the rhythm), progress dots on the right,
 * Skip always available. Auto-opens ONCE for new users (gating + the seen
 * flag live in ochre-app.tsx); re-watchable any time from the Coach tab.
 *
 * Content is data-aware: the tree card only shows when the growing-tree
 * hero is enabled for this client, the Ayurveda line only when remedies
 * exist on the plan. No screenshots — the real app is right behind it.
 */

import { useEffect, useRef, useState } from "react";
import { Icon, useOchre } from "./ochre-context";
import { isGrowingTreeEnabled } from "./growing-tree-flag";

type Card = {
  key: string;
  eyebrow?: string;
  title: string;
  body?: string;
  bullets?: string[];
  icon?: string;
  emoji?: string;
};

export function TourOverlay({ onClose }: { onClose: () => void }) {
  const data = useOchre();
  const first = data.client.firstName || "there";
  const treeOn = isGrowingTreeEnabled(data.clientId);
  const hasRemedies = (data.remedies?.length ?? 0) > 0;

  const cards: Card[] = [
    {
      key: "hello",
      eyebrow: "A one-minute tour",
      title: `Welcome, ${first}`,
      body:
        "Everything we've mapped out — your meals, supplements and daily practices — lives here, and it quietly adapts as you check in. Swipe up to see how it works.",
      emoji: "🌱",
    },
    {
      key: "baseline",
      eyebrow: "Do this first",
      title: "Your symptom baseline",
      body:
        "In the Progress tab, take the 5-minute symptom check — your starting line. Every symptom starts at “Never”, so you only tap what applies. It re-opens every 3 weeks, and each time your number should fall.",
      icon: "checkin",
    },
    {
      key: "today",
      eyebrow: "Tab 1 · Today",
      title: "Your day, in order",
      bullets: [
        "Meals for today — tap any for the full recipe.",
        "Supplements — tap to mark each as taken.",
        "A 10-second daily log: how you felt + movement.",
        ...(hasRemedies ? ["Gentle Ayurveda nudges for your constitution."] : []),
      ],
      icon: "today",
    },
    {
      key: "plan",
      eyebrow: "Tab 2 · Plan",
      title: "Your whole plan, one place",
      bullets: [
        "Two weeks of menus — every meal opens a recipe.",
        "A fortnight shopping list — buy it all in one go.",
        "Don't fancy a dish? Swap it for the alternative.",
        "Supplements with dose + brand, practices with guides.",
      ],
      icon: "plan",
    },
    {
      key: "progress",
      eyebrow: "Tab 3 · Progress",
      title: "Watch the change",
      bullets: [
        "Your symptom score, falling over time.",
        ...(treeOn ? ["Your tree, growing week by week."] : []),
        "Weight, measurements and wellbeing trend.",
        "Lab checkpoints — what to re-test, and when.",
      ],
      icon: "progress",
    },
    {
      key: "labs",
      eyebrow: "Tab 4 · Labs",
      title: "Results in plain English",
      bullets: [
        "Every marker against two ranges — standard and functional-optimal.",
        "Grouped by system, each with its date.",
        "The ones we're working on, flagged.",
      ],
      icon: "flask",
    },
    {
      key: "coach",
      eyebrow: "Tab 5 · Coach",
      title: "Never stuck",
      bullets: [
        "Message me on WhatsApp, right from the app.",
        "Ask the co-pilot for instant everyday answers.",
        "Anything personal or medical comes straight to me.",
      ],
      icon: "coach",
    },
    ...(treeOn
      ? [
          {
            key: "tree",
            eyebrow: "Your companion",
            title: "Watch your tree grow",
            bullets: [
              "Taller each week you're on plan.",
              "New leaves each day you log.",
              "Blossoms for symptom wins, fruit for check-ins, birds for a streak.",
            ],
            emoji: "🌳",
          } as Card,
        ]
      : []),
    {
      key: "rhythm",
      eyebrow: "That's it",
      title: "Your rhythm",
      bullets: [
        "Every day (~10 sec): a quick log on Today.",
        "Every week (~1 min): your check-in — it comes to me.",
        "Every 3 weeks: your symptom score.",
      ],
      body: "Small and steady beats big and rare. I'm right here whenever you need me.",
      emoji: "🍃",
    },
  ];

  const deckRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  // Track which card is in view → dots + Done-button state.
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const cardEls = Array.from(deck.querySelectorAll("[data-tour-card]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const idx = cardEls.indexOf(e.target);
            if (idx >= 0) setActive(idx);
          }
        }
      },
      { root: deck, threshold: 0.6 },
    );
    cardEls.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const jump = (i: number) => {
    const deck = deckRef.current;
    const el = deck?.querySelectorAll("[data-tour-card]")[i];
    el?.scrollIntoView({ behavior: "smooth" });
  };

  const last = active >= cards.length - 1;

  return (
    <div className="ot-tour" role="dialog" aria-label="Getting started tour">
      <style>{`
        .ot-tour{position:fixed;inset:0;z-index:120;background:var(--paper,#faf9f7);}
        .ot-tour-deck{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;
          scroll-snap-type:y mandatory;-webkit-overflow-scrolling:touch;}
        .ot-tour-card{min-height:100%;scroll-snap-align:start;scroll-snap-stop:always;
          display:flex;flex-direction:column;justify-content:center;gap:13px;
          max-width:420px;margin:0 auto;padding:56px 34px 88px;box-sizing:border-box;}
        .ot-tour-eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;
          color:var(--ochre,#a9651f);font-weight:700;}
        .ot-tour-title{font-family:var(--serif,Georgia,serif);font-weight:400;
          font-size:clamp(26px,7.4vw,32px);line-height:1.12;color:var(--forest-deep,#3a4d41);margin:0;}
        .ot-tour-body{font-size:15.5px;line-height:1.62;color:var(--ink,#262219);margin:0;}
        .ot-tour-bullets{list-style:none;margin:2px 0 0;padding:0;display:flex;flex-direction:column;gap:11px;}
        .ot-tour-bullets li{position:relative;padding-left:19px;font-size:15px;line-height:1.5;color:var(--ink,#262219);}
        .ot-tour-bullets li::before{content:"";position:absolute;left:0;top:.55em;width:7px;height:7px;
          border-radius:2px;background:var(--forest,#4a6152);opacity:.55;}
        .ot-tour-glyph{width:52px;height:52px;border-radius:15px;background:var(--forest-tint,rgba(74,97,82,.1));
          display:flex;align-items:center;justify-content:center;color:var(--forest,#4a6152);font-size:26px;}
        .ot-tour-dots{position:fixed;top:50%;right:10px;transform:translateY(-50%);
          display:flex;flex-direction:column;gap:8px;z-index:2;}
        .ot-tour-dot{width:7px;height:7px;border-radius:50%;border:none;padding:0;
          background:rgba(38,34,25,.18);cursor:pointer;transition:transform .2s,background .2s;}
        .ot-tour-dot.on{background:var(--ochre,#a9651f);transform:scale(1.5);}
        .ot-tour-top{position:fixed;top:0;left:0;right:0;display:flex;justify-content:flex-end;
          padding:14px 16px;z-index:2;}
        .ot-tour-skip{border:none;background:transparent;color:var(--forest,#4a6152);
          font-size:13px;font-weight:600;padding:8px 10px;cursor:pointer;opacity:.75;}
        .ot-tour-foot{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:center;
          padding:0 24px calc(18px + env(safe-area-inset-bottom));z-index:2;
          background:linear-gradient(rgba(250,249,247,0),var(--paper,#faf9f7) 65%);padding-top:26px;}
        .ot-tour-next{border:none;border-radius:14px;padding:14px 30px;font-size:15px;font-weight:700;
          background:var(--forest,#4a6152);color:#fff;cursor:pointer;min-width:200px;}
        .ot-tour-hint{position:fixed;left:0;right:0;bottom:76px;text-align:center;font-size:11px;
          letter-spacing:.14em;text-transform:uppercase;color:var(--forest,#4a6152);opacity:.6;z-index:1;
          pointer-events:none;}
        @media (prefers-reduced-motion: reduce){.ot-tour-deck{scroll-behavior:auto;}}
      `}</style>

      <div className="ot-tour-deck" ref={deckRef}>
        {cards.map((c) => (
          <section className="ot-tour-card" data-tour-card key={c.key}>
            <div className="ot-tour-glyph" aria-hidden>
              {c.icon ? <Icon name={c.icon} size={26} /> : <span>{c.emoji}</span>}
            </div>
            {c.eyebrow && <div className="ot-tour-eyebrow">{c.eyebrow}</div>}
            <h2 className="ot-tour-title">{c.title}</h2>
            {c.body && <p className="ot-tour-body">{c.body}</p>}
            {c.bullets && (
              <ul className="ot-tour-bullets">
                {c.bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className="ot-tour-top">
        <button className="ot-tour-skip" onClick={onClose}>
          Skip
        </button>
      </div>

      <nav className="ot-tour-dots" aria-label="Tour progress">
        {cards.map((c, i) => (
          <button
            key={c.key}
            className={"ot-tour-dot" + (i === active ? " on" : "")}
            aria-label={`Card ${i + 1} of ${cards.length}`}
            onClick={() => jump(i)}
          />
        ))}
      </nav>

      {active === 0 && <div className="ot-tour-hint">swipe up</div>}

      <div className="ot-tour-foot">
        <button
          className="ot-tour-next"
          onClick={() => (last ? onClose() : jump(active + 1))}
        >
          {last ? "Let's begin 🌱" : "Next"}
        </button>
      </div>
    </div>
  );
}

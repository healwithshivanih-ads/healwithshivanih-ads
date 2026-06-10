"use client";

/**
 * Slide-in overlays: meal detail (recipe + coach-approved swaps),
 * doc reader (lessons + resources), remedy detail, account/settings.
 */

import { useState } from "react";
import type { AppRemedy } from "@/lib/fmdb/client-app";
import { DOSHA_LABEL, Icon, REMEDY_CAT, useOchre } from "./ochre-context";

// ── meal detail ──────────────────────────────────────────────────────────────

export function MealOverlay({ slot, onClose }: { slot: string; onClose: () => void }) {
  const data = useOchre();
  const meal = data.meals.find((m) => m.slot === slot);
  const ex = data.mealExtra[slot];
  const [swapOpen, setSwapOpen] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  if (!meal) return null;

  return (
    <div className="overlay-scroll">
      <button className="back-link onhero" onClick={onClose}>
        <Icon name="arrowLeft" size={18} /> Back
      </button>

      <div className="meal-hero" style={{ background: ex?.grad }}>
        <span className="mh-tag">
          <Icon name="forkKnife" size={13} /> From your meal plan
        </span>
      </div>

      <div className="overlay-pad">
        <div className="meal-title-row">
          <div>
            <div className="eyebrow">
              {meal.slot}
              {meal.timeHint ? ` · ${meal.timeHint}` : ""}
            </div>
            <h2 className="h-serif" style={{ fontSize: 24, margin: "6px 0 0" }}>
              {meal.pills[0]}
            </h2>
            {meal.ayurveda && (
              <span className="rx-ayur" style={{ marginTop: 8, display: "inline-flex" }}>
                <Icon name="leaf" size={10} /> Ayurveda recommends
              </span>
            )}
          </div>
        </div>

        {(ex?.mins || ex?.serves) && (
          <div className="macro-row">
            {ex.serves && (
              <span className="macro">
                <b>Serves {ex.serves.replace(/serves/i, "").trim()}</b>
              </span>
            )}
            {ex.mins && (
              <span className="macro">
                <Icon name="clock" size={13} /> {ex.mins}
              </span>
            )}
          </div>
        )}

        <div className="pill-list" style={{ marginTop: 14 }}>
          {meal.pills.map((p, i) => (
            <span className="food-pill" key={i}>
              {p}
            </span>
          ))}
        </div>

        {meal.note && <div className="meal-note">{meal.note}</div>}

        {ex && ex.ingredients.length > 0 && (
          <>
            <div className="eyebrow" style={{ marginTop: 22 }}>
              Ingredients
            </div>
            <div className="divider-ochre" />
            <div className="pill-list">
              {ex.ingredients.map((ing, i) => (
                <span className="food-pill" key={i}>
                  {ing}
                </span>
              ))}
            </div>
          </>
        )}

        {ex && ex.recipe.length > 0 ? (
          <>
            <div className="eyebrow" style={{ marginTop: 22 }}>
              How to make it
            </div>
            <div className="divider-ochre" />
            <ol className="recipe">
              {ex.recipe.map((step, i) => (
                <li key={i}>
                  <span className="rn">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="card-quiet soon" style={{ marginTop: 18 }}>
            <Icon name="book" size={16} style={{ color: "var(--ochre)" }} />
            <span>
              The full method for every ✦ dish lives in your <strong>recipe pack</strong> — find it under Plan → Resources.
            </span>
          </div>
        )}

        {ex && ex.swaps.length > 0 && (
          <>
            <button className="swap-btn" onClick={() => setSwapOpen((s) => !s)} aria-expanded={swapOpen}>
              <Icon name="swap" size={17} /> Swap this meal
              <span className="chev" style={{ marginLeft: "auto", transform: swapOpen ? "rotate(90deg)" : "none", transition: "transform .25s" }}>
                <Icon name="chev" size={17} />
              </span>
            </button>
            <div className={"swap-body" + (swapOpen ? " open" : "")}>
              <div>
                <div className="swap-inner">
                  <div className="swap-hint">Approved alternatives from your own plan — same slot, same shape of plate:</div>
                  {ex.swaps.map((s, i) => (
                    <button key={i} className={"swap-opt" + (chosen === i ? " on" : "")} onClick={() => setChosen(i)}>
                      <span className="check-sq2">{chosen === i && <Icon name="checkBold" size={13} style={{ color: "#fff" }} />}</span>
                      <span style={{ flex: 1, textAlign: "left" }}>
                        <span className="so-name">{s.name}</span>
                        <span className="so-note">{s.note}</span>
                      </span>
                    </button>
                  ))}
                  {chosen != null && (
                    <div className="swap-done">
                      <Icon name="check" size={15} /> Swapped for today. Mention it at your weekly check-in.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── doc reader (lessons + resources) ─────────────────────────────────────────

export function DocOverlay({ doc, onClose }: { doc: { kind: string; id: string }; onClose: () => void }) {
  const data = useOchre();
  const isLesson = doc.kind === "lesson";
  const lesson = isLesson ? data.lessons.find((l) => l.id === doc.id) : undefined;
  const resource = !isLesson ? data.resources.find((r) => r.id === doc.id) : undefined;
  const item = lesson ?? resource;
  if (!item) return null;
  const eyebrow = lesson ? `Lesson · ${lesson.mins}` : `${resource!.kind} · from ${data.coach.name.split(" ")[0]}`;
  const body = (item.body || "").split("\n");
  const url = resource?.url;
  return (
    <div className="overlay-scroll">
      <button className="back-link" onClick={onClose} style={{ margin: "0 0 4px" }}>
        <Icon name="arrowLeft" size={18} /> Back to plan
      </button>
      <div className="overlay-pad" style={{ paddingTop: 4 }}>
        <div className="eyebrow">{eyebrow}</div>
        <h2 className="h-serif" style={{ fontSize: 24, margin: "8px 0 0", lineHeight: 1.2 }}>
          {item.title}
        </h2>
        <div className="divider-ochre" />
        <div className="doc-body">
          {body.map((line, i) => {
            const t = line.trim();
            if (!t) return <div key={i} style={{ height: 8 }} />;
            if (t === t.toUpperCase() && t.length < 40 && /[A-Z]/.test(t))
              return (
                <div key={i} className="doc-h">
                  {t}
                </div>
              );
            if (/^[•\d]/.test(t) || t.startsWith("-"))
              return (
                <div key={i} className="doc-li">
                  {t.replace(/^[-•]\s*/, "")}
                </div>
              );
            return (
              <p key={i} className="doc-p">
                {t}
              </p>
            );
          })}
        </div>
        {url && (
          <a className="wa-btn" href={url} target="_blank" rel="noreferrer" style={{ marginTop: 18 }}>
            <Icon name="external" size={18} /> Open
          </a>
        )}
        <div className="card-quiet" style={{ padding: "13px 15px", marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
          <Icon name="water" size={16} style={{ color: "var(--forest)" }} />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>From your plan — come back to it any time.</span>
        </div>
      </div>
    </div>
  );
}

// ── remedy detail ────────────────────────────────────────────────────────────

export function RemedyOverlay({ remedy, onClose }: { remedy: AppRemedy; onClose: () => void }) {
  const data = useOchre();
  const r = remedy;
  const firstName = data.coach.name.split(" ")[0];
  const cat = REMEDY_CAT[r.category] ?? REMEDY_CAT.other;
  const ext = r.route === "external";
  const icon = r.icon || cat.icon;
  const bal = r.bal ?? [];
  const agg = r.agg ?? [];
  const dl = (d: string) => DOSHA_LABEL[d] ?? d;
  const hasDosha = bal.length || agg.length || r.virya;
  const ready = r.prepSteps && r.prepSteps.length > 0;
  return (
    <div className="overlay-scroll">
      <button className="back-link" onClick={onClose} style={{ margin: "0 0 4px" }}>
        <Icon name="arrowLeft" size={18} /> Back to plan
      </button>
      <div className="overlay-pad" style={{ paddingTop: 4 }}>
        <div className="rmd-eyebrow">
          <span className="rmd-cat-ico">
            <Icon name={icon} size={16} />
          </span>
          {cat.label}
        </div>
        <h2 className="h-serif" style={{ fontSize: 25, margin: "8px 0 2px", lineHeight: 1.18 }}>
          {r.name}
        </h2>
        {r.also && <div className="rmd-also">Also called {r.also.toLowerCase()}</div>}
        <div className="rmd-badges">
          <span className={"rc-badge " + (ext ? "route-ext" : "route-int")}>
            <Icon name={ext ? "hand" : "bowl"} size={11} /> {ext ? "Applied / inhaled — not swallowed" : "Taken by mouth"}
          </span>
          {r.when && (
            <span className="rc-when">
              <Icon name="clock" size={11} /> {r.when}
            </span>
          )}
        </div>

        {r.assigned && r.why && (
          <div className="rmd-why">
            <Icon name="leaf" size={14} />{" "}
            <span>
              {r.alternative ? (
                <>
                  <strong>A swap option from {firstName}.</strong> Use this instead of {r.alternativeTo?.toLowerCase()} if it suits you
                  better — one or the other, not both.
                </>
              ) : (
                <>
                  <strong>{firstName} picked this for you.</strong> {r.why}
                </>
              )}
            </span>
          </div>
        )}

        <div className="divider-ochre" />
        <p className="doc-p" style={{ marginTop: 0 }}>
          {r.summary && !r.stub ? r.summary : `A traditional remedy from ${firstName}'s Ayurvedic library.`}
        </p>

        {hasDosha ? (
          <div className="rmd-dosha">
            {bal.length > 0 && (
              <div className="rmd-d-row">
                <span className="rmd-d-k">Balances</span>
                <span className="rmd-d-chips">
                  {bal.map((d) => (
                    <span key={d} className="dosha-chip bal">
                      {dl(d)}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {agg.length > 0 && (
              <div className="rmd-d-row">
                <span className="rmd-d-k">May aggravate</span>
                <span className="rmd-d-chips">
                  {agg.map((d) => (
                    <span key={d} className="dosha-chip agg">
                      {dl(d)}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {r.virya && (
              <div className="rmd-d-row">
                <span className="rmd-d-k">Energy</span>
                <span className="rmd-d-chips">
                  <span className={"virya-chip " + r.virya}>{r.virya === "heating" ? "↑ Heating" : "↓ Cooling"}</span>
                </span>
              </div>
            )}
          </div>
        ) : null}

        {ready ? (
          <>
            <div className="rmd-h">{ext ? "How to use it" : "How to make it"}</div>
            <ol className="rmd-steps">
              {r.prepSteps.map((s, i) => (
                <li key={i}>
                  <span className="rmd-num">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <div className="rmd-meta">
              {r.dose && (
                <div className="rmd-meta-row">
                  <span className="rmd-k">{ext ? "How often" : "How much"}</span>
                  <span className="rmd-v">{r.dose}</span>
                </div>
              )}
              {r.duration && (
                <div className="rmd-meta-row">
                  <span className="rmd-k">How long</span>
                  <span className="rmd-v">{r.duration}</span>
                </div>
              )}
              {r.timing && (
                <div className="rmd-meta-row">
                  <span className="rmd-k">{ext ? "Best time" : "When"}</span>
                  <span className="rmd-v">{r.timing}</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="rmd-pending">
            <Icon name="pen" size={16} />{" "}
            <span>
              {firstName} is still finalising the full instructions for this remedy. It’ll appear here soon — message her if you’d like to start it
              now.
            </span>
          </div>
        )}

        {r.cautions && r.cautions.length > 0 && (
          <div className="rmd-cautions">
            <div className="rmd-caution-head">
              <Icon name="droplet" size={15} /> Check before you start
            </div>
            <ul>
              {r.cautions.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
            <div className="rmd-caution-foot">Not sure if a remedy suits you? Message {firstName} before starting.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── account + settings ───────────────────────────────────────────────────────

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className={"toggle" + (on ? " on" : "")} onClick={onClick} aria-pressed={on}>
      <span className="knob" />
    </button>
  );
}

const INTEGRATIONS = [
  { id: "watch", name: "Apple Watch", meta: "Steps, walks, heart rate", icon: "walk" },
  { id: "ring", name: "Smart ring", meta: "Sleep & recovery", icon: "moon" },
  { id: "bp", name: "BP monitor", meta: "Home blood-pressure readings", icon: "heart" },
  { id: "cgm", name: "Glucose monitor (CGM)", meta: "Blood sugar patterns", icon: "sparkle" },
];

export function AccountOverlay({ onClose }: { onClose: () => void }) {
  const data = useOchre();
  const a = data.account;
  const [rem, setRem] = useState<Record<string, boolean>>(data.reminders.reduce((o, r) => ({ ...o, [r.id]: r.on }), {}));

  return (
    <div className="overlay-scroll">
      <button className="back-link" onClick={onClose} style={{ margin: "0 0 4px" }}>
        <Icon name="arrowLeft" size={18} /> Done
      </button>
      <div className="overlay-pad" style={{ paddingTop: 4 }}>
        <h2 className="h-serif" style={{ fontSize: 24, margin: "0 0 14px" }}>
          Account
        </h2>

        <div className="acct-card">
          <span className="acct-av">{a.avatar}</span>
          <div style={{ flex: 1 }}>
            <div className="acct-name">{a.name}</div>
            <div className="acct-sub">{a.contact}</div>
            <div className="acct-plan">
              {a.plan}
              {a.member ? ` · ${a.member}` : ""}
            </div>
          </div>
        </div>

        <div className="set-group">
          <div className="set-h">
            <Icon name="bell" size={15} /> Reminders
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {data.reminders.map((r) => (
              <div className="set-row" key={r.id}>
                <span className="sr-name">
                  {r.label}
                  <span className="sr-meta">{r.time}</span>
                </span>
                <Toggle on={!!rem[r.id]} onClick={() => setRem((s) => ({ ...s, [r.id]: !s[r.id] }))} />
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8, paddingLeft: 2 }}>
            Nudges arrive on WhatsApp from {data.coach.name.split(" ")[0]} — these switches set what you’d like.
          </div>
        </div>

        <div className="set-group">
          <div className="set-h">
            <Icon name="link" size={15} /> Connected apps
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {INTEGRATIONS.map((x) => (
              <div className="set-row" key={x.id}>
                <span className="conn-ico">
                  <Icon name={x.icon} size={17} />
                </span>
                <span className="sr-name" style={{ flex: 1 }}>
                  {x.name}
                  <span className="sr-meta">{x.meta}</span>
                </span>
                <button className="conn-btn" disabled style={{ opacity: 0.55 }}>
                  Coming soon
                </button>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8, paddingLeft: 2 }}>
            Device sync is coming with our iOS app — for now, the manual logs keep everything you need.
          </div>
        </div>

        <div className="card-quiet" style={{ padding: "13px 15px", display: "flex", gap: 10, alignItems: "center", marginTop: 22 }}>
          <Icon name="water" size={16} style={{ color: "var(--forest)" }} />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Your daily ticks are saved on this phone. Your weekly check-in goes to {data.coach.name.split(" ")[0]}.
          </span>
        </div>

        <div className="muted" style={{ textAlign: "center", fontSize: 11.5, marginTop: 18, paddingBottom: 8 }}>
          The Ochre Tree · your plan, day by day
        </div>
      </div>
    </div>
  );
}

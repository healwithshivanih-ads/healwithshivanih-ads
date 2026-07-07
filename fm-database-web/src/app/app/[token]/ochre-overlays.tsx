"use client";

/**
 * Slide-in overlays: meal detail (recipe + coach-approved swaps),
 * doc reader (lessons + resources), remedy detail, account/settings.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AppRecipe, AppRemedy } from "@/lib/fmdb/client-app";
import { DOSHA_LABEL, Icon, REMEDY_CAT, useOchre } from "./ochre-context";
import { AppAvatar } from "./ochre-ui";
import { BodySection } from "./ochre-body";
import { MeasureList, MEASURE_INTRO } from "./ochre-measures";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/fmdb/push-public";

/** Downscale a chosen image to a small JPEG and return base64 (no data-URL
 *  prefix), or null on failure. Mirrors the intake form's helper — kept local
 *  so the app bundle doesn't pull in intake code. */
async function downscaleToJpegB64(file: File, maxDim = 512, quality = 0.72): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("decode failed"));
      im.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height || 1));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", quality);
    const comma = out.indexOf(",");
    return comma >= 0 ? out.slice(comma + 1) : null;
  } catch {
    return null;
  }
}

// ── meal detail ──────────────────────────────────────────────────────────────

export function MealOverlay({ slot, onClose }: { slot: string; onClose: () => void }) {
  const data = useOchre();
  const meal = data.meals.find((m) => m.slot === slot);
  const ex = data.mealExtra[slot];
  const [swapOpen, setSwapOpen] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const [swapSaving, setSwapSaving] = useState(false);
  if (!meal) return null;

  // the meal's calories follow the swap once one is picked
  const effKcal = chosen != null ? ex?.swaps[chosen]?.kcal ?? meal.kcal : meal.kcal;

  const pickSwap = async (i: number) => {
    setChosen(i);
    const to = ex?.swaps[i];
    if (!to) return;
    setSwapSaving(true);
    try {
      await fetch("/api/app-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: data.token,
          slot,
          from_dish: meal.pills.join(" + "),
          to_dish: to.name,
          from_kcal: meal.kcal ?? null,
          to_kcal: to.kcal ?? null,
          date: data.today?.dateLabel ? undefined : undefined,
        }),
      });
    } catch {
      /* swap still shows locally even if the note didn't save */
    }
    setSwapSaving(false);
  };

  return (
    <div className="overlay-scroll">
      <button className="back-link onhero" onClick={onClose}>
        <Icon name="arrowLeft" size={18} /> Back
      </button>

      <div
        className="meal-hero"
        style={
          ex?.imageUrl
            ? {
                backgroundImage: `linear-gradient(180deg,rgba(0,0,0,0) 40%,rgba(0,0,0,0.35) 100%), url(${ex.imageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : { background: ex?.grad }
        }
      >
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

        {(ex?.mins || ex?.serves || effKcal) && (
          <div className="macro-row">
            {effKcal ? (
              <span className="macro">
                <b>~{effKcal} kcal</b>
              </span>
            ) : null}
            {ex?.serves && (
              <span className="macro">
                <b>Serves {ex.serves.replace(/serves/i, "").trim()}</b>
              </span>
            )}
            {ex?.mins && (
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
        ) : data.recipePack.length > 0 ? (
          /* no exact match for this dish — open the pack RIGHT HERE
             (letters are retiring; nothing points out of the app) */
          <>
            <div className="eyebrow" style={{ marginTop: 22 }}>
              From your recipe pack
            </div>
            <div className="divider-ochre" />
            <RecipeAccordion recipes={data.recipePack} />
          </>
        ) : (
          /* NO recipe pack on this plan (principle-based / hybrid letters,
             e.g. Niti) — never point at something that isn't there.
             Bug report 2026-06-11: "asking her to go to Plan for the full
             recipe and there is no full recipe there." */
          <div className="card-quiet soon" style={{ marginTop: 18 }}>
            <Icon name="leaf" size={16} style={{ color: "var(--ochre)" }} />
            <span>
              These are simple, everyday preparations — make them the way you usually
              would. Want {data.coach.name.split(" ")[0]}&apos;s method for this one? Ask
              on WhatsApp and she&apos;ll send it.
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
                    <button key={i} className={"swap-opt" + (chosen === i ? " on" : "")} onClick={() => void pickSwap(i)}>
                      <span className="check-sq2">{chosen === i && <Icon name="checkBold" size={13} style={{ color: "#fff" }} />}</span>
                      <span style={{ flex: 1, textAlign: "left" }}>
                        <span className="so-name">
                          {s.name}
                          {s.kcal ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · ~{s.kcal} kcal</span> : null}
                        </span>
                        <span className="so-note">{s.note}</span>
                      </span>
                    </button>
                  ))}
                  {chosen != null && (
                    <div className="swap-done">
                      <Icon name="check" size={15} />{" "}
                      {swapSaving ? "Saving your swap…" : `Swapped — ${data.coach.name.split(" ")[0]} will see it. Your meal is now ~${effKcal ?? "?"} kcal.`}
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

  // The recipe pack renders fully IN-APP (letters are retiring) — a list of
  // every recipe with expandable ingredients + method, no link-out.
  if (resource?.id === "r-recipes" && data.recipePack.length > 0) {
    return (
      <div className="overlay-scroll">
        <button className="back-link" onClick={onClose} style={{ margin: "0 0 4px" }}>
          <Icon name="arrowLeft" size={18} /> Back to plan
        </button>
        <div className="overlay-pad" style={{ paddingTop: 4 }}>
          <div className="eyebrow">Recipes · {data.recipePack.length} dishes</div>
          <h2 className="h-serif" style={{ fontSize: 24, margin: "8px 0 0", lineHeight: 1.2 }}>
            Your recipe pack
          </h2>
          <div className="muted" style={{ fontSize: 12.5, margin: "8px 0 12px" }}>
            Every recipe from your plan — tap a dish for ingredients and method.
          </div>
          <RecipeAccordion recipes={data.recipePack} />
        </div>
      </div>
    );
  }

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

// ── kitchen measures (decodes the household portions on every menu) ─────────

export function PortionsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay-scroll">
      <button className="back-link" onClick={onClose} style={{ margin: "0 0 4px" }}>
        <Icon name="arrowLeft" size={18} /> Back to plan
      </button>
      <div className="overlay-pad" style={{ paddingTop: 4 }}>
        <div className="eyebrow">Kitchen measures</div>
        <h2 className="h-serif" style={{ fontSize: 24, margin: "8px 0 0", lineHeight: 1.2 }}>
          What a bowl, cup &amp; katori mean
        </h2>
        <div className="divider-ochre" />
        <p className="doc-p" style={{ marginTop: 0 }}>
          {MEASURE_INTRO}
        </p>
        <MeasureList />
        <a className="wa-btn" href="/handouts/kitchen-measures.html" target="_blank" rel="noreferrer" style={{ marginTop: 20 }}>
          <Icon name="external" size={18} /> Print a fridge copy
        </a>
        <div className="card-quiet" style={{ padding: "13px 15px", marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
          <Icon name="leaf" size={16} style={{ color: "var(--forest)" }} />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
            These are guides for the eye — a little more or less is completely fine.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── in-app recipes (letters are retiring — the pack renders here) ───────────

/** Pretty-print a scaled quantity ("0.5" → "½", "1.5" → "1½"). */
function fmtQty(n: number): string {
  if (!isFinite(n) || n <= 0) return "";
  const whole = Math.floor(n + 1e-6);
  const frac = n - whole;
  const FR: [number, string][] = [
    [0.25, "¼"], [0.33, "⅓"], [0.5, "½"], [0.66, "⅔"], [0.67, "⅔"], [0.75, "¾"],
  ];
  const hit = FR.find(([v]) => Math.abs(frac - v) < 0.05);
  if (hit) return `${whole > 0 ? whole : ""}${hit[1]}`;
  return String(Math.round(n * 100) / 100);
}

function RecipeDetailBody({ r }: { r: AppRecipe }) {
  const baseServes = r.servingsNum && r.servingsNum > 0 ? r.servingsNum : parseInt(r.serves ?? "", 10) || 2;
  const [serves, setServes] = useState(baseServes);
  const ratio = serves / baseServes;
  const canScale = !!r.ingredientsStructured?.length;
  const SERVE_OPTS = Array.from(new Set([1, 2, 4, 6, baseServes])).sort((a, b) => a - b);

  return (
    <div style={{ padding: "4px 0 12px" }}>
      {r.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={r.imageUrl}
          alt={r.title}
          style={{
            width: "100%",
            borderRadius: 8,
            marginBottom: 10,
            objectFit: "cover",
            maxHeight: 220,
          }}
        />
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {r.kcalPerServing ? <span className="food-pill">~{r.kcalPerServing} kcal/serving</span> : null}
        {!canScale && r.serves && <span className="food-pill">Serves {r.serves}</span>}
        {r.time && <span className="food-pill">{r.time}</span>}
        {r.ayurveda && <span className="food-pill">Ayurveda recommends</span>}
      </div>

      {canScale && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "4px 0 12px" }}>
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Cook for</span>
          {SERVE_OPTS.map((n) => (
            <button
              key={n}
              onClick={() => setServes(n)}
              style={{
                padding: "5px 11px",
                borderRadius: 999,
                border: "1px solid var(--line)",
                background: serves === n ? "var(--forest)" : "var(--paper)",
                color: serves === n ? "#fff" : "var(--ink)",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {n}
            </button>
          ))}
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{serves === 1 ? "person" : "people"}</span>
        </div>
      )}

      {canScale ? (
        <>
          <div className="doc-h">
            Ingredients{r.kcalPerServing ? ` · ~${Math.round(r.kcalPerServing * serves)} kcal total` : ""}
          </div>
          {r.ingredientsStructured!.map((ing, i) => {
            const q = parseFloat(ing.qty);
            const scaled = isFinite(q) && q > 0 ? `${fmtQty(q * ratio)} ${ing.unit}`.trim() : ing.qty;
            return (
              <div key={i} className="doc-li">
                {[scaled, ing.item].filter(Boolean).join(" ")}
              </div>
            );
          })}
        </>
      ) : (
        r.ingredients.length > 0 && (
          <>
            <div className="doc-h">Ingredients</div>
            {r.ingredients.map((ing, i) => (
              <div key={i} className="doc-li">
                {ing}
              </div>
            ))}
          </>
        )
      )}
      {r.method.length > 0 && (
        <>
          <div className="doc-h" style={{ marginTop: 12 }}>
            Method
          </div>
          <ol className="recipe" style={{ marginTop: 4 }}>
            {r.method.map((step, i) => (
              <li key={i}>
                <span className="rn">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {r.tip && (
        <p className="doc-p" style={{ fontStyle: "italic", color: "var(--muted)" }}>
          {r.tip}
        </p>
      )}
      {r.imageCredit && (
        <p style={{ fontSize: 10.5, color: "var(--muted)", opacity: 0.7, marginTop: 10 }}>
          Photo: {r.imageCredit}
        </p>
      )}
    </div>
  );
}

/** Tappable list of every recipe in the pack — expands in place. Used in
 *  the meal overlay (when a dish has no exact match) and the Plan →
 *  Resources recipe-pack card. */
export function RecipeAccordion({ recipes }: { recipes: AppRecipe[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="card" style={{ overflow: "hidden", marginTop: 4 }}>
      {recipes.map((r, i) => (
        <div key={i} style={{ borderBottom: i < recipes.length - 1 ? "1px solid var(--line-soft)" : "none" }}>
          <button
            className="rp-row"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            <span className="rp-title">{r.title}</span>
            <span className="rp-meta">
              {r.time ?? ""}
              <span className="chev" style={{ transform: open === i ? "rotate(90deg)" : "none", transition: "transform .2s" }}>
                <Icon name="chev" size={16} />
              </span>
            </span>
          </button>
          {open === i && (
            <div style={{ padding: "0 14px" }}>
              <RecipeDetailBody r={r} />
            </div>
          )}
        </div>
      ))}
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

        {/* coach-referral purchase link, when the remedy needs buying
            (punarnava, triphala…) — curated links only, never a search */}
        {r.buyUrl && (
          <a className="wa-btn" href={r.buyUrl} target="_blank" rel="noreferrer" style={{ marginTop: 18 }}>
            <Icon name="bag" size={18} /> Get it — {firstName}&apos;s pick
          </a>
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

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];


function inputValToDisplay(val: string): string {
  const parts = val.split(":");
  let h = parseInt(parts[0]);
  const min = parts[1] ?? "00";
  const ap = h >= 12 ? "pm" : "am";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${min} ${ap}`;
}

/** Master push-notification toggle (client-controlled). When ON: registers
 *  the service worker, asks permission, subscribes, and stores it server-side.
 *  When OFF: unsubscribes the browser + drops the server subscription. iOS
 *  only supports this for an installed (Add-to-Home-Screen) PWA. */
function PushToggleSection() {
  const data = useOchre();
  const [supported, setSupported] = useState(true);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker
      .getRegistration("/ochre-app/sw.js")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setOn(!!sub))
      .catch(() => {});
  }, []);

  async function enable() {
    setBusy(true);
    setNote("");
    try {
      const reg = await navigator.serviceWorker.register("/ochre-app/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setNote("Notifications are blocked in your phone/browser settings — allow them there, then try again.");
        setBusy(false);
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      const res = await fetch("/api/app-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, action: "subscribe", subscription: sub.toJSON() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setNote("Couldn't turn on notifications just now — please try again.");
        setBusy(false);
        return;
      }
      setOn(true);
    } catch {
      setNote("Couldn't turn on notifications on this device.");
    }
    setBusy(false);
  }

  async function disable() {
    setBusy(true);
    setNote("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/ochre-app/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe().catch(() => {});
      await fetch("/api/app-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, action: "unsubscribe" }),
      }).catch(() => {});
      setOn(false);
    } catch {
      setOn(false);
    }
    setBusy(false);
  }

  return (
    <div className="set-group">
      <div className="set-h">
        <Icon name="bell" size={15} /> Push notifications
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="set-row">
          <span className="sr-name" style={{ flex: 1 }}>
            On this phone
            <span className="sr-meta">
              {supported ? (busy ? "Working…" : on ? "On" : "Off") : "Add to Home Screen first"}
            </span>
          </span>
          <Toggle
            on={on}
            onClick={() => {
              if (busy || !supported) return;
              if (on) void disable();
              else void enable();
            }}
          />
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8, paddingLeft: 2 }}>
        {supported
          ? "Gentle nudges on this phone — a fresh weekly menu, check-in reminders. Turn off any time; your WhatsApp messages from " +
            data.coach.name.split(" ")[0] +
            " are unaffected."
          : "To get notifications on iPhone, first add this app to your Home Screen (Share → Add to Home Screen), then re-open it here."}
      </div>
      {note && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6, paddingLeft: 2, color: "var(--terracotta, #b3402a)" }}>
          {note}
        </div>
      )}
    </div>
  );
}

export function AccountOverlay({
  onClose,
  textLarge,
  onTextLarge,
}: {
  onClose: () => void;
  textLarge: boolean;
  onTextLarge: (v: boolean) => void;
}) {
  const data = useOchre();
  const router = useRouter();
  const a = data.account;
  // Avatar: optimistic local override (instant) over the server value. Writing
  // an in-app photo never touches the coach-account photo on disk.
  const [photoOverride, setPhotoOverride] = useState<string | null>(null);
  const [photoCleared, setPhotoCleared] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState("");
  const effectivePhoto = photoOverride ?? (photoCleared ? null : a.photoUrl);

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    setPhotoNote("");
    const b64 = await downscaleToJpegB64(file);
    if (!b64) {
      setPhotoNote("That image couldn't be read — try a different photo.");
      setPhotoBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/app-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, image_b64: b64 }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setPhotoNote("Couldn't save your photo just now — please try again.");
        setPhotoBusy(false);
        return;
      }
      setPhotoOverride(`data:image/jpeg;base64,${b64}`);
      setPhotoCleared(false);
      router.refresh(); // re-pull server data so the header avatar updates too
    } catch {
      setPhotoNote("Couldn't reach the server. Check your connection.");
    }
    setPhotoBusy(false);
  }

  async function onClearPhoto() {
    setPhotoBusy(true);
    setPhotoNote("");
    try {
      const res = await fetch("/api/app-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, action: "clear" }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        setPhotoOverride(null);
        setPhotoCleared(true);
        router.refresh();
      } else {
        setPhotoNote("Couldn't remove the photo — please try again.");
      }
    } catch {
      setPhotoNote("Couldn't reach the server. Check your connection.");
    }
    setPhotoBusy(false);
  }

  // data.reminders is already derived from the live plan + the client's saved
  // overrides (see client-app.ts), so it's the source of truth for the initial
  // UI. We only persist what the client changes back as overrides.
  const [rem, setRem] = useState<Record<string, boolean>>(() =>
    data.reminders.reduce((o, r) => ({ ...o, [r.id]: r.on }), {}),
  );
  const [remTimes, setRemTimes] = useState<Record<string, string>>(() =>
    data.reminders.reduce((o, r) => ({ ...o, [r.id]: r.time }), {}),
  );
  // ids whose time the client has pinned — preserved across plan regeneration.
  const [customTimes, setCustomTimes] = useState<Set<string>>(
    () => new Set(data.reminders.filter((r) => r.timeCustom).map((r) => r.id)),
  );

  // Persist overrides only (on/off + pinned time). The cron re-derives label /
  // default time / cadence from the current plan, so we never store those.
  function persistReminders(
    nextRem: Record<string, boolean>,
    nextTimes: Record<string, string>,
    custom: Set<string>,
  ) {
    const items = data.reminders.map((r) => ({
      id: r.id,
      on: nextRem[r.id] ?? r.on,
      time: nextTimes[r.id] ?? r.time,
      time_custom: custom.has(r.id),
    }));
    void fetch("/api/app-reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: data.token, action: "save", items }),
    }).catch(() => {});
  }

  function handleToggle(id: string) {
    const next = { ...rem, [id]: !rem[id] };
    setRem(next);
    persistReminders(next, remTimes, customTimes);
  }

  function handleTimeChange(id: string, val: string) {
    const nextTimes = { ...remTimes, [id]: val };
    const nextCustom = new Set(customTimes).add(id);
    setRemTimes(nextTimes);
    setCustomTimes(nextCustom);
    persistReminders(rem, nextTimes, nextCustom);
  }

  function reminderDisplayTime(r: { id: string; time: string; cadence: "daily" | "weekly"; weekday?: number }): string {
    const t = remTimes[r.id] ?? r.time;
    const prefix = r.cadence === "weekly" ? `${WEEKDAY_NAMES[r.weekday ?? 0]} ` : "";
    return prefix + inputValToDisplay(t);
  }

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
          <AppAvatar photoUrl={effectivePhoto} initials={a.avatar} imgClass="acct-av-img" phClass="acct-av" />
          <div style={{ flex: 1 }}>
            <div className="acct-name">{a.name}</div>
            <div className="acct-sub">{a.contact}</div>
            <div className="acct-plan">
              {a.plan}
              {a.member ? ` · ${a.member}` : ""}
            </div>
            <div className="acct-photo-actions">
              <label className={"acct-photo-btn" + (photoBusy ? " is-busy" : "")}>
                {photoBusy ? "Saving…" : effectivePhoto ? "Change photo" : "Add a photo"}
                <input
                  type="file"
                  accept="image/*"
                  disabled={photoBusy}
                  onChange={onPickPhoto}
                  style={{ display: "none" }}
                />
              </label>
              {effectivePhoto && !photoBusy && (
                <button type="button" className="acct-photo-clear" onClick={onClearPhoto}>
                  Remove
                </button>
              )}
            </div>
            {photoNote && <div className="acct-photo-note">{photoNote}</div>}
          </div>
        </div>

        <BodySection />

        <div className="set-group">
          <div className="set-h">
            <Icon name="sun" size={15} /> Display
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="set-row">
              <span className="sr-name" style={{ flex: 1 }}>
                Larger text
                <span className="sr-meta">Bigger type across the app</span>
              </span>
              <Toggle on={textLarge} onClick={() => onTextLarge(!textLarge)} />
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8, paddingLeft: 2 }}>
            Easier on the eyes — saved on this phone.
          </div>
        </div>

        <div className="set-group">
          <div className="set-h">
            <Icon name="bell" size={15} /> Reminders
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {data.reminders.map((r) => (
              <div className="set-row" key={r.id}>
                <span className="sr-name" style={{ flex: 1 }}>
                  {r.label}
                  <span className="sr-time-row">
                    <input
                      type="time"
                      className="sr-time-input"
                      value={remTimes[r.id] ?? r.time}
                      min="07:30"
                      onChange={(e) => handleTimeChange(r.id, e.target.value)}
                      aria-label={`Set time for ${r.label}`}
                    />
                    <span className="sr-meta">{reminderDisplayTime(r)}</span>
                  </span>
                </span>
                <Toggle on={!!rem[r.id]} onClick={() => handleToggle(r.id)} />
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8, paddingLeft: 2 }}>
            Gentle nudges on this phone at the times you set. Turn on Push notifications below for these to arrive.
          </div>
        </div>

        <PushToggleSection />

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

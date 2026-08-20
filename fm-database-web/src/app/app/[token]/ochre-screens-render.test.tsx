/**
 * RENDER PARITY — what the payload prescribes must be what the screen draws.
 *
 * The incident this locks down: the Today meal row rendered
 * `components.slice(0, 3)` with no indicator. A client (cl-022) had a
 * before-3pm vegetable juice deliberately moved into her mid-morning slot;
 * it was component #4, so the row silently ended one item early and she
 * never saw it. Every data-level check passed — the juice WAS in the
 * payload. Only rendering catches this class of bug.
 *
 * Harness note: `react-dom/server`'s renderToStaticMarkup, deliberately —
 * these are pure presentational rows with no effects, no refs and no
 * post-mount behaviour, so a DOM is dead weight. No jsdom, no Testing
 * Library, no new dependency; vitest's built-in esbuild transform picks up
 * `jsx: "react-jsx"` from tsconfig.
 *
 * Ground truth is INDEPENDENT of the implementation on purpose. This file
 * never imports ML_MAX_COMPONENTS (or any other cap) and never re-derives
 * what "should" be visible from the component's own arithmetic — a check
 * that did that would pass at any cap, including a silent one. Instead it
 * asserts CONSERVATION, hand-written from the clinical meaning: a client
 * must be able to account for every prescribed item, so
 *
 *     (titles drawn) + (titles claimed by "+K more") === (titles prescribed)
 *
 * which is false for a silent cap at ANY value, and stays true when the
 * cap is retuned for layout.
 */

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MealList } from "./ochre-screens";
import { EndgameBanner, LibraryFloorScreen } from "./ochre-endgame";
import { OchreContext } from "./ochre-context";
import type { AppMeal, AppSupplement, ClientAppData, DishComponent } from "@/lib/fmdb/client-app";

// ── fixtures (synthetic — no client PHI in a committed test) ────────────────

/** Deliberately distinctive dish names: no title is a substring of another,
 *  so "did this title get drawn?" can be answered by plain string search
 *  without a false positive from a longer neighbour. */
function meal(slot: string, titles: string[]): AppMeal {
  const components: DishComponent[] = titles.map((title) => ({ title }));
  return {
    slot,
    timeHint: "10:30 am",
    glyph: "bowl",
    pills: titles,
    components,
  };
}

function ctx(meals: AppMeal[]): ClientAppData {
  // MealList reads exactly three fields; the rest of ClientAppData is
  // irrelevant to the meal row and is deliberately not faked.
  return { meals, mealExtra: {}, remedies: [] } as unknown as ClientAppData;
}

function renderMeals(meals: AppMeal[]): string {
  return renderToStaticMarkup(
    <OchreContext.Provider value={ctx(meals)}>
      <MealList openMeal={() => {}} logged={{}} onToggle={() => {}} openRemedy={() => {}} />
    </OchreContext.Provider>,
  );
}

/** How many items the row admits it is not showing. 0 when there is no
 *  affordance at all — which is the silent-drop failure mode. */
function claimedByMore(html: string): number {
  const m = html.match(/\+(\d+)\s+more/);
  return m ? Number(m[1]) : 0;
}

// ── the incident, reconstructed ─────────────────────────────────────────────

describe("Today meal row — no prescribed component is silently dropped", () => {
  // Shape of the real incident: a mid-morning slot carrying six components,
  // with the clinically-load-bearing item (the before-3pm juice) last —
  // exactly where a head-biased cap hides it.
  const SIX = [
    "Soaked almonds",
    "Steamed sprouts salad",
    "Buttermilk with jeera",
    "Roasted makhana",
    "Guava wedges",
    "Ash gourd vegetable juice",
  ];

  it("accounts for every component of a 6-item slot — drawn, or counted in +N more", () => {
    const html = renderMeals([meal("Mid-morning", SIX)]);

    const missing = SIX.filter((t) => !html.includes(t));
    const counted = claimedByMore(html);

    expect(
      missing.length,
      `Row dropped ${missing.length} prescribed component(s) but only owned up to ${counted}. ` +
        `Unaccounted: ${missing.join(", ") || "(none)"}`,
    ).toBe(counted);
  });

  it("names the last component specifically — the juice must be drawn or counted", () => {
    const html = renderMeals([meal("Mid-morning", SIX)]);
    const juice = SIX[SIX.length - 1];

    const drawn = html.includes(juice);
    const counted = claimedByMore(html);

    expect(
      drawn || counted > 0,
      `"${juice}" is prescribed in this slot but the row neither draws it nor shows a "+N more". ` +
        `This is the cl-022 failure: the client cannot tell the row is incomplete.`,
    ).toBe(true);
  });

  it("hides from the TAIL, never the head — a client reads the row top-down", () => {
    const html = renderMeals([meal("Mid-morning", SIX)]);
    const shownFlags = SIX.map((t) => html.includes(t));
    const firstHidden = shownFlags.indexOf(false);

    if (firstHidden !== -1) {
      const shownAfterAGap = shownFlags.slice(firstHidden).some(Boolean);
      expect(
        shownAfterAGap,
        `Row drew components out of order — "${SIX[firstHidden]}" was hidden while a later ` +
          `component was drawn. Truncation must take a prefix.`,
      ).toBe(false);
    }
  });

  // A cap is only honest if it also stays quiet when nothing is capped.
  // Without this, "+0 more" or a permanently-on affordance would pass above.
  it("shows every component and NO +N more when the slot is short", () => {
    const two = ["Moong dal chilla", "Coconut coriander chutney"];
    const html = renderMeals([meal("Breakfast", two)]);

    for (const t of two) {
      expect(html.includes(t), `"${t}" is prescribed but was not drawn`).toBe(true);
    }
    expect(claimedByMore(html), `Row claimed hidden items on a slot where nothing is hidden`).toBe(0);
    expect(html).not.toContain("more</span>");
  });

  // Conservation must hold at every length, not just at the incident's 6 —
  // this is what keeps the check alive if the cap is ever retuned for layout.
  it("conserves components across slot lengths 1..10", () => {
    for (let n = 1; n <= 10; n++) {
      const titles = Array.from({ length: n }, (_, i) => `Dish number ${i + 1} of ten`);
      const html = renderMeals([meal("Lunch", titles)]);

      const drawn = titles.filter((t) => html.includes(t)).length;
      const counted = claimedByMore(html);

      expect(
        drawn + counted,
        `Slot of ${n}: ${drawn} drawn + ${counted} counted = ${drawn + counted}, expected ${n}. ` +
          `${n - drawn - counted} component(s) vanished.`,
      ).toBe(n);
    }
  });

  it("conserves components independently for each slot on the screen", () => {
    const meals = [
      meal("Breakfast", ["Ragi dosa", "Peanut chutney"]),
      meal("Mid-morning", SIX),
      meal("Lunch", ["Jowar roti", "Lauki sabzi", "Toor dal", "Cucumber salad", "Curd", "Kokum sherbet", "Papad"]),
    ];
    const html = renderMeals(meals);

    // Each row's "+N more" appears in document order, so the k-th match
    // belongs to the k-th row that has one.
    const moreCounts = [...html.matchAll(/\+(\d+)\s+more/g)].map((m) => Number(m[1]));
    let moreIdx = 0;

    for (const m of meals) {
      const titles = m.components.map((c) => c.title);
      const drawn = titles.filter((t) => html.includes(t)).length;
      const counted = drawn < titles.length ? (moreCounts[moreIdx++] ?? 0) : 0;

      expect(
        drawn + counted,
        `Slot "${m.slot}": ${drawn} drawn + ${counted} counted, expected ${titles.length}.`,
      ).toBe(titles.length);
    }
  });

  it("keeps the portion attached to its component when both are drawn", () => {
    const m = meal("Breakfast", ["Poha"]);
    m.components[0].portion = "1 katori";
    const html = renderMeals([m]);

    expect(html).toContain("Poha");
    expect(html, "portion was dropped — a dish without its quantity is not a prescription").toContain("1 katori");
  });
});

// ── the same truncation shape, on supplements ───────────────────────────────
//
// The graduation "library floor" lists every supplement the client can still
// re-order, under copy that promises "your links don't expire". It used to
// .slice(0, 6) silently, so a 7- or 8-item protocol lost re-order links with
// nothing on screen admitting it — and unlike the meal row there is no
// drill-in to recover them. Same conservation rule, different surface.

function supp(name: string, buyUrl?: string): AppSupplement {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    dose: "1 capsule",
    slot: "Morning",
    timing: "With breakfast",
    chronoRank: 30,
    why: "Synthetic fixture",
    ...(buyUrl ? { buyUrl } : {}),
  };
}

function renderLibraryFloor(allSupplements: AppSupplement[]): string {
  const data = {
    token: "test-token",
    client: { firstName: "Test" },
    coach: { name: "Shivani" },
    recipePack: [],
    allSupplements,
    endgame: null,
  } as unknown as ClientAppData;

  return renderToStaticMarkup(
    <OchreContext.Provider value={data}>
      <LibraryFloorScreen goCoach={() => {}} goTab={() => {}} />
    </OchreContext.Provider>,
  );
}

describe("Library-floor supplements — every re-orderable supplement stays reachable", () => {
  // Eight buyable items: past any small cap, and a realistic size for a
  // protocol that ran a full programme before graduating.
  const EIGHT = [
    "Magnesium glycinate",
    "Vitamin D3 with K2",
    "Methylcobalamin B12",
    "Omega 3 fish oil",
    "Zinc picolinate",
    "Ashwagandha root extract",
    "N acetyl cysteine",
    "Berberine complex",
  ];

  it("draws all eight buyable supplements, or counts what it withholds", () => {
    const html = renderLibraryFloor(EIGHT.map((n) => supp(n, `https://example.test/${n}`)));

    const missing = EIGHT.filter((n) => !html.includes(n));
    const counted = claimedByMore(html);

    expect(
      missing.length,
      `Library floor dropped ${missing.length} re-orderable supplement(s) but owned up to ${counted}. ` +
        `Unaccounted: ${missing.join(", ") || "(none)"}. The card promises "your links don't expire".`,
    ).toBe(counted);
  });

  it("gives every drawn supplement its own re-order link", () => {
    const html = renderLibraryFloor(EIGHT.map((n) => supp(n, `https://example.test/${n}`)));
    const links = [...html.matchAll(/https:\/\/example\.test\/[^"]+/g)].length;

    expect(
      links,
      `${EIGHT.length} supplements are re-orderable but only ${links} link(s) rendered — ` +
        `a name without its link cannot be re-ordered.`,
    ).toBe(EIGHT.length);
  });

  it("omits supplements that have no buy link, and never invents one", () => {
    const html = renderLibraryFloor([
      supp("Magnesium glycinate", "https://example.test/mag"),
      supp("Coach sourced tincture"), // no buyUrl — nothing to re-order
    ]);

    expect(html).toContain("Magnesium glycinate");
    expect(
      html.includes("Coach sourced tincture"),
      "a supplement with no buy link was listed under a re-order card it cannot serve",
    ).toBe(false);
  });
});

// ── the final-week heads-up ─────────────────────────────────────────────────
//
// A client's app switches from their live plan to the frozen library floor on
// dates alone. cl-017 dropped on 19 Aug and opened the app the next day to find
// it changed — it read as something being taken away. The banner's job in the
// final week is to name the day AND name what stays, so the change is expected.
// Data-level gating is pinned in app-final-stretch.test.ts; this is the copy.

function renderBanner(
  endgame: Partial<NonNullable<ClientAppData["endgame"]>>,
  extra: Partial<ClientAppData> = {},
): string {
  const data = {
    client: { firstName: "Test", totalWeeks: 12 },
    coach: { name: "Shivani" },
    recipePack: [],
    allSupplements: [],
    endgame: { mode: "REVIEW", finishingSoon: null, shortEngagement: false, ...endgame },
    ...extra,
  } as unknown as ClientAppData;

  return renderToStaticMarkup(
    <OchreContext.Provider value={data}>
      <EndgameBanner goCoach={() => {}} onRenew={() => {}} />
    </OchreContext.Provider>,
  );
}

describe("Final-week banner — the change is announced, not discovered", () => {
  const FINISHING = { finishingSoon: { daysLeft: 5, dateLabel: "27th August 2026" } };

  it("names the finish date", () => {
    expect(renderBanner(FINISHING)).toContain("27th August 2026");
  });

  it("names what STAYS, so it cannot read as a countdown to losing something", () => {
    const html = renderBanner(FINISHING, {
      recipePack: [{ title: "Moong dal chilla" }],
      allSupplements: [supp("Magnesium glycinate", "https://example.test/mag")],
    } as unknown as Partial<ClientAppData>);

    expect(html).toContain("nothing disappears");
    for (const kept of ["recipes", "supplement re-order links", "recipe keepsake"]) {
      expect(html, `the note never mentions that her ${kept} stay`).toContain(kept);
    }
  });

  it("only promises what she actually has", () => {
    // No recipes on file → no recipe/keepsake promise she can't collect on.
    const html = renderBanner(FINISHING, {
      allSupplements: [supp("Magnesium glycinate", "https://example.test/mag")],
    } as unknown as Partial<ClientAppData>);
    expect(html).toContain("supplement re-order links");
    expect(html).not.toContain("keepsake");
  });

  it("says 'today' and 'tomorrow' rather than '0 days away'", () => {
    expect(renderBanner({ finishingSoon: { daysLeft: 0, dateLabel: "20th August 2026" } }))
      .toContain("That&#x27;s today");
    expect(renderBanner({ finishingSoon: { daysLeft: 1, dateLabel: "21st August 2026" } }))
      .toContain("That&#x27;s tomorrow");
  });

  it("falls back to the ordinary REVIEW copy outside the final week", () => {
    const html = renderBanner({ finishingSoon: null, recheckLabel: "3rd September 2026" });
    expect(html).toContain("wrapping up");
    expect(html).not.toContain("nothing disappears");
  });
});

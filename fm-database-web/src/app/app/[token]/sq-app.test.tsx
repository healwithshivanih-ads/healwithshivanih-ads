/**
 * The new shell's frame: what a switched-on client is handed at step 0.
 *
 * Harness: `react-dom/server`'s renderToStaticMarkup, as in
 * ochre-screens-render.test.tsx — the frame is checked as drawn markup, with
 * no DOM and no new dependency. Synthetic payload only; no client data.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import SqApp, { SQ_TABS, weekRingRadii, type SqShellState } from "./sq-app";

const noop = () => {};
const STATE: SqShellState = {
  hydrated: true,
  logged: {},
  practicesDone: {},
  practiceAt: {},
  toggleTick: noop,
  togglePractice: noop,
  checkinSentWeek: 0,
  textLarge: false,
  setTextLarge: noop,
};

/** Only the fields the frame reads; a full payload is hundreds of lines. */
function payload(week: number, totalWeeks: number): ClientAppData {
  return {
    clientId: "cl-test",
    token: "tok-test-0000000000",
    client: { firstName: "Asha", week, totalWeeks, notStarted: false },
    coach: { name: "Zzyzx Qwerty" },
    today: { dow: "Wednesday", dateLabel: "18 November", idx: 2 },
    meals: [],
    supplements: [],
    remedies: [],
    practices: [],
    mealExtra: {},
    grocery: null,
    sq: null,
  } as unknown as ClientAppData;
}

const draw = (week = 4, totalWeeks = 12, state: SqShellState = STATE) =>
  renderToStaticMarkup(<SqApp data={payload(week, totalWeeks)} state={state} />);

describe("the Sequoya shell frame", () => {
  it("has exactly the four tabs, in order, with Today open", () => {
    expect(SQ_TABS.map((t) => t.label)).toEqual(["Today", "Practices", "Coach", "Everything"]);
    const html = draw();
    const tabs = [...html.matchAll(/<button[^>]*class="sq-tab"[^>]*>.*?<\/button>/g)].map((m) => m[0]);
    expect(tabs).toHaveLength(4);
    expect(tabs.map((t) => t.replace(/<svg.*?<\/svg>/, "").replace(/<[^>]+>/g, ""))).toEqual([
      "Today",
      "Practices",
      "Coach",
      "Everything",
    ]);
    expect(tabs.filter((t) => t.includes('aria-current="page"'))).toHaveLength(1);
    expect(tabs[0]).toContain('aria-current="page"');
  });

  it("shows the wordmark and the client's own week", () => {
    const html = draw(7, 12);
    expect(html).toContain('<span class="sq-word">Sequoya</span>');
    expect(html).toContain("<span>Week 7</span>");
    expect(html).toContain('aria-label="Your progress, week 7 of 12"');
  });

  it("draws one ring per week lived on a 12-week programme, the current week heaviest", () => {
    const rings = (html: string) => [...html.matchAll(/<circle[^>]*stroke="var\(--sq-fire\)"[^>]*>/g)].map((m) => m[0]);
    expect(rings(draw(1, 12))).toHaveLength(1);
    const seven = rings(draw(7, 12));
    expect(seven).toHaveLength(7);
    expect(seven.filter((c) => c.includes('stroke-width="2"'))).toHaveLength(1);
    // Odd inputs must not throw or overdraw: a week past the end, a one-week plan.
    expect(rings(draw(40, 12))).toHaveLength(12);
    expect(rings(draw(1, 1))).toHaveLength(1);
    expect(rings(draw(0, 0))).toHaveLength(0);
  });

  it("keeps the rings apart on a long programme instead of smudging into a disc", () => {
    // Every week of every programme length up to a year: rings never closer
    // than 1 unit, never more rings than weeks lived, never outside the rim.
    for (let total = 1; total <= 52; total++) {
      for (let week = 0; week <= total; week++) {
        const r = weekRingRadii(week, total);
        expect(r.length, `week ${week} of ${total}`).toBeLessThanOrEqual(week);
        if (week > 0) expect(r.length).toBeGreaterThanOrEqual(1);
        for (let i = 1; i < r.length; i++) {
          expect(r[i - 1] - r[i], `week ${week} of ${total}`).toBeGreaterThanOrEqual(0.9); // 1, less rounding to 0.1
        }
        for (const x of r) {
          expect(x).toBeGreaterThanOrEqual(3);
          expect(x).toBeLessThanOrEqual(15);
        }
      }
    }
    // The ring still grows week by week, so a later week never looks smaller.
    for (let week = 2; week <= 26; week++) {
      expect(weekRingRadii(week, 26)[0]).toBeGreaterThan(weekRingRadii(week - 1, 26)[0]);
    }
    expect(weekRingRadii(26, 26)[0]).toBe(15);
  });

  it("opens on Home, greeting her by name with the day and her week", () => {
    const html = draw(7, 12);
    // The server does not know the phone's hour, so the greeting is neutral
    // until the page is live — never a wrong "Good morning".
    expect(html).toContain("<h1>Hello, Asha</h1>");
    expect(html).toContain("Wednesday 18 November · week 7 of 12");
  });

  it("shows no 'next' card before the phone's ticks and clock are known", () => {
    // A static render is the first paint: nothing has been read back yet. A
    // card drawn now could be for something she has already ticked.
    const html = draw();
    expect(html).not.toContain("sq-hero");
    expect(html).toContain('aria-busy="true"');
  });

  it("carries the larger-text setting it is lent", () => {
    expect(draw(4, 12, { ...STATE, textLarge: true })).toContain('class="sq-app sq-big"');
    expect(draw(4, 12, STATE)).toContain('class="sq-app"');
  });

  it("is rooted in its own class and never in today's app's", () => {
    const html = draw();
    // (React hoists the font <link> ahead of it; the app's own root is next.)
    expect(html.replace(/^<link[^>]*>/, "")).toMatch(/^<div class="sq-app"/);
    expect(html).not.toContain("ochre-app");
    // Every class it draws is its own — nothing borrowed from app.css.
    const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    expect(classes.filter((c) => !c.startsWith("sq-"))).toEqual([]);
  });

  it("has the ask box's input on Today, ready on first paint", () => {
    const html = draw();
    expect(html).toContain('placeholder="Ask about your plan"');
    expect(html).toContain('class="sq-send"');
    // No unread dot until the phone has asked the server.
    expect(html).not.toContain("sq-tabdot");
  });

  it("never prints the coach's name", () => {
    const html = draw();
    expect(html).not.toContain("Zzyzx");
    expect(html).not.toContain("Qwerty");
  });

});

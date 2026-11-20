/**
 * Today's screens hosted in the new front: which are offered, and that each
 * draws inside today's stylesheet scope with a way out.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { OchreContext } from "./ochre-context";
import { HOSTED_TITLES, hostedAvailable, SqHost } from "./sq-host";

const base = { weekMenus: [], grocery: null, exerciseSessions: [] } as unknown as ClientAppData;

describe("hostedAvailable", () => {
  it("always offers the check-in and tests; the rest only when the plan has them", () => {
    expect([...hostedAvailable(base)].sort()).toEqual(["checkin", "labs"]);
    const full = {
      weekMenus: [{ week: 1, current: true, days: [] }],
      grocery: { weeks: [{ week: 1, items: [{ name: "x" }] }] },
      exerciseSessions: [{ practiceId: "p" }],
    } as unknown as ClientAppData;
    expect([...hostedAvailable(full)].sort()).toEqual(["checkin", "grocery", "labs", "menu", "move"]);
    // A shopping list with nothing on it is not offered.
    expect(hostedAvailable({ ...base, grocery: { weeks: [{ week: 1, items: [] }] } } as unknown as ClientAppData).has("grocery")).toBe(false);
  });
  it("never names the coach in a title", () => {
    expect(Object.values(HOSTED_TITLES).join(" ")).not.toMatch(/shivani/i);
  });
});

describe("SqHost", () => {
  it("draws a plain screen inside today's stylesheet scope, with a title and Close", () => {
    const data = { ...base, weekMenus: [] } as unknown as ClientAppData;
    const html = renderToStaticMarkup(
      <OchreContext.Provider value={data}>
        <SqHost id="menu" data={data} checkinSent={false} onCheckinSent={() => {}} openHosted={() => {}} onClose={() => {}} />
      </OchreContext.Provider>,
    );
    expect(html).toContain('class="ochre-app sequoya sq-host-app"');
    expect(html).toContain("<h2>This week&#x27;s menu</h2>");
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('role="dialog"');
  });
});

/**
 * The Today card asks how the client feels and opens a practice. The failure
 * that matters is a chip that does nothing, or one that opens the wrong thing
 * after the mind-body drip has withheld a technique — the client taps "my mind
 * won't stop", gets a tapping session, and learns the card doesn't listen.
 */
import { describe, it, expect } from "vitest";

import type { AppSomatic } from "@/lib/fmdb/somatic";
import { FEELINGS, routableFeelings, routeFeeling, type Available } from "./mind-body-routing";

const somatic = (slug: string, shape: AppSomatic["shape"], name = slug): AppSomatic => ({
  practiceId: `p-${slug}`,
  sourceIndex: 0,
  slug,
  name,
  shape,
  when: "Daily",
  why: "",
  steps: [],
  reps: null,
  bilateral: false,
  timed: true,
  totalSeconds: 120,
  equipment: [],
});

const ALL: Available = {
  breath: { name: "4-7-8 breathing" },
  eft: { name: "EFT tapping" },
  sleep: { name: "Wind down for sleep" },
  somatic: [somatic("gastrocolic-rhythm", "breath_excursion", "Belly rhythm")],
};

const NOTHING: Available = { breath: null, eft: null, sleep: null, somatic: [] };

const feel = (key: string) => FEELINGS.find((f) => f.key === key)!;

describe("the chip set", () => {
  it("is the coach's six, in her words", () => {
    expect(FEELINGS.map((f) => f.label)).toEqual([
      "I'm on edge",
      "My mind won't stop",
      "I'm holding it all in",
      "I feel heavy",
      "I feel steady",
      "I feel good today",
    ]);
  });

  it("includes positive states — the card is not only for bad days", () => {
    expect(FEELINGS.filter((f) => f.tone === "settled")).toHaveLength(2);
  });

  /* Reply copy is shown above whichever practice the fallback lands on, so it
     must not name a technique or it will contradict the button beneath it. */
  it("never names a technique in the reply line", () => {
    for (const f of FEELINGS) {
      expect(f.reply.toLowerCase()).not.toMatch(/breath|tapping|eft|wind.?down|somatic/);
    }
  });

  it("gives every feeling a full preference order, so nothing dead-ends early", () => {
    for (const f of FEELINGS) {
      expect(new Set(f.prefer).size).toBe(4);
    }
  });
});

describe("routeFeeling — with everything available", () => {
  it("sends each state where the coach said it goes", () => {
    expect(routeFeeling(feel("edge"), ALL)!.kind).toBe("breath");
    expect(routeFeeling(feel("racing"), ALL)!.kind).toBe("sleep");
    expect(routeFeeling(feel("holding"), ALL)!.kind).toBe("somatic");
    expect(routeFeeling(feel("heavy"), ALL)!.kind).toBe("eft");
    expect(routeFeeling(feel("steady"), ALL)!.kind).toBe("breath");
    expect(routeFeeling(feel("good"), ALL)!.kind).toBe("breath");
  });

  it("labels the button with the real practice name", () => {
    expect(routeFeeling(feel("holding"), ALL)!.name).toBe("Belly rhythm");
    expect(routeFeeling(feel("edge"), ALL)!.name).toBe("4-7-8 breathing");
  });
});

describe("routeFeeling — when the drip has withheld things", () => {
  it("falls back rather than leaving a dead chip", () => {
    const breathOnly: Available = { ...NOTHING, breath: { name: "4-7-8 breathing" } };
    for (const f of FEELINGS) {
      const r = routeFeeling(f, breathOnly);
      expect(r, `${f.key} dead-ends`).not.toBeNull();
      expect(r!.kind).toBe("breath");
    }
  });

  it("a racing mind falls to breathing when the wind-down is still locked", () => {
    const noSleep: Available = { ...ALL, sleep: null };
    expect(routeFeeling(feel("racing"), noSleep)!.kind).toBe("breath");
  });

  it("returns null only when there is genuinely nothing to open", () => {
    for (const f of FEELINGS) expect(routeFeeling(f, NOTHING)).toBeNull();
  });
});

describe("which somatic answers 'I'm holding it all in'", () => {
  /* Several practices can be prescribed. The one that answers bracing is the
     one where a held thing lets go — not whichever happens to be listed first. */
  it("prefers a letting-go shape over plan order", () => {
    const have: Available = {
      ...NOTHING,
      somatic: [
        somatic("belly-drop", "breath_excursion", "Belly drop"),
        somatic("constructive-rest", "release", "Constructive rest"),
      ],
    };
    expect(routeFeeling(feel("holding"), have)!.name).toBe("Constructive rest");
  });

  it("ranks a true release above a load that merely ends", () => {
    const have: Available = {
      ...NOTHING,
      somatic: [
        somatic("boundary-push", "load_release", "Boundary push"),
        somatic("constructive-rest", "release", "Constructive rest"),
      ],
    };
    expect(routeFeeling(feel("holding"), have)!.name).toBe("Constructive rest");
  });

  it("takes the first prescribed one when none is a letting-go shape", () => {
    const have: Available = {
      ...NOTHING,
      somatic: [
        somatic("earthing", "still", "Earthing"),
        somatic("ankle-circles", "continuous_travel", "Ankle circles"),
      ],
    };
    expect(routeFeeling(feel("holding"), have)!.name).toBe("Earthing");
  });

  it("carries the somatic itself, so the app opens the right one", () => {
    const second = somatic("constructive-rest", "release", "Constructive rest");
    const have: Available = {
      ...NOTHING,
      somatic: [somatic("belly-drop", "breath_excursion"), second],
    };
    expect(routeFeeling(feel("holding"), have)!.somatic).toBe(second);
  });
});

describe("routableFeelings — what the card renders", () => {
  it("shows all six when everything is available", () => {
    expect(routableFeelings(ALL)).toHaveLength(6);
  });

  it("shows nothing at all when nothing is prescribed", () => {
    expect(routableFeelings(NOTHING)).toEqual([]);
  });

  it("still shows all six on a somatic-only plan — every chip has a home", () => {
    const somaticOnly: Available = {
      ...NOTHING,
      somatic: [somatic("constructive-rest", "release", "Constructive rest")],
    };
    const out = routableFeelings(somaticOnly);
    expect(out).toHaveLength(6);
    expect(out.every((o) => o.route.kind === "somatic")).toBe(true);
  });
});

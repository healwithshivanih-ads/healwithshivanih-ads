/**
 * The send-door matrix, pinned row by row. Lifecycle objects are built
 * directly — the resolver has its own tests; this file is about the policy.
 */
import { describe, it, expect } from "vitest";
import {
  mayContact,
  daysSince,
  SESSION_BOOKING_REFUSAL,
  FOLLOWUP_DRIP_GRACE_DAYS,
  WINBACK_GRACE_DAYS,
  type ContactPurpose,
} from "./contact-gate";
import {
  LAPSED_WINBACK_DAYS,
  PROSPECT_FOLLOWUP_DAYS,
  type Lifecycle,
  type LifecycleState,
} from "./lifecycle";

const TODAY = "2026-10-23";
const STATES: LifecycleState[] = ["archived", "maintenance", "active", "ending", "onboarding", "lapsed", "prospect"];
const PURPOSES: ContactPurpose[] = [
  "reply", "transactional", "plan", "session_booking", "intake",
  "followup_drip", "renewal", "winback", "content_note", "marketing",
];

function lc(state: LifecycleState, extra: Partial<Lifecycle> = {}): Lifecycle {
  return {
    state,
    since: "2026-10-01",
    reason: "fixture",
    planSlug: null,
    planEndsOn: null,
    daysSinceEnd: null,
    declined: false,
    optedOut: false,
    engagement: "",
    ...extra,
  };
}

/** Expected `ok` for every (purpose, state) with no overlays and fresh dates. */
const MATRIX: Record<ContactPurpose, Record<LifecycleState, boolean>> = {
  reply:           { archived: false, maintenance: true,  active: true,  ending: true,  onboarding: true,  lapsed: true,  prospect: true },
  transactional:   { archived: false, maintenance: true,  active: true,  ending: true,  onboarding: true,  lapsed: true,  prospect: true },
  plan:            { archived: false, maintenance: true,  active: true,  ending: true,  onboarding: true,  lapsed: false, prospect: false },
  session_booking: { archived: false, maintenance: false, active: false, ending: false, onboarding: false, lapsed: false, prospect: false },
  intake:          { archived: false, maintenance: false, active: false, ending: false, onboarding: true,  lapsed: false, prospect: false },
  followup_drip:   { archived: false, maintenance: false, active: false, ending: false, onboarding: false, lapsed: false, prospect: true },
  renewal:         { archived: false, maintenance: false, active: false, ending: true,  onboarding: false, lapsed: false, prospect: false },
  winback:         { archived: false, maintenance: false, active: false, ending: false, onboarding: false, lapsed: true,  prospect: false },
  content_note:    { archived: false, maintenance: false, active: false, ending: false, onboarding: false, lapsed: false, prospect: true },
  marketing:       { archived: false, maintenance: false, active: false, ending: false, onboarding: false, lapsed: true,  prospect: true },
};

describe("mayContact — the matrix", () => {
  for (const purpose of PURPOSES) {
    for (const state of STATES) {
      it(`${purpose} × ${state} → ${MATRIX[purpose][state] ? "ok" : "refused"}`, () => {
        // Fresh dates so the dated rows (drip / win-back) are inside their windows.
        const l = lc(state, { since: "2026-10-20", daysSinceEnd: state === "lapsed" ? 20 : null });
        const v = mayContact(l, purpose, TODAY);
        expect(v.ok).toBe(MATRIX[purpose][state]);
        if (v.ok) expect(v.reason).toBe("ok");
        else expect(v.reason.length).toBeGreaterThan(0);
      });
    }
  }

  it("session_booking carries the coach's own reason", () => {
    expect(mayContact(lc("active"), "session_booking", TODAY).reason).toBe(SESSION_BOOKING_REFUSAL);
  });
});

describe("mayContact — dated rows", () => {
  const LIMIT_DRIP = PROSPECT_FOLLOWUP_DAYS + FOLLOWUP_DRIP_GRACE_DAYS;
  it(`followup_drip allowed up to day ${LIMIT_DRIP}, refused after`, () => {
    const since = (d: number) => {
      const t = new Date(`${TODAY}T00:00:00Z`);
      t.setUTCDate(t.getUTCDate() - d);
      return t.toISOString().slice(0, 10);
    };
    expect(mayContact(lc("prospect", { since: since(LIMIT_DRIP) }), "followup_drip", TODAY).ok).toBe(true);
    const late = mayContact(lc("prospect", { since: since(LIMIT_DRIP + 1) }), "followup_drip", TODAY);
    expect(late.ok).toBe(false);
    expect(late.reason).toMatch(/finished/);
  });
  it("followup_drip with no datable since is allowed (cannot measure, do not block)", () => {
    expect(mayContact(lc("prospect", { since: null }), "followup_drip", TODAY).ok).toBe(true);
  });

  const LIMIT_WB = LAPSED_WINBACK_DAYS + WINBACK_GRACE_DAYS;
  it(`winback allowed up to day ${LIMIT_WB} after the plan ended, refused after`, () => {
    expect(mayContact(lc("lapsed", { daysSinceEnd: LIMIT_WB }), "winback", TODAY).ok).toBe(true);
    const late = mayContact(lc("lapsed", { daysSinceEnd: LIMIT_WB + 1 }), "winback", TODAY);
    expect(late.ok).toBe(false);
    expect(late.reason).toMatch(/window closed/);
  });
  it("winback with no datable end is allowed", () => {
    expect(mayContact(lc("lapsed", { daysSinceEnd: null }), "winback", TODAY).ok).toBe(true);
  });
});

describe("mayContact — overlays", () => {
  it("marketing_opt_out blocks every marketing purpose, nothing else", () => {
    for (const state of ["prospect", "lapsed"] as const) {
      const l = lc(state, { optedOut: true, since: "2026-10-20", daysSinceEnd: 20 });
      for (const p of ["followup_drip", "winback", "content_note", "marketing"] as const) {
        const v = mayContact(l, p, TODAY);
        expect(v.ok).toBe(false);
        expect(v.reason).toBe("marketing_opt_out");
      }
      expect(mayContact(l, "reply", TODAY).ok).toBe(true);
      expect(mayContact(l, "transactional", TODAY).ok).toBe(true);
    }
    // An opted-out ACTIVE client still gets her plan.
    expect(mayContact(lc("active", { optedOut: true }), "plan", TODAY).ok).toBe(true);
  });

  it("declined blocks everything except reply and transactional", () => {
    const l = lc("prospect", { declined: true, since: "2026-10-20" });
    for (const p of PURPOSES) {
      const v = mayContact(l, p, TODAY);
      if (p === "reply" || p === "transactional") {
        expect(v.ok).toBe(true);
      } else {
        expect(v.ok).toBe(false);
        expect(v.reason).toMatch(p === "session_booking" ? /coach does not auto-chase/ : /declined/);
      }
    }
  });

  it("archived refuses everything, including a reply", () => {
    for (const p of PURPOSES) expect(mayContact(lc("archived"), p, TODAY).ok).toBe(false);
  });
});

describe("daysSince", () => {
  it("counts whole days and refuses undatable input", () => {
    expect(daysSince("2026-10-20", TODAY)).toBe(3);
    expect(daysSince(TODAY, TODAY)).toBe(0);
    expect(daysSince(null, TODAY)).toBeNull();
    expect(daysSince("not a date", TODAY)).toBeNull();
  });
});

/**
 * Calm Gut screens: what a course buyer must see, drawn from a real payload.
 * Same harness as ochre-screens-render.test.tsx (renderToStaticMarkup, no DOM).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAppCourse, type AppCourse } from "@/lib/fmdb/course-app";
import { CALM_GUT } from "@/lib/fmdb/courses";
import { emptyCourseRecord } from "@/lib/fmdb/course-store";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { OchreContext } from "./ochre-context";
import { Header, BottomNav } from "./ochre-ui";
import { CourseDeviceGate } from "./course-device-gate";
import {
  catchUpSession,
  listenedCounts,
  CourseLogOverlay,
  CourseHelpScreen,
  CourseRefundOverlay,
  CourseScoreOverlay,
  CourseProvider,
  CourseTodayScreen,
  CourseSessionsScreen,
  CoursePlayerOverlay,
  CourseProgressScreen,
  bloatingWeeks,
} from "./ochre-course";

const noop = () => {};

function course(todayUtc: string, startYmd = "2026-12-08", ownerFirstName = "") {
  const rec = emptyCourseRecord("calm-gut");
  return buildAppCourse(CALM_GUT, startYmd, rec, { tz: "Asia/Kolkata", now: new Date(todayUtc), only: true, ownerFirstName });
}

function wrap(c: ReturnType<typeof course>, node: React.ReactNode) {
  return renderToStaticMarkup(
    <CourseProvider course={c} token={"t".repeat(32)} clientId="gd-0000000001">
      {node}
    </CourseProvider>,
  );
}

describe("Today for a course buyer", () => {
  it("always shows the flare-up tile, this week's session and the daily practices", () => {
    const html = wrap(course("2026-12-08T06:00:00Z"), <CourseTodayScreen openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />);
    expect(html).toContain("Having a bad moment?");
    expect(html).toContain("Calm belly");
    expect(html).toContain("Daily practice");
    expect(html).toContain("Short daily practice · 7 min");
    expect(html).toContain("Week 1 of 8");
    // Week-0 symptom check is offered on day 0 (the welcome email promises it).
    expect(html).toContain("Symptom check");
    expect(html).toContain("Before you begin");
  });

  it("in week 3 this week's session is session 3", () => {
    const html = wrap(course("2026-12-23T06:00:00Z"), <CourseTodayScreen openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />);
    expect(html).toContain("The river");
    expect(html).toContain("Week 3 of 8");
  });
});

describe("the link is personal", () => {
  it("Today's header carries the buyer's first name", () => {
    const html = wrap(course("2026-12-08T06:00:00Z", "2026-12-08", "Priya"), <CourseTodayScreen openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />);
    expect(html).toContain("Priya&#x27;s Calm Gut");
  });
  it("a third phone sees the limit, the masked buyer email and a code button — no email field", () => {
    const html = renderToStaticMarkup(<CourseDeviceGate token="t" mode="full" title="Priya's Calm Gut" maskedEmail="p•••o@example.com" />);
    expect(html).toContain("This course is already open on 2 phones");
    expect(html).toContain("p•••o@example.com");
    expect(html).toContain("Email me a code");
    expect(html).not.toMatch(/type="email"/);
  });
  it("progress copy says start, halfway and end", () => {
    const c = course("2026-12-08T06:00:00Z");
    const done = { ...c, scoreDue: null };
    const html = wrap(done, <CourseProgressScreen openScore={noop} />);
    expect(html).toContain("halfway (week 4) and at the end (week 8)");
  });
});

describe("the weekly reading and intro", () => {
  it("Today offers this week's reading (opens its voiced intro, with the text)", () => {
    const html = wrap(course("2026-12-15T06:00:00Z"), <CourseTodayScreen openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />);
    expect(html).toContain("This week&#x27;s reading");
    expect(html).toContain("to hear or read");
  });
  it("an intro's player has no music / voice switch and shows the reading open", () => {
    const html = wrap(course("2026-12-15T06:00:00Z"), <CoursePlayerOverlay trackId="r2" onClose={noop} />);
    expect(html).not.toContain("With music");
    expect(html).toContain("Week 2 reading");
    expect(html).toContain("the nervous system learns the new setting"); // the reading text, shown in full
  });
  it("the session's player links to its intro", () => {
    const html = wrap(course("2026-12-15T06:00:00Z"), <CoursePlayerOverlay trackId="s2" onClose={noop} onOpenTrack={noop} />);
    expect(html).toContain("Play this week&#x27;s intro");
    expect(html).toContain("With music");
  });
});

describe("Sessions", () => {
  it("lists all eight, later ones locked with their opening date", () => {
    const html = wrap(course("2026-12-08T06:00:00Z"), <CourseSessionsScreen openPlayer={noop} />);
    for (const t of CALM_GUT.tracks.filter((x) => x.kind !== "intro")) expect(html).toContain(t.title);
    expect(html).not.toContain("Week 1 intro"); // intros live with their session, not in the list
    expect(html).toContain("Opens Tue 15 Dec");
    expect((html.match(/cg-track locked/g) ?? []).length).toBe(7);
  });
});

describe("the player", () => {
  it("shows the safety text on every track, and session 7's extra line", () => {
    const c = course("2027-01-20T06:00:00Z"); // day 43: s7 open
    const s1 = wrap(c, <CoursePlayerOverlay trackId="s1" onClose={noop} />);
    expect(s1).toContain("not while you&#x27;re the only adult with a child who is awake");
    expect(s1).toContain("With music");
    expect(s1).toContain("Voice only");
    const s7 = wrap(c, <CoursePlayerOverlay trackId="s7" onClose={noop} />);
    expect(s7).toContain("chest pain can be the heart");
    const flare = wrap(c, <CoursePlayerOverlay trackId="flare" onClose={noop} />);
    expect(flare).toContain("severe, new, or different from usual");
  });

  it("a locked session shows when it opens, and no play button", () => {
    const html = wrap(course("2026-12-08T06:00:00Z"), <CoursePlayerOverlay trackId="s4" onClose={noop} />);
    expect(html).toContain("Opens");
    expect(html).not.toContain("cg-play");
  });
});

describe("progress", () => {
  it("averages bloating by course week", () => {
    const w = bloatingWeeks(
      { "2026-12-08": { bloating: 8 }, "2026-12-09": { bloating: 6 }, "2026-12-15": { bloating: 3 }, "2026-11-01": { bloating: 9 } },
      "2026-12-08",
      8,
    );
    expect(w[0]).toEqual({ week: 1, avg: 7, n: 2 });
    expect(w[1]).toEqual({ week: 2, avg: 3, n: 1 });
    expect(w[2].avg).toBeNull();
  });
  it("renders with no data yet", () => {
    const html = wrap(course("2026-12-08T06:00:00Z"), <CourseProgressScreen openScore={noop} />);
    expect(html).toContain("Log bloating for a few days");
  });
});

describe("persona-review fixes (22 Nov)", () => {
  it("Today's order: this week's session, then flare-up, then the daily practice, then the log; check only when due", () => {
    const c = course("2026-12-15T06:00:00Z");
    c.scoreDue = null;
    const html = wrap(c, <CourseTodayScreen openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />);
    const at = (t: string) => html.indexOf(t);
    expect(at("Turning down the volume")).toBeGreaterThan(-1);
    expect(at("Turning down the volume")).toBeLessThan(at("Flare-up, 4 minutes"));
    expect(at("Flare-up, 4 minutes")).toBeLessThan(at("Daily practice"));
    expect(at("Daily practice")).toBeLessThan(at("30-second log"));
    expect(html).not.toContain("Symptom check");
    expect(html).not.toContain("Night practice"); // trimmed from Today; still under Sessions
  });

  it("someone behind sees one thing to catch up on, not two new sessions", () => {
    const c = course("2026-12-23T06:00:00Z"); // week 3, nothing heard
    expect(catchUpSession(c, new Set())?.id).toBe("s1");
    expect(catchUpSession(c, new Set(["s1", "s2"]))).toBeNull();
    const html = wrap(c, <CourseTodayScreen openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />);
    expect(html).toContain("Catch up: Calm belly");
    expect(html).toContain("This week&#x27;s, The river, is there when you&#x27;re ready");
  });

  it("no streak: days listened this week and in total", () => {
    const days = { "2026-12-08": { listened: true }, "2026-12-15": { listened: true }, "2026-12-16": { listened: true }, "2026-12-17": {} };
    expect(listenedCounts(days, "2026-12-08", 2, "2026-12-17")).toEqual({ thisWeek: 2, total: 3 });
    const html = wrap(course("2026-12-15T06:00:00Z"), <CourseTodayScreen openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />);
    expect(html).not.toMatch(/in a row/);
    expect(html).toContain("No listening yet this week");
  });

  it("the bloating chart: less bloating sits lower, and the axis says so in words", () => {
    const c = course("2026-12-22T06:00:00Z");
    c.history.days = { "2026-12-08": { bloating: 8 }, "2026-12-15": { bloating: 2 } };
    const html = wrap(c, <CourseProgressScreen openScore={noop} />);
    const cys = [...html.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(cys).toHaveLength(2);
    expect(cys[1]).toBeGreaterThan(cys[0]); // week 2 (2/10) is drawn lower than week 1 (8/10)
    expect(html).toContain("less bloating ↓");
    expect(html).toContain("more bloating ↑");
  });

  it("the player: Play comes before the safety text; plain labels and hints", () => {
    const html = wrap(course("2026-12-08T06:00:00Z"), <CoursePlayerOverlay trackId="s1" onClose={noop} />);
    expect(html.indexOf('aria-label="Play"')).toBeLessThan(html.indexOf("Before you listen"));
    expect(html).toContain("Back 15 s");
    expect(html).toContain("Forward 15 s");
    expect(html).toContain("Prefer only the voice? Switch to Voice only.");
  });

  it("the 0–10 pickers name both ends", () => {
    const log = wrap(course("2026-12-08T06:00:00Z"), <CourseLogOverlay onClose={noop} />);
    expect(log).toContain("0 none");
    expect(log).toContain("10 worst");
    expect(log).toContain("10 very stressed");
    const check = wrap(course("2026-12-08T06:00:00Z"), <CourseScoreOverlay onClose={noop} />);
    expect(check).toContain("0 not at all");
  });
});

describe("logo, photos and the night player (22 Nov)", () => {
  it("Today shows this week's photo when it exists, and nothing when it doesn't", () => {
    const c = course("2026-12-08T06:00:00Z");
    const plain = wrap(c, <CourseTodayScreen openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />);
    expect(plain).not.toContain("cg-photo");
    c.tracks = c.tracks.map((t) => (t.id === "s1" ? { ...t, image: { wide: "/ochre-app/calm-gut/s1.jpg?v=1", square: "/ochre-app/calm-gut/s1-sq.jpg?v=1" } } : t));
    const withPhoto = wrap(c, <CourseTodayScreen openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />);
    expect(withPhoto).toContain('src="/ochre-app/calm-gut/s1.jpg?v=1"');
  });
  it("the player is the dark night player, with the week photo on top (the intro borrows its session's)", () => {
    const c = course("2026-12-15T06:00:00Z");
    c.tracks = c.tracks.map((t) => (t.id === "s2" ? { ...t, image: { wide: "/w.jpg", square: "/s.jpg" } } : t));
    const s2 = wrap(c, <CoursePlayerOverlay trackId="s2" onClose={noop} />);
    expect(s2).toContain("cg-night");
    expect(s2).toContain('src="/w.jpg"');
    const r2 = wrap(c, <CoursePlayerOverlay trackId="r2" onClose={noop} />);
    expect(r2).toContain('src="/w.jpg"');
  });
  it("Shivani's name appears nowhere on a buyer's screens", () => {
    const c = course("2026-12-15T06:00:00Z", "2026-12-08", "Priya");
    const screens = [
      <CourseTodayScreen key="t" openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />,
      <CourseSessionsScreen key="s" openPlayer={noop} />,
      <CourseProgressScreen key="p" openScore={noop} />,
      <CourseHelpScreen key="h" openRefund={noop} />,
      <CoursePlayerOverlay key="pl" trackId="s1" onClose={noop} />,
      <CourseLogOverlay key="l" onClose={noop} />,
    ];
    for (const sc of screens) expect(wrap(c, sc)).not.toMatch(/Shivani|Recorded by/);
  });
  it("course buyers' header: the tree-ring mark beside the plain name, no italic accent", () => {
    const data = { tier: "guided", account: { photoUrl: null, avatar: "PR" }, course: course("2026-12-08T06:00:00Z") } as unknown as ClientAppData;
    const html = renderToStaticMarkup(
      <OchreContext.Provider value={data}>
        <Header alert={false} onAccount={noop} />
      </OchreContext.Provider>,
    );
    expect(html).toContain("The Ochre Tree");
    expect(html).not.toContain("<em>");
    expect(html).toContain("<svg");
  });
});

describe("refund on the Help screen", () => {
  const withRefund = (refund: AppCourse["refund"]) => ({ ...course("2026-12-08T06:00:00Z"), refund });
  it("a paid buyer in the first 7 days sees a quiet 'Request a refund' link", () => {
    const html = wrap(withRefund({ eligible: true, amountLabel: "₹1,999", until: "2026-12-15T06:00:00Z", pendingSince: null }), <CourseHelpScreen openRefund={noop} />);
    expect(html).toContain("Request a refund");
    expect(html).toContain("For any problem, just reply to your welcome email.");
  });
  it("after 7 days (or for a gift) only the reply-to-your-email line", () => {
    for (const r of [{ eligible: false, amountLabel: "₹1,999", until: "x", pendingSince: null }, null]) {
      const html = wrap(withRefund(r), <CourseHelpScreen openRefund={noop} />);
      expect(html).not.toContain("Request a refund");
      expect(html).toContain("For any problem, just reply to your welcome email.");
    }
  });
  it("a pending request says when it will be done", () => {
    const html = wrap(withRefund({ eligible: true, amountLabel: "₹1,999", until: "x", pendingSince: "2026-12-09T05:00:00Z" }), <CourseHelpScreen openRefund={noop} />);
    expect(html).toContain("within 2 working days");
    expect(html).not.toContain("Request a refund");
  });
  it("the confirmation names the amount and the choice", () => {
    const html = wrap(withRefund({ eligible: true, amountLabel: "₹1,999", until: "x", pendingSince: null }), <CourseRefundOverlay onClose={noop} />);
    expect(html).toContain("Your course will end now, and ₹1,999 will return to your original payment method in 5–7 working days.");
    expect(html).toContain(">Refund<");
    expect(html).toContain("Keep my course");
  });
});

describe("the coach-app look and the speed control", () => {
  it("the player offers 1×, 1.25× and 1.5×, with 1× chosen by default", () => {
    const html = wrap(course("2026-12-08T06:00:00Z"), <CoursePlayerOverlay trackId="s1" onClose={noop} />);
    expect(html).toContain('aria-label="Speed"');
    for (const r of ["1×", "1.25×", "1.5×"]) expect(html).toContain(`>${r}</button>`);
    expect(html).toMatch(/aria-checked="true" class="on">1×</);
  });
  it("none of the old tells: no gradient hero, no all-caps labels, no italic script line, no emoji", () => {
    const html = wrap(course("2026-12-15T06:00:00Z"), <CourseTodayScreen openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />);
    expect(html).not.toMatch(/cg-hero|script|eyebrow|gradient/);
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe("brand: a course buyer sees The Ochre Tree, not Sequoya", () => {
  const base = { tier: "guided", account: { photoUrl: null, avatar: "AR" } } as unknown as ClientAppData;
  it("course-only → Ochre wordmark", () => {
    const data = { ...base, course: course("2026-12-08T06:00:00Z") } as ClientAppData;
    const html = renderToStaticMarkup(
      <OchreContext.Provider value={data}>
        <Header alert={false} onAccount={noop} />
      </OchreContext.Provider>,
    );
    expect(html).toContain("Ochre");
    expect(html).not.toContain("Sequoya");
  });
  it("a guided protocol subscriber keeps Sequoya Lite", () => {
    const html = renderToStaticMarkup(
      <OchreContext.Provider value={base}>
        <Header alert={false} onAccount={noop} />
      </OchreContext.Provider>,
    );
    expect(html).toContain("Sequoya");
  });
  it("the course tab bar is Today · Sessions · Progress · Help", () => {
    const html = renderToStaticMarkup(<BottomNav active="today" onChange={noop} coachAlert={false} course />);
    const labels = [...html.matchAll(/tl-label">([^<]+)</g)].map((m) => m[1]);
    expect(labels).toEqual(["Today", "Sessions", "Progress", "Help"]);
  });
});

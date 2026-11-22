/**
 * Calm Gut screens: what a course buyer must see, drawn from a real payload.
 * Same harness as ochre-screens-render.test.tsx (renderToStaticMarkup, no DOM).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildAppCourse } from "@/lib/fmdb/course-app";
import { CALM_GUT } from "@/lib/fmdb/courses";
import { emptyCourseRecord } from "@/lib/fmdb/course-store";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { OchreContext } from "./ochre-context";
import { Header, BottomNav } from "./ochre-ui";
import {
  CourseProvider,
  CourseTodayScreen,
  CourseSessionsScreen,
  CoursePlayerOverlay,
  CourseProgressScreen,
  bloatingWeeks,
} from "./ochre-course";

const noop = () => {};

function course(todayUtc: string, startYmd = "2026-12-08") {
  const rec = emptyCourseRecord("calm-gut");
  return buildAppCourse(CALM_GUT, startYmd, rec, { tz: "Asia/Kolkata", now: new Date(todayUtc), only: true });
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
    expect(html).toContain("Night practice");
    expect(html).toContain("Week 1 of 8");
    // Week-0 symptom check is offered on day 0 (the welcome email promises it).
    expect(html).toContain("Your 2-minute symptom check");
  });

  it("in week 3 this week's session is session 3", () => {
    const html = wrap(course("2026-12-23T06:00:00Z"), <CourseTodayScreen openPlayer={noop} openLog={noop} openScore={noop} goTab={noop} />);
    expect(html).toContain("The river");
    expect(html).toContain("Week 3 of 8");
  });
});

describe("Sessions", () => {
  it("lists all eight, later ones locked with their opening date", () => {
    const html = wrap(course("2026-12-08T06:00:00Z"), <CourseSessionsScreen openPlayer={noop} />);
    for (const t of CALM_GUT.tracks) expect(html).toContain(t.title.replace(",", ","));
    expect(html).toContain("Opens Tue 15 Dec");
    expect((html.match(/cg-track locked/g) ?? []).length).toBe(7);
  });
});

describe("the player", () => {
  it("shows the safety text on every track, and session 7's extra line", () => {
    const c = course("2027-01-20T06:00:00Z"); // day 43: s7 open
    const s1 = wrap(c, <CoursePlayerOverlay trackId="s1" onClose={noop} />);
    expect(s1).toContain("never while driving, cooking, bathing or caring for a child");
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

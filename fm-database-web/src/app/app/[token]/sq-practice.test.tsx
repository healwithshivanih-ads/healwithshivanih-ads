/**
 * The Practices tab, the player and the goodnight screen, as drawn.
 *
 * Harness: renderToStaticMarkup — markup only. No sound plays in a static
 * render: effects do not run, so the audio engine is never woken.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { SqGoodnight, SqPracticePlayer } from "./sq-practice";
import { DEFAULT_PREFS, practiceList, type PracticePrefs } from "./sq-practice-data";
import { ALL_PRACTICES, eft, eftTheme } from "./sq-practice.fixture";
import { SqPractices, SqScenesSheet } from "./sq-practices";

const noop = () => {};
const DATA = { token: "tok-test-0000000000", ...ALL_PRACTICES } as unknown as ClientAppData;
const LIST = practiceList(ALL_PRACTICES);
const tab = (prefs: PracticePrefs = DEFAULT_PREFS, list = LIST) =>
  renderToStaticMarkup(<SqPractices list={list} prefs={prefs} todayYmd="2026-11-19" onBegin={noop} open={noop} />);
const player = (id: string, o: { prefs?: PracticePrefs; hour?: number; data?: ClientAppData } = {}) =>
  renderToStaticMarkup(
    <SqPracticePlayer
      data={o.data ?? DATA}
      practice={practiceList(o.data ?? DATA).find((p) => p.id === id)!}
      hour={o.hour ?? 13}
      prefs={o.prefs ?? DEFAULT_PREFS}
      setPrefs={noop}
      onFinish={noop}
      onClose={noop}
    />,
  );

describe("the Practices tab", () => {
  it("lists every practice on the plan, the first as a card with Begin", () => {
    const html = tab();
    expect(html).toContain("<h1>Practices</h1>");
    expect(html).toContain("<h3>Sleep wind-down</h3>");
    expect(html).toContain(">Begin<");
    for (const title of ["Slow breathing", "Tapping", "Body reset", "One minute of breathing", "Backgrounds"]) expect(html).toContain(title);
    expect(html).not.toContain("Last used");
  });

  it("puts the one she finished last on top, marked done today or last used", () => {
    const today = tab({ ...DEFAULT_PREFS, last: { id: "tap", ymd: "2026-11-19" } });
    expect(today).toContain("Done today");
    expect(today).toContain("<h3>Tapping</h3>");
    expect(today).toContain(">Again<");
    const earlier = tab({ ...DEFAULT_PREFS, last: { id: "tap", ymd: "2026-11-12" } });
    expect(earlier).toContain("Last used");
    expect(earlier).toContain(">Begin<");
  });

  it("shows a practice she left part-way as paused, ready to carry on", () => {
    const html = tab({ ...DEFAULT_PREFS, resume: { sleep: 4 } });
    expect(html).toContain("Paused part-way · tap to carry on");
    expect(html).toContain(">Carry on<");
  });

  it("says when the next practice is being held back, as today's app does", () => {
    const html = renderToStaticMarkup(
      <SqPractices list={LIST} prefs={DEFAULT_PREFS} todayYmd="2026-11-19" next={{ nextUp: "sleep wind-down", priorLabel: "tapping", doneCount: 1, needed: 2 }} onBegin={noop} open={noop} />,
    );
    expect(html).toContain("One more day opens your next practice.");
    expect(html).toContain("Keep up tapping. Sleep wind-down opens as it becomes a habit.");
    expect(tab()).not.toContain("opens as it becomes a habit");
  });

  it("a plan with no practices says so, and offers no backgrounds", () => {
    const html = tab(DEFAULT_PREFS, []);
    expect(html).toContain("There are no practices on your plan yet.");
    expect(html).not.toContain("Backgrounds");
  });

  it("uses only its own classes", () => {
    const classes = [...tab().matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    expect(classes.filter((c) => !c.startsWith("sq-"))).toEqual([]);
  });
});

describe("the practice player", () => {
  it("the wind-down opens on step one, dimmed, with only Dim, Close, the step controls and Settings", () => {
    const html = player("sleep");
    expect(html).toContain('class="sq-sheet sq-scene sq-dim"');
    expect(html).toContain("1 of 10 · Settle in");
    for (const label of ["Previous", "Pause", "Next", "Dim", "Settings"]) expect(html).toContain(`>${label}<`);
    expect(html).toContain('aria-label="Close"');
    // Voice, Music, Volume, Pace and Scene are behind Settings, not on screen.
    for (const hidden of ["Voice:", "Music:", "Pace 1", "Volume", "sq-swatches"]) expect(html).not.toContain(hidden);
  });

  it("is light in the day and dim from 8 pm, wind-down apart", () => {
    expect(player("tap", { hour: 13 })).toContain('class="sq-sheet sq-scene"');
    expect(player("tap", { hour: 21 })).toContain('class="sq-sheet sq-scene sq-dim"');
  });

  it("shows the scene's still first and loads its loop muted", () => {
    const html = player("sleep");
    expect(html).toContain('src="/app-scenes/rain.mp4"');
    expect(html).toContain('poster="/app-scenes/rain.jpg"');
    expect(html).toMatch(/<video[^>]*muted/);
    // A scene she chose wins over the practice's own.
    expect(player("sleep", { prefs: { ...DEFAULT_PREFS, scene: "shore" } })).toContain('src="/app-scenes/shore.mp4"');
  });

  it("a half-finished practice reopens paused, with Resume and Start again", () => {
    const html = player("sleep", { prefs: { ...DEFAULT_PREFS, resume: { sleep: 4 } } });
    expect(html).toContain("5 of 10 · Your back");
    expect(html).toContain(">Resume<");
    expect(html).toContain("Picked up where you left off.");
    expect(html).toContain(">Start again<");
    expect(html).not.toContain("sq-run"); // nothing is moving
  });

  it("tapping with one theme asks how strong it is, then starts; with several it asks which", () => {
    const one = player("tap");
    expect(one).toContain("How strong is it right now?");
    expect(one.match(/class="sq-rate-b"/g)).toHaveLength(11);
    expect(one).toContain(">Skip<");
    const many = { ...DATA, eft: eft([eftTheme("stress", "Stress reset"), eftTheme("sleep", "Winding down for sleep")]) } as ClientAppData;
    const pick = player("tap", { data: many });
    expect(pick).toContain("What would you like to tap on?");
    expect(pick).toContain("Stress reset");
    expect(pick).toContain("Winding down for sleep");
  });

  it("breathing shows the breath, the time left, Pause and I'm done", () => {
    const html = player("breath");
    expect(html).toContain("Breathe in");
    expect(html).toContain("5:00 left");
    expect(html).toContain(">Pause<");
    expect(html).toContain("I&#x27;m done");
    expect(player("one")).toContain("1:00 left");
  });

  it("a body reset walks its steps", () => {
    const html = player("reset:body-reset");
    expect(html).toContain("1 of 2 · Shoulders");
    expect(html).toContain("Drop your shoulders and unclench your jaw.");
  });

  it("uses only its own classes", () => {
    for (const id of ["sleep", "tap", "breath", "reset:body-reset"]) {
      const classes = [...player(id).matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
      expect(classes.filter((c) => !c.startsWith("sq-")), id).toEqual([]);
    }
  });
});

describe("the goodnight screen", () => {
  it("is two lines and a Close, with one tick for a bedtime supplement still open", () => {
    const html = renderToStaticMarkup(<SqGoodnight pending={[{ id: "s-mg", name: "Magnesium glycinate" }]} onTick={noop} onClose={noop} />);
    expect(html).toContain("Goodnight.");
    expect(html).toContain("Put the phone down now. It is quiet from here.");
    expect(html).toContain("Taken your magnesium glycinate? Tick it here");
    expect(html).toContain(">Close<");
  });
  it("asks nothing when nothing is open", () => {
    const html = renderToStaticMarkup(<SqGoodnight pending={[]} onTick={noop} onClose={noop} />);
    expect(html).not.toContain("Tick it here");
  });
});

describe("the backgrounds screen", () => {
  it("shows the four scenes and marks the chosen one", () => {
    const html = renderToStaticMarkup(<SqScenesSheet prefs={{ ...DEFAULT_PREFS, scene: "grove" }} setPrefs={noop} />);
    for (const name of ["Slow waves", "Rain on leaves", "Forest path", "Grasses in the breeze"]) expect(html).toContain(name);
    expect(html.match(/>Chosen</g)).toHaveLength(1);
    expect(html).toContain("Let each practice choose");
  });
});

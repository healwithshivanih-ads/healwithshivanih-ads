/**
 * The ask box and the Coach tab as drawn.
 *
 * Harness: renderToStaticMarkup, as in sq-app.test.tsx — markup only, no DOM,
 * no network. Synthetic payload; no client data.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { coachCard, handoffCard, urgentCard, type AskCard } from "@/lib/fmdb/ask-card";
import { handoffText, SqAskBox, SqAskView, type AskTurn } from "./sq-ask-ui";
import { SqCoach, type CoachThread } from "./sq-coach";

const noop = () => {};
const turn = (card: AskCard | null, over: Partial<AskTurn> = {}): AskTurn => ({ id: 1, q: "a question", card, send: "idle", ...over });
const view = (turns: AskTurn[]) =>
  renderToStaticMarkup(<SqAskView turns={turns} onBack={noop} onButton={noop} onSend={noop} onAsk={noop} />);

describe("the ask box on Home", () => {
  it("draws each tappable question as a button", () => {
    const html = renderToStaticMarkup(<SqAskBox chips={["What's for lunch?", "What is left today?"]} onAsk={noop} />);
    expect(html).toContain("Ask anything about your plan");
    expect(html.match(/class="sq-chip"/g)).toHaveLength(2);
    expect(html).toContain("What&#x27;s for lunch?");
  });
});

describe("answer cards", () => {
  it("shows her question, then the answer with its source, heading, lines and buttons", () => {
    const html = view([
      turn({
        src: "From your plan",
        heading: "Dinner: Moong khichdi",
        lines: ["Moong dal, rice"],
        list: [{ mark: "yes", text: "On Tuesday" }, { mark: "dot", text: "Plain" }],
        note: "Check with your coach before changing it.",
        buttons: [{ to: "recipe", label: "See recipe", ref: "Dinner", solid: true }],
      }),
    ]);
    expect(html).toContain('<div class="sq-me">a question</div>');
    expect(html).toContain('<div class="sq-src">From your plan</div>');
    expect(html).toContain("<h3>Dinner: Moong khichdi</h3>");
    expect(html).toContain("See recipe");
    expect(html).toContain("Check with your coach before changing it.");
    expect(html).not.toContain("Send to coach");
  });

  it("an urgent card is announced, and the emergency card has no button at all", () => {
    const html = view([turn(urgentCard("emergency"))]);
    expect(html).toContain('class="sq-card sq-ans sq-urgent" role="alert"');
    expect(html).toContain("Call 112 or go to your nearest hospital now.");
    expect(html).not.toContain("sq-row-btns");
  });

  it("a hand-off offers Send to coach and Not now, and says nothing is sent yet", () => {
    const html = view([turn(handoffCard("symptom"))]);
    expect(html).toContain("Send to coach");
    expect(html).toContain("Not now");
    expect(html).toContain("If it feels severe or sudden, see a doctor today.");
    expect(html).not.toContain("Sent to your coach");
  });

  it("once sent, says so with the 24-hour line and where the reply will be", () => {
    const html = view([turn(handoffCard("dose"), { send: "sent" })]);
    expect(html).toContain("Sent to your coach");
    expect(html).toContain("Your coach replies within 24 hours.");
    expect(html).toContain("Coach tab");
    expect(html).not.toContain("Send to coach");
  });

  it("a send that failed says Not sent yet and offers to try again", () => {
    const html = view([turn(handoffCard("dose"), { send: "failed" })]);
    expect(html).toContain("Not sent yet");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Sent to your coach");
  });

  it("while the model is asked, shows that and no card", () => {
    const html = view([turn(null)]);
    expect(html).toContain("Looking at your plan…");
    expect(html).not.toContain("sq-ans");
  });

  it("only the newest answer can still be sent; an earlier hand-off is history", () => {
    const html = view([turn(coachCard("first"), { id: 1 }), turn(coachCard("second"), { id: 2 })]);
    // Earlier questions are folded away until asked for.
    expect(html).toContain("Earlier questions");
    expect(html).not.toContain("first");
    expect(html.match(/Send to coach/g)).toHaveLength(1);
  });
});

describe("handoffText — what the coach receives", () => {
  it("is her own words, then where and when it was asked", () => {
    expect(handoffText("  can I skip the b-complex today  ", 4, 12)).toBe("can I skip the b-complex today\n\n(Asked in the app · week 4 of 12)");
  });
});

// ── the Coach tab ──────────────────────────────────────────────────────────

const DATA = { coach: { name: "Zzyzx Qwerty", nextSession: "Sat, 5 Dec" } } as unknown as ClientAppData;
const thread = (over: Partial<CoachThread> = {}): CoachThread => ({
  msgs: [],
  local: [],
  loaded: true,
  unread: false,
  note: null,
  send: async () => true,
  retry: noop,
  ...over,
});
const coach = (t: CoachThread) => renderToStaticMarkup(<SqCoach data={DATA} thread={t} />);

describe("the Coach tab", () => {
  it("says the coach replies within 24 hours and never prints the coach's name", () => {
    const html = coach(thread());
    expect(html).toContain("replies within 24 hours");
    expect(html).toContain("If something feels urgent, see a doctor.");
    expect(html).toContain("Next session · Sat, 5 Dec");
    expect(html).not.toMatch(/zzyzx|qwerty/i);
    expect(html).toContain("No messages yet.");
  });

  it("draws both sides of the thread, and the reply line on her latest message only", () => {
    const html = coach(
      thread({
        msgs: [
          { id: "a", at: "2026-11-17T04:00:00Z", from: "me", text: "First" },
          { id: "b", at: "2026-11-17T05:00:00Z", from: "coach", text: "Hello back" },
          { id: "c", at: "2026-11-18T04:00:00Z", from: "me", text: "Second" },
        ],
      }),
    );
    expect(html.match(/class="sq-me"/g)).toHaveLength(2);
    expect(html.match(/class="sq-them"/g)).toHaveLength(1);
    expect(html.match(/reply within 24 hours/g)).toHaveLength(1);
    expect(html.indexOf("Second")).toBeLessThan(html.indexOf("reply within 24 hours"));
  });

  it("a message that did not go stays on screen as Not sent yet, with a way to retry", () => {
    const html = coach(thread({ local: [{ id: "l1", at: "2026-11-18T04:00:00Z", from: "me", text: "Kept words", state: "failed" }] }));
    expect(html).toContain("Kept words");
    expect(html).toContain("Not sent yet");
    expect(html).toContain("Try again");
  });

  it("shows the emergency card beside an emergency message, which is still in the thread", () => {
    const html = coach(
      thread({
        msgs: [{ id: "a", at: "2026-11-18T04:00:00Z", from: "me", text: "chest pain since an hour" }],
        note: { urgent: "emergency" },
      }),
    );
    expect(html).toContain("chest pain since an hour");
    expect(html).toContain("This may be an emergency");
    expect(html).toContain('role="alert"');
  });

  it("shows the see-a-doctor line beside a symptom", () => {
    const html = coach(thread({ note: { doctor: "If it feels severe or sudden, see a doctor today." } }));
    expect(html).toContain("If it feels severe or sudden, see a doctor today.");
    expect(html).not.toContain('role="alert"');
  });
});

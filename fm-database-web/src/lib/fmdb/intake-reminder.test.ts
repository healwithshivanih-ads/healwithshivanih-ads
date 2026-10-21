/**
 * The intake-reminder cron must never tell a client who has SUBMITTED that
 * their form "is still waiting". Real case: cl-906 submitted 2026-09-21, the
 * coach had not pressed Finalise, and fm_intake_reminder went out on
 * 2026-10-03 and 2026-10-08.
 */
import { describe, it, expect } from "vitest";
import {
  intakeReminderDecision,
  hasSubmittedIntake,
  MAX_REMINDERS_PER_TOKEN,
} from "./intake-reminder";

const TODAY = new Date("2026-10-03T03:00:00Z");

/** An open, opted-in, never-nudged link issued 7 days ago (expires in 7). */
function openLink(extra: Record<string, unknown> = {}) {
  return {
    client_id: "cl-x",
    intake_token: "tok",
    intake_reminder_enabled: true,
    intake_token_expires_at: "2026-10-10T03:00:00Z",
    intake_finalised_at: null,
    ...extra,
  };
}

describe("intakeReminderDecision", () => {
  it("nudges an open, unsubmitted link past the spacing window", () => {
    expect(intakeReminderDecision(openLink(), TODAY).send).toBe(true);
  });

  it("does NOT nudge a submitted-but-not-finalised client (the cl-906 shape)", () => {
    const cl906 = openLink({
      intake_submitted_at: "2026-09-21T07:35:04.270299+00:00",
      intake_last_submitted_at: "2026-09-21T07:35:04.270299+00:00",
      intake_finalised_at: null,
      intake_reminders_sent_at: [],
    });
    expect(intakeReminderDecision(cl906, TODAY)).toEqual({ send: false, reason: "submitted" });
    // ...and not later either: Oct 8 was the second wrong send.
    expect(intakeReminderDecision(cl906, new Date("2026-10-08T03:00:00Z")).send).toBe(false);
  });

  it("treats either submit stamp as submitted", () => {
    expect(
      intakeReminderDecision(openLink({ intake_last_submitted_at: "2026-09-30T00:00:00Z" }), TODAY),
    ).toEqual({ send: false, reason: "submitted" });
    expect(
      intakeReminderDecision(openLink({ intake_submitted_at: "2026-09-30T00:00:00Z" }), TODAY),
    ).toEqual({ send: false, reason: "submitted" });
    expect(hasSubmittedIntake({ intake_submitted_at: "", intake_last_submitted_at: null })).toBe(false);
  });

  it("keeps the existing gates", () => {
    expect(intakeReminderDecision(openLink({ intake_token: undefined }), TODAY).send).toBe(false);
    expect(
      intakeReminderDecision(openLink({ intake_finalised_at: "2026-09-30T00:00:00Z" }), TODAY).send,
    ).toBe(false);
    expect(intakeReminderDecision(openLink({ intake_reminder_enabled: false }), TODAY).send).toBe(false);
    expect(
      intakeReminderDecision(openLink({ intake_token_expires_at: "2026-10-01T00:00:00Z" }), TODAY).send,
    ).toBe(false);
    expect(
      intakeReminderDecision(
        openLink({ intake_reminders_sent_at: Array(MAX_REMINDERS_PER_TOKEN).fill("2026-09-01T00:00:00Z") }),
        TODAY,
      ).send,
    ).toBe(false);
    // Reminder sent 2 days ago → too soon.
    expect(
      intakeReminderDecision(openLink({ intake_reminders_sent_at: ["2026-10-01T03:00:00Z"] }), TODAY),
    ).toEqual({ send: false, reason: "too_soon" });
  });
});

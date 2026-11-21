import { describe, expect, it } from "vitest";
import { decideSend, EMBARGO_UNTIL_MS, lastSend, TEST_PROFILE, type BodyAgeSummary } from "../body-age-send";
import { summaryToView } from "../body-age-report-view";

const READY: BodyAgeSummary = {
  report_no: "BA-S-900-260704",
  kind: "standard",
  outcome: "foundation",
  subject: "Your body age report is ready",
  attachment: "Body age report, Ochre, 4 July 2026.pdf",
  ready: true,
  blockers: [],
};
const BEFORE = EMBARGO_UNTIL_MS - 1;
const AFTER = EMBARGO_UNTIL_MS;
const base = { summary: READY, recordedReportNos: [] as string[], recordEmail: "buyer@example.com", coachEmail: "coach@example.com" };

describe("body age report: who a report may be emailed to", () => {
  it("the launch moment is Sat 2 Jan 2027, 20:00 in India", () => {
    expect(new Date(EMBARGO_UNTIL_MS).toISOString()).toBe("2027-01-02T14:30:00.000Z");
  });

  it("before the launch a real buyer's report is refused, even when ready and saved", () => {
    const v = decideSend({ ...base, clientId: "cl-123", nowMs: BEFORE, recordedReportNos: [READY.report_no!] });
    expect(v.ok).toBe(false);
  });

  it("the test profile's report goes to the coach's own mailbox, never the address on the record", () => {
    for (const nowMs of [BEFORE, AFTER]) {
      const v = decideSend({ ...base, clientId: TEST_PROFILE, nowMs });
      expect(v).toEqual({ ok: true, to: "coach@example.com", test: true });
    }
    expect(decideSend({ ...base, clientId: TEST_PROFILE, nowMs: BEFORE, coachEmail: null }).ok).toBe(false);
  });

  it("a report that is not ready, or was never built, is never sent", () => {
    for (const summary of [null, { ...READY, ready: false }, { ...READY, ready: undefined }, { ...READY, attachment: "" }]) {
      expect(decideSend({ ...base, clientId: TEST_PROFILE, nowMs: AFTER, summary }).ok).toBe(false);
      expect(decideSend({ ...base, clientId: "cl-123", nowMs: AFTER, summary, recordedReportNos: [READY.report_no!] }).ok).toBe(false);
    }
  });

  it("after the launch a buyer's report goes to their own email, once it is saved to their record", () => {
    const unsaved = decideSend({ ...base, clientId: "cl-123", nowMs: AFTER });
    expect(unsaved.ok).toBe(false);
    const saved = decideSend({ ...base, clientId: "cl-123", nowMs: AFTER, recordedReportNos: [READY.report_no!] });
    expect(saved).toEqual({ ok: true, to: "buyer@example.com", test: false });
    for (const recordEmail of [null, "", "not an email", "a@b", "two@x.com, three@y.com"]) {
      expect(decideSend({ ...base, clientId: "cl-123", nowMs: AFTER, recordedReportNos: [READY.report_no!], recordEmail }).ok).toBe(false);
    }
  });

  it("no refusal uses the word urgent or the internal product name", () => {
    const msgs = [
      decideSend({ ...base, clientId: "cl-123", nowMs: BEFORE }),
      decideSend({ ...base, clientId: "cl-123", nowMs: AFTER }),
      decideSend({ ...base, clientId: "cl-123", nowMs: AFTER, summary: null }),
    ].map((v) => (v.ok ? "" : v.error));
    for (const m of msgs) expect(m).not.toMatch(/urgent|rings|sequoya/i);
  });
});

describe("body age report: the card after a reload", () => {
  it("reads the newest send back from the log, and nothing from a damaged one", () => {
    expect(lastSend(null)).toBeNull();
    expect(lastSend({})).toBeNull();
    expect(lastSend([{ sent_at: 5 }, "x"])).toBeNull();
    const log = [
      { sent_at: "2027-01-03T04:00:00.000Z", to: "a@x.com", test: false },
      { sent_at: "2027-01-04T04:00:00.000Z", to: "a@x.com", test: false },
    ];
    expect(lastSend(log)?.sent_at).toBe("2027-01-04T04:00:00.000Z");
  });

  it("rebuilds the card from a past build's summary, with its send state", () => {
    const v = summaryToView("cl-900", { ...READY, pages: 18 }, true, { sent_at: "2026-11-21T06:00:00.000Z", to: "coach@example.com", test: true });
    expect(v?.ready).toBe(true);
    expect(v?.recorded).toBe(true);
    expect(v?.pdfUrl).toBe("/api/body-age-file/cl-900/BA-S-900-260704/Body%20age%20report%2C%20Ochre%2C%204%20July%202026.pdf");
    expect(v?.emailUrl).toBe("/api/body-age-file/cl-900/BA-S-900-260704/email-preview.html");
    expect(v?.sentTo).toBe("coach@example.com");
    expect(v?.sentTest).toBe(true);
    expect(summaryToView("cl-900", { ...READY, ready: undefined }, false, null)?.ready).toBe(false); // an older build: not sendable
    expect(summaryToView("cl-900", { ...READY, report_no: "../x" }, false, null)).toBeNull();
    expect(summaryToView("cl-900", null, false, null)).toBeNull();
  });
});

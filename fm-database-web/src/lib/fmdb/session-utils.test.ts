/**
 * Tests for parseSessionType — the one reader every "is this a check-in /
 * discovery / intake?" decision must go through.
 *
 * The session type lives as a `[session_type: X]` tag at the head of
 * presenting_complaints (the Session model has no session_type field).
 * save-session.py owns that tag and, since 2026-08-22, keeps a caller-supplied
 * one instead of prepending a second. That means a form's more specific
 * sub-type (`protocol_checkin`) is now the ONLY tag on disk for that session —
 * the alias table here is what keeps it reading as a check-in.
 */
import { describe, it, expect } from "vitest";
import { parseSessionType } from "./session-utils";

describe("parseSessionType", () => {
  it("reads the four canonical types", () => {
    expect(parseSessionType("[session_type: discovery] chief concern")).toBe("discovery");
    expect(parseSessionType("[session_type: intake] chief complaint")).toBe("intake");
    expect(parseSessionType("[session_type: check_in] adherence 4/5")).toBe("check_in");
    expect(parseSessionType("[session_type: quick_note] [source: coach] 🧠 Coach observation")).toBe("quick_note");
  });

  it("aliases the pre-v0.63 names", () => {
    expect(parseSessionType("[session_type: pre_intake] x")).toBe("discovery");
    expect(parseSessionType("[session_type: discovery_consultation] x")).toBe("discovery");
    expect(parseSessionType("[session_type: full_assessment] x")).toBe("intake");
  });

  it("maps the protocol-checkin panel's sub-type to check_in", () => {
    // Before the shim became idempotent it wrote `[session_type: check_in]`
    // in front of this tag, which is the only reason it ever parsed right.
    expect(parseSessionType("[session_type: protocol_checkin]\n\n💊 Supplements\n✅ magnesium")).toBe("check_in");
  });

  it("reads the FIRST tag on a legacy double-tagged session", () => {
    // 46 sessions on disk carry two tags from the pre-fix shim.
    expect(parseSessionType("[session_type: quick_note] [session_type: quick_note] [source: coach] x")).toBe("quick_note");
    expect(parseSessionType("[session_type: discovery] [session_type: discovery_consultation] x")).toBe("discovery");
    expect(parseSessionType("[session_type: check_in] [session_type: protocol_checkin]\n\nx")).toBe("check_in");
  });

  it("finds the tag anywhere — WhatsApp threads lead with [plan:] [window:]", () => {
    expect(
      parseSessionType("[plan: nidhi-plan-1] [window: 2026-08-01] [session_type: quick_note] [source: whatsapp_webhook]\n\nhi"),
    ).toBe("quick_note");
  });

  it("defaults to intake when there is no tag or an unknown one", () => {
    expect(parseSessionType(undefined)).toBe("intake");
    expect(parseSessionType("")).toBe("intake");
    expect(parseSessionType("[source: client_intake_form] I feel tired all the time")).toBe("intake");
    expect(parseSessionType("[session_type: something_new] x")).toBe("intake");
  });
});

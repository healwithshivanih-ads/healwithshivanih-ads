/**
 * Tests for the outbound-channel tag helpers.
 *
 * Client notifications moved from WhatsApp-only to email-by-default on
 * 2026-08-09. Both channels write the same rolling thread segment, so every
 * reader that used to test for `[source: whatsapp_outbound]` literally now goes
 * through isOutboundSegment. Miss one and an emailed notification is invisible:
 * the chat thread drops it, and "✓ Sent · Resend" reads as never-sent forever.
 */
import { describe, it, expect } from "vitest";
import {
  isOutboundSegment,
  outboundSourceTag,
  outboundChannelOf,
  indexOfOutboundTag,
} from "./session-utils";

const WA = "[source: whatsapp_outbound] [template: fm_supplement_activate_v1] [sent_at: 2026-08-09T10:00:00Z]";
const EM = "[source: email_outbound] [template: email_supplement_activate] [sent_at: 2026-08-09T10:00:00Z]";
const IN = "[source: whatsapp_webhook] [sent_at: 2026-08-09T09:00:00Z]";

describe("outboundSourceTag", () => {
  it("writes the tag each channel is read back by", () => {
    expect(outboundSourceTag("email")).toBe("[source: email_outbound]");
    expect(outboundSourceTag("whatsapp")).toBe("[source: whatsapp_outbound]");
  });
});

describe("isOutboundSegment", () => {
  it("recognises BOTH channels — the whole point of the switch", () => {
    expect(isOutboundSegment(WA)).toBe(true);
    expect(isOutboundSegment(EM)).toBe(true);
  });

  it("does not mistake an inbound message for a send", () => {
    expect(isOutboundSegment(IN)).toBe(false);
    expect(isOutboundSegment("just some prose")).toBe(false);
  });
});

describe("outboundChannelOf", () => {
  it("reads the channel back off a segment", () => {
    expect(outboundChannelOf(EM)).toBe("email");
    expect(outboundChannelOf(WA)).toBe("whatsapp");
  });

  it("defaults to whatsapp for the years of history written before email", () => {
    expect(outboundChannelOf("[source: whatsapp_outbound]")).toBe("whatsapp");
    expect(outboundChannelOf("no tag at all")).toBe("whatsapp");
  });
});

describe("indexOfOutboundTag", () => {
  it("finds whichever tag comes first, for the old direction fallback", () => {
    const both = `${EM}\n---\n${WA}`;
    expect(indexOfOutboundTag(both)).toBe(both.indexOf("[source: email_outbound]"));
    const waFirst = `${WA}\n---\n${EM}`;
    expect(indexOfOutboundTag(waFirst)).toBe(0);
  });

  it("returns -1 when there is no outbound tag", () => {
    expect(indexOfOutboundTag(IN)).toBe(-1);
  });
});

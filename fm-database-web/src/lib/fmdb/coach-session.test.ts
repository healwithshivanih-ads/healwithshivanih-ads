/**
 * Tests for the /m session token (coach-session.ts).
 *
 * This token is the ONLY thing standing between the public internet and every
 * client record once /m is enabled on Fly. Each test here is a way the gate
 * could be defeated.
 */
import { describe, it, expect } from "vitest";
import {
  COACH_MOBILE_TTL_MS,
  createSessionToken,
  verifySessionToken,
} from "./coach-session";

const PW = "correct-horse-battery-staple";
const T0 = 1_700_000_000_000; // fixed clock

describe("createSessionToken", () => {
  it("mints a token that verifies immediately", () => {
    const token = createSessionToken(PW, T0);
    expect(verifySessionToken(token, PW, T0)).toBe(true);
  });

  it("never embeds the password", () => {
    expect(createSessionToken(PW, T0)).not.toContain(PW);
  });

  it("encodes the expiry as <expiry>.<hex sig>", () => {
    const token = createSessionToken(PW, T0);
    const [expiry, sig] = token.split(".");
    expect(Number(expiry)).toBe(T0 + COACH_MOBILE_TTL_MS);
    expect(sig).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
});

describe("verifySessionToken — rejection paths", () => {
  it("rejects an expired token", () => {
    const token = createSessionToken(PW, T0, 1000);
    expect(verifySessionToken(token, PW, T0 + 999)).toBe(true);
    expect(verifySessionToken(token, PW, T0 + 1001)).toBe(false);
  });

  it("rejects a token signed with a different password", () => {
    const token = createSessionToken("old-password", T0);
    expect(verifySessionToken(token, PW, T0)).toBe(false);
  });

  it("rotating the password invalidates every live session", () => {
    const token = createSessionToken(PW, T0);
    expect(verifySessionToken(token, PW, T0)).toBe(true);
    expect(verifySessionToken(token, PW + "!", T0)).toBe(false);
  });

  it("rejects a client-extended expiry (expiry is inside the signature)", () => {
    // The attack this defends: edit the cookie to push the expiry out.
    const token = createSessionToken(PW, T0, 1000);
    const sig = token.split(".")[1];
    const forged = `${T0 + 999_999_999}.${sig}`;
    expect(verifySessionToken(forged, PW, T0)).toBe(false);
  });

  it("rejects empty / missing / malformed input", () => {
    for (const bad of [null, undefined, "", "no-dot", ".", ".abc", "abc."]) {
      expect(verifySessionToken(bad, PW, T0)).toBe(false);
    }
  });

  it("rejects a missing password (unset env must never authorise)", () => {
    const token = createSessionToken(PW, T0);
    expect(verifySessionToken(token, "", T0)).toBe(false);
    expect(verifySessionToken(token, null, T0)).toBe(false);
    expect(verifySessionToken(token, undefined, T0)).toBe(false);
  });

  it("rejects non-integer expiries that Number() would otherwise accept", () => {
    const sig = createSessionToken(PW, T0).split(".")[1];
    for (const expiry of ["1e99", " 1700000000000", "+1700000000000", "0x10", "NaN"]) {
      expect(verifySessionToken(`${expiry}.${sig}`, PW, T0)).toBe(false);
    }
  });

  it("rejects a right-length non-hex signature without throwing", () => {
    const expiry = String(T0 + COACH_MOBILE_TTL_MS);
    expect(verifySessionToken(`${expiry}.${"z".repeat(64)}`, PW, T0)).toBe(false);
  });

  it("rejects a truncated signature", () => {
    const token = createSessionToken(PW, T0);
    const [expiry, sig] = token.split(".");
    expect(verifySessionToken(`${expiry}.${sig.slice(0, -2)}`, PW, T0)).toBe(false);
  });
});

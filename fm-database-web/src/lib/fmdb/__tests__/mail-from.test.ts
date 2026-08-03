/**
 * A client should never receive a note about their programme from an address
 * they have never seen. Gmail authenticates as one mailbox and can send as a
 * verified alias, so the address on the envelope is a separate decision from
 * the one we log in with — and the fallback has to be safe, because an empty
 * env var must not produce a From header of "Shivani Hari <>".
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { clientFrom } from "../mail-from";

afterEach(() => vi.unstubAllEnvs());

describe("client-facing From address", () => {
  it("uses the practice address when one is configured", () => {
    vi.stubEnv("GMAIL_FROM", "shivani@theochretree.com");
    expect(clientFrom("reachochretree@gmail.com")).toContain("<shivani@theochretree.com>");
  });

  it("falls back to the authenticating mailbox when unset", () => {
    vi.stubEnv("GMAIL_FROM", "");
    expect(clientFrom("reachochretree@gmail.com")).toContain("<reachochretree@gmail.com>");
  });

  it("treats a whitespace-only value as unset, not as an empty address", () => {
    vi.stubEnv("GMAIL_FROM", "   ");
    expect(clientFrom("reachochretree@gmail.com")).toBe(
      "Shivani Hari <reachochretree@gmail.com>",
    );
  });

  it("carries the coach's display name", () => {
    vi.stubEnv("GMAIL_FROM", "shivani@theochretree.com");
    vi.stubEnv("COACH_NAME", "Shivani Hari");
    expect(clientFrom("x@y.com")).toBe("Shivani Hari <shivani@theochretree.com>");
  });
});

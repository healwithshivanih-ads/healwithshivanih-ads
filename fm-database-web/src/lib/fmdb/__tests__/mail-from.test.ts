/**
 * Client email should come from the coach, automated mail from the ops
 * mailbox.
 *
 * They are separate Google Workspace accounts with separate credentials, not
 * aliases, so this is a choice of SMTP session — not a From header. The
 * fallback matters most: a half-finished setup has to degrade to the old
 * behaviour, because "no email at all" is a worse outcome than "email from
 * the address we used last week".
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { clientFrom, clientMailer } from "../mail-from";

afterEach(() => vi.unstubAllEnvs());

function ops() {
  vi.stubEnv("GMAIL_USER", "reachochretree@gmail.com");
  vi.stubEnv("GMAIL_APP_PASSWORD", "ops-secret");
}

describe("choosing the sending account", () => {
  it("sends from the coach's own account when it is configured", () => {
    ops();
    vi.stubEnv("COACH_GMAIL_USER", "shivani@theochretree.com");
    vi.stubEnv("COACH_GMAIL_APP_PASSWORD", "coach-secret");
    const m = clientMailer()!;
    expect(m.user).toBe("shivani@theochretree.com");
    expect(m.pass).toBe("coach-secret");
    expect(m.from).toContain("<shivani@theochretree.com>");
    expect(m.personal).toBe(true);
  });

  it("falls back to the ops mailbox when the coach account is absent", () => {
    ops();
    vi.stubEnv("COACH_GMAIL_USER", "");
    vi.stubEnv("COACH_GMAIL_APP_PASSWORD", "");
    const m = clientMailer()!;
    expect(m.user).toBe("reachochretree@gmail.com");
    expect(m.personal).toBe(false);
  });

  it("falls back when the address is set but the password is not", () => {
    // The dangerous half-configured case: an address with no credentials
    // would authenticate as nobody and fail every send.
    ops();
    vi.stubEnv("COACH_GMAIL_USER", "shivani@theochretree.com");
    vi.stubEnv("COACH_GMAIL_APP_PASSWORD", "");
    expect(clientMailer()!.user).toBe("reachochretree@gmail.com");
  });

  it("treats whitespace-only settings as unset", () => {
    ops();
    vi.stubEnv("COACH_GMAIL_USER", "   ");
    vi.stubEnv("COACH_GMAIL_APP_PASSWORD", "   ");
    expect(clientMailer()!.personal).toBe(false);
  });

  it("returns null only when nothing at all is configured", () => {
    vi.stubEnv("GMAIL_USER", "");
    vi.stubEnv("GMAIL_APP_PASSWORD", "");
    vi.stubEnv("COACH_GMAIL_USER", "");
    vi.stubEnv("COACH_GMAIL_APP_PASSWORD", "");
    expect(clientMailer()).toBeNull();
  });

  it("never builds an empty From header", () => {
    vi.stubEnv("GMAIL_FROM", "   ");
    expect(clientFrom("x@y.com")).toBe("Shivani Hari <x@y.com>");
  });
});

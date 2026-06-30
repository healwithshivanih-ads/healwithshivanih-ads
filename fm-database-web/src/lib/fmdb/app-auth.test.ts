/**
 * Tests for verifyAppClient — the authorization gate on public client-app
 * write routes (payments, lab bookings). Mocks resolveAppToken so we exercise
 * the gate logic without touching the filesystem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveAppToken = vi.fn();
vi.mock("@/lib/server-actions/letter-token", () => ({
  resolveAppToken: (t: string) => resolveAppToken(t),
}));

import { verifyAppClient } from "./app-auth";

const GOOD_TOKEN = "a".repeat(24); // >= 16 chars

beforeEach(() => resolveAppToken.mockReset());

describe("verifyAppClient", () => {
  it("rejects a missing token with 401 (no resolve attempted)", async () => {
    const r = await verifyAppClient(undefined, "cl-005");
    expect(r).toEqual({ ok: false, status: 401, error: "unauthorized" });
    expect(resolveAppToken).not.toHaveBeenCalled();
  });

  it("rejects a too-short token with 401 (no resolve attempted)", async () => {
    const r = await verifyAppClient("short", "cl-005");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
    expect(resolveAppToken).not.toHaveBeenCalled();
  });

  it("rejects a non-string token with 401", async () => {
    const r = await verifyAppClient(12345, "cl-005");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("rejects an unresolvable token with 401", async () => {
    resolveAppToken.mockResolvedValue({ ok: false, error: "not_found" });
    const r = await verifyAppClient(GOOD_TOKEN, "cl-005");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("rejects a token that resolves to a DIFFERENT client with 403", async () => {
    // The core fix: a valid token for client A cannot drive client B's route.
    resolveAppToken.mockResolvedValue({ ok: true, client_id: "cl-999", plan_slug: "p" });
    const r = await verifyAppClient(GOOD_TOKEN, "cl-005");
    expect(r).toEqual({ ok: false, status: 403, error: "forbidden" });
  });

  it("accepts a token that resolves to the expected client", async () => {
    resolveAppToken.mockResolvedValue({ ok: true, client_id: "cl-005", plan_slug: "p1" });
    const r = await verifyAppClient(GOOD_TOKEN, "cl-005");
    expect(r).toEqual({ ok: true, clientId: "cl-005", planSlug: "p1" });
  });

  it("returns the resolved client when no expected id is given (lab-order route)", async () => {
    // The lab route derives the client FROM the token rather than the request.
    resolveAppToken.mockResolvedValue({ ok: true, client_id: "cl-008", plan_slug: "p2" });
    const r = await verifyAppClient(GOOD_TOKEN);
    expect(r).toEqual({ ok: true, clientId: "cl-008", planSlug: "p2" });
  });
});

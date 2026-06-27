/**
 * Tests for the token-admin flattening (token-admin-types.ts).
 *
 * Pinned `now` so expiry is deterministic. Covers: per-kind emission, URL
 * construction, expiry, terminal states (finalised/used), masking, the
 * published-only gate on letter tokens, and revocable flags.
 */
import { describe, it, expect } from "vitest";
import { buildIssuedTokens, maskToken } from "./token-admin-types";

const BASE = "https://intake.theochretree.com";
const NOW = Date.parse("2026-06-26T00:00:00Z");

describe("maskToken", () => {
  it("masks long tokens, leaves short ones whole", () => {
    expect(maskToken("abcdef1234567890XYZ")).toBe("abcdef…0XYZ");
    expect(maskToken("short")).toBe("short");
    expect(maskToken("")).toBe("—");
  });
});

describe("buildIssuedTokens", () => {
  it("emits app + intake tokens for a client with correct URLs", () => {
    const rows = buildIssuedTokens(
      [
        {
          client_id: "cl-001",
          display_name: "Nidhi Jain",
          app_token: "APPtoken1234567890abcd",
          intake_token: "INTtoken1234567890abcd",
          intake_token_expires_at: "2026-07-10",
          intake_first_opened_at: "2026-06-20T05:00:00Z",
        },
      ],
      [],
      BASE,
      NOW,
    );
    const app = rows.find((r) => r.kind === "app")!;
    expect(app.url).toBe(`${BASE}/app/APPtoken1234567890abcd`);
    expect(app.clientName).toBe("Nidhi Jain");
    expect(app.status).toBe("active");
    expect(app.revocable).toBe(true);

    const intake = rows.find((r) => r.kind === "intake")!;
    expect(intake.url).toBe(`${BASE}/intake/INTtoken1234567890abcd`);
    expect(intake.status).toBe("active");
    expect(intake.firstOpenedAt).toBe("2026-06-20T05:00:00Z");
  });

  it("marks an expired intake token expired + not revocable", () => {
    const rows = buildIssuedTokens(
      [{ client_id: "c", intake_token: "x".repeat(20), intake_token_expires_at: "2026-06-01" }],
      [],
      BASE,
      NOW,
    );
    const intake = rows.find((r) => r.kind === "intake")!;
    expect(intake.status).toBe("expired");
    expect(intake.revocable).toBe(false);
  });

  it("surfaces a finalised intake as a terminal row with no URL", () => {
    const rows = buildIssuedTokens(
      [{ client_id: "c", intake_finalised_at: "2026-06-15T00:00:00Z" }],
      [],
      BASE,
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("finalised");
    expect(rows[0].url).toBeNull();
    expect(rows[0].revocable).toBe(false);
  });

  it("emits letter tokens only for published plans", () => {
    const rows = buildIssuedTokens(
      [],
      [
        { client_id: "c", slug: "p-1", letter_token: "L".repeat(20), _bucket: "published" },
        { client_id: "c", slug: "p-0", letter_token: "O".repeat(20), _bucket: "superseded" },
      ],
      BASE,
      NOW,
    );
    const letters = rows.filter((r) => r.kind === "letter");
    expect(letters).toHaveLength(1);
    expect(letters[0].planSlug).toBe("p-1");
    expect(letters[0].url).toBe(`${BASE}/letter/${"L".repeat(20)}`);
  });

  it("handles start-confirmation active vs used", () => {
    const rows = buildIssuedTokens(
      [],
      [
        { client_id: "c", slug: "p-live", start_confirmation_token: "S".repeat(20), start_confirmation_expires_at: "2026-07-01", _bucket: "published" },
        { client_id: "c", slug: "p-used", start_confirmation_used_at: "2026-06-10", _bucket: "published" },
      ],
      BASE,
      NOW,
    );
    const live = rows.find((r) => r.planSlug === "p-live")!;
    const used = rows.find((r) => r.planSlug === "p-used")!;
    expect(live.status).toBe("active");
    expect(live.revocable).toBe(true);
    expect(used.status).toBe("used");
    expect(used.url).toBeNull();
    expect(used.revocable).toBe(false);
  });

  it("sorts live (active) rows ahead of terminal ones", () => {
    const rows = buildIssuedTokens(
      [
        { client_id: "a", intake_finalised_at: "2026-06-01T00:00:00Z" },
        { client_id: "b", app_token: "A".repeat(20) },
      ],
      [],
      BASE,
      NOW,
    );
    expect(rows[0].status).toBe("active");
    expect(rows[rows.length - 1].status).toBe("finalised");
  });
});

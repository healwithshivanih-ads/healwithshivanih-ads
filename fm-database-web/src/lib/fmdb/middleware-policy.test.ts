/**
 * Boundary tests for the coach-UI auth gate (middleware-policy.ts).
 *
 * Guards the single most important invariant in the deploy: on the public
 * Fly host (FLY_INTAKE_ONLY=1), NO coach-UI route is ever reachable — every
 * one resolves to "notfound" (404) — while the token/HMAC-gated public
 * surface stays open ("next"). If someone adds a coach route to the public
 * allowlist, or fat-fingers a prefix, one of these goes red.
 *
 * Tests the pure decideGate() directly (no Next runtime needed). The real
 * src/middleware.ts is a thin adapter: notfound→404, unauthorised→401,
 * next→NextResponse.next().
 */
import { describe, it, expect } from "vitest";
import {
  decideGate,
  isPublicPath,
  PUBLIC_PATH_PREFIXES,
  type GateEnv,
} from "./middleware-policy";

// Representative coach-UI routes that must NEVER be publicly reachable.
// PHI lives behind these; a leak here is the worst-case data exposure.
const COACH_ROUTES = [
  "/",
  "/dashboard-v2",
  "/clients-v2",
  "/clients-v2/cl-005",
  "/clients-v2/cl-005/plan/edit/some-slug",
  "/plans",
  "/plans/shivani-plan-1-2026-05-06-cl-001",
  "/assess",
  "/catalogue",
  "/catalogue/cleanup",
  "/calendar",
  "/ingest",
  "/backlog",
  "/sources",
  "/search",
  "/resources",
  "/mindmap",
];

// Representative public routes. Each is token- or HMAC-gated at the ROUTE
// level — the gate only decides whether the request bypasses the Basic-auth
// wall / exists on the Fly host, not whether it's ultimately authorised.
const PUBLIC_ROUTES = [
  "/intake/abc123",
  "/start/abc123",
  "/letter/abc123",
  "/recipes/abc123",
  "/supplements/abc123",
  "/app/abc123",
  "/guide/abc123",
  "/s/AbC1234",
  "/l/AbC1234",
  "/api/health",
  "/api/whatsapp-webhook",
  "/api/whatsapp-poll-webhook",
  "/api/app-checkin",
  "/api/app-copilot",
  "/api/app-msq",
  "/api/lab-order/123/pay",
  "/api/lab-order/webhook",
  "/api/cron/run",
  "/api/handover/test",
  "/api/cal-com-webhook",
  "/api/zoom-webhook",
  "/api/intake/upload",
  "/handouts/iron.html",
  "/ochre-app/manifest.json",
  "/recipe-images/dal.jpg",
];

const FLY: GateEnv = { flyIntakeOnly: "1" };
const AUTH: GateEnv = { coachAuthPassword: "s3cret", coachAuthUsername: "shivani" };
const LOCAL: GateEnv = {};

const basic = (user: string, pass: string) => "Basic " + btoa(`${user}:${pass}`);

describe("Mode 1: FLY_INTAKE_ONLY (public Fly host)", () => {
  it.each(COACH_ROUTES)("404s coach route %s", (path) => {
    expect(decideGate(path, FLY, null)).toBe("notfound");
  });

  it.each(PUBLIC_ROUTES)("serves public route %s", (path) => {
    expect(decideGate(path, FLY, null)).toBe("next");
  });

  it("does not treat a path that merely CONTAINS a public prefix as public", () => {
    // startsWith semantics: /evil/intake/ is NOT /intake/.
    expect(decideGate("/evil/intake/x", FLY, null)).toBe("notfound");
    expect(decideGate("/clients-v2/app/leak", FLY, null)).toBe("notfound");
  });

  it("blocks even with a would-be-valid Basic auth header (route doesn't exist on Fly)", () => {
    expect(decideGate("/clients-v2", FLY, basic("shivani", "s3cret"))).toBe("notfound");
  });
});

describe("Mode 2: COACH_AUTH_PASSWORD (auth-gated host)", () => {
  it("challenges coach route (401) when no auth header", () => {
    expect(decideGate("/clients-v2", AUTH, null)).toBe("unauthorised");
  });

  it("challenges coach route (401) on wrong password", () => {
    expect(decideGate("/clients-v2", AUTH, basic("shivani", "wrong"))).toBe("unauthorised");
  });

  it("allows coach route through with correct Basic auth", () => {
    expect(decideGate("/clients-v2", AUTH, basic("shivani", "s3cret"))).toBe("next");
  });

  it("defaults the username to 'shivani' when COACH_AUTH_USERNAME unset", () => {
    const env: GateEnv = { coachAuthPassword: "s3cret" };
    expect(decideGate("/clients-v2", env, basic("shivani", "s3cret"))).toBe("next");
    expect(decideGate("/clients-v2", env, basic("someone", "s3cret"))).toBe("unauthorised");
  });

  it("lets public routes through without any auth", () => {
    for (const path of PUBLIC_ROUTES) {
      expect(decideGate(path, AUTH, null)).toBe("next");
    }
  });
});

describe("Mode 3: local dev (no env set)", () => {
  it("passes coach routes through (no auth, no block)", () => {
    for (const path of COACH_ROUTES) {
      expect(decideGate(path, LOCAL, null)).toBe("next");
    }
  });

  it("passes public routes through", () => {
    for (const path of PUBLIC_ROUTES) {
      expect(decideGate(path, LOCAL, null)).toBe("next");
    }
  });
});

describe("allowlist hygiene", () => {
  it("isPublicPath agrees with the FLY-mode decision for every sample route", () => {
    for (const p of PUBLIC_ROUTES) expect(isPublicPath(p)).toBe(true);
    for (const p of COACH_ROUTES) expect(isPublicPath(p)).toBe(false);
  });

  it("no coach-UI prefix has leaked into the public allowlist", () => {
    // A regression tripwire: these segments must never appear as public
    // prefixes. Cheap insurance against a careless paste.
    const FORBIDDEN = [
      "/clients-v2",
      "/plans",
      "/dashboard",
      "/assess",
      "/catalogue",
      "/ingest",
      "/backlog",
      "/calendar",
    ];
    for (const prefix of PUBLIC_PATH_PREFIXES) {
      for (const bad of FORBIDDEN) {
        expect(prefix.startsWith(bad)).toBe(false);
      }
    }
  });
});

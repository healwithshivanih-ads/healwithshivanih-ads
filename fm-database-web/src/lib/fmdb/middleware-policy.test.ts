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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  decideGate,
  isMobilePath,
  isPublicPath,
  safeMobileNext,
  PUBLIC_PATH_PREFIXES,
  type GateEnv,
} from "./middleware-policy";

const HERE = path.dirname(fileURLToPath(import.meta.url));

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
  "/api/app-practice",
  "/api/app-reminders",
  "/api/app-body",
  "/api/app-swap",
  "/api/app-push",
  "/api/app-installed",
  "/api/app-photo",
  "/api/app-travel",
  "/api/app-travel-guide",
  "/api/lab-order/123/pay",
  "/api/lab-order/webhook",
  "/api/maintenance/cl-005/pay",
  "/api/maintenance/webhook",
  "/api/invoice/lab-order/2026-06-26-lab002",
  "/api/invoice/maintenance-order/cl-005-2026",
  "/api/invoice/maintenance-charge/pay_ABC123",
  "/api/cron/run",
  "/api/handover/test",
  "/api/cal-com-webhook",
  "/api/zoom-webhook",
  "/api/intake/upload",
  "/handouts/iron.html",
  "/ochre-app/manifest.json",
  "/coach-app/manifest.webmanifest",
  "/coach-app/icon-192.png",
  "/api/m-bridge/ask",
  "/recipe-images/dal.jpg",
  "/exercise-videos/neck-retraction.mp4",
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

describe("Mode 4: /m coach mobile app", () => {
  // Fly host with the mobile surface switched ON — the only config where /m
  // is reachable from the public internet.
  const FLY_M: GateEnv = { flyIntakeOnly: "1", coachMobileEnabled: true };

  const MOBILE_ROUTES = [
    "/m",
    "/m/",
    "/m/clients",
    "/m/clients/cl-005",
    "/m/today",
    "/api/m/quick-note",
  ];

  it.each(MOBILE_ROUTES)("redirects %s to login without a session", (path) => {
    expect(decideGate(path, FLY_M, null, false)).toBe("login");
  });

  it.each(MOBILE_ROUTES)("serves %s with a valid session", (path) => {
    expect(decideGate(path, FLY_M, null, true)).toBe("next");
  });

  it("defaults to fail-closed when the session flag is omitted entirely", () => {
    // A caller that forgets the 4th arg must NOT accidentally authorise.
    expect(decideGate("/m/clients", FLY_M, null)).toBe("login");
  });

  it("lets the login + logout endpoints through without a session", () => {
    for (const p of ["/m/login", "/api/m/login", "/api/m/logout"]) {
      expect(decideGate(p, FLY_M, null, false)).toBe("next");
    }
  });

  it("FAILS CLOSED: /m 404s on Fly when /m is not configured on this host", () => {
    // Enabling the surface must be an explicit act. Without the password the
    // whole app is simply not there.
    for (const p of [...MOBILE_ROUTES, "/m/login", "/api/m/login"]) {
      expect(decideGate(p, FLY, null, false)).toBe("notfound");
      // ...and a forged session flag cannot conjure it into existence.
      expect(decideGate(p, FLY, null, true)).toBe("notfound");
    }
  });

  it("does not weaken any other coach route when /m is enabled", () => {
    for (const p of COACH_ROUTES) {
      expect(decideGate(p, FLY_M, null, true)).toBe("notfound");
    }
  });

  it("keeps public routes public when /m is enabled", () => {
    for (const p of PUBLIC_ROUTES) {
      expect(decideGate(p, FLY_M, null, false)).toBe("next");
    }
  });

  it("uses the cookie gate instead of Basic auth on an auth-gated host", () => {
    // Basic auth re-prompts badly inside an installed iOS PWA — /m must never
    // fall through to the 401 wall.
    const env: GateEnv = { coachAuthPassword: "s3cret", coachMobileEnabled: true };
    expect(decideGate("/m/clients", env, null, false)).toBe("login");
    expect(decideGate("/m/clients", env, null, true)).toBe("next");
    // The rest of the coach UI still uses Basic.
    expect(decideGate("/clients-v2", env, null, false)).toBe("unauthorised");
  });
});

describe("mobile prefix matching (segment-anchored)", () => {
  // A bare startsWith("/m") would swallow these. /mindmap and /messages are
  // REAL coach routes: matching them would turn their Fly 404 into a login
  // redirect, advertising that the route exists.
  const NOT_MOBILE = [
    "/mindmap",
    "/mindmap/thyroid-dysfunction",
    "/messages",
    "/api/maintenance/cl-005/pay",
    "/mobile",
    "/m-something",
    "/media",
    // Shares the "/api/m" stem but is a DIFFERENT surface: the Mac-side AI
    // bridge, secret-gated at its own route. Must not fall into the /m
    // session gate, or Fly could never reach it.
    "/api/m-bridge/ask",
  ];

  it.each(NOT_MOBILE)("does not treat %s as a mobile path", (path) => {
    expect(isMobilePath(path)).toBe(false);
  });

  it.each(["/m", "/m/", "/m/clients", "/api/m/quick-note"])(
    "treats %s as a mobile path",
    (path) => {
      expect(isMobilePath(path)).toBe(true);
    },
  );

  it("still 404s /mindmap and /messages on Fly with /m enabled", () => {
    const env: GateEnv = { flyIntakeOnly: "1", coachMobileEnabled: true };
    expect(decideGate("/mindmap", env, null, false)).toBe("notfound");
    expect(decideGate("/messages", env, null, false)).toBe("notfound");
  });
});

describe("safeMobileNext — post-login destination clamp", () => {
  it("keeps a legitimate destination inside /m", () => {
    expect(safeMobileNext("/m")).toBe("/m");
    expect(safeMobileNext("/m/clients")).toBe("/m/clients");
    expect(safeMobileNext("/m/clients/cl-005")).toBe("/m/clients/cl-005");
    expect(safeMobileNext("/m/clients?q=hari")).toBe("/m/clients?q=hari");
  });

  it("normalises BEFORE validating — traversal cannot escape /m", () => {
    // The bug this exists for: "/m/../clients-v2" passes a naive
    // startsWith("/m/") check, then resolves to /clients-v2. Caught in
    // runtime testing on 2026-08-02; guarded here so it cannot come back.
    expect(safeMobileNext("/m/../clients-v2")).toBe("/m");
    expect(safeMobileNext("/m/../../etc/passwd")).toBe("/m");
    expect(safeMobileNext("/m/./../plans")).toBe("/m");
    expect(safeMobileNext("/m/%2e%2e/clients-v2")).toBe("/m");
  });

  it("rejects absolute and protocol-relative destinations", () => {
    for (const bad of [
      "//evil.com",
      "https://evil.com",
      "http://evil.com/m/clients",
      "javascript:alert(1)",
      "\\\\evil.com",
    ]) {
      expect(safeMobileNext(bad)).toBe("/m");
    }
  });

  it("rejects other coach routes, including near-misses", () => {
    for (const bad of ["/clients-v2", "/mindmap", "/messages", "/mobile", "/m-x"]) {
      expect(safeMobileNext(bad)).toBe("/m");
    }
  });

  it("never bounces back to the login page (redirect loop)", () => {
    expect(safeMobileNext("/m/login")).toBe("/m");
    expect(safeMobileNext("/m/login?error=1")).toBe("/m");
  });

  it("falls back to /m on empty or unparseable input", () => {
    for (const bad of [null, undefined, ""]) {
      expect(safeMobileNext(bad)).toBe("/m");
    }
  });
});

describe("allowlist hygiene", () => {
  it("/m is NOT in the public allowlist", () => {
    // The whole point of Mode 4: "public" means NO auth on Fly. /m lists every
    // client, so it must never be public — it carries its own cookie gate.
    expect(isPublicPath("/m")).toBe(false);
    expect(isPublicPath("/m/clients")).toBe(false);
    expect(isPublicPath("/m/login")).toBe(false);
    expect(isPublicPath("/api/m/login")).toBe(false);
    for (const prefix of PUBLIC_PATH_PREFIXES) {
      expect(prefix.startsWith("/m"), `${prefix} must not be a public /m prefix`).toBe(
        false,
      );
    }
  });

  it("isPublicPath agrees with the FLY-mode decision for every sample route", () => {
    for (const p of PUBLIC_ROUTES) expect(isPublicPath(p)).toBe(true);
    for (const p of COACH_ROUTES) expect(isPublicPath(p)).toBe(false);
  });

  it("every /api/app-* route dir is in the public allowlist", () => {
    // The client app (PWA, served from the Fly host) POSTs to these. If a
    // route dir exists on disk but isn't allowlisted, it 404s under
    // FLY_INTAKE_ONLY=1 and the feature silently dies (the app UI swallows
    // the error). This is exactly how app-practice + app-reminders shipped
    // broken. Enumerate the real route dirs so a newly-added app-* route
    // CANNOT ship un-allowlisted — this test goes red until it's added.
    const apiDir = path.join(HERE, "..", "..", "app", "api");
    const appRoutes = fs
      .readdirSync(apiDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("app-"))
      .map((e) => `/api/${e.name}`);
    expect(appRoutes.length).toBeGreaterThan(5); // sanity: dirs were found
    for (const route of appRoutes) {
      expect(isPublicPath(route), `${route} must be in PUBLIC_PATH_PREFIXES`).toBe(true);
    }
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

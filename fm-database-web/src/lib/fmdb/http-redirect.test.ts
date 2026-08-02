/**
 * Guards the sign-in-from-a-phone bug.
 *
 * `NextResponse.redirect(new URL(path, req.url))` emitted
 * `https://localhost:3002/m` in production, because on Fly `req.url` is the
 * internal bind address. The browser dutifully tried to reach the coach's own
 * laptop and sign-in was unusable. These assert the Location stays relative —
 * which is correct behind any proxy, on any host.
 */
import { describe, it, expect } from "vitest";
import { relativeRedirect } from "./http-redirect";

describe("relativeRedirect", () => {
  it("emits a relative Location, never an absolute one", () => {
    const res = relativeRedirect("/m/today");
    expect(res.headers.get("location")).toBe("/m/today");
    expect(res.headers.get("location")).not.toMatch(/^https?:\/\//);
  });

  it("keeps the query string", () => {
    expect(relativeRedirect("/m/settings?error=current").headers.get("location")).toBe(
      "/m/settings?error=current",
    );
  });

  it("defaults to 303 so a form POST re-issues as GET", () => {
    // A plain 302 after a form POST can re-POST on refresh.
    expect(relativeRedirect("/m").status).toBe(303);
    expect(relativeRedirect("/m", 307).status).toBe(307);
  });

  it("refuses protocol-relative paths, which the browser would send off-site", () => {
    expect(relativeRedirect("//evil.com").headers.get("location")).toBe("/");
  });

  it("refuses anything not root-relative", () => {
    for (const bad of ["https://evil.com", "m/today", "", "javascript:alert(1)"]) {
      expect(relativeRedirect(bad).headers.get("location")).toBe("/");
    }
  });

  it("never carries a body", () => {
    expect(relativeRedirect("/m").body).toBeNull();
  });
});

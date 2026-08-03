/**
 * "Check your connection" was told to someone whose connection was fine.
 *
 * A Server Action is bound to the build that produced it, so deploying under
 * an open page makes every call from it fail — into the same catch block as
 * a dead network. The two have opposite fixes, so the distinguishing probe
 * is pinned here, along with the draft surviving the recovery reload: an
 * automatic reload that eats a typed message is worse than the bug.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { serverIsReachable, reloadPreserving, takePreserved } from "../stale-build";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", { location: { reload: vi.fn() } });
});

describe("stale build vs no network", () => {
  it("a responding server means the network is NOT the problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    expect(await serverIsReachable()).toBe(true);
  });

  it("a throwing fetch is a genuine connection failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await serverIsReachable()).toBe(false);
  });

  it("a 5xx is not treated as reachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    expect(await serverIsReachable()).toBe(false);
  });

  it("the unsent message survives the recovery reload", () => {
    reloadPreserving("k", "the message she typed");
    expect(takePreserved("k")).toBe("the message she typed");
  });

  it("reloads onto the current build", () => {
    reloadPreserving("k", "x");
    expect(window.location.reload).toHaveBeenCalled();
  });

  it("a restored draft is handed back only once", () => {
    reloadPreserving("k", "x");
    expect(takePreserved("k")).toBe("x");
    expect(takePreserved("k")).toBe("");
  });

  it("storage being unavailable still reloads rather than stranding the page", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => {},
    });
    expect(() => reloadPreserving("k", "x")).not.toThrow();
    expect(window.location.reload).toHaveBeenCalled();
    expect(takePreserved("k")).toBe("");
  });
});

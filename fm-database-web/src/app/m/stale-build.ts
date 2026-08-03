"use client";

/**
 * Telling "you are offline" apart from "this page is older than the server".
 *
 * Server Actions are bound to the build that produced them. Deploying while
 * a page is open leaves that page calling an action id the new server has
 * never heard of — Next answers "Failed to find Server Action" and the call
 * throws, landing in the same catch block as a dead network. Shivani hit
 * this mid-conversation and was told to check her connection, which was
 * fine; she retried four times against a page that could never succeed.
 *
 * The two look identical from inside the catch and have opposite fixes, so
 * we ask the server directly. A reachable server means the network is fine
 * and the PAGE is the stale part — recoverable by reloading, which is
 * something we can just do, as long as what she typed survives it. Losing a
 * written message to an automatic reload would be a worse bug than the one
 * being fixed.
 */

/** True when the server answers — i.e. the network is not the problem. */
export async function serverIsReachable(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Reload onto the current build, carrying unsent text across. */
export function reloadPreserving(key: string, value: string): void {
  try {
    if (value) sessionStorage.setItem(key, value);
  } catch {
    // Private mode / storage full: reloading still beats a dead page.
  }
  window.location.reload();
}

/** Take back anything stashed before a reload (once — it is then cleared). */
export function takePreserved(key: string): string {
  try {
    const v = sessionStorage.getItem(key);
    if (v) sessionStorage.removeItem(key);
    return v ?? "";
  } catch {
    return "";
  }
}

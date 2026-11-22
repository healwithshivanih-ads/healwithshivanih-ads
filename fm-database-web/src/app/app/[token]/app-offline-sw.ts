"use client";

/**
 * Registers the "opens with no signal" worker (public/ochre-app/app-sw.js,
 * scope /app/) for someone with a course, then asks it to keep this page
 * and the build files it used, so the next open works with no network.
 *
 * Separate from the push worker (/ochre-app/sw.js, scope /ochre-app/): every
 * push call looks that one up by its own address, so the two never meet.
 */

export function registerAppOffline(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  void (async () => {
    try {
      const reg = await navigator.serviceWorker.register("/ochre-app/app-sw.js", { scope: "/app/" });
      const worker = reg.active ?? reg.waiting ?? reg.installing;
      if (!worker) return;
      const send = () =>
        worker.postMessage({
          type: "warm",
          page: location.pathname,
          files: performance
            .getEntriesByType("resource")
            .map((e) => e.name)
            .filter((n) => n.includes("/_next/static/") || n.includes("/ochre-app/calm-gut/")),
        });
      if (worker.state === "activated") send();
      else worker.addEventListener("statechange", () => worker.state === "activated" && send());
    } catch {
      // No worker (private mode, an old phone): the app works as before,
      // it just needs a signal to open.
    }
  })();
}

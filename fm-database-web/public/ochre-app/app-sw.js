/* The Ochre Tree — "opens with no signal" worker for the client app pages.
 *
 * Scope /app/ (allowed by the Service-Worker-Allowed header in
 * next.config.ts). Registered only for someone with a course (ochre-app.tsx),
 * so a saved Calm Gut track can be played when the phone has no signal at
 * all: on a plane, in the hills. Shivani, 22 Nov 2026.
 *
 * It is separate from /ochre-app/sw.js (push). Every push call looks that one
 * up by its own address, so this worker never touches a subscription.
 *
 *   - The app page: network first, always. A copy of the last page that
 *     loaded is kept and shown only when the network fails.
 *   - Next's build files (/_next/static/, hashed, never change), the fonts
 *     and the course photos: from the copy if there is one, else the network.
 *   - Anything else (every /api/ call, audio links): straight to the network,
 *     never kept. Audio saved for offline lives in its own cache
 *     (course-offline.ts) and is read by the page, not by this worker.
 */

const PAGES = "ochre-app-pages-v1";
const FILES = "ochre-app-files-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => (k.startsWith("ochre-app-pages-") || k.startsWith("ochre-app-files-")) && k !== PAGES && k !== FILES)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isAppPage(url) {
  return url.origin === self.location.origin && /^\/app\/[^/]+\/?$/.test(url.pathname);
}

function isKeptFile(url) {
  if (url.origin === self.location.origin) {
    return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/ochre-app/calm-gut/");
  }
  return url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com";
}

/* The page that registered this worker loaded before the worker existed, so
 * nothing of it was kept. It sends its own address and the build files it
 * used; they are fetched once now, so the very next open works offline. */
self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.type !== "warm" || !Array.isArray(d.files)) return;
  const page = typeof d.page === "string" ? new URL(d.page, self.location.origin) : null;
  const jobs = [];
  if (page && isAppPage(page)) {
    jobs.push(
      fetch(page.origin + page.pathname, { credentials: "same-origin" })
        .then((res) => (res.ok ? caches.open(PAGES).then((c) => c.put(page.origin + page.pathname, res)) : null))
        .catch(() => {}),
    );
  }
  for (const f of d.files.slice(0, 200)) {
    let u;
    try {
      u = new URL(f, self.location.origin);
    } catch (_e) {
      continue;
    }
    // Fonts are kept by the fetch handler on the next open, in the mode the
    // page asks for them; warming them here could store the wrong kind.
    if (u.origin !== self.location.origin || !isKeptFile(u)) continue;
    jobs.push(
      caches.open(FILES).then((c) =>
        c.match(u.href).then((hit) =>
          hit
            ? null
            : fetch(u.href)
                .then((res) => (res.ok ? c.put(u.href, res) : null))
                .catch(() => {}),
        ),
      ),
    );
  }
  event.waitUntil(Promise.all(jobs));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate" && isAppPage(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            // One page per link, without its query string.
            caches.open(PAGES).then((c) => c.put(url.origin + url.pathname, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches
            .open(PAGES)
            .then((c) => c.match(url.origin + url.pathname))
            .then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  if (isKeptFile(url)) {
    event.respondWith(
      caches.open(FILES).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok || res.type === "opaque") c.put(req, res.clone()).catch(() => {});
              return res;
            }),
        ),
      ),
    );
  }
});

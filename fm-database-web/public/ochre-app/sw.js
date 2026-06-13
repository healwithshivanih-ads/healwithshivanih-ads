/* The Ochre Tree — push service worker.
 * Scope is /ochre-app/ (where this file is served). That's fine for push:
 * the subscription + notification display are tied to the registration, not
 * to controlling the /app/<token> page. notificationclick focuses an open
 * app tab or opens the client's link. */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = {};
  }
  const title = data.title || "The Ochre Tree";
  const options = {
    body: data.body || "",
    icon: "/ochre-app/icon-192.png",
    badge: "/ochre-app/icon-192.png",
    tag: data.tag || "ochre",
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const w of wins) {
          if (w.url.includes("/app/") && "focus" in w) return w.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});

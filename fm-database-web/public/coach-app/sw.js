/* Ochre Coach — push service worker.
 *
 * Scope is /coach-app/ (where this file is served), which is fine for push:
 * the subscription and the notification display are tied to the registration,
 * not to controlling the /m pages.
 *
 * Separate from the CLIENT app's worker on purpose. Both apps can be installed
 * on the same phone, and a shared worker would mean a client notification and
 * a coach notification competing over one registration and one tag namespace.
 */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = {};
  }
  const title = data.title || "Ochre Coach";
  const options = {
    body: data.body || "",
    icon: "/coach-app/icon-192.png",
    badge: "/coach-app/icon-192.png",
    // One tag per client, so three messages from the same person replace each
    // other rather than stacking three notifications.
    tag: data.tag || "coach",
    data: { url: data.url || "/m/today" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/m/today";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        // Focus an open coach window and take it to the conversation, rather
        // than opening a second copy of the app.
        for (const w of wins) {
          if (w.url.includes("/m") && "focus" in w) {
            if ("navigate" in w) w.navigate(url);
            return w.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

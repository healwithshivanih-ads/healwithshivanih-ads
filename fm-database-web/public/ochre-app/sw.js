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
  // Tell the server this phone actually DREW it. A push service accepting
  // the message says it left; only this says it arrived. Best-effort: a
  // failed receipt must never cost the notification itself.
  const receipt = data.receipt;
  event.waitUntil(
    self.registration.showNotification(title, options).then(function () {
      if (!receipt || !receipt.client || !receipt.id) return;
      return fetch("/api/push-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(receipt),
      }).catch(function () {});
    }),
  );
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

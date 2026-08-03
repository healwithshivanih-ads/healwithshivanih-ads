"use client";

/**
 * Turn on notifications for THIS device.
 *
 * Per-device by nature: a push subscription belongs to one browser on one
 * phone, so the control says "this device" rather than implying a global
 * setting. Registering the phone and later the laptop gives two — both ring.
 *
 * Registered against /coach-app/sw.js, the coach app's own worker, kept
 * separate from the client app's so the two can be installed side by side
 * without fighting over one registration.
 */
import { useEffect, useState } from "react";
import { VAPID_PUBLIC_KEY, urlBase64ToUint8Array } from "@/lib/fmdb/push-public";
import { Icon } from "../ui";

type State = "checking" | "on" | "off" | "asking" | "blocked" | "unsupported";

export function NotificationSetting() {
  const [state, setState] = useState<State>("checking");
  const [devices, setDevices] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
        return setState("unsupported");
      }
      try {
        const res = await fetch("/api/m/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status" }),
        });
        const j = await res.json();
        setDevices(j.devices ?? 0);
        // Both must be true: the browser has granted permission AND the
        // server holds a subscription. Either alone means no notification
        // arrives, so showing "on" for one of them would be a lie.
        const reg = await navigator.serviceWorker.getRegistration("/coach-app/sw.js");
        const sub = await reg?.pushManager.getSubscription();
        if (Notification.permission === "denied") setState("blocked");
        else if (Notification.permission === "granted" && sub && j.devices > 0) setState("on");
        else setState("off");
      } catch {
        setState("off");
      }
    })();
  }, []);

  async function enable() {
    setState("asking");
    setError(null);
    try {
      const reg = await navigator.serviceWorker.register("/coach-app/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState("blocked");
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        }));
      const res = await fetch("/api/m/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "subscribe",
          subscription: sub.toJSON(),
          label: navigator.userAgent.slice(0, 60),
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError("Couldn't register this device.");
        return setState("off");
      }
      setDevices(j.devices ?? 1);
      setState("on");
    } catch (e) {
      setError((e as Error).message);
      setState("off");
    }
  }

  async function disable() {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/coach-app/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      await fetch("/api/m/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unsubscribe", endpoint: sub?.endpoint }),
      });
      await sub?.unsubscribe();
      setDevices((d) => Math.max(0, d - 1));
      setState("off");
    } catch {
      setState("off");
    }
  }

  return (
    <>
      <div className="m-eyebrow" style={{ marginTop: 28 }}>
        Notifications
      </div>
      <div className="m-card">
        {state === "unsupported" ? (
          <span className="m-subtle">
            This browser can&apos;t do notifications. Add the app to your home
            screen and open it from there.
          </span>
        ) : state === "blocked" ? (
          <span className="m-subtle">
            Blocked in your phone&apos;s settings. Allow notifications for this
            app there, then come back.
          </span>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className={`m-dot ${state === "on" ? "m-dot--success" : ""}`} />
              <span style={{ fontSize: "var(--fm-text-md)" }}>
                {state === "on"
                  ? "On for this device"
                  : state === "asking"
                    ? "Asking your phone…"
                    : state === "checking"
                      ? "Checking…"
                      : "Off"}
              </span>
            </div>
            <p className="m-subtle" style={{ margin: "8px 0 12px" }}>
              {state === "on"
                ? `You'll get a notification when a client messages you.${devices > 1 ? ` ${devices} devices registered.` : ""}`
                : "Get a notification when a client messages you in their app."}
            </p>
            {state === "on" ? (
              <button type="button" className="fm-btn" onClick={disable}>
                Turn off on this device
              </button>
            ) : (
              <button
                type="button"
                className="fm-btn primary"
                onClick={enable}
                disabled={state === "asking" || state === "checking"}
              >
                <Icon name="chat" size="sm" />
                Turn on
              </button>
            )}
            {error ? (
              <p className="m-subtle" style={{ marginTop: 8, color: "var(--fm-danger)" }}>
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

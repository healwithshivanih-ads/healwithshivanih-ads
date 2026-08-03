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

type State =
  | "checking"
  | "on"
  | "off"
  | "asking"
  | "blocked"
  | "needs-install"   // Safari tab on iOS — the API does not exist here
  | "unsupported";    // genuinely no push on this browser/OS

export function NotificationSetting() {
  const [state, setState] = useState<State>("checking");
  const [devices, setDevices] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // iOS exposes the Notification API ONLY to a PWA launched from the
      // Home Screen. In a Safari tab it is simply absent — so "no button"
      // must not read as "broken", it has to say what to do instead.
      const standalone =
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        (window.navigator as { standalone?: boolean }).standalone === true;
      const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
        return setState(iOS && !standalone ? "needs-install" : "unsupported");
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

  async function test() {
    setError(null);
    setNote("Sending…");
    try {
      const res = await fetch("/api/m/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const j = await res.json();
      // "Sent" here means the push service accepted it, which is not the same
      // as it appearing on screen — so the wording asks her to look rather
      // than claiming success she can disprove by glancing at her phone.
      setNote(j.ok ? "Sent — check your lock screen." : "");
      if (!j.ok) setError(j.error ?? "Couldn't send.");
    } catch {
      setNote("");
      setError("Couldn't reach the server.");
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
        {state === "needs-install" ? (
          <>
            <div style={{ fontSize: "var(--fm-text-md)", marginBottom: 6 }}>
              Add the app to your Home Screen first
            </div>
            <p className="m-subtle" style={{ margin: 0, lineHeight: 1.6 }}>
              iPhone only allows notifications from an app on the Home Screen —
              not from a Safari tab, which is why there&apos;s no switch here.
              <br />
              <br />
              Tap <strong>Share</strong> at the bottom of Safari, choose{" "}
              <strong>Add to Home Screen</strong>, then open{" "}
              <strong>Coach</strong> from your Home Screen and come back to this
              page. The switch will be here.
            </p>
          </>
        ) : state === "unsupported" ? (
          <span className="m-subtle">
            This browser doesn&apos;t support notifications. Open the app on
            your phone instead.
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
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="fm-btn primary" onClick={test}>
                  Send a test
                </button>
                <button type="button" className="fm-btn" onClick={disable}>
                  Turn off on this device
                </button>
              </div>
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
            {note ? (
              <p className="m-subtle" style={{ marginTop: 8 }}>{note}</p>
            ) : null}
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

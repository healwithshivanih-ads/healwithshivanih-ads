"use client";
/**
 * Push notifications on this phone, for the client app: is it on, turn it on,
 * turn it off. One copy of the steps (service worker, permission, subscribe,
 * store server-side) for the new front's reminder sheet.
 * iOS supports this only for an app added to the Home Screen.
 */
import { useEffect, useState } from "react";
import { urlBase64ToUint8Array, VAPID_PUBLIC_KEY } from "./push-public";

const SW = "/ochre-app/sw.js";

export type PushState = "checking" | "unsupported" | "off" | "on" | "blocked";

export function usePush(token: string) {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const ok = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!ok) {
      setState("unsupported");
      return;
    }
    navigator.serviceWorker
      .getRegistration(SW)
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : Notification.permission === "denied" ? "blocked" : "off"))
      .catch(() => setState("off"));
  }, []);

  async function enable() {
    setBusy(true);
    setNote("");
    try {
      const reg = await navigator.serviceWorker.register(SW);
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("blocked");
        setBusy(false);
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      const res = await fetch("/api/app-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "subscribe", subscription: sub.toJSON() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setNote("That didn't go through. Please try again in a moment.");
      } else {
        setState("on");
        setNote(j.verified ? "Done. A test reminder should be on your screen now." : "Turned on, but the test reminder didn't arrive. Try again in a moment.");
      }
    } catch {
      setNote("Reminders can't be turned on on this phone.");
    }
    setBusy(false);
  }

  async function disable() {
    setBusy(true);
    setNote("");
    try {
      const reg = await navigator.serviceWorker.getRegistration(SW);
      const sub = await reg?.pushManager.getSubscription();
      // The server first: if it cannot be told (offline), the phone keeps its
      // subscription, so reminders are still on in both places, not half off.
      const res = await fetch("/api/app-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "unsubscribe", endpoint: sub?.endpoint }),
      });
      if (!res.ok) throw new Error("not reached");
      if (sub) await sub.unsubscribe().catch(() => {});
      setState("off");
    } catch {
      setNote("Couldn't turn reminders off just now. Check your internet and try again.");
    }
    setBusy(false);
  }

  return { state, busy, note, enable, disable };
}

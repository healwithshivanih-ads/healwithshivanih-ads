"use client";

/**
 * InstallPrompt — gentle "add to home screen" nudge for the client app.
 *
 *  • Android / Chrome: captures the native `beforeinstallprompt` event and
 *    shows a one-tap "Add" button that fires the real install dialog.
 *  • iOS Safari: no programmatic install exists, so we show the manual
 *    Share → "Add to Home Screen" instructions instead.
 *  • Hidden entirely once the app is already installed (standalone display
 *    mode / navigator.standalone) and after the client dismisses it.
 */

import { useEffect, useState } from "react";

const DISMISS_KEY = "ochre.install.dismissed";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isiOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as Mac — detect touch + Apple platform
  const iPadOS = navigator.platform === "MacIntel" && (navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1;
  return iOSDevice || iPadOS;
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      /* private mode — still show */
    }

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    // iOS never fires beforeinstallprompt — surface the manual path after a
    // short beat so it doesn't fight the splash.
    const onIOS = isiOS();
    setIos(onIOS);
    const t = onIOS ? setTimeout(() => setShow(true), 1800) : null;

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!show) return null;

  const close = (remember: boolean) => {
    setShow(false);
    if (remember) {
      try {
        localStorage.setItem(DISMISS_KEY, "1");
      } catch {
        /* ignore */
      }
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    close(true);
  };

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)",
        zIndex: 60,
        background: "#fff",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 16,
        boxShadow: "0 8px 30px rgba(0,0,0,0.16)",
        padding: "14px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        maxWidth: 460,
        margin: "0 auto",
        animation: "ochreInstallIn .3s ease",
      }}
      role="dialog"
      aria-label="Add The Ochre Tree to your home screen"
    >
      <style>{`@keyframes ochreInstallIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/ochre-app/icon-192.png"
          alt=""
          width={40}
          height={40}
          style={{ borderRadius: 10, flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#2b2d42" }}>
            Keep The Ochre Tree handy
          </div>
          <div style={{ fontSize: 12.5, color: "#6f6a5d", lineHeight: 1.45 }}>
            {ios
              ? "Add it to your home screen so it opens like an app."
              : "Add it to your home screen — opens full-screen, one tap away."}
          </div>
        </div>
        <button
          onClick={() => close(true)}
          aria-label="Not now"
          style={{
            background: "transparent",
            border: "none",
            color: "#9a948a",
            fontSize: 20,
            lineHeight: 1,
            cursor: "pointer",
            padding: 2,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>

      {ios ? (
        <div
          style={{
            fontSize: 12.5,
            color: "#4a4640",
            background: "#f7f4f3",
            borderRadius: 10,
            padding: "9px 11px",
            lineHeight: 1.55,
          }}
        >
          Tap the <strong>Share</strong> icon{" "}
          <span aria-hidden style={{ display: "inline-block", transform: "translateY(2px)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2b6cb0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle" }}>
              <path d="M12 16V4" />
              <path d="M8 8l4-4 4 4" />
              <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
            </svg>
          </span>{" "}
          at the bottom of Safari, then choose <strong>“Add to Home Screen.”</strong>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={install}
            style={{
              flex: 1,
              background: "#a9651f",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Add to home screen
          </button>
          <button
            onClick={() => close(true)}
            style={{
              background: "#f0ede9",
              color: "#4a4640",
              border: "none",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}

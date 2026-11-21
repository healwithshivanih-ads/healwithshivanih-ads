"use client";
/**
 * Reminders: one button to turn them on, and plain steps for when the phone
 * blocks it. Opened from Everything and from the missed-capsule answer
 * (coach, 21 Nov 2026: "you can set up the app to remind you … let them click
 * yes or whatever is convenient").
 */
import type { ClientAppData } from "@/lib/fmdb/client-app";
import { usePush } from "@/lib/fmdb/use-push";
import { SqCard } from "./sq-ui";

const BUTTON = "the button above";
const IOS = [
  "Open this app in Safari, tap the Share button, then Add to Home Screen.",
  "Open the app from that new icon on your Home Screen.",
  `Come back to Reminders and tap ${BUTTON}, then Allow.`,
  "Still nothing? Settings → Notifications → this app → Allow Notifications.",
];
const ANDROID = [
  `Tap ${BUTTON}, then Allow when your phone asks.`,
  "If it says blocked: tap the lock or ⋮ next to the web address → Notifications → Allow.",
  "Still nothing? Settings → Apps → Chrome → Notifications → turn them on.",
];

export function SqRemindSheet({ data }: { data: ClientAppData }) {
  const p = usePush(data.token);
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <>
      <SqCard>
        <p className="sq-sub">
          {p.state === "on"
            ? "Reminders are on. Your phone will remind you at each supplement time, and when your check-in is due."
            : p.state === "blocked"
              ? "Your phone is blocking reminders from this app. The steps below turn them back on."
              : "Your phone can remind you at each supplement time, and when your check-in is due."}
        </p>
        {(p.state === "off" || p.state === "blocked") && (
          <button type="button" className="sq-btn sq-btn-solid" disabled={p.busy} onClick={() => void p.enable()}>
            {p.busy ? "Turning on…" : p.state === "blocked" ? "Try again" : "Yes, remind me"}
          </button>
        )}
        {p.state === "on" && (
          <button type="button" className="sq-btn sq-btn-quiet" disabled={p.busy} onClick={() => void p.disable()}>
            Turn reminders off
          </button>
        )}
        {p.note && <p className="sq-sub">{p.note}</p>}
      </SqCard>
      {(p.state === "unsupported" || p.state === "blocked" || p.state === "off") && (
        <>
          <SqCard title={ios ? "On this iPhone" : "On this Android phone"}>
            <ol className="sq-steps">{(ios ? IOS : ANDROID).map((t) => <li key={t}>{t}</li>)}</ol>
          </SqCard>
          <SqCard title={ios ? "On an Android phone" : "On an iPhone"}>
            <ol className="sq-steps">{(ios ? ANDROID : IOS).map((t) => <li key={t}>{t}</li>)}</ol>
          </SqCard>
        </>
      )}
    </>
  );
}

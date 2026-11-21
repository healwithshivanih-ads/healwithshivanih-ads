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
        <SqCard title="If it doesn't work">
          {ios ? (
            <ol className="sq-steps">
              <li>Open this app in Safari and tap the Share button.</li>
              <li>Tap Add to Home Screen, then open the app from that icon.</li>
              <li>Come back here and tap Yes, remind me.</li>
              <li>Still nothing? Settings → Notifications → find this app → Allow Notifications.</li>
            </ol>
          ) : (
            <ol className="sq-steps">
              <li>Tap Yes, remind me, then Allow when your phone asks.</li>
              <li>If it says blocked: tap the lock or three dots next to the web address → Notifications → Allow.</li>
              <li>Still nothing? Settings → Apps → Chrome → Notifications → turn them on.</li>
            </ol>
          )}
        </SqCard>
      )}
    </>
  );
}

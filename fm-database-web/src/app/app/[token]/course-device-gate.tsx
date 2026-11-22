"use client";

/**
 * Shown instead of the course when this phone is not one of the buyer's two
 * (course-devices.ts).
 *   claimable — a slot is free: register this phone and open the course.
 *   full  — both slots are taken: offer a 6-digit code, emailed to the
 *           address the course was bought with (never one typed here).
 */

import { useEffect, useState } from "react";
import { SequoyaFonts } from "@/components/sequoya/sequoya-brand";
import { Mark } from "./ochre-context";

async function post(token: string, action: string, extra: Record<string, unknown> = {}) {
  const res = await fetch("/api/app-course", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, action, ...extra }),
  });
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; triesLeft?: number };
  return { ok: res.ok && j.ok === true, status: res.status, error: j.error ?? "", triesLeft: j.triesLeft };
}

const ERRORS: Record<string, string> = {
  wait: "A code was just sent. Wait a minute before asking for another.",
  limit: "That's the most codes for one day. Try again tomorrow, or write to hello@theochretree.com.",
  wrong: "That code isn't right.",
  expired: "That code has expired. Ask for a new one.",
  used_up: "Too many wrong tries. Ask for a new code.",
  none: "Ask for a code first.",
};

export function CourseDeviceGate({
  token,
  mode,
  title,
  maskedEmail,
  maxDevices = 2,
}: {
  token: string;
  /** The real limit (COURSE_MAX_DEVICES), so the sentence never lies. */
  maxDevices?: number;
  mode: "claimable" | "full";
  title: string;
  maskedEmail: string;
}) {
  const [view, setView] = useState<"claiming" | "full" | "code">(mode === "claimable" ? "claiming" : "full");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (view !== "claiming") return;
    void post(token, "device-claim").then((r) => {
      if (r.ok) window.location.reload();
      else setView("full"); // the last slot went to another phone a moment ago
    });
  }, [view, token]);

  const sendCode = async () => {
    setBusy(true);
    setMsg("");
    const r = await post(token, "device-code");
    setBusy(false);
    if (r.ok) setView("code");
    else setMsg(ERRORS[r.error] ?? "The code couldn't be sent just now. Try again in a minute.");
  };

  const verify = async () => {
    setBusy(true);
    setMsg("");
    const r = await post(token, "device-verify", { code });
    setBusy(false);
    if (r.ok) {
      window.location.reload();
      return;
    }
    setMsg(
      r.error === "wrong" && r.triesLeft
        ? `${ERRORS.wrong} ${r.triesLeft} ${r.triesLeft === 1 ? "try" : "tries"} left.`
        : (ERRORS[r.error] ?? "That didn't work. Try again."),
    );
    if (r.error === "expired" || r.error === "used_up") setView("full");
  };

  return (
    <div className="ochre-app sequoya">
      <SequoyaFonts />
      <div className="app">
        <div className="token-screen cg-gate" style={{ position: "relative", height: "100dvh" }}>
          <span className="big-mark">
            <Mark size={56} />
          </span>
          <div className="t">{title}</div>
          {view === "claiming" ? (
            <>
              <div className="spinner" />
              <div className="s">Opening your course…</div>
            </>
          ) : (
            <div className="cg-gate-body">
              <h1 className="cg-gate-h">
                This course is already open on {maxDevices} {maxDevices === 1 ? "phone" : "phones"}
              </h1>
              <p>
                It&apos;s a personal course for the person who bought it. If that&apos;s you on a new phone, we&apos;ll
                email a 6-digit code to the address you bought it with
                {maskedEmail ? (
                  <>
                    {" "}
                    (<strong>{maskedEmail}</strong>)
                  </>
                ) : null}
                . Your least-used phone will be signed out.
              </p>
              {view === "full" ? (
                maskedEmail ? (
                  <button className="cg-btn wide" disabled={busy} onClick={() => void sendCode()}>
                    {busy ? "Sending…" : "Email me a code"}
                  </button>
                ) : (
                  <p>
                    Write to <strong>hello@theochretree.com</strong> and we&apos;ll move it to this phone.
                  </p>
                )
              ) : (
                <>
                  <p className="cg-gate-sent">Code sent. It works for 15 minutes.</p>
                  <input
                    className="cg-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    aria-label="6-digit code"
                  />
                  <button className="cg-btn wide" disabled={busy || code.length !== 6} onClick={() => void verify()}>
                    {busy ? "Checking…" : "Open the course here"}
                  </button>
                  <button className="link" style={{ marginTop: 10 }} disabled={busy} onClick={() => void sendCode()}>
                    Send a new code
                  </button>
                </>
              )}
              {msg && <div className="cg-error">{msg}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

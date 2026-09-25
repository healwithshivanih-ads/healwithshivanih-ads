"use client";

/**
 * DiscoveryAppCard — coach-side control to share the app at the DISCOVERY
 * (consult-only) stage: a client who's had a discovery call but hasn't signed
 * up for the full programme. One click issues the stable app link; recording
 * the call as the PAID Foundation session (not a free call) starts the 15-day
 * ₹12,000 credit window; and it projects the read-only discovery app
 * (Lab Vault + Starting Map, locked Plan/Progress) to Fly.
 *
 * Same `app_token` the full app uses — when a plan is later published, this
 * exact link flips to the full Ochre Tree in place. See DISCOVERY_TIER_SPEC.md.
 */

import { useEffect, useState } from "react";
import { FmPanel } from "@/components/fm";
import { copyText } from "@/lib/copy-text";
import { resolveDiscoveryCredit, type DiscoveryCredit } from "@/lib/fmdb/discovery-tier";
import { CallKindRecorder } from "@/components/call-kind-recorder";

interface Props {
  clientId: string;
  mobileNumber?: string | null;
  displayName?: string | null;
  existingToken?: string | null;
  /** YYYY-MM-DD if the credit window has already been started. */
  existingCallDate?: string | null;
}

function buildPublicUrl(p: string): string {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return origin.replace(/\/$/, "") + p;
}

function istTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function humanDate(ymd: string): string {
  return new Date(ymd + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildWhatsappLink(phone: string, name: string, url: string): string {
  const clean = phone.replace(/\D+/g, "");
  const e164 = clean.length === 10 ? `91${clean}` : clean;
  const msg = [
    `Hi ${name || "there"},`,
    "",
    "Here are your reports and a starting map from our session, in a simple app:",
    "",
    url,
    "",
    "Open it on your phone and tap 'Add to Home Screen'. Have a look whenever — and when you're ready for the full programme, the upgrade button is right inside.",
    "",
    "— The Ochre Tree",
  ].join("\n");
  return `https://wa.me/${e164}?text=${encodeURIComponent(msg)}`;
}

function CreditChip({ credit }: { credit: DiscoveryCredit }) {
  if (credit.state === "credit_expired") {
    return (
      <div style={{ fontSize: 12.5, color: "#b3402a" }}>
        ⏳ Credit window closed{credit.expiresOn ? ` (expired ${humanDate(credit.expiresOn)})` : ""} — full
        price, or a fresh call resets it.
      </div>
    );
  }
  return (
    <div style={{ fontSize: 12.5, color: "#2f7a3f" }}>
      ✓ Credit window open
      {credit.expiresOn ? ` until ${humanDate(credit.expiresOn)}` : ""}
      {credit.daysLeft != null
        ? ` · ${credit.daysLeft === 0 ? "last day" : `${credit.daysLeft} day${credit.daysLeft === 1 ? "" : "s"} left`}`
        : ""}
    </div>
  );
}

export function DiscoveryAppCard({ clientId, mobileNumber, displayName, existingToken, existingCallDate }: Props) {
  const [token, setToken] = useState<string | null>(existingToken ?? null);
  const [callDate, setCallDate] = useState<string | null>(existingCallDate ?? null);
  const [credit, setCredit] = useState<DiscoveryCredit | null>(
    existingCallDate ? resolveDiscoveryCredit(existingCallDate, istTodayYmd()) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const url = token ? buildPublicUrl(`/app/${token}`) : null;

  const share = async () => {
    setBusy(true);
    setError("");
    try {
      const { shareDiscoveryApp } = await import("@/lib/server-actions/app-token");
      const out = await shareDiscoveryApp(clientId);
      if (!out.ok) throw new Error(out.error);
      setToken(out.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not share");
    } finally {
      setBusy(false);
    }
  };

  // "Which call was this?" — a FREE call is recorded without any credit; only
  // the PAID Foundation session sets discovery_call_date (reveals the Starting
  // Map + starts the 15-day ₹12,000 credit). See CallKindRecorder.
  const [earlierCall, setEarlierCall] = useState<{ kind: "free" | "triage"; date: string } | null>(null);
  const [foundationPaid, setFoundationPaid] = useState(false);
  const [triagePaidOn, setTriagePaidOn] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    import("@/lib/server-actions/discovery-followup")
      .then((m) => m.loadCallRecordAction(clientId))
      .then((r) => {
        if (!live) return;
        setFoundationPaid(r.foundationPaid);
        setTriagePaidOn(r.triagePaidOn);
        if ((r.kind === "free" || r.kind === "triage") && r.date) setEarlierCall({ kind: r.kind, date: r.date });
      })
      .catch(() => {/* the recorder still works without it */});
    return () => {
      live = false;
    };
  }, [clientId]);

  const copy = async () => {
    if (!url) return;
    try {
      await copyText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard denied */
    }
  };

  return (
    <FmPanel title="🌱 Discovery app" subtitle="Share reports + a starting map, with an upgrade path inside">
      {!token ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 13, color: "var(--fm-muted, #6f6a5d)" }}>
            For a consult-only client: opens the app so they can complete their intake and book their
            labs. Their Starting Map + the 15-day ₹12,000 credit appear only <strong>after you record
            their call as the paid Foundation session</strong> (a free call carries no credit). Same link
            upgrades to the full app when you publish their plan.
          </div>
          <button className="fm-btn" onClick={share} disabled={busy}>
            {busy ? "Sharing…" : "🌱 Share app (discovery stage)"}
          </button>
          {error && <div style={{ fontSize: 12.5, color: "#b3402a" }}>{error}</div>}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <code
            style={{ fontSize: 12, wordBreak: "break-all", background: "rgba(0,0,0,0.04)", borderRadius: 8, padding: "8px 10px" }}
          >
            {url}
          </code>
          {callDate ? (
            credit && <CreditChip credit={credit} />
          ) : (
            <div style={{ display: "grid", gap: 8, padding: "9px 11px", background: "var(--fm-surface)", border: "1px solid var(--fm-border-light, #e6e1d6)", borderRadius: 8 }}>
              {earlierCall && (
                <div style={{ fontSize: 12.5, color: "#2f7a3f" }}>
                  {earlierCall.kind === "triage"
                    ? `✓ Paid ₹999 short call on ${humanDate(earlierCall.date)} — their Foundation session is ₹11,001. `
                    : `✓ Free discovery call on ${humanDate(earlierCall.date)} — no credit. `}
                  Follow-up emails offer the Foundation session. When they have it, record it below.
                </div>
              )}
              <div style={{ fontSize: 12.5, color: "var(--fm-muted, #6f6a5d)", lineHeight: 1.45 }}>
                After the call, record which kind it was. Only the <strong>paid Foundation session</strong>{" "}
                reveals their Starting Map and starts the 15-day ₹12,000 credit in their app.
              </div>
              <CallKindRecorder
                clientId={clientId}
                clientName={displayName ?? undefined}
                foundationPaid={foundationPaid}
                triagePaidOn={triagePaidOn}
                onRecorded={(kind, date) => {
                  if (kind === "paid") {
                    setCallDate(date);
                    setCredit(resolveDiscoveryCredit(date, istTodayYmd()));
                  } else {
                    setEarlierCall({ kind, date });
                  }
                }}
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="fm-btn" onClick={copy}>
              {copied ? "✓ Copied" : "📋 Copy link"}
            </button>
            {mobileNumber && url && (
              <a
                className="fm-btn"
                href={buildWhatsappLink(mobileNumber, displayName ?? "", url)}
                target="_blank"
                rel="noreferrer"
              >
                💬 Share on WhatsApp
              </a>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--fm-muted, #6f6a5d)" }}>
            The link is stable — it becomes the full app the moment you publish a plan for this client.
          </div>
          {error && <div style={{ fontSize: 12.5, color: "#b3402a" }}>{error}</div>}
        </div>
      )}
    </FmPanel>
  );
}

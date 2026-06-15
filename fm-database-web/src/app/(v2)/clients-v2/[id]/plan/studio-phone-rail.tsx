"use client";

/**
 * StudioPhoneRail — the live phone preview lifted out of AppPreviewPanel
 * into the Plan studio's sticky right rail (2026-06-15 redesign).
 *
 * Collapsible (coach picked "pinned but collapsible"): collapsed it's a
 * slim vertical toggle so the editors get the full row; expanded it's the
 * real /app iframe. Loads the app token lazily on first expand so the
 * Plan page keeps today's zero eager-load cost. The iframe is keyed by
 * `version` so a bump from any app-preview edit remounts it with the
 * change applied — the "edits appear instantly" guarantee.
 */

import { useEffect, useState } from "react";
import { loadAppPreviewAction } from "@/lib/server-actions/app-preview";

export function StudioPhoneRail({
  clientId,
  open,
  onToggle,
  version,
  onRefresh,
}: {
  clientId: string;
  open: boolean;
  onToggle: () => void;
  version: number;
  onRefresh: () => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [access, setAccess] = useState<{
    lastOpenedAt: string | null;
    openCount: number;
    installed: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Lazy-load the token on first expand.
  useEffect(() => {
    if (!open || token || busy) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    loadAppPreviewAction(clientId)
      .then((out) => {
        if (cancelled) return;
        if (out.ok) {
          setToken(out.token);
          setAccess(out.access);
        } else {
          setError(out.error);
        }
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "load failed"))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
    // `busy` is intentionally NOT a dep: including it makes the effect
    // re-run the instant we setBusy(true), whose cleanup cancels the
    // in-flight load → stuck on "Loading…". Guard above still reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token, clientId]);

  if (!open) {
    return (
      <button
        type="button"
        className="fm-phone-toggle"
        onClick={onToggle}
        style={{
          flexDirection: "column",
          gap: 8,
          padding: "14px 8px",
          width: 44,
          writingMode: "vertical-rl",
          fontSize: 11.5,
          letterSpacing: 0.4,
        }}
        title="Show the live client app preview"
      >
        <span style={{ writingMode: "horizontal-tb", fontSize: 16 }}>📱</span>
        Show live preview
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          fontWeight: 700,
          color: "var(--fm-text-tertiary)",
        }}
      >
        👁 What the client sees
        <button
          type="button"
          className="fm-phone-toggle"
          onClick={onToggle}
          style={{ marginLeft: "auto", padding: "4px 9px", fontSize: 11 }}
          title="Collapse the preview"
        >
          Hide ▸
        </button>
      </div>

      {/* App-access meta (the "📱 App opened …" line from the design strip) */}
      {access && (
        <div
          style={{
            fontSize: 11.5,
            color: access.lastOpenedAt ? "#3d6b4f" : "var(--fm-text-tertiary)",
            background: access.lastOpenedAt ? "rgba(61,107,79,0.08)" : "var(--fm-bg-cool)",
            border: "1px solid var(--fm-border-light)",
            borderRadius: "var(--fm-radius-md)",
            padding: "6px 10px",
            lineHeight: 1.4,
          }}
        >
          {access.lastOpenedAt ? (
            <>
              📲 Opened{" "}
              <b>
                {new Date(access.lastOpenedAt).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </b>
              {access.openCount > 0 ? ` · ${access.openCount} open${access.openCount === 1 ? "" : "s"}` : ""}
              {access.installed ? " · ✓ installed" : ""}
            </>
          ) : (
            "📲 Not opened yet"
          )}
        </div>
      )}

      {error && (
        <div style={{ color: "#c0392b", fontSize: 12 }}>{error}</div>
      )}

      {busy && !token && (
        <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>
          Loading the client&apos;s app…
        </div>
      )}

      {token && (
        <>
          <div
            style={{
              borderRadius: 36,
              border: "10px solid #2c2a26",
              boxShadow: "0 12px 40px rgba(38,34,25,0.25)",
              overflow: "hidden",
              width: 375,
              maxWidth: "100%",
              background: "#faf9f7",
            }}
          >
            <iframe
              key={version}
              src={`/app/${token}`}
              title="Live client app preview"
              style={{ width: 375, height: 680, border: 0, display: "block", maxWidth: "100%" }}
            />
          </div>
          <button
            type="button"
            className="fm-phone-toggle"
            onClick={onRefresh}
            style={{ alignSelf: "center", padding: "5px 12px", fontSize: 11.5 }}
            title="Reload the live preview"
          >
            🔄 Refresh preview
          </button>
          <div style={{ textAlign: "center", fontSize: 10.5, color: "var(--fm-text-tertiary)" }}>
            Live — the client&apos;s actual app. Edits on the left appear here.
          </div>
        </>
      )}
    </div>
  );
}

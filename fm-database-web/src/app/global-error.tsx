"use client";

/**
 * Root error boundary. Without this, any uncaught render error in a Server
 * Component or layout would blank the page. Renders a minimal fallback with
 * the error message + a Reset button so the coach can recover without
 * restarting PM2.
 *
 * Also auto-recovers from stale-chunk errors after a deploy (same dance
 * the per-client-page error boundary does).
 */
import { useEffect, useState } from "react";
import { isChunkLoadError as detectChunkError, maybeReloadForChunkError } from "@/lib/chunk-reload";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isChunkLoadError = detectChunkError(error.message || "");
  const [autoReloadAttempted, setAutoReloadAttempted] = useState(false);
  useEffect(() => {
    if (!isChunkLoadError) return;
    // "suppressed" means we already reloaded within the cooldown and it's
    // STILL failing → genuinely broken build; show the error UI instead.
    if (maybeReloadForChunkError() === "suppressed") setAutoReloadAttempted(true);
  }, [isChunkLoadError]);

  if (isChunkLoadError && !autoReloadAttempted) {
    return (
      <html>
        <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, color: "#666", textAlign: "center" }}>
          New build detected — reloading…
        </body>
      </html>
    );
  }

  return (
    <html>
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32, color: "#1a1a1a" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Something went wrong</h1>
        <p style={{ fontSize: 14, color: "#555", marginBottom: 12 }}>
          {error.message || "An unexpected error blanked the page."}
        </p>
        {error.digest && (
          <p style={{ fontSize: 11, color: "#888", marginBottom: 16 }}>
            Error ID: <code>{error.digest}</code>
          </p>
        )}
        <button
          onClick={reset}
          style={{
            padding: "8px 14px",
            background: "#059669",
            color: "white",
            border: 0,
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}

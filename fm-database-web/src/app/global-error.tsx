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

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const msg = error.message || "";
  const isChunkLoadError =
    /Failed to load chunk|Loading chunk \d+ failed|ChunkLoadError|fetch dynamically imported module/i.test(msg);
  const [autoReloadAttempted, setAutoReloadAttempted] = useState(false);
  useEffect(() => {
    if (!isChunkLoadError || typeof window === "undefined") return;
    const key = "fm-chunk-reload-attempted";
    if (window.sessionStorage.getItem(key)) {
      setAutoReloadAttempted(true);
      return;
    }
    window.sessionStorage.setItem(key, "1");
    window.location.reload();
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

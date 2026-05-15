"use client";

/**
 * Per-client-page error boundary. A broken widget (e.g. functional-test parse
 * returns an unexpected shape, intake-insights card chokes on a stale field)
 * now isolates to a recoverable banner instead of blanking the entire client
 * view. Reset reruns the segment without a full reload.
 */
import { useEffect, useState } from "react";

export default function ClientPageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Stale-chunk auto-recovery. When we ship a new build, browsers that
  // still have an open tab from the old build keep asking for chunks
  // whose hashes have moved. The fetch fails → boundary fires → coach
  // sees a "couldn't render" card. Detect that specific error and
  // hard-reload once (with a session-storage guard so we never loop).
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
      <div style={{ padding: 24, textAlign: "center", color: "#666", fontSize: 13 }}>
        New build detected — reloading…
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <div
        style={{
          border: "1px solid #fecaca",
          background: "#fef2f2",
          padding: 16,
          borderRadius: 8,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#991b1b", margin: "0 0 8px" }}>
          This page couldn&apos;t render
        </h2>
        <p style={{ fontSize: 13, color: "#7f1d1d", margin: "0 0 8px" }}>
          {error.message || "An unexpected error broke the client view."}
        </p>
        {error.digest && (
          <p style={{ fontSize: 11, color: "#a83a3a", margin: "0 0 12px" }}>
            Error ID: <code>{error.digest}</code>
          </p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={reset}
            style={{
              padding: "6px 12px",
              background: "#059669",
              color: "white",
              border: 0,
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload this page
          </button>
          <a
            href="/clients-v2"
            style={{
              padding: "6px 12px",
              background: "white",
              color: "#444",
              border: "1px solid #d1d5db",
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
              alignSelf: "center",
            }}
          >
            ← All clients
          </a>
        </div>
      </div>
    </div>
  );
}

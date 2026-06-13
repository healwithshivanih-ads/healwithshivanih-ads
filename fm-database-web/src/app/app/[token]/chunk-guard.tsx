"use client";

/**
 * Catches stale-chunk failures that happen OUTSIDE React render — the App
 * Router prefetching / lazy-loading a chunk in the background of a tab that
 * was left open across a deploy. Those surface as window 'error' (failed
 * <script>) or 'unhandledrejection' (rejected dynamic import), neither of
 * which reaches the render error boundary. One cooldown-guarded reload pulls
 * the current build. Renders nothing.
 */
import { useEffect } from "react";
import { isChunkLoadError, maybeReloadForChunkError } from "@/lib/chunk-reload";

export default function ChunkGuard() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const t = e.target as HTMLScriptElement | null;
      const isChunkScript =
        !!t &&
        t.tagName === "SCRIPT" &&
        /\/_next\/static\/chunks\//.test(t.src || "");
      if (isChunkScript || isChunkLoadError(e.message) || isChunkLoadError(e.error)) {
        maybeReloadForChunkError();
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) maybeReloadForChunkError();
    };
    // capture=true: resource (script) load errors only reach window in the
    // capture phase — they don't bubble.
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

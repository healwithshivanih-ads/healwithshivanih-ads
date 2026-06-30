"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Fix F22 2026-05-23 — the letter iframe used to be position: fixed;
 * height: 100vh. The actual letter body is 5-12K px tall (12-week meal
 * plan with weekly tables). Inner-iframe scroll worked but felt broken
 * on mobile (no momentum, conflicts with browser chrome auto-hide).
 *
 * Now: iframe sizes to its content via a ResizeObserver on the inner
 * document. Outer page becomes the scroll surface, so mobile scroll
 * is native + momentum-y and the URL bar auto-hides cleanly.
 *
 * Brand CSS still isolated because we keep the srcDoc iframe (the
 * letter HTML is a complete standalone document from brand_html.py).
 */
export function AutoSizedLetterIframe({ srcDoc }: { srcDoc: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState<number>(800);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    const measure = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      // Use scrollHeight from documentElement so margins on body don't
      // produce phantom whitespace below the letter.
      const h = Math.max(
        doc.documentElement.scrollHeight,
        doc.body?.scrollHeight ?? 0,
      );
      // Add a small bottom padding (16px) so the print footer never
      // sits flush against the viewport edge on mobile.
      setHeight(h + 16);
    };

    // Initial measure once iframe document is parsed.
    const onLoad = () => {
      measure();
      // Watch for font load + image load reflows. ResizeObserver on
      // body keeps the iframe sized through any post-load reflow
      // (web fonts, lazy images, etc).
      const doc = iframe.contentDocument;
      if (doc?.body && typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => measure());
        ro.observe(doc.body);
        // Stash on iframe for cleanup
        (iframe as unknown as { __ro?: ResizeObserver }).__ro = ro;
      }
    };
    iframe.addEventListener("load", onLoad);

    // If load already fired (cached srcDoc), measure now.
    if (iframe.contentDocument?.readyState === "complete") measure();

    return () => {
      iframe.removeEventListener("load", onLoad);
      const ro = (iframe as unknown as { __ro?: ResizeObserver }).__ro;
      ro?.disconnect();
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      title="Your healing plan"
      srcDoc={srcDoc}
      // Hardening: the letter HTML is first-party (brand_html.py), but sandbox
      // the frame anyway. allow-same-origin → the ResizeObserver can read the
      // inner doc to size it; allow-scripts → the per-week / supplement print
      // buttons run; allow-modals → window.print(); allow-popups(+escape) → buy
      // links open as normal tabs. Deliberately NOT granted: top-navigation and
      // forms — so a letter can never redirect the parent page or submit anywhere.
      sandbox="allow-same-origin allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox"
      style={{
        display: "block",
        width: "100%",
        height,
        border: 0,
        // Letter has its own background; outer page is transparent.
        background: "transparent",
      }}
    />
  );
}

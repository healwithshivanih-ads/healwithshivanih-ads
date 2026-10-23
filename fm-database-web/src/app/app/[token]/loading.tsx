/**
 * Instant loading shell for /app/<token>.
 *
 * The page assembles the client's whole plan on the server before any HTML can
 * arrive, so without this the phone showed a blank white screen for the length
 * of that render. Next streams this skeleton immediately (loading.tsx wraps the
 * page in a Suspense boundary) and swaps the real app in when it is ready.
 *
 * Deliberately a SERVER component with no imports: it must not pull in the
 * client bundle (ochre-app.tsx and friends) — its whole job is to be on screen
 * before that bundle has even been requested. Palette comes from the
 * `.ochre-app` tokens in app.css, which the /app layout already loads; the
 * blocks are inline-styled so nothing here depends on app-screen classes.
 */

const block = (h: number, extra?: React.CSSProperties): React.CSSProperties => ({
  height: h,
  borderRadius: 16,
  background: "var(--paper-2, #f4efe6)",
  animation: "ochre-skel-pulse 1.4s ease-in-out infinite",
  ...extra,
});

export default function ClientAppLoading() {
  return (
    <div className="ochre-app sequoya">
      <style>{`@keyframes ochre-skel-pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }`}</style>
      <div
        className="app"
        aria-busy="true"
        aria-label="Opening your plan"
        style={{ background: "var(--paper, #faf9f7)" }}
      >
        {/* header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "calc(env(safe-area-inset-top, 0px) + 16px) 20px 14px",
            borderBottom: "1px solid var(--line, rgba(38,34,25,0.09))",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={block(12, { width: 92, borderRadius: 6 })} />
            <div style={block(22, { width: 168, borderRadius: 8 })} />
          </div>
          <div style={block(36, { width: 36, borderRadius: 999 })} />
        </div>
        {/* cards */}
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={block(120)} />
          <div style={block(76)} />
          <div style={block(76)} />
          <div style={block(140)} />
        </div>
        <p
          style={{
            margin: "auto 0 0",
            padding: "0 20px calc(env(safe-area-inset-bottom, 0px) + 22px)",
            textAlign: "center",
            fontSize: 13,
            color: "var(--muted, #5b5648)",
          }}
        >
          Opening your plan…
        </p>
      </div>
    </div>
  );
}

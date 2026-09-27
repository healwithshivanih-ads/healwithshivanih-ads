/**
 * Sequoya brand atoms — the "After the fire" palette, the inlined logo, and the
 * small "Founding member" mark used in the client app.
 *
 *   Ash #F5F0EB (page) · Charcoal #2A292D (text) · Fireweed #C94A77 (accent)
 *   New growth #7FA66B · Cedar #A0673F
 *   Fraunces (headlines, italic accents) + Instrument Sans (body)
 *
 * Fonts load through a React-19-hoisted <link> only where these atoms render,
 * so the rest of the app never pays for them.
 */

import { SEQUOYA_RING_MARK_SVG, SEQUOYA_WORDMARK_SVG } from "./sequoya-logo-svg";

export const SEQUOYA = {
  ash: "#F5F0EB",
  charcoal: "#2A292D",
  fireweed: "#C94A77",
  growth: "#7FA66B",
  cedar: "#A0673F",
  serif: "'Fraunces', Georgia, 'Times New Roman', serif",
  sans: "'Instrument Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const;

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400;1,9..144,500&family=Instrument+Sans:wght@400;500;600&display=swap";

export function SequoyaFonts() {
  // React 19 hoists + dedupes a stylesheet <link> that carries `precedence`.
  return <link rel="stylesheet" href={FONTS_HREF} precedence="default" />;
}

export function SequoyaWordmark({ width = 180 }: { width?: number }) {
  return (
    <span
      role="img"
      aria-label="Sequoya"
      style={{ display: "block", width, aspectRatio: "390.9 / 119" }}
      // Static, first-party artwork (generated from the brand SVG) — not user input.
      dangerouslySetInnerHTML={{ __html: SEQUOYA_WORDMARK_SVG }}
    />
  );
}

export function SequoyaRingMark({ size = 20 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-block", width: size, height: size, flex: "none" }}
      dangerouslySetInnerHTML={{ __html: SEQUOYA_RING_MARK_SVG }}
    />
  );
}

/**
 * The quiet "Founding member" mark for a founding client's app. Warm, small,
 * never loud — it sits beside the greeting on Today and under the tree on
 * Progress. Carries no price, no rate, no number.
 */
export function FoundingMemberMark({ variant = "pill" }: { variant?: "pill" | "line" }) {
  if (variant === "line") {
    return (
      <div
        className="founding-mark-line"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          marginTop: 8,
          fontFamily: SEQUOYA.serif,
          fontStyle: "italic",
          fontSize: 13.5,
          color: SEQUOYA.cedar,
        }}
      >
        <SequoyaFonts />
        <SequoyaRingMark size={18} />
        <span>A founding member of Sequoya — this tree was among the first twenty planted.</span>
      </div>
    );
  }
  return (
    <span
      className="founding-mark"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px 3px 5px",
        borderRadius: 999,
        background: "rgba(201, 74, 119, 0.08)",
        border: "1px solid rgba(201, 74, 119, 0.22)",
        color: SEQUOYA.charcoal,
        fontFamily: SEQUOYA.serif,
        fontStyle: "italic",
        fontSize: 12.5,
        lineHeight: 1.3,
        whiteSpace: "nowrap",
      }}
    >
      <SequoyaFonts />
      <SequoyaRingMark size={16} />
      Founding member
    </span>
  );
}

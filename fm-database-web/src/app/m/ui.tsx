/**
 * Shared visual tokens + small primitives for the coach mobile app.
 *
 * Plain inline styles rather than Tailwind: /m renders inside a fixed overlay
 * that sits on top of the root layout, and keeping its styling self-contained
 * means a future change to the coach-UI design system can't reflow the phone
 * app underneath the coach.
 */
import Link from "next/link";

export const C = {
  ink: "#2B2D42",
  body: "#4A4540",
  muted: "#8A857F",
  line: "#E4DFD6",
  card: "#FFFFFF",
  bg: "#F7F4EF",
  ochre: "#B85C3E",
  good: "#2E6B45",
  goodBg: "#E8F3EC",
  warn: "#8A6B2F",
  warnBg: "#FBF3E2",
  bad: "#8A2F2F",
  badBg: "#FDECEC",
} as const;

export const serif = "var(--font-libre-baskerville), Georgia, serif";

export function Panel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 12,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: C.muted,
        margin: "20px 2px 8px",
        fontWeight: 600,
      }}
    >
      {children}
    </h2>
  );
}

export function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const map = {
    neutral: { bg: "#F1EEE8", fg: C.body },
    good: { bg: C.goodBg, fg: C.good },
    warn: { bg: C.warnBg, fg: C.warn },
    bad: { bg: C.badBg, fg: C.bad },
  }[tone];
  return (
    <span
      style={{
        background: map.bg,
        color: map.fg,
        borderRadius: 999,
        padding: "3px 9px",
        fontSize: 12,
        fontWeight: 500,
        // NOT nowrap. Real condition names run long ("Anxiety + Depression (on
        // long-term SSRI + benzo, 20 yrs)") and nowrap pushed them past the
        // viewport edge, silently clipping the text on a 375px screen.
        maxWidth: "100%",
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </span>
  );
}

/** Empty states say WHY, never just "nothing here" — an empty client list on a
 *  misconfigured host would otherwise read as "you have no clients". */
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <Panel style={{ textAlign: "center", padding: 24 }}>
      <div style={{ color: C.body, fontSize: 15, marginBottom: detail ? 6 : 0 }}>{title}</div>
      {detail ? (
        <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.5 }}>{detail}</div>
      ) : null}
    </Panel>
  );
}

/** 44px minimum touch target — Apple's HIG floor; smaller is a mis-tap. */
export const actionBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 44,
  minHeight: 44,
  borderRadius: 11,
  border: `1px solid ${C.line}`,
  background: "#fff",
  color: C.body,
  fontSize: 18,
  textDecoration: "none",
  flex: 1,
};

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} style={{ fontSize: 15, color: C.muted, textDecoration: "none" }}>
      ← {label}
    </Link>
  );
}

/** "3 days ago" — relative time is what the coach actually reasons about. */
export function ago(iso?: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 0) return `in ${Math.abs(days)}d`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 31) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

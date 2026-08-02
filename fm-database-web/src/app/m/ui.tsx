/**
 * Primitives for the coach mobile app, built on the COACH DASHBOARD design
 * system (src/styles/fm-v2.css) via coach.css — same palette, type scale and
 * chip tones the coach already reads all day, at phone density.
 *
 * Icons are Lucide paths at 1.5px stroke in currentColor, inlined rather than
 * pulled from a package: a dozen icons do not justify a dependency, and
 * inlining keeps them tintable with no runtime.
 */
import Link from "next/link";

/* ── Icons ──────────────────────────────────────────────────────────── */

const PATHS: Record<string, React.ReactNode> = {
  // message-circle — personal WhatsApp (opens the app)
  message: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  // send — business number, via our own server
  send: <><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></>,
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2z" />,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
  back: <path d="m15 18-6-6 6-6" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  alert: <><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  key: <><circle cx="7.5" cy="15.5" r="4.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></>,
  external: <><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M21 14v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" /></>,
  // smartphone — "open what they see on their phone"
  phoneApp: <><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 18h.01" /></>,
  note: <><path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z" /><path d="M15 3v6h6" /></>,
};

export function Icon({
  name,
  size = "md",
  className = "",
}: {
  name: keyof typeof PATHS | string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const cls = `m-ico${size === "sm" ? " m-ico--sm" : size === "lg" ? " m-ico--lg" : ""} ${className}`;
  return (
    <svg viewBox="0 0 24 24" className={cls} aria-hidden="true" focusable="false">
      {PATHS[name] ?? null}
    </svg>
  );
}

/* ── Primitives ─────────────────────────────────────────────────────── */

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="m-eyebrow">{children}</div>;
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`m-card ${className}`}>{children}</div>;
}

export type Tone = "primary" | "success" | "warning" | "danger";

export function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <span className={`m-chip${tone ? ` m-chip--${tone}` : ""}`}>{children}</span>
  );
}

/** Initials, not a photo — projecting client photos would push image data
 *  onto the public box for no clinical gain. */
export function Avatar({ name, prospect }: { name: string; prospect?: boolean }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className={`m-avatar${prospect ? " m-avatar--prospect" : ""}`} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

/** Empty states say WHY. An empty client list on a misconfigured host would
 *  otherwise read as "you have no clients". */
export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card>
      <div style={{ fontSize: "var(--fm-text-md)" }}>{title}</div>
      {detail ? (
        <p className="m-subtle" style={{ margin: "6px 0 0", lineHeight: 1.55 }}>
          {detail}
        </p>
      ) : null}
    </Card>
  );
}

export function Note({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: Tone;
}) {
  return <div className={`m-note${tone ? ` m-note--${tone}` : ""}`}>{children}</div>;
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="m-subtle"
      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      <Icon name="back" size="sm" />
      {label}
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

/** Meta wants E.164 without punctuation; Indian mobiles are stored various
 *  ways, so normalise a bare 10-digit number to +91. */
export function waNumber(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

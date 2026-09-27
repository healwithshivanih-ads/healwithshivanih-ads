/**
 * The gifted Foundation session page (Sequoya "Founding 20").
 *
 * Shown in place of the pay step when a founding member gifted this person
 * their Foundation session. Same next steps as a paid client — intake form,
 * then book the first call — with NO price anywhere and no Razorpay order.
 * Sequoya "After the fire" styling; a full-screen layer over the Ochre Tree
 * foundation layout so the brand reads as one.
 */

import { SEQUOYA, SequoyaFonts, SequoyaWordmark } from "@/components/sequoya/sequoya-brand";

function longDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const card: React.CSSProperties = {
  background: "#FFFDFA",
  border: "1px solid rgba(42, 41, 45, 0.10)",
  borderRadius: 18,
  padding: "20px 20px",
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <span
          style={{
            flex: "none",
            width: 30,
            height: 30,
            borderRadius: 999,
            background: SEQUOYA.fireweed,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: SEQUOYA.serif,
            fontSize: 15,
          }}
        >
          {n}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0, fontFamily: SEQUOYA.serif, fontWeight: 600, fontSize: 18, color: SEQUOYA.charcoal }}>
            {title}
          </h3>
          {children}
        </div>
      </div>
    </div>
  );
}

const button: React.CSSProperties = {
  display: "inline-block",
  marginTop: 12,
  padding: "11px 20px",
  borderRadius: 999,
  background: SEQUOYA.fireweed,
  color: "#fff",
  fontWeight: 600,
  fontSize: 15,
  textDecoration: "none",
};

export function GiftView({
  firstName,
  byFirstName,
  expiresOn,
  expired,
  intakePath,
  intakeSubmitted,
  bookingUrl,
}: {
  firstName: string;
  byFirstName: string;
  expiresOn: string;
  expired: boolean;
  intakePath: string | null;
  intakeSubmitted: boolean;
  bookingUrl: string;
}) {
  const body: React.CSSProperties = {
    margin: "6px 0 0",
    fontSize: 15,
    lineHeight: 1.6,
    color: "rgba(42, 41, 45, 0.78)",
  };
  return (
    <div
      className="sequoya-gift"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        overflow: "auto",
        background: SEQUOYA.ash,
        color: SEQUOYA.charcoal,
        fontFamily: SEQUOYA.sans,
      }}
    >
      <SequoyaFonts />
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "36px 16px 56px" }}>
        <header style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <SequoyaWordmark width={170} />
          <div style={{ fontFamily: SEQUOYA.serif, fontStyle: "italic", fontSize: 14, color: SEQUOYA.cedar }}>
            by Shivani Hari
          </div>
        </header>

        <section style={{ marginTop: 34, textAlign: "center" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: SEQUOYA.fireweed,
            }}
          >
            A gift for you, {firstName}
          </div>
          <h1
            style={{
              margin: "10px 0 0",
              fontFamily: SEQUOYA.serif,
              fontWeight: 400,
              fontSize: "clamp(28px, 7vw, 38px)",
              lineHeight: 1.15,
              color: SEQUOYA.charcoal,
            }}
          >
            A Foundation session, gifted to you by <em style={{ color: SEQUOYA.fireweed }}>{byFirstName}</em>
          </h1>
          <p style={{ ...body, marginTop: 14 }}>
            {byFirstName}{" "}is one of the founding members of Sequoya, and chose you. It&apos;s a proper first
            look at your health, over two calls: your full story first, then a review of your labs — so
            you leave knowing what&apos;s going on and where to begin.
          </p>
        </section>

        {expired ? (
          <div style={{ ...card, marginTop: 28, textAlign: "center" }}>
            <h2 style={{ margin: 0, fontFamily: SEQUOYA.serif, fontWeight: 600, fontSize: 19 }}>
              This gift was for use by {longDate(expiresOn)}
            </h2>
            <p style={body}>
              That date has passed. If you&apos;d still like to talk, message Shivani — she&apos;d be glad to
              hear from you.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14, marginTop: 28 }}>
            <Step n={1} title="Tell me your story">
              <p style={body}>
                A health form, at your own pace. It lets Shivani prepare properly before you talk.
              </p>
              {intakeSubmitted ? (
                <p style={{ ...body, color: SEQUOYA.growth, fontWeight: 600 }}>✓ Received — thank you.</p>
              ) : intakePath ? (
                <a href={intakePath} style={button}>
                  Open my health form →
                </a>
              ) : (
                <p style={body}>Your form link is on its way — Shivani will send it shortly.</p>
              )}
            </Step>
            <Step n={2} title="Book your first call">
              <p style={body}>Pick a time that suits you. We&apos;ll arrange the lab review together after it.</p>
              <a
                href={bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...button, background: "transparent", color: SEQUOYA.fireweed, border: `1.5px solid ${SEQUOYA.fireweed}` }}
              >
                Choose a time →
              </a>
            </Step>
            <p style={{ ...body, textAlign: "center", fontSize: 13.5, marginTop: 4 }}>
              Please use your gift by {longDate(expiresOn)}.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

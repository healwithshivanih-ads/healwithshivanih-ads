"use client";

/**
 * Guided-tier screens — the Coach tab for self-guided subscribers.
 *
 * A guided subscriber has NO live coach relationship: no WhatsApp, no chat,
 * no weekly check-in review. This screen says so honestly, carries the
 * monthly live session, and holds the one upgrade path (the assessment).
 *
 * Anti-steering note (matters when this ships inside the Play build): the
 * assessment is a 1:1 person-to-person service, which both stores permit
 * paying for outside the app. The copy still never mentions prices of other
 * channels or "cheaper elsewhere" — it links out, neutrally.
 */

import { Accordion, Section } from "./ochre-ui";
import { Icon, useOchre } from "./ochre-context";

/** Where "Book an assessment" goes. Env-configurable so web + (later) Play
 *  builds can point at the right surface without a code change. */
const ASSESSMENT_URL =
  process.env.NEXT_PUBLIC_GUIDED_ASSESSMENT_URL || "https://www.theochretree.com";

export function GuidedCoachScreen() {
  const data = useOchre();
  return (
    <div className="screen-pad screen-anim">
      <div className="greeting">
        <div className="hi">Your programme, and what&apos;s beyond it</div>
        <div className="date script">Guided · self-paced</div>
      </div>

      <Section title="The monthly live session">
        <div className="card" style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 14.2, lineHeight: 1.6 }}>
            Once a month, Shivani takes questions live — any programme, any week.
            The invite arrives by email a few days before.
          </div>
          <div style={{ fontSize: 12.8, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
            It&apos;s the one place your questions reach a human — use it.
          </div>
        </div>
      </Section>

      <Section title="Want it built around you?">
        <div className="card" style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 14.2, lineHeight: 1.6 }}>
            You&apos;re running the standard programme — the same phases for everyone.
            The assessment is where it becomes yours: your history, your medications,
            your labs, read properly, and a version built to fit.
          </div>
          <a
            href={ASSESSMENT_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              textAlign: "center",
              marginTop: 12,
              padding: "12px 16px",
              borderRadius: 999,
              background: "var(--forest)",
              color: "#fff",
              fontSize: 14.5,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Book an assessment
          </a>
          <div style={{ fontSize: 12.2, color: "var(--muted)", marginTop: 9, lineHeight: 1.5, textAlign: "center" }}>
            Finished a round and plateaued? That&apos;s exactly the moment this is for.
          </div>
        </div>
      </Section>

      <Section title="Programme support">
        <div className="card-quiet soon">
          <Icon name="message" size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span>
            Stuck on something in the app, or a payment question? Write to{" "}
            <strong>hello@theochretree.com</strong> — replies within a working day.
          </span>
        </div>
      </Section>

      {data.faq.length > 0 && (
        <Section title="Common questions">
          <Accordion items={data.faq} />
        </Section>
      )}

      {data.guidedWeekly && (
        <div className="card-quiet soon" style={{ marginTop: 14 }}>
          <Icon name="dot" size={10} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <span>{data.guidedWeekly.standardNote}</span>
        </div>
      )}
    </div>
  );
}

/**
 * /m/clients/[id] — the client card.
 *
 * "Basic info easily available", per the original ask. A SOAP note answers
 * *what happened in that session*; this answers *who is this and where are
 * we* — what you need in the ten seconds before a call. Session detail sits
 * below, one scroll down.
 */
import { notFound } from "next/navigation";
import { loadCoachCard } from "@/lib/fmdb/coach-mobile";
import {
  Avatar,
  BackLink,
  Card,
  Chip,
  Eyebrow,
  Icon,
  Note,
  ago,
  waNumber,
} from "../../../ui";
import { AskPanel } from "./ask";

export const dynamic = "force-dynamic";

function Facts({ label, items }: { label: string; items?: unknown }) {
  const arr = Array.isArray(items) ? items.filter(Boolean).map(String) : [];
  if (!arr.length) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="m-label">{label}</div>
      <div className="m-chips">
        {arr.map((v, i) => (
          <Chip key={`${v}-${i}`}>{v}</Chip>
        ))}
      </div>
    </div>
  );
}

export default async function ClientCard({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ noted?: string; sent?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const card = loadCoachCard(id);
  if (!card) notFound();

  const g = card.glance as Record<string, unknown>;
  const name = String(g.display_name ?? card.id);
  const mobile = g.mobile_number ? String(g.mobile_number) : null;
  const email = g.email ? String(g.email) : null;
  const wa = waNumber(mobile);
  const tel = mobile?.replace(/[^\d+]/g, "");
  const allergies = (g.known_allergies as string[]) ?? [];

  return (
    <main className="m-page">
      <BackLink href="/m/clients" label="Clients" />

      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "16px 0 0" }}>
        <Avatar name={name} prospect={card.kind === "prospect"} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: "var(--fm-text-xl)" }}>{name}</h1>
          <div className="m-subtle">
            {[g.sex, g.age_band, g.city].filter(Boolean).join(" · ") || card.kind}
          </div>
        </div>
      </div>

      <div className="m-row" style={{ marginTop: 16 }}>
        {wa ? (
          <a className="m-iconbtn" href={`https://wa.me/${wa}`} aria-label="WhatsApp">
            <Icon name="message" />
          </a>
        ) : null}
        {tel ? (
          <a className="m-iconbtn" href={`tel:${tel}`} aria-label="Call">
            <Icon name="phone" />
          </a>
        ) : null}
        {email ? (
          <a className="m-iconbtn" href={`mailto:${email}`} aria-label="Email">
            <Icon name="mail" />
          </a>
        ) : null}
        {wa ? (
          <a className="m-iconbtn" href="#send" aria-label="Send from business number">
            <Icon name="send" />
          </a>
        ) : null}
      </div>

      {sp.noted ? (
        <div style={{ marginTop: 16 }}>
          <Note tone="success">Note saved. It reaches the full record on the next sync.</Note>
        </div>
      ) : null}
      {sp.sent ? (
        <div style={{ marginTop: 16 }}>
          <Note tone="success">WhatsApp sent.</Note>
        </div>
      ) : null}
      {sp.error ? (
        <div style={{ marginTop: 16 }}>
          <Note tone="danger">{decodeURIComponent(sp.error)}</Note>
        </div>
      ) : null}

      {/* Allergies lead: they're the thing that changes what you say. */}
      {allergies.length ? (
        <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "flex-start", color: "var(--fm-danger)" }}>
          <Icon name="alert" size="sm" />
          <div style={{ fontSize: "var(--fm-text-base)", color: "var(--fm-text-primary)" }}>
            <span className="m-em">Allergies</span> — {allergies.join(", ")}
          </div>
        </div>
      ) : null}

      <Eyebrow>At a glance</Eyebrow>
      <Card>
        <Facts label="Conditions" items={g.active_conditions} />
        <Facts label="Medications" items={g.current_medications} />
        <Facts label="Goals" items={g.goals} />
        <Facts label="History" items={g.medical_history} />
        <Facts label="Won't give up" items={g.non_negotiables} />
        <Facts label="Avoids" items={g.foods_to_avoid} />
        {g.dietary_preference ? (
          <div className="m-subtle">Diet — {String(g.dietary_preference)}</div>
        ) : null}
      </Card>

      <Eyebrow>Plan</Eyebrow>
      {card.plan ? (
        <Card>
          <div className="m-chips">
            <Chip tone={card.plan.status === "published" ? "success" : undefined}>
              {card.plan.status}
            </Chip>
            {card.plan.period_weeks ? <Chip>{card.plan.period_weeks} weeks</Chip> : null}
            <Chip>{card.plan.supplement_count ?? 0} supplements</Chip>
            <Chip>{card.plan.practice_count ?? 0} practices</Chip>
          </div>
          {card.plan.meal_plan_started_on ? (
            <div className="m-subtle" style={{ marginTop: 10 }}>
              Day 1 was {card.plan.meal_plan_started_on} · {ago(card.plan.meal_plan_started_on)}
            </div>
          ) : null}
        </Card>
      ) : (
        <Card>
          <span className="m-subtle">No plan yet.</span>
        </Card>
      )}

      <Eyebrow>Ask about {name.split(" ")[0]}</Eyebrow>
      <AskPanel clientId={card.id} clientName={name} />

      <Eyebrow>Quick note</Eyebrow>
      <form method="POST" action="/api/m/note">
        <input type="hidden" name="client_id" value={card.id} />
        <input type="hidden" name="next" value={`/m/clients/${card.id}`} />
        <textarea
          name="text"
          rows={3}
          required
          className="m-field"
          placeholder="What just happened — dictate it if easier"
          style={{ marginBottom: 12 }}
        />
        <button type="submit" className="fm-btn primary block">
          <Icon name="note" size="sm" />
          Save note
        </button>
      </form>

      {wa ? (
        <>
          <Eyebrow>
            <span id="send">Business WhatsApp</span>
          </Eyebrow>
          <form method="POST" action="/api/m/wa">
            <input type="hidden" name="client_id" value={card.id} />
            <input type="hidden" name="phone" value={wa} />
            <textarea
              name="text"
              rows={3}
              required
              className="m-field"
              placeholder="Message"
              style={{ marginBottom: 12 }}
            />
            <button type="submit" className="fm-btn block">
              <Icon name="send" size="sm" />
              Send from business number
            </button>
            <p className="m-subtle" style={{ marginTop: 10 }}>
              Sent from your business number and logged. Works only within 24
              hours of her last message — otherwise use an approved template
              from the desktop app.
            </p>
          </form>
        </>
      ) : null}

      {card.whatsapp.messages.length ? (
        <>
          <Eyebrow>Recent messages from her</Eyebrow>
          {card.whatsapp.messages.slice(0, 8).map((m, i) => (
            <Card key={i} className="m-stack" >
              <div className="m-subtle" style={{ fontSize: 11 }}>{m.at}</div>
              <div style={{ fontSize: "var(--fm-text-base)" }}>{m.text}</div>
            </Card>
          ))}
        </>
      ) : null}

      <Eyebrow>Sessions</Eyebrow>
      {card.sessions.length === 0 ? (
        <Card>
          <span className="m-subtle">No sessions recorded.</span>
        </Card>
      ) : (
        card.sessions.slice(0, 8).map((s) => (
          <Card key={s.id} className="m-stack" >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span className="m-em" style={{ fontSize: "var(--fm-text-base)" }}>
                {s.kind.replace(/_/g, " ")}
              </span>
              <span className="m-subtle" style={{ fontSize: 11 }}>{s.date}</span>
            </div>
            {s.complaints ? (
              <div style={{ fontSize: "var(--fm-text-base)" }}>{s.complaints.slice(0, 400)}</div>
            ) : null}
            {s.coach_notes ? (
              <div className="m-subtle" style={{ fontSize: "var(--fm-text-base)" }}>
                {s.coach_notes.slice(0, 300)}
              </div>
            ) : null}
          </Card>
        ))
      )}
    </main>
  );
}

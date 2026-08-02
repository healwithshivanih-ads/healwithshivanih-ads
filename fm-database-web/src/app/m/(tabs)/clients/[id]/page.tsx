/**
 * /m/clients/[id] — the client card.
 *
 * "Basic info easily available", per the original ask. A SOAP note answers
 * *what happened in that session*; this answers *who is this and where are we*
 * — which is what you need in the ten seconds before a call. Session detail
 * sits below, one scroll down.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCoachCard } from "@/lib/fmdb/coach-mobile";
import { C, Chip, Panel, SectionTitle, ago, serif, BackLink } from "../../../ui";
import { AskPanel } from "./ask";

export const dynamic = "force-dynamic";

function waNumber(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

function List({ label, items }: { label: string; items?: unknown }) {
  const arr = Array.isArray(items) ? items.filter(Boolean).map(String) : [];
  if (!arr.length) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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

  // Flags first — allergies and meds are the things that change what you say.
  const allergies = (g.known_allergies as string[]) ?? [];
  const meds = (g.current_medications as string[]) ?? [];

  return (
    <main style={{ padding: 16 }}>
      <BackLink href="/m/clients" label="Clients" />

      <h1 style={{ fontFamily: serif, fontSize: 25, color: C.ink, margin: "14px 0 4px" }}>
        {name}
      </h1>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
        {[g.sex, g.age_band, g.city].filter(Boolean).join(" · ") || card.kind}
        {card.staged_at ? ` · synced ${ago(card.staged_at) ?? ""}` : ""}
      </div>

      {sp.noted ? (
        <Panel style={{ background: C.goodBg, borderColor: "#B4D6C1" }}>
          <span style={{ color: C.good, fontSize: 14 }}>
            Note saved. It reaches the full record on the next sync.
          </span>
        </Panel>
      ) : null}
      {sp.sent ? (
        <Panel style={{ background: C.goodBg, borderColor: "#B4D6C1" }}>
          <span style={{ color: C.good, fontSize: 14 }}>WhatsApp sent.</span>
        </Panel>
      ) : null}
      {sp.error ? (
        <Panel style={{ background: C.badBg, borderColor: "#E9B8B8" }}>
          <span style={{ color: C.bad, fontSize: 14 }}>{decodeURIComponent(sp.error)}</span>
        </Panel>
      ) : null}

      {/* Contact row — the reason this app exists. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {wa ? (
          <a
            href={`https://wa.me/${wa}`}
            style={{ ...btn, background: "#25D366", color: "#fff", border: "none" }}
          >
            💬 WhatsApp
          </a>
        ) : null}
        {tel ? (
          <a href={`tel:${tel}`} style={btn}>
            📞 Call
          </a>
        ) : null}
        {email ? (
          <a href={`mailto:${email}`} style={btn}>
            ✉️ Email
          </a>
        ) : null}
      </div>

      {/* ── Glance ─────────────────────────────────────────────── */}
      <Panel>
        {allergies.length ? (
          <div
            style={{
              background: C.badBg,
              border: `1px solid #E9B8B8`,
              borderRadius: 10,
              padding: "8px 10px",
              marginBottom: 10,
            }}
          >
            <span style={{ color: C.bad, fontSize: 13, fontWeight: 600 }}>
              ⚠ Allergies: {allergies.join(", ")}
            </span>
          </div>
        ) : null}
        <List label="Conditions" items={g.active_conditions} />
        <List label="Medications" items={meds} />
        <List label="Goals" items={g.goals} />
        <List label="Past / history" items={g.medical_history} />
        <List label="Won't give up" items={g.non_negotiables} />
        <List label="Avoids" items={g.foods_to_avoid} />
        {g.dietary_preference ? (
          <div style={{ fontSize: 13, color: C.body }}>
            Diet: {String(g.dietary_preference)}
          </div>
        ) : null}
      </Panel>

      {/* ── Plan ───────────────────────────────────────────────── */}
      {card.plan ? (
        <Panel>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <Chip tone={card.plan.status === "published" ? "good" : "warn"}>
              {card.plan.status}
            </Chip>
            {card.plan.period_weeks ? <Chip>{card.plan.period_weeks} wks</Chip> : null}
            <Chip>{card.plan.supplement_count ?? 0} supplements</Chip>
            <Chip>{card.plan.practice_count ?? 0} practices</Chip>
          </div>
          {card.plan.meal_plan_started_on ? (
            <div style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>
              Day 1 was {card.plan.meal_plan_started_on} ({ago(card.plan.meal_plan_started_on)})
            </div>
          ) : null}
        </Panel>
      ) : (
        <Panel>
          <span style={{ fontSize: 14, color: C.muted }}>No plan yet.</span>
        </Panel>
      )}

      {/* ── Ask AI ─────────────────────────────────────────────── */}
      <SectionTitle>Ask about {name.split(" ")[0]}</SectionTitle>
      <AskPanel clientId={card.id} clientName={name} />

      {/* ── Quick note ─────────────────────────────────────────── */}
      <SectionTitle>Quick note</SectionTitle>
      <form method="POST" action="/api/m/note">
        <input type="hidden" name="client_id" value={card.id} />
        <input type="hidden" name="next" value={`/m/clients/${card.id}`} />
        <textarea
          name="text"
          rows={3}
          required
          placeholder="What just happened — dictate it if easier."
          style={{
            width: "100%",
            fontSize: 16,
            padding: "11px 13px",
            borderRadius: 11,
            border: `1px solid ${C.line}`,
            background: "#fff",
            marginBottom: 8,
            fontFamily: "inherit",
          }}
        />
        <button type="submit" style={{ ...btn, background: C.ink, color: "#fff", border: "none" }}>
          Save note
        </button>
      </form>

      {/* ── Business WhatsApp ──────────────────────────────────── */}
      {wa ? (
        <>
          <SectionTitle>
            <span id="send">Send from business WhatsApp</span>
          </SectionTitle>
          <form method="POST" action="/api/m/wa">
            <input type="hidden" name="client_id" value={card.id} />
            <input type="hidden" name="phone" value={wa} />
            <textarea
              name="text"
              rows={3}
              required
              placeholder="Message…"
              style={{
                width: "100%",
                fontSize: 16,
                padding: "11px 13px",
                borderRadius: 11,
                border: `1px solid ${C.line}`,
                background: "#fff",
                marginBottom: 8,
                fontFamily: "inherit",
              }}
            />
            <button type="submit" style={btn}>
              Send via business number
            </button>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
              Goes from your business number and is logged. Only works inside 24h
              of her last message — otherwise use an approved template from the
              desktop app.
            </div>
          </form>
        </>
      ) : null}

      {/* ── Recent activity ────────────────────────────────────── */}
      {card.whatsapp.messages.length ? (
        <>
          <SectionTitle>Recent messages from her</SectionTitle>
          {card.whatsapp.messages.slice(0, 8).map((m, i) => (
            <Panel key={i} style={{ padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>{m.at}</div>
              <div style={{ fontSize: 14, color: C.body, lineHeight: 1.5 }}>{m.text}</div>
            </Panel>
          ))}
        </>
      ) : null}

      <SectionTitle>Sessions</SectionTitle>
      {card.sessions.length === 0 ? (
        <Panel>
          <span style={{ fontSize: 14, color: C.muted }}>No sessions recorded.</span>
        </Panel>
      ) : (
        card.sessions.slice(0, 8).map((s) => (
          <Panel key={s.id} style={{ padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 13, color: C.ink, fontWeight: 600 }}>
                {s.kind.replace(/_/g, " ")}
              </span>
              <span style={{ fontSize: 12, color: C.muted }}>{s.date}</span>
            </div>
            {s.complaints ? (
              <div style={{ fontSize: 14, color: C.body, marginTop: 5, lineHeight: 1.5 }}>
                {s.complaints.slice(0, 400)}
              </div>
            ) : null}
            {s.coach_notes ? (
              <div style={{ fontSize: 13, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
                {s.coach_notes.slice(0, 300)}
              </div>
            ) : null}
          </Panel>
        ))
      )}

      <div style={{ marginTop: 18 }}>
        <Link href="/m/clients" style={{ fontSize: 14, color: C.muted }}>
          ← Back to clients
        </Link>
      </div>
    </main>
  );
}

const btn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  padding: "0 16px",
  borderRadius: 11,
  border: `1px solid ${C.line}`,
  background: "#fff",
  color: C.body,
  fontSize: 15,
  fontWeight: 500,
  textDecoration: "none",
  flex: 1,
};

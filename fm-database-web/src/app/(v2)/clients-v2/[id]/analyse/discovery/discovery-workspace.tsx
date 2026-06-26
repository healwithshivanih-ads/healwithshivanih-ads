"use client";

/**
 * DiscoveryWorkspace — the stage-aware half of the discovery-analyse page. It
 * sits below the discovery form and drives the whole consult-tier arc from one
 * place:
 *   recommend labs (Acumen, in-app payable) → client books + pays → results in
 *   → author the Starting Map + mark the discovery call done (reveals the map +
 *   starts the 15-day upgrade window).
 *
 * Mounted only for a client with no published plan. tier === "discovery" gets
 * the full stage-aware workspace; a "signed_up" pre-build client (tier
 * "package", no plan yet) gets the lab-recommend tool only. The stage comes from
 * resolveDiscoveryStage (same source the client app uses), so this page always
 * mirrors what the client currently sees.
 */

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { FmPanel } from "@/components/fm";
import { LabRecommendCard } from "../../lab-recommend-card";
import { DiscoveryBookingSend } from "./discovery-booking-send";
import type { DiscoveryStage } from "@/lib/fmdb/discovery-tier";

interface LabSend {
  sessionId: string;
  appToken: string | null;
  clientEmail: string | null;
  lastSentAt: string | null;
}

/** Collapsible phone-frame preview of the REAL client app (an iframe of
 *  /app/<token>) — shows the exact discovery/labs screen the client sees. */
function ClientAppPhone({ token, reloadKey }: { token: string; reloadKey: number }) {
  const [open, setOpen] = useState(false);
  return (
    <FmPanel title="👁 What the client sees" subtitle="The live app — updates as you recommend">
      {!open ? (
        <button type="button" className="fm-btn" onClick={() => setOpen(true)}>
          📲 Show the client&apos;s app
        </button>
      ) : (
        <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
          <div
            style={{
              borderRadius: 36,
              border: "10px solid #2c2a26",
              boxShadow: "0 12px 40px rgba(38,34,25,0.25)",
              overflow: "hidden",
              width: 375,
              background: "#faf9f7",
            }}
          >
            <iframe
              key={reloadKey}
              src={`/app/${token}`}
              title="Live client app preview"
              style={{ width: 375, height: 680, border: 0, display: "block" }}
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--fm-text-tertiary, #8a8378)" }}>
            Live — exactly what the client sees. Recommend a package and it updates here.
          </div>
        </div>
      )}
    </FmPanel>
  );
}

interface Point {
  title: string;
  note: string;
}
interface SummaryDraft {
  headline: string;
  hypotheses: Point[];
  foundationalChanges: Point[];
  journeyPreview: string[];
}

// Stable client-only row ids so editable lists don't key on array index (which
// shuffles input focus/value when a middle row is removed).
interface PointRow extends Point {
  id: string;
}
interface JourneyRow {
  id: string;
  value: string;
}
let _rowSeq = 0;
const rid = () => `row-${_rowSeq++}`;
const toPointRows = (pts: Point[]): PointRow[] => pts.map((p) => ({ id: rid(), title: p.title, note: p.note }));
const toJourneyRows = (xs: string[]): JourneyRow[] => xs.map((v) => ({ id: rid(), value: v }));

interface Props {
  clientId: string;
  /** "discovery" gets the full stage-aware workspace (recommend → map). A
   *  package client with no plan yet ("signed_up" pre-build) gets the lab
   *  recommend tool only — no discovery framing. */
  tier: "discovery" | "package";
  stage: DiscoveryStage;
  intakeSubmitted: boolean;
  callDate: string | null;
  savedLabs: string[];
  /** What the single send surface needs (one requisition send, in the Labs block). */
  labSend: LabSend;
  existingSummary: SummaryDraft;
}

// Recommend labs while the order is still being decided / in flight.
const RECOMMEND_STAGES: DiscoveryStage[] = [
  "onboard_intake",
  "awaiting_recommendation",
  "book_labs",
  "awaiting_results",
];
// Author + reveal the map once results are in.
const MAP_STAGES: DiscoveryStage[] = ["awaiting_call", "post_call"];

const FIELD: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "7px 9px",
  fontSize: 13,
  fontFamily: "inherit",
  border: "1px solid var(--fm-border-light, #e6e1d6)",
  borderRadius: 8,
  background: "var(--fm-bg, #fff)",
};
const SECTION_LABEL: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "var(--fm-text-tertiary, #8a8378)",
};

const STAGE_META: Record<DiscoveryStage, { label: string; tone: string }> = {
  onboard_intake: { label: "Intake not submitted yet", tone: "#b07b1e" },
  awaiting_recommendation: { label: "Intake in — recommend their labs", tone: "#2d5a3d" },
  book_labs: { label: "Labs recommended — awaiting client booking/payment", tone: "#1d6fb8" },
  awaiting_results: { label: "Booked + paid — awaiting results", tone: "#1d6fb8" },
  awaiting_call: { label: "Results in — author the map + run the call", tone: "#2d5a3d" },
  post_call: { label: "Map live — 15-day window running", tone: "#2f7a3f" },
};

function humanDate(ymd: string): string {
  return new Date(ymd + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function StageStrip({ stage }: { stage: DiscoveryStage }) {
  const m = STAGE_META[stage];
  const steps: { key: DiscoveryStage[]; label: string }[] = [
    { key: ["onboard_intake"], label: "Intake" },
    { key: ["awaiting_recommendation", "book_labs", "awaiting_results"], label: "Labs" },
    { key: ["awaiting_call"], label: "Call" },
    { key: ["post_call"], label: "Map" },
  ];
  const activeIdx = steps.findIndex((s) => s.key.includes(stage));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: m.tone }}>● {m.label}</div>
      <div style={{ display: "flex", gap: 6 }} aria-hidden>
        {steps.map((s, i) => (
          <div key={s.label} style={{ flex: 1, textAlign: "center" }}>
            <div
              style={{
                height: 3,
                borderRadius: 999,
                background: i <= activeIdx ? "var(--fm-accent, #2d5a3d)" : "var(--fm-border-light, #e6e1d6)",
                opacity: i < activeIdx ? 0.6 : 1,
              }}
            />
            <div
              style={{
                fontSize: 10.5,
                marginTop: 4,
                color: i === activeIdx ? "var(--fm-accent, #2d5a3d)" : "var(--fm-text-tertiary, #8a8378)",
                fontWeight: i === activeIdx ? 700 : 500,
              }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Title+note repeater (hypotheses / foundational changes), keyed on stable ids. */
function PointListEditor({
  label,
  hint,
  rows,
  onChange,
}: {
  label: string;
  hint: string;
  rows: PointRow[];
  onChange: (next: PointRow[]) => void;
}) {
  const set = (id: string, patch: Partial<Point>) =>
    onChange(rows.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return (
    <div style={{ display: "grid", gap: 7 }}>
      <div style={SECTION_LABEL}>{label}</div>
      <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary, #6f6a5d)" }}>{hint}</div>
      {rows.map((p) => (
        <div key={p.id} style={{ display: "grid", gap: 5, padding: "8px 9px", border: "1px solid var(--fm-border-light, #e6e1d6)", borderRadius: 8 }}>
          <input style={FIELD} placeholder="Title (short)" value={p.title} onChange={(e) => set(p.id, { title: e.target.value })} />
          <textarea style={{ ...FIELD, minHeight: 42, resize: "vertical" }} placeholder="Plain-language note" value={p.note} onChange={(e) => set(p.id, { note: e.target.value })} />
          <button
            type="button"
            onClick={() => onChange(rows.filter((r) => r.id !== p.id))}
            style={{ justifySelf: "end", background: "transparent", border: "none", color: "var(--fm-muted, #6f6a5d)", fontSize: 12, cursor: "pointer" }}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="fm-btn" style={{ justifySelf: "start", fontSize: 12, padding: "4px 9px" }} onClick={() => onChange([...rows, { id: rid(), title: "", note: "" }])}>
        + Add
      </button>
    </div>
  );
}

function StartingMapEditor({
  clientId,
  stage,
  callDate,
  initial,
}: {
  clientId: string;
  stage: DiscoveryStage;
  callDate: string | null;
  initial: SummaryDraft;
}) {
  const router = useRouter();
  const [headline, setHeadline] = useState(initial.headline);
  const [hyp, setHyp] = useState<PointRow[]>(() => toPointRows(initial.hypotheses));
  const [found, setFound] = useState<PointRow[]>(() => toPointRows(initial.foundationalChanges));
  const [journey, setJourney] = useState<JourneyRow[]>(() => toJourneyRows(initial.journeyPreview));
  const [saving, setSaving] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState("");

  const buildDraft = (): SummaryDraft => ({
    headline,
    hypotheses: hyp.map(({ title, note }) => ({ title, note })),
    foundationalChanges: found.map(({ title, note }) => ({ title, note })),
    journeyPreview: journey.map((j) => j.value),
  });

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { saveDiscoverySummaryAction } = await import("@/lib/server-actions/app-token");
      const r = await saveDiscoverySummaryAction(clientId, buildDraft());
      if (!r.ok) throw new Error(r.error);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not save");
    } finally {
      setSaving(false);
    }
  };

  const reveal = async () => {
    setRevealing(true);
    setError("");
    try {
      // Persist the latest edits first, then reveal (mark the call done). Both
      // steps are idempotent, so re-tapping after a partial failure self-heals.
      const { saveDiscoverySummaryAction, markDiscoveryCallDoneAction } = await import("@/lib/server-actions/app-token");
      const s = await saveDiscoverySummaryAction(clientId, buildDraft());
      if (!s.ok) throw new Error(`Couldn't save the map: ${s.error}`);
      const r = await markDiscoveryCallDoneAction(clientId);
      if (!r.ok) throw new Error(`Map saved, but revealing it didn't take (${r.error}). Tap reveal again.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not reveal");
    } finally {
      setRevealing(false);
    }
  };

  const live = stage === "post_call";

  return (
    <FmPanel
      title="🗺️ Starting Map"
      subtitle={live ? "Live in the client's app — edits save instantly" : "Author what the client sees, then reveal it on the call"}
    >
      <div style={{ display: "grid", gap: 14 }}>
        {live && callDate && (
          <div style={{ fontSize: 12.5, color: "#2f7a3f" }}>
            ✓ Revealed {humanDate(callDate)} · the 15-day upgrade window is running.
          </div>
        )}

        <div style={{ display: "grid", gap: 6 }}>
          <div style={SECTION_LABEL}>Headline</div>
          <input style={FIELD} placeholder="Warm one-liner (a default is used if blank)" value={headline} onChange={(e) => setHeadline(e.target.value)} />
        </div>

        <PointListEditor
          label="What I'm seeing"
          hint="Top 2–3 root-cause hypotheses. Orientation, not diagnosis — no doses."
          rows={hyp}
          onChange={setHyp}
        />
        <PointListEditor
          label="Start here"
          hint="2–3 foundational changes they can begin now. Principles, not a protocol."
          rows={found}
          onChange={setFound}
        />

        <div style={{ display: "grid", gap: 6 }}>
          <div style={SECTION_LABEL}>Your full journey would add</div>
          <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary, #6f6a5d)" }}>The locked upsell list — what the full programme gives that this consult doesn&apos;t.</div>
          {journey.map((j) => (
            <div key={j.id} style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...FIELD, flex: 1 }}
                placeholder="e.g. Personalised supplement schedule"
                value={j.value}
                onChange={(e) => setJourney(journey.map((x) => (x.id === j.id ? { ...x, value: e.target.value } : x)))}
              />
              <button
                type="button"
                onClick={() => setJourney(journey.filter((x) => x.id !== j.id))}
                style={{ background: "transparent", border: "none", color: "var(--fm-muted, #6f6a5d)", fontSize: 13, cursor: "pointer" }}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="fm-btn" style={{ justifySelf: "start", fontSize: 12, padding: "4px 9px" }} onClick={() => setJourney([...journey, { id: rid(), value: "" }])}>
            + Add
          </button>
        </div>

        {error && <div style={{ fontSize: 12.5, color: "#b3402a" }}>{error}</div>}

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="fm-btn" onClick={save} disabled={saving || revealing}>
            {saving ? "Saving…" : savedFlash ? "✓ Saved" : live ? "💾 Save changes" : "💾 Save draft"}
          </button>
          {!live && (
            <button
              type="button"
              className="fm-btn"
              style={{ background: "var(--fm-accent, #2d5a3d)", color: "#fff" }}
              onClick={reveal}
              disabled={revealing || saving}
            >
              {revealing ? "Revealing…" : "✓ Discovery call done — reveal map + start window"}
            </button>
          )}
        </div>
        {!live && (
          <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary, #6f6a5d)" }}>
            Revealing shows this map in the client&apos;s app and starts the 15-day upgrade-credit countdown. Save a draft as many times as you like before then.
          </div>
        )}
      </div>
    </FmPanel>
  );
}

export function DiscoveryWorkspace({ clientId, tier, stage, intakeSubmitted, callDate, savedLabs, labSend, existingSummary }: Props) {
  const router = useRouter();
  // Bump the live phone preview after a recommend; also refresh the page so the
  // server-computed stage (= "a package is recommended") updates and the email
  // button enables.
  const [previewKey, setPreviewKey] = useState(0);
  const onRecommended = () => {
    setPreviewKey((k) => k + 1);
    router.refresh();
  };

  // A package has been recommended once the stage is past the pre-order stages.
  const hasOrder = stage !== "onboard_intake" && stage !== "awaiting_recommendation";

  // The ONE send surface — emails the client a single booking email built from the
  // recommended package (matches the app booking) + any own-lab extras.
  const sendBlock =
    labSend.sessionId && savedLabs.length > 0 ? (
      <FmPanel title="📧 Email the client" subtitle="One email: the package they book + pay for in-app, plus any own-lab tests">
        <DiscoveryBookingSend
          clientId={clientId}
          clientEmail={labSend.clientEmail}
          requestedLabs={savedLabs}
          hasOrder={hasOrder}
          lastSentAt={labSend.lastSentAt}
        />
      </FmPanel>
    ) : null;

  const phone = labSend.appToken ? <ClientAppPhone token={labSend.appToken} reloadKey={previewKey} /> : null;

  // Package client with no plan yet — just the lab-recommend tool + send, no
  // discovery stage framing or Starting Map (their app shows the plan).
  if (tier !== "discovery") {
    return (
      <div style={{ marginTop: 22, display: "grid", gap: 16 }}>
        <LabRecommendCard clientId={clientId} seedMarkers={savedLabs} intakeSubmitted={intakeSubmitted} onRecommended={onRecommended} />
        {sendBlock}
        {phone}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16, marginTop: 22 }}>
      <FmPanel title="🌱 Discovery workspace" subtitle="Recommend labs → client books in-app → results → author the map">
        <StageStrip stage={stage} />
      </FmPanel>

      {RECOMMEND_STAGES.includes(stage) && (
        <>
          <LabRecommendCard clientId={clientId} seedMarkers={savedLabs} intakeSubmitted={intakeSubmitted} onRecommended={onRecommended} />
          {sendBlock}
        </>
      )}

      {MAP_STAGES.includes(stage) && (
        <StartingMapEditor clientId={clientId} stage={stage} callDate={callDate} initial={existingSummary} />
      )}

      {phone}
    </div>
  );
}

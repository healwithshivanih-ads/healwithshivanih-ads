"use client";

/**
 * SomaticReadPanel — what the somatic catalogue says about the conditions this
 * client actually came in for.
 *
 * COACH-SIDE ONLY. Nothing here reaches the client app. The reads are grouped
 * by how safely they can be used, because the distinction is the whole point:
 * a `general` read is fine to work with openly, a `sensitive` one is a session
 * conversation, and a gated one must never be surfaced at all.
 *
 * Everything shown is an ASSOCIATION recorded in one source — never a cause.
 * The differential is displayed alongside, not hidden behind a disclosure,
 * because it is the thing that stops a reading being taken as a diagnosis.
 */

import { useEffect, useState, useTransition } from "react";

import {
  loadMindBodyDepth,
  loadSharedMaps,
  loadSomaticRead,
  setMapShared,
  setMindBodyDepth,
  type MindBodyDepth,
  type SomaticReadItem,
} from "@/lib/server-actions/somatic";

const TONE: Record<string, { bg: string; fg: string; label: string }> = {
  general: { bg: "rgba(74,97,82,.12)", fg: "#3a4d41", label: "safe to share" },
  sensitive: { bg: "rgba(169,101,31,.14)", fg: "#8c5318", label: "your judgement" },
  coach_only: { bg: "rgba(38,34,25,.10)", fg: "#262219", label: "never surface" },
};

export function SomaticReadPanel({ clientId }: { clientId: string }) {
  const [reads, setReads] = useState<SomaticReadItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [depth, setDepth] = useState<MindBodyDepth | null>(null);
  const [saving, setSaving] = useState(false);
  const [shared, setShared] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open || shared !== null) return;
    loadSharedMaps(clientId).then(setShared).catch(() => setShared([]));
  }, [open, shared, clientId]);

  function toggleShare(mapSlug: string, next: boolean) {
    const prev = shared ?? [];
    setShared(next ? [...prev, mapSlug] : prev.filter((s) => s !== mapSlug));
    setMapShared(clientId, mapSlug, next)
      .then((r) => { if (!r.ok) { setShared(prev); setErr(r.error); } })
      .catch(() => setShared(prev));
  }

  useEffect(() => {
    if (!open || depth !== null) return;
    loadMindBodyDepth(clientId).then(setDepth).catch(() => setDepth("off"));
  }, [open, depth, clientId]);

  function choose(next: MindBodyDepth) {
    const prev = depth;
    setDepth(next);           // optimistic — the control must feel immediate
    setSaving(true);
    setMindBodyDepth(clientId, next)
      .then((r) => { if (!r.ok) { setDepth(prev); setErr(r.error); } })
      .catch(() => setDepth(prev))
      .finally(() => setSaving(false));
  }

  useEffect(() => {
    if (!open || reads || err) return;
    start(async () => {
      const r = await loadSomaticRead(clientId);
      if (r.ok) setReads(r.reads);
      else setErr(r.error);
    });
  }, [open, reads, err, clientId]);

  return (
    <section className="fm-panel" style={{ marginTop: 16 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          background: "none", border: 0, padding: 0, cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 600 }}>🌿 Mind-body read</span>
        <span style={{ fontSize: 12, color: "var(--fm-muted)" }}>
          {reads ? `${reads.length} of their conditions` : "what the catalogue says"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--fm-muted)" }}>
          {open ? "hide" : "show"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          {/* The client-app gate. Off by default for everyone; this is the
              only place it changes. `full` is what lets a reading reach the
              client with no coach in the room, so it reads as a decision. */}
          <div
            style={{
              border: "1px solid var(--fm-line)", borderRadius: 12,
              padding: "10px 12px", marginBottom: 12, background: "var(--fm-bg-subtle, #faf9f7)",
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>
              Show in their app
            </div>
            <div style={{ fontSize: 11.5, color: "var(--fm-muted)", lineHeight: 1.5, marginBottom: 8 }}>
              <strong>+ gentle reads</strong> shows only the source&apos;s <em>general</em> entries —
              which in practice means sleep, digestion and aches, because it marks nearly every named
              diagnosis sensitive. <strong>+ all chronic reads</strong> adds those (blood pressure,
              thyroid pattern, PCOS, diabetes) as food for thought. Neither opens the twelve
              <em> never surface</em> entries — grief, pregnancy loss, infertility, sexual trauma;
              those you share one at a time below, for this client.
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {([
                ["off", "Nothing"],
                ["resets_only", "Practices only"],
                ["full", "+ gentle reads"],
                ["deep", "+ all chronic reads"],
              ] as [MindBodyDepth, string][]).map(([v, label]) => {
                const on = depth === v;
                return (
                  <button
                    key={v}
                    disabled={saving || depth === null}
                    onClick={() => choose(v)}
                    style={{
                      fontSize: 12, padding: "6px 11px", borderRadius: 999, cursor: "pointer",
                      border: on ? "1px solid #4a6152" : "1px solid var(--fm-line)",
                      background: on ? "#4a6152" : "#fff",
                      color: on ? "#f7f4ee" : "var(--fm-ink, #262219)",
                      opacity: depth === null ? 0.5 : 1,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {pending && <p style={{ fontSize: 13, color: "var(--fm-muted)" }}>Reading…</p>}
          {err && <p style={{ fontSize: 13, color: "#a32d2d" }}>{err}</p>}

          {reads?.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--fm-muted)", lineHeight: 1.6 }}>
              Nothing here for this client — their conditions are mostly measured rather than
              felt, and the somatic library maps symptoms and syndromes, not lab findings.
              That&apos;s expected, not a gap.
            </p>
          )}

          {reads?.map((r) => {
            const tone = TONE[r.sensitivity] ?? TONE.sensitive;
            return (
              <div
                key={r.target_slug}
                style={{
                  border: "1px solid var(--fm-line)", borderRadius: 12,
                  padding: "12px 14px", marginBottom: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 14 }}>{r.condition}</strong>
                  <span style={{
                    fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase",
                    padding: "2px 8px", borderRadius: 999, background: tone.bg, color: tone.fg,
                  }}>
                    {r.gated ? "never surface" : tone.label}
                  </span>

                  {/* The per-client override. Shown on every read so the state
                      is always legible, but it is the ONLY route past
                      coach_only — which is why it names the client and asks
                      for a deliberate tap rather than inheriting a setting. */}
                  {shared !== null && (() => {
                    const on = shared.includes(r.map_slug);
                    const heavy = r.sensitivity === "coach_only" || r.gated;
                    return (
                      <button
                        onClick={() => toggleShare(r.map_slug, !on)}
                        title={
                          on
                            ? "Showing in their app — tap to stop"
                            : heavy
                              ? "Share this one with THIS client only — the source marks it never-surface, so this is your call"
                              : "Share this one in their app"
                        }
                        style={{
                          marginLeft: "auto", fontSize: 11, padding: "3px 9px", borderRadius: 999,
                          cursor: "pointer",
                          border: on ? "1px solid #4a6152" : `1px ${heavy ? "dashed" : "solid"} var(--fm-line)`,
                          background: on ? "#4a6152" : "#fff",
                          color: on ? "#f7f4ee" : heavy ? "#8c5318" : "var(--fm-muted)",
                        }}
                      >
                        {on ? "✓ in their app" : heavy ? "share anyway" : "share"}
                      </button>
                    );
                  })()}
                </div>

                {r.themes.length > 0 && (
                  <p style={{ fontSize: 12, color: "var(--fm-muted)", margin: "6px 0 0" }}>
                    {r.themes.join(" · ")}
                  </p>
                )}

                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
                  {r.roots.map((x, i) => (
                    <li key={i}>
                      <strong>{x.pattern}</strong>
                      {x.note ? ` — ${x.note}` : ""}
                    </li>
                  ))}
                </ul>

                {r.inquiry_question && (
                  <p style={{
                    fontSize: 13.5, margin: "10px 0 0", padding: "8px 10px",
                    background: "var(--fm-bg-subtle, rgba(0,0,0,.03))", borderRadius: 8,
                  }}>
                    <strong>Ask:</strong> {r.inquiry_question}
                  </p>
                )}

                {r.differential_note && (
                  <p style={{ fontSize: 12, color: "var(--fm-muted)", margin: "8px 0 0", lineHeight: 1.5 }}>
                    <strong>Exclude first:</strong> {r.differential_note}
                  </p>
                )}

                {r.gated && (
                  <p style={{ fontSize: 12, color: "#8c5318", margin: "8px 0 0" }}>
                    Session material only — this framing can land as blame.
                  </p>
                )}
              </div>
            );
          })}

          {reads && reads.length > 0 && (
            <p style={{ fontSize: 11.5, color: "var(--fm-muted)", lineHeight: 1.5, marginTop: 4 }}>
              Associations recorded in one source, not causes. Offer them as something to test
              with the client, never as a finding about them.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

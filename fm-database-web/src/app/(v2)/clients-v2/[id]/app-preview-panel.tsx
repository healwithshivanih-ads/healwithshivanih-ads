"use client";

/**
 * AppPreviewPanel — "What the client sees" (coach rule 2026-06-12: the
 * coach must know and be able to edit, at all times, what the client's
 * app is showing and suggesting).
 *
 * Renders from the app's OWN loader so it can never drift. Three zones:
 *   🔔 Suggestions to review — auto-suggested remedies the coach hasn't
 *      reviewed (the "Punarnava tea" case), highlighted amber with
 *      Keep / Hide / + buy link.
 *   🌿 On their app now — assigned remedies (untick = remove from plan)
 *      + reviewed suggestions (Hide any time).
 *   💊 Supplements — with order-link status; one-click add for missing
 *      links (saved to supplement_links.yaml with the referral code).
 * Plus a one-line menu/practices/resources summary.
 */

import { useState } from "react";
import { FmPanel } from "@/components/fm";
import {
  approveSuggestionAction,
  loadAppPreviewAction,
  saveBuyLinkAction,
  setMealOverrideAction,
  setRemedyHiddenAction,
  type AppPreview,
  type AppPreviewRemedy,
} from "@/lib/server-actions/app-preview";
import { setClientRemedies } from "@/lib/server-actions/remedies";
import { ManageRemediesPanel } from "./manage-remedies-panel";
import {
  QuickEditSupplementsPanel,
  type QuickEditSupplementRow,
} from "./plan/quick-edit-supplements-panel";
import {
  approveWeekMenuAction,
  dismissPendingMenuAction,
  generateWeekMenuAction,
  weeklyMenuStatusAction,
  type WeeklyMenuStatus,
} from "@/lib/server-actions/weekly-menu";

const btn: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 999,
  border: "1px solid var(--fm-border, rgba(120,113,108,0.3))",
  background: "var(--fm-surface, #fff)",
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
};

function BuyLinkAdder({
  itemKey,
  displayName,
  onSaved,
}: {
  itemKey: string;
  displayName: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!open)
    return (
      <button style={btn} onClick={() => setOpen(true)}>
        🔗 Add buy link
      </button>
    );
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste product URL (referral code auto-added for VitaOne)"
        style={{
          padding: "5px 10px",
          fontSize: 11.5,
          borderRadius: 8,
          border: "1px solid var(--fm-border, rgba(120,113,108,0.3))",
          width: 240,
        }}
      />
      <button
        style={{ ...btn, background: "var(--fm-primary, #4a6152)", color: "#fff" }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          const out = await saveBuyLinkAction(itemKey, displayName, url).catch((e) => ({
            ok: false as const,
            error: String(e),
          }));
          setBusy(false);
          if (!out.ok) setErr(out.error ?? "failed");
          else {
            setOpen(false);
            onSaved();
          }
        }}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {err && <span style={{ color: "#c0392b", fontSize: 11 }}>{err}</span>}
    </span>
  );
}

function MealCell({
  clientId,
  week,
  dayIdx,
  slot,
  dish,
  overridden,
  onSaved,
}: {
  clientId: string;
  week: number;
  dayIdx: number;
  slot: string;
  dish: string;
  overridden: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(dish);
  const [busy, setBusy] = useState(false);
  const save = async (next: string | null) => {
    setBusy(true);
    await setMealOverrideAction(clientId, week, dayIdx, slot, next).catch(() => null);
    setBusy(false);
    setEditing(false);
    onSaved();
  };
  if (editing)
    return (
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ flexShrink: 0, width: 70, color: "var(--fm-text-tertiary)", fontSize: 11 }}>{slot}</span>
        <input
          value={val}
          autoFocus
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save(val);
            if (e.key === "Escape") setEditing(false);
          }}
          style={{ flex: 1, fontSize: 12, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--fm-border, rgba(120,113,108,0.3))" }}
        />
        <button style={btn} disabled={busy} onClick={() => save(val)}>
          {busy ? "…" : "Save"}
        </button>
        {overridden && (
          <button style={btn} disabled={busy} onClick={() => save(null)} title="Restore the letter's original dish">
            Reset
          </button>
        )}
      </span>
    );
  return (
    <span
      onClick={() => {
        setVal(dish);
        setEditing(true);
      }}
      style={{ display: "flex", gap: 6, cursor: "pointer" }}
      title="Click to change this dish on the client's app"
    >
      <span style={{ flexShrink: 0, width: 70, color: "var(--fm-text-tertiary)", fontSize: 11 }}>{slot}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        {dish}
        {overridden && (
          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#92600a", background: "rgba(214,158,46,0.15)", borderRadius: 999, padding: "1px 7px" }}>
            edited
          </span>
        )}
      </span>
    </span>
  );
}

export function AppPreviewPanel({
  clientId,
  quickEdit,
}: {
  clientId: string;
  /** dose/timing editing rows — passed on the Plan tab so the studio is
   *  the ONE supplement surface (the standalone Quick-edit panel is gone) */
  quickEdit?: { planSlug: string; rows: QuickEditSupplementRow[] };
}) {
  const [data, setData] = useState<AppPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  // bumps on every successful edit/load so the phone-frame iframe re-renders
  // the REAL app with the change applied — the mockup can never lie
  const [previewKey, setPreviewKey] = useState(0);

  const [weekly, setWeekly] = useState<WeeklyMenuStatus | null>(null);
  const [weeklyBusy, setWeeklyBusy] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await loadAppPreviewAction(clientId);
      if (out.ok) setData(out);
      else setError(out.error);
      const ws = await weeklyMenuStatusAction(clientId).catch(() => null);
      if (ws && ws.ok) setWeekly(ws);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
    setBusy(false);
    setLoadedOnce(true);
    setPreviewKey((k) => k + 1);
  };

  const weeklyAct = async (kind: "generate" | "approve" | "dismiss") => {
    setWeeklyBusy(kind);
    const fn =
      kind === "generate"
        ? generateWeekMenuAction
        : kind === "approve"
          ? approveWeekMenuAction
          : dismissPendingMenuAction;
    const out = await fn(clientId).catch((e) => ({ ok: false as const, error: String(e) }));
    if (!out.ok) setError(out.error ?? `${kind} failed`);
    setWeeklyBusy(null);
    void load();
  };

  const hide = async (slug: string) => {
    await setRemedyHiddenAction(clientId, slug, true).catch(() => null);
    void load();
  };
  const unhide = async (slug: string) => {
    await setRemedyHiddenAction(clientId, slug, false).catch(() => null);
    void load();
  };
  const keep = async (slug: string) => {
    await approveSuggestionAction(clientId, slug).catch(() => null);
    void load();
  };
  const unassign = async (slug: string) => {
    if (!data) return;
    const remaining = data.assigned.map((r) => r.slug).filter((s) => s !== slug);
    await setClientRemedies(clientId, remaining, "Removed from app preview panel").catch(() => null);
    void load();
  };

  const toReview = (data?.suggested ?? []).filter((r) => !r.approved);
  const reviewed = (data?.suggested ?? []).filter((r) => r.approved);

  const remedyRow = (r: AppPreviewRemedy, actions: React.ReactNode) => (
    <div
      key={r.slug}
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "8px 0",
        borderBottom: "1px solid rgba(120,113,108,0.12)",
        fontSize: 12.5,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          {/* link to the catalogue entry — full procedure, cautions, SOURCE */}
          <a
            href={`/catalogue/home_remedies/${r.slug}`}
            style={{ color: "inherit", textDecoration: "underline", textDecorationColor: "rgba(120,113,108,0.4)" }}
            title="Open the catalogue entry — full procedure, cautions and source. ← Back returns here."
          >
            {r.name}
          </a>
          {r.when && <span style={{ fontWeight: 400, color: "var(--fm-text-tertiary)" }}> · {r.when}</span>}
          {r.buyUrl ? (
            <a href={r.buyUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 8, fontSize: 11 }}>
              link ↗
            </a>
          ) : null}
        </div>
        {r.whyFor && <div style={{ color: "var(--fm-text-secondary)", fontSize: 11.5 }}>{r.whyFor}</div>}
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>{actions}</div>
    </div>
  );

  return (
    <FmPanel title="👁 What the client sees">
      <div style={{ display: "grid", gap: 12, fontSize: 13 }}>
        {!loadedOnce && (
          <button style={{ ...btn, padding: "8px 14px", alignSelf: "start" }} onClick={load} disabled={busy}>
            {busy ? "Loading the client's app…" : "👁 Load app preview"}
          </button>
        )}
        {error && <div style={{ color: "#c0392b", fontSize: 12.5 }}>{error}</div>}

        {data && (
          <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 420px", minWidth: 0, display: "grid", gap: 12 }}>
            {/* ✨ next week's auto-drafted menu — review → approve → live */}
            {weekly?.pending && (
              <div
                style={{
                  background: "rgba(74, 97, 82, 0.07)",
                  border: "1.5px solid rgba(74, 97, 82, 0.45)",
                  borderRadius: "var(--fm-radius-md, 10px)",
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--fm-primary, #4a6152)" }}>
                  ✨ Week {weekly.pending.week} menu drafted — review &amp; approve
                </div>
                {weekly.pending.change_note && (
                  <div style={{ fontSize: 13, fontStyle: "italic", margin: "6px 0 2px", color: "var(--fm-text-primary)" }}>
                    “{weekly.pending.change_note}”
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginBottom: 8 }}>
                  Drafted {new Date(weekly.pending.generated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {weekly.pending.inputs_summary ? ` · from ${weekly.pending.inputs_summary}` : ""}
                </div>
                <div style={{ display: "grid", gap: 3, fontSize: 12, marginBottom: 10 }}>
                  {weekly.pending.days.map((d, di) => (
                    <div key={di} style={{ display: "flex", gap: 8 }}>
                      <span style={{ flexShrink: 0, width: 44, fontWeight: 700, color: "var(--fm-text-secondary)" }}>Day {di + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, color: "var(--fm-text-secondary)" }}>
                        {d.slots.map((s) => s.dish).join(" · ")}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    style={{ ...btn, background: "var(--fm-primary, #4a6152)", color: "#fff", borderColor: "transparent" }}
                    disabled={!!weeklyBusy}
                    onClick={() => weeklyAct("approve")}
                  >
                    {weeklyBusy === "approve" ? "Going live…" : "✓ Approve & go live"}
                  </button>
                  <button style={btn} disabled={!!weeklyBusy} onClick={() => weeklyAct("generate")}>
                    {weeklyBusy === "generate" ? "Redrafting…" : "↻ Regenerate"}
                  </button>
                  <button style={btn} disabled={!!weeklyBusy} onClick={() => weeklyAct("dismiss")}>
                    Discard
                  </button>
                </div>
              </div>
            )}
            {weekly && !weekly.pending && weekly.hasMenu && !weekly.isSample && !weekly.nextWeekReady && weekly.currentWeek < weekly.totalWeeks && (
              <button
                style={{ ...btn, alignSelf: "start" }}
                disabled={!!weeklyBusy}
                onClick={() => weeklyAct("generate")}
                title="One Sonnet call (~$0.05, ~45s) — reads their check-ins, notes, your dish edits and MSQ since last week"
              >
                {weeklyBusy === "generate" ? "Drafting week " + (weekly.currentWeek + 1) + "…" : `✨ Draft week ${weekly.currentWeek + 1} menu`}
              </button>
            )}

            {/* 🔔 flagged: auto-suggested, not yet reviewed */}
            {toReview.length > 0 && (
              <div
                style={{
                  background: "rgba(214, 158, 46, 0.08)",
                  border: "1px solid rgba(214, 158, 46, 0.4)",
                  borderRadius: "var(--fm-radius-md, 10px)",
                  padding: "10px 14px",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "#92600a", marginBottom: 4 }}>
                  🔔 The app is suggesting these remedies — review
                </div>
                {toReview.map((r) =>
                  remedyRow(
                    r,
                    <>
                      <button style={{ ...btn, borderColor: "var(--fm-primary)", color: "var(--fm-primary)" }} onClick={() => keep(r.slug)}>
                        ✓ Keep
                      </button>
                      <button style={btn} onClick={() => hide(r.slug)}>
                        Hide
                      </button>
                      {!r.buyUrl && <BuyLinkAdder itemKey={r.slug} displayName={r.name} onSaved={load} />}
                    </>,
                  ),
                )}
              </div>
            )}

            {/* 🌿 live on the app */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--fm-text-secondary)", marginBottom: 2 }}>
                🌿 Remedies on their app
              </div>
              {data.assigned.length === 0 && reviewed.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--fm-text-tertiary)" }}>None assigned.</div>
              )}
              {data.assigned.map((r) =>
                remedyRow(
                  r,
                  <button style={btn} onClick={() => unassign(r.slug)} title="Removes it from the plan — the app updates immediately">
                    Remove
                  </button>,
                ),
              )}
              {reviewed.map((r) =>
                remedyRow(
                  r,
                  <button style={btn} onClick={() => hide(r.slug)}>
                    Hide
                  </button>,
                ),
              )}
              {/* add from the 198-remedy library — the old standalone
                  "Manage remedies" panel, merged here 2026-06-12 so the
                  remedy surface is ONE place */}
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fm-primary, #4a6152)", cursor: "pointer" }}>
                  ➕ Add remedies from the library
                </summary>
                <div style={{ marginTop: 8 }}>
                  <ManageRemediesPanel clientId={clientId} embedded />
                </div>
              </details>
              {data.hidden.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ fontSize: 11.5, color: "var(--fm-text-tertiary)", cursor: "pointer" }}>
                    Hidden from the app · {data.hidden.length}
                  </summary>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {data.hidden.map((slug) => (
                      <button key={slug} style={btn} onClick={() => unhide(slug)} title="Unhide">
                        {slug} ✕
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>

            {/* 💊 supplements + link status */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--fm-text-secondary)", marginBottom: 2 }}>
                💊 Supplements on their app
              </div>
              {data.supplements.map((s) => (
                <div
                  key={s.name}
                  style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid rgba(120,113,108,0.12)", fontSize: 12.5 }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{s.name}</strong>
                    <span style={{ color: "var(--fm-text-tertiary)" }}> · {s.dose}</span>
                  </span>
                  {s.buyUrl ? (
                    <a href={s.buyUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5 }}>
                      ✓ {s.linkSource} ↗
                    </a>
                  ) : (
                    <BuyLinkAdder itemKey={s.name} displayName={s.name} onSaved={load} />
                  )}
                </div>
              ))}
              {quickEdit && quickEdit.rows.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 11.5, fontWeight: 600, color: "var(--fm-primary, #4a6152)", cursor: "pointer" }}>
                    ✏️ Edit doses, timings or remove a supplement
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    <QuickEditSupplementsPanel planSlug={quickEdit.planSlug} supplements={quickEdit.rows} embedded />
                  </div>
                </details>
              )}
            </div>

            {/* recipe-coverage check — DETAILED plans must ship recipes
                (Nidhi, 2026-06-12). Hybrids show a sample menu of simple
                everyday preparations — no pack expected, no warning. */}
            {data.menu.weeks > 0 && !data.menu.isSample && data.recipeCount === 0 && (
              <div
                style={{
                  background: "rgba(214, 158, 46, 0.08)",
                  border: "1px solid rgba(214, 158, 46, 0.4)",
                  borderRadius: "var(--fm-radius-md, 10px)",
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "#92600a",
                }}
              >
                ⚠ The menu is live but <strong>no recipe pack has been issued</strong> — dishes
                show without methods. Generate &amp; send a <em>recipes</em> letter from
                Communicate and the app picks it up automatically.
              </div>
            )}

            {/* 📅 the full menu, dish by dish — click any dish to swap it.
                Overrides apply before everything that derives from the
                tables, so Today, the week view and grocery follow. */}
            {data.weekMenus.length > 0 && (
              <details>
                <summary style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--fm-text-secondary)", cursor: "pointer" }}>
                  📅 {data.menu.isSample ? "Sample menu" : "Menu"} — click any dish to change it
                </summary>
                {data.weekMenus.map((w) => (
                  <div key={w.week} style={{ marginTop: 8 }}>
                    {data.weekMenus.length > 1 && (
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--fm-text-secondary)", margin: "6px 0 2px" }}>Week {w.week}</div>
                    )}
                    {w.days.map((d, di) => (
                      <div key={di} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid rgba(120,113,108,0.10)", fontSize: 12 }}>
                        <span style={{ flexShrink: 0, width: 56, fontWeight: 700, color: "var(--fm-text-secondary)" }}>
                          {data.menu.isSample ? `Day ${di + 1}` : d.dow}
                          {d.dateLabel && <span style={{ display: "block", fontWeight: 400, fontSize: 10.5 }}>{d.dateLabel}</span>}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                          {d.slots.map((s) => (
                            <MealCell
                              key={s.slot}
                              clientId={clientId}
                              week={w.week}
                              dayIdx={di}
                              slot={s.slot}
                              dish={s.dish}
                              overridden={s.overridden}
                              onSaved={load}
                            />
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
                {data.menu.groceryGenerated && (
                  <div style={{ fontSize: 11, color: "var(--fm-text-tertiary)", marginTop: 6 }}>
                    Changed a dish? Regenerate the 🛒 grocery list so the shopping list matches.
                  </div>
                )}
              </details>
            )}

            {/* 📅 everything else, one line each */}
            <div style={{ fontSize: 12, color: "var(--fm-text-secondary)", lineHeight: 1.7 }}>
              📅 Menu: {data.menu.weeks === 0 ? "principle-based (no tables)" : data.menu.isSample ? `Sample menu · ${data.menu.days} days` : `${data.menu.weeks} week${data.menu.weeks > 1 ? "s" : ""} · ${data.menu.days} days each`}
              {" · "}🛒 grocery list {data.menu.groceryGenerated ? "live" : "not generated"}
              <br />
              🌿 Practices: {data.practices.join(" · ") || "none"}
              <br />
              📚 {data.lessons.length} lessons · {data.resources.length} resources
            </div>

            <button style={{ ...btn, alignSelf: "start" }} onClick={load} disabled={busy}>
              {busy ? "Refreshing…" : "🔄 Refresh"}
            </button>
            </div>

            {/* ── the LIVE phone — the real client app, not a mockup.
                Reloads after every edit so what you see is exactly what
                the client sees (coach directive 2026-06-12). ── */}
            <div style={{ flex: "0 0 392px", position: "sticky", top: 12 }}>
              <div
                style={{
                  borderRadius: 36,
                  border: "10px solid #2c2a26",
                  boxShadow: "0 12px 40px rgba(38,34,25,0.25)",
                  overflow: "hidden",
                  width: 375 + 0,
                  background: "#faf9f7",
                }}
              >
                <iframe
                  key={previewKey}
                  src={`/app/${data.token}`}
                  title="Live client app preview"
                  style={{ width: 375, height: 700, border: 0, display: "block" }}
                />
              </div>
              <div style={{ textAlign: "center", marginTop: 8, fontSize: 11, color: "var(--fm-text-tertiary)" }}>
                Live — this is the client&apos;s actual app. Edits on the left appear here instantly.
              </div>
            </div>
          </div>
        )}
      </div>
    </FmPanel>
  );
}

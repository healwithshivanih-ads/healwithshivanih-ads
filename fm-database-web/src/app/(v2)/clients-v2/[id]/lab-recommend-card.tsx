"use client";

/**
 * LabRecommendCard — coach "Recommend labs" builder.
 *
 * The coach approves which Acumen profile + which add-ons are right for this
 * client → creates a `recommended` lab order the client then pays for in the app.
 * The profile price is catalogue-fixed; the coach sets each add-on's client price.
 * See docs/LAB_BOOKING_SPEC.md ("Coach-approved booking").
 */

import { useEffect, useState } from "react";
import { FmPanel } from "@/components/fm";
import type { LabMenu } from "@/lib/server-actions/lab-orders";
import type { LabOrder, LabOrderStatus, LogisticsSlot } from "@/lib/fmdb/lab-orders";
import { checkCoverage } from "@/lib/fmdb/lab-coverage";

const SLOT_LABEL: Record<LogisticsSlot, string> = {
  morning: "Morning (7–10 am)",
  late_morning: "Late morning (10 am–1 pm)",
  afternoon: "Afternoon (1–4 pm)",
  evening: "Evening (4–7 pm)",
};

const STATUS_META: Record<LabOrderStatus, { label: string; color: string }> = {
  recommended: { label: "Recommended · awaiting payment", color: "#b07b1e" },
  paid: { label: "Paid · book with Acumen", color: "#1d6fb8" },
  booked: { label: "Booked", color: "#1d6fb8" },
  sample_collected: { label: "Sample collected", color: "#1d6fb8" },
  results_in: { label: "Results in", color: "#2f7a3f" },
  cancelled: { label: "Cancelled", color: "#8a8378" },
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** The next fulfilment step the coach can take from each status. */
const ADVANCE: Partial<Record<LabOrderStatus, { to: "booked" | "sample_collected" | "results_in"; label: string }>> = {
  paid: { to: "booked", label: "Mark booked" },
  booked: { to: "sample_collected", label: "Mark collected" },
  sample_collected: { to: "results_in", label: "Mark results in" },
};

export function LabRecommendCard({
  clientId,
  seedMarkers,
  intakeSubmitted = true,
  onRecommended,
}: {
  clientId: string;
  /** Markers the coach picked on the discovery panel — drive the coverage check
   *  (which package covers them) and the email "why". */
  seedMarkers?: string[];
  /** When false, recommending is blocked (the in-app pay screen needs intake
   *  submitted first); the requisition email is the path before then. */
  intakeSubmitted?: boolean;
  /** Fired after a successful recommend — lets a parent refresh the live app
   *  preview so the client's new pay screen shows. */
  onRecommended?: () => void;
}) {
  const [menu, setMenu] = useState<LabMenu | null>(null);
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [addonPrices, setAddonPrices] = useState<Record<string, string>>({}); // slug → price string ("" = not selected)
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [okFlash, setOkFlash] = useState(false);

  const refresh = async () => {
    const { loadClientLabOrdersAction } = await import("@/lib/server-actions/lab-orders");
    setOrders(await loadClientLabOrdersAction(clientId));
  };

  useEffect(() => {
    let live = true;
    (async () => {
      const { loadLabMenuAction, loadClientLabOrdersAction } = await import("@/lib/server-actions/lab-orders");
      const m = await loadLabMenuAction(clientId);
      if (!live) return;
      if (m.ok) {
        setMenu(m);
        setProfileId(m.suggestedIds[0] ?? null);
      } else {
        setError(m.error);
      }
      setOrders(await loadClientLabOrdersAction(clientId));
    })().catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [clientId]);

  const priceOk = (v: string | undefined) =>
    typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) > 0;

  const profile = menu?.profiles.find((p) => p.id === profileId) ?? null;
  // Tests already inside the chosen panel — hidden from the picker (and never
  // charged) so a marker isn't recommended twice.
  const coveredSlugs = new Set(profile?.coveredAddonSlugs ?? []);
  // The add-ons the coach can actually pick for this profile.
  const visibleAddons = (menu?.addons ?? []).filter((a) => !coveredSlugs.has(a.slug));
  const hiddenCount = (menu?.addons.length ?? 0) - visibleAddons.length;

  // Prune any ticked add-on that the newly-selected profile now covers, so it
  // can't linger checked (or be charged). Runs whenever the profile changes.
  useEffect(() => {
    if (coveredSlugs.size === 0) return;
    setAddonPrices((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [slug, v] of Object.entries(prev)) {
        if (coveredSlugs.has(slug)) changed = true;
        else next[slug] = v;
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  // Coverage of the discovery call's lab list against the chosen package.
  const coverage =
    menu && seedMarkers && seedMarkers.length > 0
      ? checkCoverage(seedMarkers, profile, menu.coverage, menu.addons)
      : null;
  // One-click "add this marker as an add-on" — ticks it for the coach to price.
  const addAddon = (slug: string) =>
    setAddonPrices((prev) => (slug in prev ? prev : { ...prev, [slug]: "" }));

  const selectedAddons = Object.entries(addonPrices)
    .filter(([slug, v]) => priceOk(v) && !coveredSlugs.has(slug))
    .map(([slug, v]) => ({ slug, inr: Number(v) }));

  const addonTotal = selectedAddons.reduce((s, a) => s + a.inr, 0);
  const total = (profile?.mrpInr ?? 0) + addonTotal;
  const ourCost =
    (profile?.ourCostInr ?? 0) +
    selectedAddons.reduce((s, a) => s + (menu?.addons.find((x) => x.slug === a.slug)?.ourCostInr ?? 0), 0);
  const margin = total - ourCost;
  // ticked add-ons missing a valid price — must be resolved before recommending
  // (otherwise they'd be silently dropped from the order). Covered ones excluded.
  const incompleteAddons = Object.entries(addonPrices)
    .filter(([slug, v]) => v !== undefined && !priceOk(v) && !coveredSlugs.has(slug))
    .map(([slug]) => menu?.addons.find((a) => a.slug === slug)?.name ?? slug);
  // Intake gate: recommending creates the client's in-app pay screen, so block
  // it until intake is submitted (before then, the requisition email is the path).
  const canRecommend =
    !busy &&
    intakeSubmitted &&
    total > 0 &&
    (profileId != null || selectedAddons.length > 0) &&
    incompleteAddons.length === 0;

  const recommend = async () => {
    setBusy(true);
    setError("");
    setOkFlash(false);
    try {
      const { recommendLabsAction } = await import("@/lib/server-actions/lab-orders");
      const r = await recommendLabsAction({
        clientId,
        profileId,
        addons: selectedAddons,
        coachNote: note.trim() || undefined,
      });
      if (!r.ok) throw new Error(r.error);
      await refresh();
      setNote("");
      setAddonPrices({});
      setOkFlash(true);
      setTimeout(() => setOkFlash(false), 2200);
      onRecommended?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not recommend");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (orderId: string) => {
    const { cancelLabOrderAction } = await import("@/lib/server-actions/lab-orders");
    const r = await cancelLabOrderAction(clientId, orderId);
    if (r.ok) await refresh();
    else setError(r.error);
  };

  const advance = async (orderId: string, to: "booked" | "sample_collected" | "results_in") => {
    const { advanceLabOrderAction } = await import("@/lib/server-actions/lab-orders");
    const r = await advanceLabOrderAction(clientId, orderId, to);
    if (r.ok) await refresh();
    else setError(r.error);
  };

  if (error && !menu) {
    return (
      <FmPanel title="🔬 Recommend labs" subtitle="Acumen — coach-approved booking">
        <div style={{ fontSize: 12.5, color: "#b3402a" }}>{error}</div>
      </FmPanel>
    );
  }

  return (
    <FmPanel title="🔬 Recommend labs" subtitle="Approve the panel + tests; the client pays in-app">
      {!menu ? (
        <div style={{ fontSize: 12.5, color: "var(--fm-muted, #6f6a5d)" }}>Loading catalogue…</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {!intakeSubmitted && (
            <div style={{ fontSize: 12, color: "#b07b1e", background: "rgba(176,123,30,0.08)", border: "1px solid rgba(176,123,30,0.3)", borderRadius: 8, padding: "7px 9px", lineHeight: 1.45 }}>
              ⚠ Intake not submitted yet — recommending is disabled until it is. You can still send the lab list by email below.
            </div>
          )}
          {/* profile picker */}
          <div style={{ display: "grid", gap: 6 }}>
            <Label>Profile</Label>
            {menu.profiles.map((p) => {
              const suggested = menu.suggestedIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 9px",
                    borderRadius: 8,
                    border: "1px solid " + (profileId === p.id ? "var(--fm-accent, #2d5a3d)" : "var(--fm-border-light, #e6e1d6)"),
                    background: profileId === p.id ? "rgba(45,90,61,0.06)" : "transparent",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  <input type="radio" name="lab-profile" checked={profileId === p.id} onChange={() => setProfileId(p.id)} />
                  <span style={{ flex: 1 }}>
                    {p.name}
                    {suggested && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--fm-accent, #2d5a3d)" }}>✓ for this client</span>}
                    <span style={{ display: "block", fontSize: 11, color: "var(--fm-muted, #6f6a5d)" }}>{p.audience}</span>
                  </span>
                  <strong>{inr(p.mrpInr)}</strong>
                </label>
              );
            })}
            <button
              type="button"
              className="fm-btn"
              style={{ justifySelf: "start", fontSize: 12, padding: "3px 8px" }}
              onClick={() => setProfileId(null)}
            >
              No profile (add-ons only)
            </button>
          </div>

          {/* coverage of the discovery call's lab list against the chosen package */}
          {coverage && profile && (() => {
            const need = coverage.covered.length + coverage.availableAsAddon.length + coverage.notAtAcumen.length + coverage.unknown.length;
            const allIn = coverage.availableAsAddon.length === 0 && coverage.notAtAcumen.length === 0 && coverage.unknown.length === 0;
            const reqList = [...coverage.notAtAcumen, ...coverage.unknown];
            return (
              <div
                style={{
                  border: `1px solid ${allIn ? "rgba(47,122,63,0.35)" : "rgba(176,123,30,0.4)"}`,
                  background: allIn ? "rgba(47,122,63,0.06)" : "rgba(176,123,30,0.07)",
                  borderRadius: 8,
                  padding: "9px 11px",
                  display: "grid",
                  gap: 7,
                  fontSize: 12.5,
                }}
              >
                {allIn ? (
                  <div style={{ color: "#2f7a3f", fontWeight: 600 }}>
                    ✓ All {need} marker{need === 1 ? "" : "s"} from your call are in {profile.name}.
                  </div>
                ) : (
                  <div style={{ color: "#92600a", fontWeight: 600 }}>
                    {coverage.covered.length} of {need} markers are in {profile.name} — {need - coverage.covered.length} {need - coverage.covered.length === 1 ? "isn't" : "aren't"}:
                  </div>
                )}

                {coverage.availableAsAddon.length > 0 && (
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontSize: 11, color: "var(--fm-text-tertiary, #8a8378)" }}>Add to this booking (our partner can run these):</div>
                    {coverage.availableAsAddon.map((a) => {
                      const added = a.slug in addonPrices;
                      const cost = menu?.addons.find((x) => x.slug === a.slug)?.ourCostInr;
                      return (
                        <div key={a.slug} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ flex: 1 }}>
                            {a.marker}
                            {cost != null && <span style={{ color: "var(--fm-text-tertiary, #8a8378)", fontSize: 11 }}> · our cost {inr(cost)}</span>}
                          </span>
                          {added ? (
                            <span style={{ fontSize: 11.5, color: "#2f7a3f" }}>✓ added — set price below</span>
                          ) : (
                            <button type="button" className="fm-btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => addAddon(a.slug)}>
                              + Add
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {reqList.length > 0 && (
                  <div style={{ fontSize: 11.5, color: "var(--fm-text-secondary, #6f6a5d)", lineHeight: 1.5 }}>
                    <strong>Send as a requisition</strong> (their own lab — not run by our partner): {reqList.join(", ")}.
                    <span style={{ display: "block", fontSize: 11, marginTop: 2 }}>Use the &quot;Email the lab list&quot; option below for these.</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* add-ons — coach sets each price */}
          <div style={{ display: "grid", gap: 6 }}>
            <Label>Additional tests (you set the price)</Label>
            {hiddenCount > 0 && (
              <div style={{ fontSize: 11, color: "var(--fm-muted, #6f6a5d)" }}>
                {hiddenCount} test{hiddenCount === 1 ? "" : "s"} already in {profile?.name} — hidden so you don&apos;t book them twice.
              </div>
            )}
            <div style={{ maxHeight: 180, overflowY: "auto", display: "grid", gap: 4 }}>
              {visibleAddons.map((a) => {
                const on = a.slug in addonPrices;
                return (
                  <div key={a.slug} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setAddonPrices((prev) => {
                          const next = { ...prev };
                          if (e.target.checked) next[a.slug] = "";
                          else delete next[a.slug];
                          return next;
                        })
                      }
                    />
                    <span style={{ flex: 1 }}>
                      {a.name}
                      {a.ourCostInr != null && (
                        <span style={{ color: "var(--fm-muted, #6f6a5d)", marginLeft: 6, fontSize: 11 }}>our cost {inr(a.ourCostInr)}</span>
                      )}
                    </span>
                    {on && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        ₹
                        <input
                          type="number"
                          min={1}
                          value={addonPrices[a.slug]}
                          placeholder="price"
                          onChange={(e) => setAddonPrices((prev) => ({ ...prev, [a.slug]: e.target.value }))}
                          style={{ width: 74, padding: "3px 6px", fontSize: 12.5 }}
                        />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note to the client (why these labs) — optional"
            rows={2}
            style={{ width: "100%", fontSize: 12.5, padding: "6px 8px", resize: "vertical" }}
          />

          {/* totals */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, alignItems: "baseline" }}>
            <span style={{ color: "var(--fm-muted, #6f6a5d)" }}>
              Client pays <strong style={{ color: "var(--fm-text, #2c2a24)", fontSize: 15 }}>{inr(total)}</strong>
            </span>
            <span style={{ fontSize: 11.5, color: margin >= 0 ? "#2f7a3f" : "#b3402a" }}>margin {inr(margin)}</span>
          </div>

          {incompleteAddons.length > 0 && (
            <div style={{ fontSize: 12, color: "#b07b1e" }}>
              Set a price for: {incompleteAddons.join(", ")} (or untick).
            </div>
          )}
          <button className="fm-btn" onClick={recommend} disabled={!canRecommend}>
            {busy ? "Recommending…" : "🔬 Recommend to client"}
          </button>
          {okFlash && <div style={{ fontSize: 12.5, color: "#2f7a3f" }}>✓ Recommended — the client can now pay in their app.</div>}
          {error && <div style={{ fontSize: 12.5, color: "#b3402a" }}>{error}</div>}

          {/* existing orders */}
          {orders.length > 0 && (
            <div style={{ display: "grid", gap: 6, borderTop: "1px solid var(--fm-border-light, #e6e1d6)", paddingTop: 10 }}>
              <Label>Orders</Label>
              {orders.map((o) => {
                const meta = STATUS_META[o.status] ?? { label: o.status, color: "#8a8378" };
                const profileName = o.lines[0]?.label ?? "Add-ons";
                const cancellable = o.status === "recommended"; // paid orders need a refund flow, not a silent void
                return (
                  <div key={o.order_id} style={{ display: "grid", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                      <span style={{ flex: 1 }}>
                        {profileName}
                        {o.addon_slugs.length > 0 ? ` +${o.addon_slugs.length}` : ""} · {inr(o.amount_inr)}
                        <span style={{ display: "block", fontSize: 11, color: meta.color }}>{meta.label}</span>
                      </span>
                      {ADVANCE[o.status] && (
                        <button
                          type="button"
                          className="fm-btn"
                          style={{ fontSize: 11, padding: "2px 7px" }}
                          onClick={() => advance(o.order_id, ADVANCE[o.status]!.to)}
                        >
                          {ADVANCE[o.status]!.label}
                        </button>
                      )}
                      {cancellable && (
                        <button
                          type="button"
                          className="fm-btn"
                          style={{ fontSize: 11, padding: "2px 7px" }}
                          onClick={() => cancel(o.order_id)}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    {o.logistics && (
                      <div
                        style={{
                          fontSize: 11,
                          lineHeight: 1.5,
                          color: "var(--fm-text-secondary, #6f6a5d)",
                          background: "var(--fm-surface, #faf8f3)",
                          border: "1px solid var(--fm-border-light, #e6e1d6)",
                          borderRadius: 7,
                          padding: "6px 9px",
                        }}
                      >
                        <strong style={{ color: "var(--fm-text, #2c2a24)" }}>🏠 Home collection</strong> ·{" "}
                        {o.logistics.full_name} · {o.logistics.phone}
                        <br />
                        {o.logistics.address}, {o.logistics.pincode}
                        <br />
                        Preferred: {o.logistics.preferred_date} · {SLOT_LABEL[o.logistics.preferred_slot] ?? o.logistics.preferred_slot}
                        {o.logistics.notes ? (
                          <>
                            <br />
                            Note: {o.logistics.notes}
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </FmPanel>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fm-text-tertiary, #8a8378)" }}>
      {children}
    </div>
  );
}

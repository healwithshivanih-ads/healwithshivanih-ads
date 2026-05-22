"use client";

/**
 * Cal.com booking modal — two flows in one UI:
 *
 *   A. Send link    — sends a WhatsApp message (via Cloud API server) with the
 *                     Cal.com self-serve URL.
 *   B. Book direct  — coach picks an available slot; we POST to Cal.com
 *                     on the client's behalf so the calendar block, Zoom
 *                     link, and reminder emails all fire on Cal.com's side.
 *
 * Mounts:
 *   - Dashboard (no prefilled client → modal starts with client picker)
 *   - Client detail Sessions tab (clientId pre-set → skips client picker)
 */

import * as React from "react";
import { toast } from "sonner";
import {
  listEventTypesAction,
  listAvailableSlotsAction,
  createBookingAction,
  sendBookingLinkAction,
} from "@/app/api/calcom/actions";
import type { EventTypeOption, SlotOption } from "@/app/api/calcom/types";

// ── Public props ──────────────────────────────────────────────────────────────

export interface BookSessionClient {
  client_id: string;
  display_name?: string;
  email?: string;
  mobile_number?: string;
}

interface BookSessionModalProps {
  open: boolean;
  onClose: () => void;
  /** When set, client-picker step is skipped. */
  prefilledClient?: BookSessionClient | null;
  /** Required when no prefilledClient — full list to choose from. */
  allClients?: BookSessionClient[];
}

// ── Component ─────────────────────────────────────────────────────────────────

type Mode = "send" | "direct";
type Step = "pick-client" | "pick-type" | "pick-slot" | "confirm" | "done" | "sent";

export function BookSessionModal({
  open,
  onClose,
  prefilledClient = null,
  allClients = [],
}: BookSessionModalProps) {
  const [client, setClient] = React.useState<BookSessionClient | null>(prefilledClient);
  const [clientSearch, setClientSearch] = React.useState("");
  const [mode, setMode] = React.useState<Mode>("direct");
  const [eventTypes, setEventTypes] = React.useState<EventTypeOption[]>([]);
  const [eventTypesError, setEventTypesError] = React.useState<string | null>(null);
  const [eventTypesLoaded, setEventTypesLoaded] = React.useState(false);
  const [selectedType, setSelectedType] = React.useState<EventTypeOption | null>(null);
  const [slots, setSlots] = React.useState<SlotOption[]>([]);
  const [slotsLoading, setSlotsLoading] = React.useState(false);
  const [slotsError, setSlotsError] = React.useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<SlotOption | null>(null);
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [step, setStep] = React.useState<Step>(prefilledClient ? "pick-type" : "pick-client");
  const [bookingResult, setBookingResult] = React.useState<{ bookingUid?: string; calcomEventUrl?: string; whatsappSent?: boolean } | null>(null);
  const [sendResult, setSendResult] = React.useState<{ method: string; url: string } | null>(null);

  // Reset when modal closes
  React.useEffect(() => {
    if (!open) return;
    setClient(prefilledClient);
    setClientSearch("");
    setMode("direct");
    setSelectedType(null);
    setSelectedSlot(null);
    setSlots([]);
    setSlotsError(null);
    setNotes("");
    setSubmitting(false);
    setStep(prefilledClient ? "pick-type" : "pick-client");
    setBookingResult(null);
    setSendResult(null);
  }, [open, prefilledClient]);

  // Load event types on open
  React.useEffect(() => {
    if (!open || eventTypesLoaded) return;
    let cancelled = false;
    (async () => {
      const res = await listEventTypesAction();
      if (cancelled) return;
      setEventTypes(res.options);
      setEventTypesError(res.ok ? null : (res.error ?? "Failed to load event types"));
      setEventTypesLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [open, eventTypesLoaded]);

  // Escape to close
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Group slots by date for the slot picker. MUST stay above the
  // `if (!open) return null` early return — otherwise hook count
  // differs between open/closed renders and React throws #310
  // ("Rendered more hooks than during the previous render").
  // Coach bug 2026-05-19.
  const slotsByDate = React.useMemo(() => {
    const map = new Map<string, { dateLabel: string; slots: SlotOption[] }>();
    for (const s of slots) {
      if (!map.has(s.dateKey)) map.set(s.dateKey, { dateLabel: s.dateLabel, slots: [] });
      map.get(s.dateKey)!.slots.push(s);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  if (!open) return null;

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handlePickType(et: EventTypeOption) {
    setSelectedType(et);
    if (mode === "send") {
      setStep("confirm");
      return;
    }
    if (!et.eventTypeId) {
      toast.error(`Cal.com event-type id missing for "${et.label}" — direct-book unavailable.`);
      return;
    }
    setStep("pick-slot");
    setSlotsLoading(true);
    setSlotsError(null);
    setSlots([]);
    const res = await listAvailableSlotsAction(et.slug, 14);
    setSlotsLoading(false);
    if (!res.ok) {
      setSlotsError(res.error ?? "Failed to load slots");
      return;
    }
    setSlots(res.slots);
  }

  async function handleConfirmDirectBook() {
    if (!client || !selectedType || !selectedSlot) return;
    if (!client.email) {
      toast.error("Client has no email on file. Cal.com requires an email to send the confirmation + Zoom link. Add it on the client page first.");
      return;
    }
    setSubmitting(true);
    const res = await createBookingAction({
      eventTypeSlug: selectedType.slug,
      slotIso: selectedSlot.startIso,
      clientId: client.client_id,
      clientName: client.display_name ?? client.client_id,
      clientEmail: client.email,
      clientPhone: client.mobile_number,
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.error ?? "Booking failed.", { description: "Pick another slot or check the Cal.com API key." });
      return;
    }
    setBookingResult({ bookingUid: res.bookingUid, calcomEventUrl: res.calcomEventUrl, whatsappSent: res.whatsappSent });
    setStep("done");
    toast.success(
      `Booked ${client.display_name ?? client.client_id} — ${selectedType.label} on ${selectedSlot.dateLabel} at ${selectedSlot.label}`,
    );
  }

  async function handleSendLink() {
    if (!client || !selectedType) return;
    setSubmitting(true);
    const res = await sendBookingLinkAction({
      clientId: client.client_id,
      eventTypeSlug: selectedType.slug,
      clientName: client.display_name ?? client.client_id,
      clientPhone: client.mobile_number,
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.error ?? "Failed to send link.");
      return;
    }
    setSendResult({ method: res.method, url: res.url });
    setStep("sent");
    if (res.method === "manual") {
      toast.success("Link ready — copy below and paste into WhatsApp.");
    } else {
      toast.success(`Booking link sent via ${res.method}.`);
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  const filteredClients = clientSearch.trim()
    ? allClients.filter((c) => {
        const q = clientSearch.toLowerCase();
        return (
          c.client_id.toLowerCase().includes(q) ||
          (c.display_name ?? "").toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.mobile_number ?? "").toLowerCase().includes(q)
        );
      })
    : allClients;

  // (slotsByDate moved above the early return — see comment up there.)

  // ── JSX ─────────────────────────────────────────────────────────────────────

  return (
    // Outer overlay: inline styles instead of Tailwind classes (coach
    // reported 2026-05-19 that clicking Book Session opened a modal
    // that was invisible — the agent had used `bg-black/50 z-50` etc.
    // which depend on Tailwind 4 opacity-slash syntax being compiled
    // for this file. Inline styles bypass that entirely so the modal
    // is guaranteed to render no matter what the CSS pipeline does).
    <div
      role="dialog"
      aria-modal
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20, 20, 24, 0.55)",
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100%)",
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: "var(--fm-surface, #fff)",
          border: "1px solid var(--fm-border-light, #E5E2DD)",
          borderRadius: 14,
          boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
        }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">📅 Book session</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {client
                ? <>For <span className="font-medium">{client.display_name ?? client.client_id}</span></>
                : "Select a client to begin"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-muted transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* ── Step 1: pick client ── */}
          {step === "pick-client" && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Select client</h3>
              <input
                type="text"
                placeholder="Search by name, id, email, or phone…"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                autoFocus
              />
              <div className="max-h-72 overflow-y-auto border rounded-md divide-y">
                {filteredClients.length === 0 && (
                  <div className="px-3 py-4 text-sm text-muted-foreground">No clients match.</div>
                )}
                {filteredClients.map((c) => (
                  <button
                    key={c.client_id}
                    onClick={() => {
                      setClient(c);
                      setStep("pick-type");
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{c.display_name ?? c.client_id}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.email ?? "—"} · {c.mobile_number ?? "—"}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{c.client_id}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: mode + event type ── */}
          {step === "pick-type" && client && (
            <div className="space-y-4">
              {/* Mode tabs */}
              <div className="flex gap-2 border-b pb-3">
                <button
                  onClick={() => setMode("send")}
                  className={`px-4 py-2 text-sm rounded-md transition-colors ${
                    mode === "send"
                      ? "bg-amber-100 text-amber-900 font-semibold border border-amber-300"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  📞 Send link
                </button>
                <button
                  onClick={() => setMode("direct")}
                  className={`px-4 py-2 text-sm rounded-md transition-colors ${
                    mode === "direct"
                      ? "bg-amber-100 text-amber-900 font-semibold border border-amber-300"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  ✏️ Book directly
                </button>
              </div>

              <p className="text-xs text-muted-foreground">
                {mode === "send"
                  ? "Client picks their own slot via the Cal.com link."
                  : "You pick an exact slot below; Cal.com handles calendar + Zoom + emails."}
              </p>

              {eventTypesError && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {eventTypesError}
                </div>
              )}

              {/* Event-type cards */}
              <div className="grid gap-3">
                {eventTypes.map((et) => {
                  const disabled = mode === "direct" && !et.eventTypeId;
                  return (
                    <button
                      key={et.slug}
                      disabled={disabled}
                      onClick={() => handlePickType(et)}
                      className={`text-left rounded-lg border-2 px-4 py-3 transition-all ${
                        disabled
                          ? "border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed"
                          : "border-border hover:border-amber-400 hover:bg-amber-50/30 cursor-pointer"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{et.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm">{et.label}</div>
                          <div className="text-xs text-muted-foreground">{et.tagline}</div>
                          {disabled && (
                            <div className="text-[10px] text-amber-700 mt-1">
                              Direct-book unavailable — Cal.com event type not found.
                            </div>
                          )}
                        </div>
                        <span className="text-muted-foreground">→</span>
                      </div>
                    </button>
                  );
                })}
                {eventTypes.length === 0 && eventTypesLoaded && (
                  <div className="text-sm text-muted-foreground italic">
                    No event types found in <code>~/fm-plans/_calcom_links.yaml</code>.
                  </div>
                )}
              </div>

              {!prefilledClient && (
                <button
                  onClick={() => setStep("pick-client")}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  ← Choose a different client
                </button>
              )}
            </div>
          )}

          {/* ── Step 3a: pick slot (direct mode only) ── */}
          {step === "pick-slot" && selectedType && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {selectedType.emoji} {selectedType.label} — pick a slot
                </h3>
                <button
                  onClick={() => setStep("pick-type")}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  ← Change session type
                </button>
              </div>

              {slotsLoading && <div className="text-sm text-muted-foreground">Loading available slots…</div>}
              {slotsError && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
                  {slotsError}
                </div>
              )}

              {!slotsLoading && !slotsError && slotsByDate.length === 0 && (
                <div className="text-sm text-muted-foreground italic">
                  No available slots in the next 14 days.
                </div>
              )}

              {slotsByDate.map(([dateKey, group]) => (
                <div key={dateKey} className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.dateLabel}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.slots.map((s) => (
                      <button
                        key={s.startIso}
                        onClick={() => {
                          setSelectedSlot(s);
                          setStep("confirm");
                        }}
                        className="text-xs px-3 py-1.5 rounded-md border bg-white hover:bg-amber-50 hover:border-amber-400 transition-colors"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Step 4: confirm ── */}
          {step === "confirm" && client && selectedType && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-amber-50/30 px-4 py-3 space-y-1.5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                  Confirm
                </div>
                <div className="text-sm">
                  {mode === "direct" && selectedSlot ? (
                    <>
                      Book <span className="font-semibold">{client.display_name ?? client.client_id}</span> into{" "}
                      <span className="font-semibold">{selectedType.label}</span> on{" "}
                      <span className="font-semibold">{selectedSlot.dateLabel}</span> at{" "}
                      <span className="font-semibold">{selectedSlot.label}</span>.
                    </>
                  ) : (
                    <>
                      Send the <span className="font-semibold">{selectedType.label}</span> booking link to{" "}
                      <span className="font-semibold">{client.display_name ?? client.client_id}</span> via WhatsApp.
                    </>
                  )}
                </div>
              </div>

              {mode === "direct" && (
                <>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div>Client email: <span className="font-mono">{client.email ?? <em>(missing — Cal.com requires email)</em>}</span></div>
                    {client.mobile_number && <div>Client phone: <span className="font-mono">{client.mobile_number}</span></div>}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Notes (optional)
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Anything to flag for this session?"
                      rows={3}
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setStep(mode === "direct" ? "pick-slot" : "pick-type")}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  ← Back
                </button>
                <button
                  disabled={submitting}
                  onClick={mode === "direct" ? handleConfirmDirectBook : handleSendLink}
                  className="rounded-md bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 disabled:opacity-50"
                >
                  {submitting ? "Working…" : (mode === "direct" ? "Confirm booking" : "Send link")}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 5a: done (direct) ── */}
          {step === "done" && client && selectedType && selectedSlot && (
            <div className="space-y-4">
              <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 px-4 py-4">
                <div className="text-sm font-semibold text-emerald-900">
                  ✅ Booked {client.display_name ?? client.client_id}
                </div>
                <div className="text-xs text-emerald-800 mt-1">
                  {selectedType.label} · {selectedSlot.dateLabel} at {selectedSlot.label}
                </div>
                {bookingResult?.bookingUid && (
                  <div className="text-[11px] text-emerald-700 mt-2 font-mono">
                    booking uid: {bookingResult.bookingUid}
                  </div>
                )}
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>
                  ✉️ Cal.com emailed {client.display_name?.split(" ")[0] ?? "the client"} the
                  confirmation + calendar invite (Zoom link if set) and put the event on your calendar.
                </div>
                <div>
                  {bookingResult?.whatsappSent
                    ? `💬 WhatsApp confirmation sent to ${client.display_name?.split(" ")[0] ?? "the client"} too.`
                    : client.mobile_number
                      ? "💬 WhatsApp confirmation couldn't be sent — check the WhatsApp server. Email still went out."
                      : "💬 No WhatsApp sent — no mobile number on file. Email still went out."}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                {bookingResult?.calcomEventUrl && (
                  <a
                    href={bookingResult.calcomEventUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                  >
                    Open in Cal.com ↗
                  </a>
                )}
                <button
                  onClick={onClose}
                  className="rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-4 py-1.5"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* ── Step 5b: sent (send-link) ── */}
          {step === "sent" && client && sendResult && (
            <div className="space-y-4">
              <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 px-4 py-4">
                <div className="text-sm font-semibold text-emerald-900">
                  {sendResult.method === "manual"
                    ? "🔗 Link ready"
                    : `✅ Link sent via ${sendResult.method}`}
                </div>
                <div className="text-xs text-emerald-800 mt-1">
                  {sendResult.method === "manual"
                    ? "Copy the URL below and paste into WhatsApp manually."
                    : <>To <span className="font-medium">{client.display_name ?? client.client_id}</span>.</>}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono break-all select-all">
                {sendResult.url}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(sendResult.url)}
                  className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  📋 Copy link
                </button>
                <button
                  onClick={onClose}
                  className="rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-4 py-1.5"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Button wrapper ────────────────────────────────────────────────────────────

interface BookSessionButtonProps {
  prefilledClient?: BookSessionClient | null;
  allClients?: BookSessionClient[];
  variant?: "header" | "inline";
  label?: string;
}

export function BookSessionButton({
  prefilledClient = null,
  allClients = [],
  variant = "header",
  label = "📅 Book session",
}: BookSessionButtonProps) {
  const [open, setOpen] = React.useState(false);
  const cls = variant === "header"
    ? "rounded-md bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 transition-colors"
    : "rounded-lg border-2 border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-sm font-semibold px-4 py-2 transition-colors";
  return (
    <>
      <button onClick={() => setOpen(true)} className={cls}>{label}</button>
      <BookSessionModal
        open={open}
        onClose={() => setOpen(false)}
        prefilledClient={prefilledClient}
        allClients={allClients}
      />
    </>
  );
}

"use client";

import { useState } from "react";
import { broadcastAction } from "@/app/api/whatsapp/actions";

interface ClientRow {
  client_id: string;
  display_name?: string;
  mobile_number?: string;
  next_contact_date?: string;
  plan_status?: string;
}

interface Props {
  clients: ClientRow[];
  followUpDueIds: string[];
  recheckDueIds: string[];
  activeIds: string[];
}

type RecipientMode = "follow_up_due" | "recheck_due" | "all_active" | "custom";

/**
 * Templates suitable for BROADCAST (one-to-many to a list of clients).
 * Curated from the 17-template WABA inventory at
 *   ~/.claude/projects/-Users-shivani-code-healwithshivanih-ads/memory/project_whatsapp_templates.md
 *
 * Deliberately excluded from this dropdown — they belong on other surfaces:
 *   - fm_session_confirm / appt_*       per-session, sent from the calendar
 *   - fm_intake_invite / _reminder      handover flow, fires on programme signup
 *   - fm_programme_welcome              fires once when ochre handoff lands
 *   - fm_weekly_motivation              cron-driven (Sunday)
 *   - fm_start_date_check_v1            start-date cron
 *   - fm_weekly_*_v1 polls              live on the Weekly Check-in Poll panel
 *
 * MARKETING-category templates cost ~7× UTILITY per-message (~₹0.78 vs
 * ₹0.115). Surface that warning when one is picked so the coach doesn't
 * bulk-blast a 50-recipient broadcast on fm_encouragement.
 */
const APPROVED_TEMPLATES: { name: string; category: "UTILITY" | "MARKETING"; params: number; note?: string }[] = [
  { name: "fm_lab_reminder", category: "UTILITY", params: 2, note: "name / labs" },
  { name: "fm_supplement_instructions", category: "UTILITY", params: 2, note: "name / instructions" },
  { name: "fm_encouragement", category: "MARKETING", params: 2, note: "name / protocolHighlight" },
  { name: "fm_checkin_nudge", category: "MARKETING", params: 2, note: "name / symptom" },
];

export function BroadcastPanel({ clients, followUpDueIds, recheckDueIds, activeIds }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RecipientMode>("follow_up_due");
  // Selected client ids — independently editable regardless of mode.
  // Mode preset is just a one-click "select these" shortcut; the coach
  // can always tick/untick individual clients afterwards. That was the
  // confusing bit in v1 — coach picked "All active" but couldn't drop
  // one off without flipping to "Custom" and re-checking the rest.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(followUpDueIds));
  const [campaignName, setCampaignName] = useState("");
  const [params, setParams] = useState(["", "", ""]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyMode(next: RecipientMode) {
    setMode(next);
    if (next === "follow_up_due") setSelectedIds(new Set(followUpDueIds));
    else if (next === "recheck_due") setSelectedIds(new Set(recheckDueIds));
    else if (next === "all_active") setSelectedIds(new Set(activeIds));
    else setSelectedIds(new Set());
  }

  const recipientClients = clients.filter((c) => selectedIds.has(c.client_id));
  const recipientCount = recipientClients.length;

  const handleSend = async () => {
    if (!campaignName.trim()) { setError("Campaign name is required"); return; }
    if (recipientCount === 0) { setError("No recipients selected"); return; }
    setError(null);
    setSending(true);
    setResult(null);
    try {
      const filledParams = params.filter((p) => p.trim());
      const res = await broadcastAction(Array.from(selectedIds), campaignName.trim(), filledParams);
      setResult(res);
    } catch (e) {
      setError((e as Error).message ?? "Unknown error");
    } finally {
      setSending(false);
    }
  };

  const toggleClient = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      // Drop out of preset modes the instant the coach edits the list —
      // the radio chip stops claiming the selection matches a preset.
      setMode("custom");
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-border bg-muted/10">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-left hover:bg-muted/20 rounded-xl transition-colors"
      >
        <span>📢</span>
        <span>Broadcast</span>
        <span className="ml-auto text-muted-foreground text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {/* Recipient selector */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Quick-pick preset
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: "follow_up_due",  label: `Follow-up due (${followUpDueIds.length})` },
                  { value: "recheck_due",    label: `Recheck due (${recheckDueIds.length})` },
                  { value: "all_active",     label: `All active (${activeIds.length})` },
                  { value: "custom",         label: "Start blank" },
                ] as { value: RecipientMode; label: string }[]
              ).map(({ value, label }) => (
                <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="broadcast-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => applyMode(value)}
                    className="accent-indigo-600"
                  />
                  <span className="text-xs">{label}</span>
                </label>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground italic">
              Tick / untick individual clients below to fine-tune. Selection is
              independent of the preset — coach has final say.
            </p>
          </div>

          {/* Recipient checklist — always visible. The preset above seeds
              what's pre-checked; checkboxes below override at any time. */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="font-semibold uppercase tracking-wide">
                {recipientCount} selected
              </span>
              <button
                type="button"
                className="underline hover:text-foreground disabled:opacity-40 disabled:no-underline"
                disabled={recipientCount === clients.length || clients.length === 0}
                onClick={() => setSelectedIds(new Set(clients.map((c) => c.client_id)))}
              >
                Select all visible
              </button>
              <button
                type="button"
                className="underline hover:text-foreground disabled:opacity-40 disabled:no-underline"
                disabled={recipientCount === 0}
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </button>
            </div>
            <div className="rounded-lg border bg-white p-2 max-h-56 overflow-y-auto space-y-0.5">
              {clients.length === 0 && (
                <p className="text-xs text-muted-foreground italic px-2 py-1">
                  No clients found.
                </p>
              )}
              {clients.map((c) => {
                const checked = selectedIds.has(c.client_id);
                return (
                  <label
                    key={c.client_id}
                    className={`flex items-center gap-2 cursor-pointer px-2 py-1 rounded ${
                      checked ? "bg-indigo-50/60" : "hover:bg-muted/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleClient(c.client_id)}
                      className="accent-indigo-600"
                    />
                    <span className="text-xs font-medium">
                      {c.display_name ?? c.client_id}
                    </span>
                    {c.mobile_number ? (
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {c.mobile_number}
                      </span>
                    ) : (
                      <span className="text-[10px] text-red-400 ml-auto">
                        no phone
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {/* Campaign name — dropdown of all 17 approved templates. */}
          {(() => {
            const selected = APPROVED_TEMPLATES.find((t) => t.name === campaignName.trim());
            const isMarketing = selected?.category === "MARKETING";
            return (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Campaign / Template name
                </label>
                <select
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— pick a Meta-approved template —</option>
                  <optgroup label="UTILITY (~₹0.115/msg)">
                    {APPROVED_TEMPLATES.filter((t) => t.category === "UTILITY").map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name} · {t.params} param{t.params !== 1 ? "s" : ""}{t.note ? ` (${t.note})` : ""}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="MARKETING — 7× cost (~₹0.78/msg)">
                    {APPROVED_TEMPLATES.filter((t) => t.category === "MARKETING").map((t) => (
                      <option key={t.name} value={t.name}>
                        ⚠ {t.name} · {t.params} param{t.params !== 1 ? "s" : ""}{t.note ? ` (${t.note})` : ""}
                      </option>
                    ))}
                  </optgroup>
                </select>
                {isMarketing && recipientCount > 0 && (
                  <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
                    ⚠ <strong>{selected.name}</strong> is Meta-classified
                    MARKETING (~₹0.78/msg). Sending to{" "}
                    <strong>{recipientCount}</strong> recipient
                    {recipientCount !== 1 ? "s" : ""} ≈{" "}
                    <strong>₹{(recipientCount * 0.78).toFixed(2)}</strong>. A
                    UTILITY template would be ~₹{(recipientCount * 0.115).toFixed(2)}.
                  </p>
                )}
              </div>
            );
          })()}

          {/* Template params */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Template parameters</p>
            <div className="grid grid-cols-3 gap-2">
              {params.map((p, i) => (
                <label key={i} className="space-y-0.5">
                  <span className="text-[10px] text-muted-foreground">Param {i + 1}</span>
                  <input
                    type="text"
                    value={p}
                    onChange={(e) => {
                      const next = [...params];
                      next[i] = e.target.value;
                      setParams(next);
                    }}
                    placeholder={`{{param${i + 1}}}`}
                    className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* Preview */}
          {recipientCount > 0 && (
            <div className="rounded-lg border bg-white p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">
                Will send to {recipientCount} client{recipientCount !== 1 ? "s" : ""}:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {recipientClients.map((c) => (
                  <span
                    key={c.client_id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-indigo-50 text-indigo-800 border border-indigo-200"
                  >
                    <span className="font-medium">{c.display_name ?? c.client_id}</span>
                    {c.mobile_number && <span className="text-indigo-500">· {c.mobile_number}</span>}
                    {!c.mobile_number && <span className="text-red-400">· no phone</span>}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground pt-1 border-t border-dashed">
                Sender shows as <code>+91 89765 63971</code> (WABA display
                name &ldquo;The Ochre Tree&rdquo; still PENDING_REVIEW at
                Meta). Branding comes from the in-body sign-off.
              </p>
            </div>
          )}
          {recipientCount === 0 && mode !== "custom" && (
            <p className="text-xs text-muted-foreground italic">No clients in this group.</p>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-red-600 rounded-md border border-red-200 bg-red-50 px-3 py-2">{error}</p>
          )}

          {/* Result */}
          {result && (
            <div className={`rounded-md border px-3 py-2 text-xs space-y-1 ${result.failed === 0 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
              <p className="font-semibold">
                {result.sent} sent · {result.failed} failed
              </p>
              {result.errors.length > 0 && (
                <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={sending || recipientCount === 0 || !campaignName.trim()}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
            style={{ background: "var(--brand-indigo, #2B2D42)" }}
          >
            {sending ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Sending…
              </>
            ) : (
              `📤 Send to ${recipientCount} client${recipientCount !== 1 ? "s" : ""}`
            )}
          </button>
        </div>
      )}
    </div>
  );
}

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
interface ApprovedTemplate {
  name: string;
  category: "UTILITY" | "MARKETING";
  /** Param labels in {{1}}, {{2}} order — drives the input field labels
   *  in the panel so coach knows what each slot means. */
  paramLabels: string[];
  /** Exact body verbatim as APPROVED by Meta on the WABA. Mirrors the
   *  TEMPLATES entries in whatsapp-server/scripts/submit-templates.js
   *  — keep both in sync. Coach sees this rendered with {{1}}/{{2}}
   *  filled from the inputs as a live preview. */
  body: string;
}

const SIGNOFF = `\n\n— ${process.env.NEXT_PUBLIC_COACH_NAME || "Shivani Hari"}\nYour Functional Health Coach`;

const APPROVED_TEMPLATES: ApprovedTemplate[] = [
  {
    name: "fm_lab_reminder",
    category: "UTILITY",
    paramLabels: ["name", "labs"],
    body: `Hi {{1}}, a gentle reminder to get your labs done before our next session. Here are the tests we discussed: {{2}}. Please share the report at least 2 days before our appointment. 🙏${SIGNOFF}`,
  },
  {
    name: "fm_supplement_instructions",
    category: "UTILITY",
    paramLabels: ["name", "instructions"],
    body: `Hi {{1}}, here are your supplement instructions for this week: {{2}}. Take them as discussed and note any changes. Feel free to message if you have questions! 💊${SIGNOFF}`,
  },
  {
    name: "fm_encouragement",
    category: "MARKETING",
    paramLabels: ["name", "protocolHighlight"],
    body: `Hi {{1}}, you're doing great! Healing takes time and consistency — be patient with yourself. Keep going with {{2}}. Rooting for you! 💚${SIGNOFF}`,
  },
  {
    name: "fm_checkin_nudge",
    category: "MARKETING",
    paramLabels: ["name", "symptom"],
    body: `Hi {{1}}, just checking in! How are you feeling on the protocol? Any changes in {{2}}? Would love to hear how things are going. 🌿${SIGNOFF}`,
  },
];

/** Render {{N}} placeholders with the coach's typed values. Unfilled
 *  slots stay as {{paramLabel}} so the preview reads cleanly instead
 *  of "Hi  ,". */
function renderBodyPreview(template: ApprovedTemplate, params: string[]): string {
  return template.body.replace(/\{\{(\d+)\}\}/g, (_, idxStr) => {
    const i = parseInt(idxStr, 10) - 1;
    const val = (params[i] ?? "").trim();
    if (val) return val;
    const label = template.paramLabels[i] ?? `param${i + 1}`;
    return `{{${label}}}`;
  });
}

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
    // Send exactly N params where N = the template's declared paramLabels.
    // Trailing empties become "" so Meta receives a placeholder for each
    // slot — better than dropping (which makes the {{N}} render as
    // literally "{{2}}" in the client's WhatsApp bubble).
    const selected = APPROVED_TEMPLATES.find((t) => t.name === campaignName.trim());
    const slotCount = selected?.paramLabels.length ?? 0;
    const sendParams = Array.from({ length: slotCount }, (_, i) => (params[i] ?? "").trim());
    const missing = selected
      ? sendParams
          .map((v, i) => (v ? null : selected.paramLabels[i]))
          .filter((x): x is string => !!x)
      : [];
    if (missing.length > 0) {
      setError(`Fill in ${missing.map((m) => `{{${m}}}`).join(", ")} before sending`);
      return;
    }
    // Hard confirm gate (durable rule: feedback-send-buttons-persist-state).
    // Bulk sends have the largest misclick blast radius in the whole app —
    // one tap fans out to N clients with no per-row "are you sure".
    // Spell out the cohort size + template + the literal {{1}} / {{2}}
    // values that will be substituted, so the coach catches typos in the
    // params or a stale "all active" recipient set BEFORE Meta sends N
    // copies. Confirms once; no second prompt on per-client failures.
    const n = selectedIds.size;
    const paramSummary = sendParams
      .map((v, i) => `  {{${i + 1}}} = ${v || "(empty)"}`)
      .join("\n");
    const ok = confirm(
      `Send "${campaignName.trim()}" to ${n} client${n === 1 ? "" : "s"}?\n\n` +
      `${paramSummary}\n\n` +
      `This fires the template to every selected client and cannot be undone.`,
    );
    if (!ok) return;
    setError(null);
    setSending(true);
    setResult(null);
    try {
      const res = await broadcastAction(Array.from(selectedIds), campaignName.trim(), sendParams);
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
                        {t.name} · {t.paramLabels.length} param{t.paramLabels.length !== 1 ? "s" : ""}{" "}
                        ({t.paramLabels.join(" / ")})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="MARKETING — 7× cost (~₹0.78/msg)">
                    {APPROVED_TEMPLATES.filter((t) => t.category === "MARKETING").map((t) => (
                      <option key={t.name} value={t.name}>
                        ⚠ {t.name} · {t.paramLabels.length} param{t.paramLabels.length !== 1 ? "s" : ""}{" "}
                        ({t.paramLabels.join(" / ")})
                      </option>
                    ))}
                  </optgroup>
                </select>

                {/* Live message preview — show the actual approved body
                    with {{1}}/{{2}} substituted by what the coach has
                    typed. Reads like the WhatsApp bubble the client will
                    see, so coach can sanity-check tone + spelling before
                    sending. Unfilled slots stay as {{paramLabel}}. */}
                {selected && (
                  <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                      <span>💬</span>
                      <span>Message preview</span>
                      <span className="text-emerald-700/70 font-normal lowercase tracking-normal">
                        — exactly what each client sees on WhatsApp
                      </span>
                    </div>
                    <pre
                      className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-emerald-950 m-0"
                      style={{ fontFamily: "inherit" }}
                    >
                      {renderBodyPreview(selected, params)}
                    </pre>
                  </div>
                )}
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

          {/* Template params — render ONLY the slots the picked template
              defines. Previous version always rendered 3, which was both
              wasteful and confusing for 2-param templates (the 3rd input
              just silently sent an extra param Meta ignores). */}
          {(() => {
            const selected = APPROVED_TEMPLATES.find((t) => t.name === campaignName.trim());
            const slotCount = selected?.paramLabels.length ?? 0;
            if (slotCount === 0) return null;
            return (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Template parameters
                </p>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `repeat(${Math.min(slotCount, 3)}, minmax(0, 1fr))` }}
                >
                  {selected!.paramLabels.map((label, i) => (
                    <label key={i} className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        {`{{${label}}}`}
                      </span>
                      <input
                        type="text"
                        value={params[i] ?? ""}
                        onChange={(e) => {
                          const next = [...params];
                          while (next.length <= i) next.push("");
                          next[i] = e.target.value;
                          setParams(next);
                        }}
                        placeholder={label === "name" ? "Hariharan" : `e.g. ${label}…`}
                        className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
              </div>
            );
          })()}

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

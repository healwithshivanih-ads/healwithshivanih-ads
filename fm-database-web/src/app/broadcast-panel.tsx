"use client";

import { useMemo, useState } from "react";
import { broadcastAction } from "@/app/api/aisensy-webhook/actions";

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
 * AiSensy campaign templates that are registered + Meta-approved on the
 * dashboard. Coach picks one from the dropdown; the slug is what gets
 * POSTed as `campaignName` to AiSensy's direct API.
 *
 * Keep in sync with src/app/clients/[id]/message-templates-panel.tsx ::
 * APPROVED_AISENSY_CAMPAIGNS so the per-client preview + broadcast both
 * use the same single source of truth.
 */
const AISENSY_TEMPLATES: { slug: string; label: string; hint: string; params: string[] }[] = [
  {
    slug: "fm_lab_reminder",
    label: "🧪 Lab reminder",
    hint: "Nudge to book / complete pending lab work.",
    params: ["client first name", "labs panel name", "deadline / date"],
  },
  {
    slug: "fm_session_confirm",
    label: "📅 Session confirmation",
    hint: "Confirm an upcoming consultation.",
    params: ["client first name", "session date", "session type"],
  },
  {
    slug: "fm_supplement_instructions",
    label: "💊 Supplement instructions",
    hint: "Restate dosing / timing for an active protocol.",
    params: ["client first name", "supplement name", "instruction line"],
  },
  {
    slug: "fm_encouragement",
    label: "✨ Encouragement",
    hint: "Mid-protocol motivational nudge.",
    params: ["client first name", "milestone / progress note", ""],
  },
];

export function BroadcastPanel({ clients, followUpDueIds, recheckDueIds, activeIds }: Props) {
  // Promoted to top of dashboard 2026-05-13 — start expanded so the coach
  // doesn't have to click to reveal it.
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<RecipientMode>("follow_up_due");
  const [customIds, setCustomIds] = useState<Set<string>>(new Set());
  const [campaignName, setCampaignName] = useState<string>(AISENSY_TEMPLATES[0].slug);
  // Per-recipient removals — coach can drop individual clients from the
  // computed group without having to switch to "custom" mode + recheck.
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [params, setParams] = useState(["", "", ""]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function getRecipientIds(): string[] {
    switch (mode) {
      case "follow_up_due":  return followUpDueIds;
      case "recheck_due":    return recheckDueIds;
      case "all_active":     return activeIds;
      case "custom":         return Array.from(customIds);
    }
  }

  const computedIds = getRecipientIds();
  const recipientIds = useMemo(
    () => computedIds.filter((id) => !excludedIds.has(id)),
    [computedIds, excludedIds],
  );
  const recipientClients = clients.filter((c) => recipientIds.includes(c.client_id));
  const recipientCount = recipientClients.length;
  const excludedClients = clients.filter((c) => excludedIds.has(c.client_id) && computedIds.includes(c.client_id));

  const activeTemplate = AISENSY_TEMPLATES.find((t) => t.slug === campaignName);

  const handleSend = async () => {
    if (!campaignName.trim()) { setError("Campaign name is required"); return; }
    if (recipientCount === 0) { setError("No recipients selected"); return; }
    setError(null);
    setSending(true);
    setResult(null);
    try {
      const filledParams = params.filter((p) => p.trim());
      const res = await broadcastAction(recipientIds, campaignName.trim(), filledParams);
      setResult(res);
    } catch (e) {
      setError((e as Error).message ?? "Unknown error");
    } finally {
      setSending(false);
    }
  };

  const toggleCustom = (id: string) => {
    setCustomIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const removeRecipient = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const restoreRecipient = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleModeChange = (m: RecipientMode) => {
    setMode(m);
    setCustomIds(new Set());
    setExcludedIds(new Set());
    setResult(null);
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
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recipients</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { value: "follow_up_due",  label: `Follow-up due (${followUpDueIds.length})` },
                  { value: "recheck_due",    label: `Recheck due (${recheckDueIds.length})` },
                  { value: "all_active",     label: `All active (${activeIds.length})` },
                  { value: "custom",         label: "Custom selection" },
                ] as { value: RecipientMode; label: string }[]
              ).map(({ value, label }) => (
                <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="broadcast-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => handleModeChange(value)}
                    className="accent-indigo-600"
                  />
                  <span className="text-xs">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Custom selection checkboxes */}
          {mode === "custom" && (
            <div className="rounded-lg border bg-white p-3 max-h-48 overflow-y-auto space-y-1">
              {clients.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No clients found.</p>
              )}
              {clients.map((c) => (
                <label key={c.client_id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 px-1 py-0.5 rounded">
                  <input
                    type="checkbox"
                    checked={customIds.has(c.client_id)}
                    onChange={() => toggleCustom(c.client_id)}
                    className="accent-indigo-600"
                  />
                  <span className="text-xs font-medium">{c.display_name ?? c.client_id}</span>
                  {c.mobile_number && (
                    <span className="text-[10px] text-muted-foreground ml-auto">{c.mobile_number}</span>
                  )}
                  {!c.mobile_number && (
                    <span className="text-[10px] text-red-400 ml-auto">no phone</span>
                  )}
                </label>
              ))}
            </div>
          )}

          {/* Campaign template — dropdown of AiSensy-approved templates only.
              Free-form text removed because every broadcast needs a template
              that's already registered on Meta + AiSensy; coach hitting the
              wrong slug used to fail silently. */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Template
            </label>
            <select
              value={campaignName}
              onChange={(e) => {
                setCampaignName(e.target.value);
                setResult(null);
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {AISENSY_TEMPLATES.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.label} — {t.slug}
                </option>
              ))}
            </select>
            {activeTemplate && (
              <p className="text-[11px] text-muted-foreground">
                {activeTemplate.hint}
              </p>
            )}
          </div>

          {/* Template params — labels come from the selected template's
              `params` array so the coach knows what each {{N}} stands for. */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Template parameters</p>
            <div className="grid grid-cols-3 gap-2">
              {params.map((p, i) => {
                const hint = activeTemplate?.params?.[i] ?? `param ${i + 1}`;
                return (
                  <label key={i} className="space-y-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {`{{${i + 1}}}`} · {hint || "(unused)"}
                    </span>
                    <input
                      type="text"
                      value={p}
                      onChange={(e) => {
                        const next = [...params];
                        next[i] = e.target.value;
                        setParams(next);
                      }}
                      placeholder={hint || `param ${i + 1}`}
                      disabled={!hint}
                      className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none disabled:opacity-40"
                    />
                  </label>
                );
              })}
            </div>
          </div>

          {/* Preview — each chip has an × to drop that client from the broadcast
              without switching the recipient mode. Excluded chips show below
              with a + to restore. */}
          {recipientCount > 0 && (
            <div className="rounded-lg border bg-white p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">
                Will send to {recipientCount} client{recipientCount !== 1 ? "s" : ""}{excludedClients.length > 0 ? ` · ${excludedClients.length} excluded` : ""}:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {recipientClients.map((c) => (
                  <span
                    key={c.client_id}
                    className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[10px] bg-indigo-50 text-indigo-800 border border-indigo-200"
                  >
                    <span className="font-medium">{c.display_name ?? c.client_id}</span>
                    {c.mobile_number && <span className="text-indigo-500">· {c.mobile_number}</span>}
                    {!c.mobile_number && <span className="text-red-400">· no phone</span>}
                    <button
                      type="button"
                      onClick={() => removeRecipient(c.client_id)}
                      title="Remove from this broadcast"
                      className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full text-indigo-600 hover:bg-indigo-200 hover:text-indigo-900 transition-colors text-[11px] leading-none"
                      aria-label={`Remove ${c.display_name ?? c.client_id}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {excludedClients.length > 0 && (
            <div className="rounded-lg border border-dashed bg-muted/20 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">
                Excluded ({excludedClients.length}) — click + to add back:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {excludedClients.map((c) => (
                  <span
                    key={c.client_id}
                    className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[10px] bg-white text-muted-foreground border border-dashed line-through decoration-muted-foreground/30"
                  >
                    <span>{c.display_name ?? c.client_id}</span>
                    <button
                      type="button"
                      onClick={() => restoreRecipient(c.client_id)}
                      title="Add back to the broadcast"
                      className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-emerald-100 hover:text-emerald-700 transition-colors text-[11px] leading-none no-underline"
                      aria-label={`Restore ${c.display_name ?? c.client_id}`}
                    >
                      +
                    </button>
                  </span>
                ))}
              </div>
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

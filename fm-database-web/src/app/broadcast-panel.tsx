"use client";

import { useMemo, useState } from "react";
import { broadcastAction } from "@/app/api/aisensy-webhook/actions";
import { broadcastEmailAction } from "@/app/api/email/actions";

interface ClientRow {
  client_id: string;
  display_name?: string;
  mobile_number?: string;
  /** Optional — only set when the dashboard loader populates it. */
  email?: string;
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
type Channel = "whatsapp" | "email";

/**
 * AiSensy campaign templates that are registered + Meta-approved on the
 * dashboard. Coach picks one from the dropdown; the slug is what gets
 * POSTed as `campaignName` to AiSensy's direct API.
 *
 * Keep in sync with src/app/clients/[id]/message-templates-panel.tsx ::
 * APPROVED_AISENSY_CAMPAIGNS so the per-client preview + broadcast both
 * use the same single source of truth.
 */
interface BroadcastTemplate {
  slug: string;
  label: string;
  hint: string;
  /** Per-position param hints — matches AiSensy template {{1}}, {{2}}, {{3}}. */
  params: string[];
  /** Email subject when broadcasting via email channel. Uses {{1}}, {{name}} placeholders. */
  emailSubject: string;
  /** Email body when broadcasting via email channel. */
  emailBody: string;
}

const AISENSY_TEMPLATES: BroadcastTemplate[] = [
  {
    slug: "fm_lab_reminder",
    label: "🧪 Lab reminder",
    hint: "Nudge to book / complete pending lab work.",
    params: ["client first name", "labs panel name", "deadline / date"],
    emailSubject: "{{name}} — your {{2}} labs",
    emailBody:
      `Hi {{name}},\n\n` +
      `Quick reminder to book / complete your {{2}} labs — ideally by {{3}}.\n\n` +
      `The earlier we have the results, the sooner we can refine your protocol. ` +
      `Let me know if you need a referral to the lab or help reading the requisition.\n\n` +
      `Warmly,`,
  },
  {
    slug: "fm_session_confirm",
    label: "📅 Session confirmation",
    hint: "Confirm an upcoming consultation.",
    params: ["client first name", "session date", "session type"],
    emailSubject: "Confirming your {{3}} session on {{2}}",
    emailBody:
      `Hi {{name}},\n\n` +
      `Confirming your upcoming {{3}} session on {{2}}.\n\n` +
      `If you haven't already, please complete the pre-session prep ` +
      `(intake form / food journal / lab uploads) so we can use our time well.\n\n` +
      `Looking forward to it,`,
  },
  {
    slug: "fm_supplement_instructions",
    label: "💊 Supplement instructions",
    hint: "Restate dosing / timing for an active protocol.",
    params: ["client first name", "supplement name", "instruction line"],
    emailSubject: "{{name}} — quick note on your {{2}}",
    emailBody:
      `Hi {{name}},\n\n` +
      `Just a quick reminder on your {{2}}:\n\n` +
      `{{3}}\n\n` +
      `Reply with any questions or side effects — happy to adjust if needed.\n\n` +
      `Warmly,`,
  },
  {
    slug: "fm_encouragement",
    label: "✨ Encouragement",
    hint: "Mid-protocol motivational nudge.",
    params: ["client first name", "milestone / progress note", ""],
    emailSubject: "{{name}} — a midway check-in 🌱",
    emailBody:
      `Hi {{name}},\n\n` +
      `Just wanted to drop in mid-protocol with a quick note: {{2}}\n\n` +
      `Small consistent wins compound — keep going. I'm here if anything's coming up.\n\n` +
      `Cheering you on,`,
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
  // Channel picker — WhatsApp and/or Email. Both default on; the coach
  // ticks/unticks before sending.
  const [channels, setChannels] = useState<Set<Channel>>(new Set(["whatsapp"]));
  // Email subject + body, pre-filled from the selected template, editable.
  const initialTemplate = AISENSY_TEMPLATES[0];
  const [emailSubject, setEmailSubject] = useState<string>(initialTemplate.emailSubject);
  const [emailBody, setEmailBody] = useState<string>(initialTemplate.emailBody);
  const [emailEdited, setEmailEdited] = useState<boolean>(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    whatsapp?: { sent: number; failed: number; errors: string[] };
    email?: { sent: number; failed: number; errors: string[] };
  } | null>(null);
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
    if (!campaignName.trim()) { setError("Pick a template"); return; }
    if (channels.size === 0) { setError("Pick at least one channel (WhatsApp / Email)"); return; }
    if (recipientCount === 0) { setError("No recipients selected"); return; }
    setError(null);
    setSending(true);
    setResult(null);
    try {
      const filledParams = params.filter((p) => p.trim());
      const next: NonNullable<typeof result> = {};
      // Run in parallel — both fan out client-by-client server-side, and a
      // single request can drive both endpoints in flight at once.
      const promises: Promise<void>[] = [];
      if (channels.has("whatsapp")) {
        promises.push(
          broadcastAction(recipientIds, campaignName.trim(), filledParams).then(
            (r) => { next.whatsapp = r; },
          ),
        );
      }
      if (channels.has("email")) {
        promises.push(
          broadcastEmailAction(recipientIds, emailSubject, emailBody, params).then(
            (r) => { next.email = r; },
          ),
        );
      }
      await Promise.all(promises);
      setResult(next);
    } catch (e) {
      setError((e as Error).message ?? "Unknown error");
    } finally {
      setSending(false);
    }
  };

  const handleTemplateChange = (slug: string) => {
    setCampaignName(slug);
    setResult(null);
    // If coach hasn't manually touched the email fields yet, swap in the
    // new template's email defaults. Otherwise preserve her edits.
    if (!emailEdited) {
      const t = AISENSY_TEMPLATES.find((x) => x.slug === slug);
      if (t) {
        setEmailSubject(t.emailSubject);
        setEmailBody(t.emailBody);
      }
    }
  };

  const toggleChannel = (c: Channel) => {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
    setResult(null);
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
              onChange={(e) => handleTemplateChange(e.target.value)}
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

          {/* Channel picker — WhatsApp / Email / both. Coach toggles either
              or both. Counts in parens show how many recipients in the
              current group have the channel's contact field on file. */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Channels
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={channels.has("whatsapp")}
                  onChange={() => toggleChannel("whatsapp")}
                  className="accent-emerald-600"
                />
                <span className="text-xs">
                  📱 WhatsApp{" "}
                  <span className="text-muted-foreground">
                    ({recipientClients.filter((c) => c.mobile_number).length})
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={channels.has("email")}
                  onChange={() => toggleChannel("email")}
                  className="accent-indigo-600"
                />
                <span className="text-xs">
                  ✉️ Email{" "}
                  <span className="text-muted-foreground">
                    ({recipientClients.filter((c) => c.email).length})
                  </span>
                </span>
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Clients with no contact field for a checked channel are skipped silently.
            </p>
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
            <p className="text-[10px] text-muted-foreground">
              These fill in <code>{`{{1}}`}</code>, <code>{`{{2}}`}</code>,{" "}
              <code>{`{{3}}`}</code> in both the WhatsApp template and the
              email subject + body. <code>{`{{name}}`}</code> is auto-filled
              with each client&apos;s first name on send.
            </p>
          </div>

          {/* Email subject + body — only relevant when the email channel is
              checked. Pre-filled from the selected template; coach can edit
              freely. Once she edits, switching templates won't overwrite. */}
          {channels.has("email") && (
            <div className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/30 p-3">
              <p className="text-xs font-semibold text-indigo-900 uppercase tracking-wide">
                Email subject + body
                {emailEdited && (
                  <span className="ml-2 normal-case tracking-normal text-[10px] font-medium text-indigo-700">
                    (edited — switching templates won&apos;t overwrite)
                  </span>
                )}
              </p>
              <label className="block space-y-0.5">
                <span className="text-[10px] text-indigo-900">Subject</span>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => {
                    setEmailSubject(e.target.value);
                    setEmailEdited(true);
                  }}
                  placeholder="{{name}} — your labs"
                  className="w-full rounded border border-indigo-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </label>
              <label className="block space-y-0.5">
                <span className="text-[10px] text-indigo-900">Body</span>
                <textarea
                  value={emailBody}
                  onChange={(e) => {
                    setEmailBody(e.target.value);
                    setEmailEdited(true);
                  }}
                  rows={8}
                  placeholder="Hi {{name}}, ..."
                  className="w-full rounded border border-indigo-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 font-sans"
                />
              </label>
              {emailEdited && (
                <button
                  type="button"
                  onClick={() => {
                    const t = AISENSY_TEMPLATES.find((x) => x.slug === campaignName);
                    if (t) {
                      setEmailSubject(t.emailSubject);
                      setEmailBody(t.emailBody);
                    }
                    setEmailEdited(false);
                  }}
                  className="text-[11px] text-indigo-700 hover:underline"
                >
                  ↺ Reset to template defaults
                </button>
              )}
            </div>
          )}

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

          {/* Result — per-channel block, expanded so the coach can see
              exactly which side succeeded / failed when sending to both. */}
          {result && (
            <div className="space-y-2">
              {(["whatsapp", "email"] as Channel[])
                .filter((ch) => result[ch] != null)
                .map((ch) => {
                  const r = result[ch]!;
                  const allOk = r.failed === 0;
                  const label = ch === "whatsapp" ? "📱 WhatsApp" : "✉️ Email";
                  return (
                    <div
                      key={ch}
                      className={`rounded-md border px-3 py-2 text-xs space-y-1 ${allOk ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}
                    >
                      <p className="font-semibold">
                        {label}: {r.sent} sent · {r.failed} failed
                      </p>
                      {r.errors.length > 0 && (
                        <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                          {r.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {/* Send button — label changes with selected channels. */}
          <button
            onClick={handleSend}
            disabled={
              sending ||
              recipientCount === 0 ||
              !campaignName.trim() ||
              channels.size === 0
            }
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
            ) : (() => {
              const parts: string[] = [];
              if (channels.has("whatsapp")) parts.push("WhatsApp");
              if (channels.has("email")) parts.push("email");
              const via = parts.length === 0 ? "no channel" : parts.join(" + ");
              return `📤 Send via ${via} to ${recipientCount} client${recipientCount !== 1 ? "s" : ""}`;
            })()}
          </button>
        </div>
      )}
    </div>
  );
}

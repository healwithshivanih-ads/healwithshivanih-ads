"use client";

import { useState, useEffect, useCallback } from "react";
import {
  loadMessageTemplatesAction,
  saveMessageTemplateAction,
  deleteMessageTemplateAction,
  sendWhatsAppAction,
  checkAisensyConfigAction,
  type MessageTemplate,
} from "@/app/api/aisensy-webhook/actions";

interface Props {
  clientId: string;
  clientName: string;
  clientPhone?: string;
  aisensyConfigured?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract {{variable}} tokens from a template body */
function extractVariables(body: string): string[] {
  const matches = body.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/[{}]/g, "")))];
}

/** Replace {{variable}} tokens with their values */
function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/** Slugify a template name */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const CATEGORY_COLORS: Record<string, string> = {
  labs:        "bg-purple-50 text-purple-700 border-purple-200",
  protocol:    "bg-blue-50 text-blue-700 border-blue-200",
  "follow-up": "bg-emerald-50 text-emerald-700 border-emerald-200",
  appointment: "bg-amber-50 text-amber-700 border-amber-200",
  support:     "bg-pink-50 text-pink-700 border-pink-200",
};

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_COLORS[category] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {category}
    </span>
  );
}

// ── Add template form ─────────────────────────────────────────────────────────

function AddTemplateForm({
  initialBody,
  onSaved,
  onCancel,
}: {
  initialBody?: string;
  onSaved: (t: MessageTemplate) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("follow-up");
  const [body, setBody] = useState(initialBody ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim() || !body.trim()) { setError("Name and body are required"); return; }
    setSaving(true); setError(null);
    const template: MessageTemplate = {
      slug: slugify(name),
      name: name.trim(),
      category: category.trim() || "general",
      body: body.trim(),
      variables: extractVariables(body),
    };
    const res = await saveMessageTemplateAction(template);
    setSaving(false);
    if (!res.ok) { setError(res.error ?? "Failed to save"); return; }
    onSaved(template);
  };

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">New template</span>
        <button onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5">
          <span className="text-[10px] text-muted-foreground">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Lab Reminder"
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[10px] text-muted-foreground">Category</span>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. labs, protocol"
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none"
          />
        </label>
      </div>
      <label className="block space-y-0.5">
        <span className="text-[10px] text-muted-foreground">
          Body — use {"{{variable}}"} for dynamic parts
        </span>
        <textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Hi {{name}}, your next appointment is on {{date}}...`}
          className="w-full rounded border border-input bg-background px-2 py-1.5 text-xs focus:outline-none resize-none font-mono"
        />
      </label>
      {extractVariables(body).length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Variables detected: {extractVariables(body).map((v) => `{{${v}}}`).join(", ")}
        </p>
      )}
      {error && <p className="text-[10px] text-red-600">{error}</p>}
      <button
        onClick={handleSave}
        disabled={saving}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50"
        style={{ background: "var(--brand-indigo, #2B2D42)" }}
      >
        {saving ? "Saving…" : "Save template"}
      </button>
    </div>
  );
}

// ── Compose view ──────────────────────────────────────────────────────────────

function ComposeView({
  template,
  clientName,
  clientPhone,
  aisensyConfigured,
  onBack,
}: {
  template: MessageTemplate;
  clientName: string;
  clientPhone?: string;
  aisensyConfigured?: boolean;
  onBack: () => void;
}) {
  const vars = extractVariables(template.body);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of vars) {
      if (v === "name") init[v] = clientName;
    }
    return init;
  });
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const filled = fillTemplate(template.body, values);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(filled);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSend = async () => {
    if (!clientPhone) return;
    setSending(true); setSendResult(null);
    const res = await sendWhatsAppAction(clientPhone, template.slug, Object.values(values));
    setSending(false);
    setSendResult(res);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-[11px] text-muted-foreground hover:text-foreground">← Back</button>
        <span className="text-xs font-semibold">{template.name}</span>
        <CategoryBadge category={template.category} />
      </div>

      {/* Variable inputs */}
      {vars.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Fill in variables</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {vars.map((v) => (
              <label key={v} className="space-y-0.5">
                <span className="text-[10px] text-muted-foreground">{`{{${v}}}`}</span>
                <input
                  type="text"
                  value={values[v] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [v]: e.target.value }))}
                  className="w-full rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Live preview textarea */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Preview — edit freely</p>
        <textarea
          rows={6}
          value={filled}
          readOnly
          className="w-full rounded border border-input bg-muted/20 px-3 py-2 text-xs focus:outline-none resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border hover:bg-muted transition-colors"
        >
          {copied ? "✓ Copied" : "📋 Copy"}
        </button>

        {aisensyConfigured && clientPhone && (
          <button
            onClick={handleSend}
            disabled={sending}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 transition-opacity"
            style={{ background: "var(--brand-indigo, #2B2D42)" }}
          >
            {sending ? "Sending…" : "📤 Send via AiSensy"}
          </button>
        )}

        {aisensyConfigured && !clientPhone && (
          <span className="text-[10px] text-muted-foreground italic">No phone number on file for this client</span>
        )}
      </div>

      {sendResult && (
        <p className={`text-xs rounded border px-3 py-2 ${sendResult.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {sendResult.ok ? "✓ Message sent via AiSensy" : `Error: ${sendResult.error}`}
        </p>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function MessageTemplatesPanel({ clientId, clientName, clientPhone, aisensyConfigured: aisensyConfiguredProp }: Props) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [aisensyConfigured, setAisensyConfigured] = useState<boolean>(aisensyConfiguredProp ?? false);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    const [ts, cfg] = await Promise.all([
      loadMessageTemplatesAction(),
      checkAisensyConfigAction(),
    ]);
    setTemplates(ts);
    setAisensyConfigured(cfg.configured);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open && templates.length === 0) {
      loadTemplates();
    }
  }, [open, templates.length, loadTemplates]);

  const handleDelete = async (slug: string) => {
    await deleteMessageTemplateAction(slug);
    setTemplates((prev) => prev.filter((t) => t.slug !== slug));
  };

  // Group templates by category
  const grouped = templates.reduce<Record<string, MessageTemplate[]>>((acc, t) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {});

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-lg border bg-background"
    >
      <summary className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer hover:bg-muted/30 rounded-lg select-none list-none">
        <span>💬</span>
        <span>Send message</span>
        <span className="ml-auto text-muted-foreground">{open ? "▲" : "▼"}</span>
      </summary>

      <div className="px-3 pb-3 space-y-3 border-t">
        {loading && <p className="text-xs text-muted-foreground italic pt-2">Loading templates…</p>}

        {!loading && !selected && !showAddForm && (
          <>
            {Object.entries(grouped).map(([cat, ts]) => (
              <div key={cat} className="space-y-2 pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <CategoryBadge category={cat} />
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ts.map((t) => (
                    <div
                      key={t.slug}
                      className="rounded-lg border bg-muted/10 hover:bg-muted/30 transition-colors p-2.5 space-y-1"
                    >
                      <div className="flex items-start justify-between gap-1">
                        <button
                          onClick={() => setSelected(t)}
                          className="text-xs font-semibold text-left hover:underline"
                        >
                          {t.name}
                        </button>
                        <button
                          onClick={() => handleDelete(t.slug)}
                          className="text-[10px] text-muted-foreground hover:text-red-600 shrink-0"
                          title="Delete template"
                        >
                          ✕
                        </button>
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-2">{t.body}</p>
                      {t.variables.length > 0 && (
                        <p className="text-[9px] text-muted-foreground/70">
                          vars: {t.variables.join(", ")}
                        </p>
                      )}
                      <button
                        onClick={() => setSelected(t)}
                        className="text-[10px] font-medium text-blue-600 hover:text-blue-800"
                      >
                        Use →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {templates.length === 0 && !loading && (
              <p className="text-xs text-muted-foreground italic pt-2">No templates yet.</p>
            )}

            <button
              onClick={() => setShowAddForm(true)}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 underline"
            >
              ＋ Add template
            </button>
          </>
        )}

        {!loading && showAddForm && (
          <div className="pt-2">
            <AddTemplateForm
              onSaved={(t) => {
                setTemplates((prev) => {
                  const idx = prev.findIndex((x) => x.slug === t.slug);
                  if (idx >= 0) { const next = [...prev]; next[idx] = t; return next; }
                  return [...prev, t];
                });
                setShowAddForm(false);
                setSelected(t);
              }}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        )}

        {!loading && selected && (
          <div className="pt-2">
            <ComposeView
              template={selected}
              clientName={clientName}
              clientPhone={clientPhone}
              aisensyConfigured={aisensyConfigured}
              onBack={() => setSelected(null)}
            />
          </div>
        )}
      </div>
    </details>
  );
}

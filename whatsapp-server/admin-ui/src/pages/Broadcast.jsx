import React, { useState } from 'react';
import { api } from '../api.js';
import Button from '../components/Button.jsx';

// Approved templates on our WABA. Update when new ones are approved.
// `params` defines each placeholder in order: label shown above the input
// (matches the {{N}} index) + placeholder text shown inside the empty input.
const TEMPLATES = [
  {
    name: 'appt_reminder_2h',
    language: 'en',
    params: [
      { label: 'Name', placeholder: 'Priya' },
      { label: 'Time', placeholder: '5:00 PM' },
      { label: 'Session type', placeholder: 'Cortisol Reset' },
    ],
  },
  {
    name: 'appt_reminder_24h',
    language: 'en',
    params: [
      { label: 'Name', placeholder: 'Priya' },
      { label: 'Date', placeholder: '15 May 2026' },
      { label: 'Time', placeholder: '5:00 PM' },
    ],
  },
  {
    name: 'appt_confirmation',
    language: 'en',
    params: [
      { label: 'Name', placeholder: 'Priya' },
      { label: 'Date', placeholder: '15 May 2026' },
      { label: 'Time', placeholder: '5:00 PM' },
    ],
  },
];

// Parses a freeform recipient blob:
//   - one entry per line
//   - each line is either "+91 98765 43210" or "+91 98765 43210, FirstName"
function parseRecipients(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(',').map((s) => s.trim()).filter(Boolean);
    out.push({ phone: parts[0], name: parts[1] || undefined });
  }
  return out;
}

export default function Broadcast() {
  const [tplName, setTplName] = useState(TEMPLATES[0].name);
  const [tplLang, setTplLang] = useState(TEMPLATES[0].language);
  // paramValues is keyed by template name so switching templates doesn't wipe
  // half-filled inputs in the other.
  const [paramValues, setParamValues] = useState({});
  const [recipientsText, setRecipientsText] = useState('');
  const [stage, setStage] = useState('compose'); // compose | confirm | sending | done
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const tpl = TEMPLATES.find((t) => t.name === tplName) || TEMPLATES[0];
  const currentValues = paramValues[tpl.name] || [];
  const params = tpl.params.map((_, i) => (currentValues[i] || '').trim());
  const allParamsFilled = params.every((p) => p.length > 0);
  const recipients = parseRecipients(recipientsText);

  function updateParam(i, val) {
    setParamValues((prev) => {
      const next = [...(prev[tpl.name] || [])];
      next[i] = val;
      return { ...prev, [tpl.name]: next };
    });
  }

  function reset() {
    setStage('compose');
    setResult(null);
    setErr('');
  }

  function review() {
    setErr('');
    if (recipients.length === 0) {
      setErr('Add at least one recipient.');
      return;
    }
    if (!allParamsFilled) {
      setErr(`Fill all ${tpl.params.length} param fields for "${tpl.name}".`);
      return;
    }
    setStage('confirm');
  }

  async function execute() {
    setStage('sending');
    setErr('');
    try {
      const res = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': localStorage.getItem('wa_admin_key') || '',
        },
        body: JSON.stringify({
          templateName: tpl.name,
          templateLanguage: tpl.language,
          templateParams: params,
          recipients,
          origin: 'broadcast',
          originRef: 'admin_ui',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
      setStage('done');
    } catch (e) {
      setErr(e.message || 'Broadcast failed');
      setStage('confirm');
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">📣 Broadcast</h1>
          <p className="text-sm text-slate-500">
            Send a WhatsApp template message to a list of recipients.
          </p>
        </div>
        {stage !== 'compose' && (
          <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-900">
            ← Start over
          </button>
        )}
      </header>

      {stage === 'compose' && (
        <ComposeStep
          tpl={tpl}
          tplName={tplName}
          setTplName={setTplName}
          tplLang={tplLang}
          setTplLang={setTplLang}
          params={params}
          updateParam={updateParam}
          recipientsText={recipientsText}
          setRecipientsText={setRecipientsText}
          recipients={recipients}
          err={err}
          onReview={review}
        />
      )}

      {(stage === 'confirm' || stage === 'sending') && (
        <ConfirmStep
          tpl={tpl}
          params={params}
          recipients={recipients}
          sending={stage === 'sending'}
          err={err}
          onBack={() => setStage('compose')}
          onExecute={execute}
        />
      )}

      {stage === 'done' && result && <ResultStep result={result} onReset={reset} />}
    </div>
  );
}

function ComposeStep({
  tpl, tplName, setTplName, tplLang, setTplLang,
  params, updateParam, recipientsText, setRecipientsText,
  recipients, err, onReview,
}) {
  return (
    <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-5">
      <Section title="1 · Template">
        <div className="flex gap-2">
          <select
            className="input flex-1"
            value={tplName}
            onChange={(e) => {
              const t = TEMPLATES.find((x) => x.name === e.target.value);
              setTplName(e.target.value);
              if (t) setTplLang(t.language);
            }}
          >
            {TEMPLATES.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} ({t.params.length} params)
              </option>
            ))}
          </select>
          <select className="input w-24" value={tplLang} onChange={(e) => setTplLang(e.target.value)}>
            <option value="en">en</option>
            <option value="en_US">en_US</option>
            <option value="hi">hi</option>
          </select>
        </div>
      </Section>

      <Section title={`2 · Params`}>
        <div className="grid gap-3 sm:grid-cols-2">
          {tpl.params.map((p, i) => (
            <label key={i} className="block">
              <div className="mb-1 text-xs font-medium text-slate-700">
                {p.label}{' '}
                <span className="font-mono text-slate-400">{`{{${i + 1}}}`}</span>
              </div>
              <input
                type="text"
                className="input w-full"
                placeholder={p.placeholder}
                value={params[i] || ''}
                onChange={(e) => updateParam(i, e.target.value)}
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Same params sent to every recipient. (Per-recipient personalisation comes later when
          broadcasting from ochre-followup.)
        </p>
      </Section>

      <Section title="3 · Recipients">
        <textarea
          className="input min-h-[120px] resize-y font-mono text-sm"
          placeholder={`919876543210\n919812345678, Asha\n+91 98989 89898, Priya`}
          value={recipientsText}
          onChange={(e) => setRecipientsText(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          One per line. Optional comma + name. Detected:{' '}
          <span className="font-medium">{recipients.length}</span> recipient(s).
        </p>
      </Section>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onReview} disabled={recipients.length === 0}>
          Review →
        </Button>
      </div>
    </div>
  );
}

function ConfirmStep({ tpl, params, recipients, sending, err, onBack, onExecute }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-5">
      <div className="text-sm">
        <div className="text-base font-semibold text-amber-900">
          ⚠ Confirm broadcast
        </div>
        <p className="mt-1 text-amber-800">
          You're about to send <strong>{tpl.name}</strong> to{' '}
          <strong>{recipients.length}</strong> recipient(s). Each send costs Meta's template
          rate (~₹0.115 for utility, ~₹0.78 for marketing). This action cannot be undone once
          messages are dispatched to Meta.
        </p>
      </div>

      <div className="rounded-md bg-white p-3 text-sm">
        <div className="text-xs uppercase tracking-wide text-slate-500">Template</div>
        <div className="font-mono">{tpl.name} [{tpl.language}]</div>

        <div className="mt-3 text-xs uppercase tracking-wide text-slate-500">Params</div>
        <ol className="ml-5 list-decimal font-mono text-sm">
          {params.map((p, i) => <li key={i}>{p}</li>)}
        </ol>

        <div className="mt-3 text-xs uppercase tracking-wide text-slate-500">
          Recipients ({recipients.length})
        </div>
        <ul className="max-h-40 overflow-y-auto text-sm">
          {recipients.map((r, i) => (
            <li key={i} className="border-b border-slate-100 py-0.5">
              <span className="font-mono">{r.phone}</span>
              {r.name && <span className="ml-2 text-slate-500">· {r.name}</span>}
            </li>
          ))}
        </ul>
      </div>

      <label className="flex items-center gap-2 text-sm text-amber-900">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="h-4 w-4"
        />
        I understand this will send {recipients.length} WhatsApp message(s) immediately.
      </label>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={onBack} className="text-sm text-slate-600 hover:text-slate-900" disabled={sending}>
          ← Back to edit
        </button>
        <Button onClick={onExecute} disabled={!confirmed || sending}>
          {sending ? 'Sending…' : `Send to ${recipients.length}`}
        </Button>
      </div>
    </div>
  );
}

function ResultStep({ result, onReset }) {
  const failed = result.results.filter((r) => !r.ok);
  return (
    <div className="space-y-4 rounded-lg border border-emerald-300 bg-emerald-50 p-5">
      <div>
        <div className="text-base font-semibold text-emerald-900">✓ Broadcast complete</div>
        <p className="mt-1 text-sm text-emerald-800">
          {result.sent} sent · {result.failed} failed · {result.skipped} skipped (out of {result.total}).
        </p>
      </div>

      {failed.length > 0 && (
        <div className="rounded-md bg-white p-3 text-sm">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
            Failures ({failed.length})
          </div>
          <ul>
            {failed.map((r, i) => (
              <li key={i} className="border-b border-slate-100 py-1">
                <span className="font-mono">{r.phone || '?'}</span>
                <span className="ml-2 text-red-600">{r.code || 'error'}: {r.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onReset}>New broadcast</Button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-slate-800">{title}</div>
      {children}
    </div>
  );
}

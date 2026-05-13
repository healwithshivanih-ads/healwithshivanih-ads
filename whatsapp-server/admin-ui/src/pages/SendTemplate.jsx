import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import Input from '../components/Input.jsx';
import Button from '../components/Button.jsx';

export default function SendTemplate() {
  const [contacts, setContacts] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ contact_id: '', template_name: 'appt_reminder_24h', language_code: 'en' });
  const [vars, setVars] = useState([{ key: 'p1', value: '' }]);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.contacts({ limit: 200, search }).then((d) => setContacts(d.rows || [])).catch(() => {});
  }, [search]);

  function addVar() { setVars([...vars, { key: `p${vars.length + 1}`, value: '' }]); }
  function setVar(i, v) {
    const next = [...vars];
    next[i] = { ...next[i], value: v };
    setVars(next);
  }
  function removeVar(i) {
    setVars(vars.filter((_, j) => j !== i));
  }

  async function submit(e) {
    e.preventDefault();
    setErr(null); setResult(null); setSending(true);
    try {
      const variables = { body: vars.map((v) => v.value).filter((v) => v !== undefined) };
      const r = await api.sendTemplate({
        contact_id: form.contact_id,
        template_name: form.template_name,
        language_code: form.language_code,
        variables,
      });
      setResult(r);
    } catch (e) {
      setErr(e.body?.message || e.message);
    } finally {
      setSending(false);
    }
  }

  const selectedContact = contacts.find((c) => c.id === form.contact_id);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Send Template</h1>
      <p className="mb-6 max-w-prose text-sm text-slate-600">
        Send a pre-approved WhatsApp message template to any contact. Use this when the contact is outside the 24-hour service window
        (the only kind of message Meta allows at that point). Make sure the template is <strong>APPROVED</strong> in WhatsApp Manager
        before sending — Meta will return a 132012 error otherwise.
      </p>

      <form onSubmit={submit} className="card max-w-2xl space-y-4 p-5">
        <Input label="Search contact" placeholder="name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Contact</span>
          <select className="input" value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })} required>
            <option value="">Select…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.wa_id} (+{c.wa_id})</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Template name" value={form.template_name} onChange={(e) => setForm({ ...form, template_name: e.target.value })} required />
          <Input label="Language code" value={form.language_code} onChange={(e) => setForm({ ...form, language_code: e.target.value })} />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Body parameters ({'{{1}}, {{2}}, …'})</span>
            <button type="button" onClick={addVar} className="text-xs text-brand-700 hover:underline">+ Add</button>
          </div>
          <div className="space-y-2">
            {vars.map((v, i) => (
              <div key={i} className="flex gap-2">
                <span className="inline-flex w-12 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-500">{`{{${i + 1}}}`}</span>
                <input className="input" value={v.value} onChange={(e) => setVar(i, e.target.value)} placeholder="value" />
                <button type="button" onClick={() => removeVar(i)} className="text-slate-400 hover:text-red-600">×</button>
              </div>
            ))}
          </div>
        </div>

        {selectedContact && (
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            Will send <code className="font-mono">{form.template_name}</code> ({form.language_code}) to{' '}
            <strong>{selectedContact.name || selectedContact.wa_id}</strong> (+{selectedContact.wa_id})
          </div>
        )}

        <Button type="submit" disabled={!form.contact_id || sending}>{sending ? 'Sending…' : 'Send template'}</Button>
        {err && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</div>}
        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
            Sent. wa_message_id: <code>{result.wa_message_id}</code>
          </div>
        )}
      </form>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Button from '../../components/Button.jsx';
import Input from '../../components/Input.jsx';

function fmtTs(iso) {
  if (!iso) return 'never';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function Integrations() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await api.integrations();
      setItems(r.items || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const wix = items.find((i) => i.type === 'wix');

  return (
    <div className="p-6">
      <header className="mb-4">
        <h1 className="text-lg font-semibold">Integrations</h1>
        <p className="text-xs text-slate-500">Connect external services. Credentials are encrypted at rest.</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <WixCard integration={wix} onChange={load} />
        <CalendlyCard integration={items.find((i) => i.type === 'calendly')} onChange={load} />
      </div>

      {loading && <p className="mt-4 text-xs text-slate-400">Loading…</p>}
    </div>
  );
}

function WixCard({ integration, onChange }) {
  const [editing, setEditing] = useState(!integration);
  const [apiKey, setApiKey] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true); setMsg(''); setErr('');
    try {
      await api.saveIntegration({
        type: 'wix',
        credentials: {
          api_key: apiKey || undefined,
          signing_secret: signingSecret || undefined,
        },
      });
      setApiKey(''); setSigningSecret('');
      setEditing(false);
      setMsg('Saved.');
      onChange?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function test() {
    if (!integration) return;
    setBusy(true); setMsg(''); setErr('');
    try {
      const r = await api.testIntegration(integration.id);
      if (r.ok) setMsg(`✓ Connected. Sample fetch returned ${r.sample_count} contact(s).`);
      else setErr(r.error || 'Test failed.');
      onChange?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function syncNow() {
    if (!integration) return;
    setBusy(true); setMsg(''); setErr('');
    try {
      await api.syncIntegration(integration.id);
      setMsg('Sync queued. Check back in a few minutes.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function disconnect() {
    if (!integration || !confirm('Disconnect Wix?')) return;
    setBusy(true);
    try { await api.deleteIntegration(integration.id); onChange?.(); }
    finally { setBusy(false); }
  }

  return (
    <section className="card p-4">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Wix</h2>
          {integration && <StatusPill status={integration.status} />}
        </div>
        {integration && !editing && (
          <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
        )}
      </header>

      {integration && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs text-slate-600">
          <dt>Connected since</dt><dd>{fmtTs(integration.created_at)}</dd>
          <dt>Last incremental sync</dt><dd>{fmtTs(integration.last_incremental_sync_at)}</dd>
          <dt>Last full sync</dt><dd>{fmtTs(integration.last_full_sync_at)}</dd>
          <dt>Has API key</dt><dd>{integration.has_credentials ? 'Yes' : 'No'}</dd>
        </dl>
      )}

      {editing && (
        <div className="mt-3 space-y-2">
          <Input label="Wix API key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="paste key here" />
          <Input label="Webhook signing secret (optional)" type="password" value={signingSecret} onChange={(e) => setSigningSecret(e.target.value)} />
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            {integration && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </div>
      )}

      {!editing && integration && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={test} disabled={busy}>Test connection</Button>
          <Button variant="ghost" onClick={syncNow} disabled={busy}>Sync now (full)</Button>
          <Button variant="danger" onClick={disconnect} disabled={busy}>Disconnect</Button>
        </div>
      )}

      {msg && <p className="mt-2 text-xs text-emerald-700">{msg}</p>}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      {integration?.last_error && (
        <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">
          Last error: {integration.last_error.message || JSON.stringify(integration.last_error)}
        </p>
      )}
    </section>
  );
}

function CalendlyCard({ integration }) {
  return (
    <section className="card p-4">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Calendly</h2>
          {integration && <StatusPill status={integration.status} />}
        </div>
      </header>
      <p className="text-xs text-slate-600">
        Calendly is webhook-only this round. Set <code className="rounded bg-slate-100 px-1">CALENDLY_SIGNING_SECRET</code> on the server, then point a Calendly webhook subscription at <code className="rounded bg-slate-100 px-1">/webhooks/calendly</code>. Bookings + cancellations land automatically.
      </p>
    </section>
  );
}

function StatusPill({ status }) {
  const tone = {
    connected: 'bg-emerald-100 text-emerald-700',
    pending: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700',
    disconnected: 'bg-slate-200 text-slate-600',
  }[status] || 'bg-slate-100 text-slate-600';
  return <span className={`badge ${tone}`}>{status}</span>;
}

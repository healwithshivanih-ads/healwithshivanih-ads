import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Badge from '../components/Badge.jsx';
import Button from '../components/Button.jsx';
import Input from '../components/Input.jsx';
import TagInput from '../components/TagInput.jsx';

export default function ContactDetail() {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [tab, setTab] = useState('overview');
  const [allTags, setAllTags] = useState([]);

  async function load() {
    const [contact, tagList] = await Promise.all([api.contact(id), api.tags()]);
    setC(contact);
    setAllTags((tagList?.items || []).map((t) => t.name));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!c) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  const TAB = [
    { k: 'overview', label: 'Overview' },
    { k: 'conversations', label: 'Conversations' },
    { k: 'identities', label: 'Identities' },
    { k: 'history', label: 'History' },
  ];

  return (
    <div className="p-6">
      <div className="mb-1 text-xs text-slate-500">
        <Link to="/contacts" className="hover:underline">← Contacts</Link>
      </div>
      <h1 className="text-xl font-semibold">{c.display_name || '(unnamed)'}</h1>
      <p className="text-sm text-slate-500">
        {c.primary_phone || '—'}{c.primary_email ? ` · ${c.primary_email}` : ''}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {(c.tags || []).map((t) => (
          <span key={t.id || t.name} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
            #{t.name}
          </span>
        ))}
      </div>

      <nav className="mt-4 flex border-b border-slate-200 text-sm">
        {TAB.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`px-3 py-2 -mb-px border-b-2 ${
              tab === t.k ? 'border-emerald-600 text-emerald-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <Overview contact={c} reload={load} allTags={allTags} />}
      {tab === 'conversations' && <Conversations contact={c} />}
      {tab === 'identities' && <Identities contact={c} />}
      {tab === 'history' && <History contact={c} />}
    </div>
  );
}

function Overview({ contact, reload, allTags }) {
  const [form, setForm] = useState({
    display_name: contact.display_name || '',
    primary_phone: contact.primary_phone || '',
    primary_email: contact.primary_email || '',
    locale: contact.locale || '',
    city: contact.city || '',
    country: contact.country || '',
    opt_in_status: contact.opt_in_status || 'unknown',
  });
  function patch(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setSaving(true); setErr('');
    try {
      await api.patchContact(contact.id, form);
      reload();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <section className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Profile</h2>
        <Input label="Display name" value={form.display_name} onChange={(e) => patch('display_name', e.target.value)} />
        <Input label="Phone" value={form.primary_phone} onChange={(e) => patch('primary_phone', e.target.value)} />
        <Input label="Email" value={form.primary_email} onChange={(e) => patch('primary_email', e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="City" value={form.city} onChange={(e) => patch('city', e.target.value)} />
          <Input label="Country" value={form.country} onChange={(e) => patch('country', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="Locale" value={form.locale} onChange={(e) => patch('locale', e.target.value)} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Opt-in</span>
            <select className="input" value={form.opt_in_status} onChange={(e) => patch('opt_in_status', e.target.value)}>
              <option value="unknown">unknown</option>
              <option value="pending">pending</option>
              <option value="opted_in">opted_in</option>
              <option value="opted_out">opted_out</option>
            </select>
          </label>
        </div>
        {err && <div className="text-xs text-red-600">{err}</div>}
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">Tags</h2>
        <TagInput
          tags={(contact.tags || []).map((t) => t.name)}
          suggestions={allTags}
          onAdd={async (name) => { await api.addTag(contact.id, name); reload(); }}
          onRemove={async (name) => { await api.removeTag(contact.id, name); reload(); }}
        />
      </section>
    </div>
  );
}

function Conversations({ contact }) {
  if (!contact.conversations?.length) {
    return <div className="mt-4 text-sm text-slate-400">No conversations yet.</div>;
  }
  return (
    <div className="mt-4 card p-4">
      <ul className="divide-y divide-slate-100">
        {contact.conversations.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2 text-sm">
            <Link to={`/inbox/${c.id}`} className="text-emerald-700 hover:underline">
              {c.channel} · {c.status}
            </Link>
            <span className="text-xs text-slate-500">
              {c.last_inbound_at ? new Date(c.last_inbound_at).toLocaleString() : 'no inbound'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Identities({ contact }) {
  if (!contact.identities?.length) {
    return <div className="mt-4 text-sm text-slate-400">No identities recorded.</div>;
  }
  return (
    <div className="mt-4 card p-4">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr><th className="py-2">Channel</th><th className="py-2">External ID</th><th className="py-2">Subscription</th><th className="py-2">Primary</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {contact.identities.map((i) => (
            <tr key={i.id}>
              <td className="py-2 font-medium">{i.channel}</td>
              <td className="py-2 font-mono text-xs">{i.external_id}</td>
              <td className="py-2">{i.subscription_status}</td>
              <td className="py-2">{i.is_primary ? '✓' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({ contact }) {
  return (
    <div className="mt-4 card p-4 text-sm text-slate-500">
      <p>Created {new Date(contact.created_at).toLocaleString()}</p>
      <p>Last updated {new Date(contact.updated_at).toLocaleString()}</p>
      {contact.opt_in_at && <p>Opt-in at {new Date(contact.opt_in_at).toLocaleString()}</p>}
      <pre className="mt-3 overflow-x-auto rounded bg-slate-50 p-3 text-xs">
        {JSON.stringify(contact.metadata || {}, null, 2)}
      </pre>
    </div>
  );
}

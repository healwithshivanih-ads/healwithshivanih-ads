import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Table } from '../components/Table.jsx';
import Button from '../components/Button.jsx';
import Input from '../components/Input.jsx';

function fmtAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString();
}

export default function Contacts() {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.contacts({ search: search || undefined, limit: 100 });
      setItems(r.items || []);
      setTotal(r.total || 0);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  function onSubmit(e) { e.preventDefault(); load(); }

  return (
    <div className="p-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Contacts</h1>
          <p className="text-xs text-slate-500">{total} total</p>
        </div>
        <Button onClick={() => setShowNew(true)}>+ New contact</Button>
      </header>

      <form onSubmit={onSubmit} className="mb-3 flex gap-2">
        <Input
          placeholder="Search name, phone, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="ghost" type="submit">Search</Button>
      </form>

      <Table
        columns={[
          { key: 'display_name', header: 'Name', render: (r) => (
            <Link to={`/contacts/${r.id}`} className="font-medium text-emerald-700 hover:underline">
              {r.display_name || '(unnamed)'}
            </Link>
          )},
          { key: 'primary_phone', header: 'Phone', render: (r) => r.primary_phone || '—' },
          { key: 'primary_email', header: 'Email', render: (r) => r.primary_email || '—' },
          { key: 'opt_in_status', header: 'Opt-in' },
          { key: 'last_inbound_at', header: 'Last inbound', render: (r) => fmtAgo(r.last_inbound_at) },
        ]}
        rows={loading ? [] : items}
        empty={loading ? 'Loading…' : 'No contacts yet.'}
      />

      {showNew && <NewContactModal onClose={() => setShowNew(false)} onCreated={load} />}
    </div>
  );
}

function NewContactModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    display_name: '',
    primary_phone: '',
    primary_email: '',
    opt_in_status: 'unknown',
    opt_in_source: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  function patch(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.createContact({
        display_name: form.display_name || undefined,
        primary_phone: form.primary_phone || undefined,
        primary_email: form.primary_email || undefined,
        opt_in_status: form.opt_in_status,
        opt_in_source: form.opt_in_source || undefined,
      });
      onCreated?.();
      onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <form
        className="card w-full max-w-md p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="text-base font-semibold">New contact</h2>
        <Input label="Display name" value={form.display_name} onChange={(e) => patch('display_name', e.target.value)} />
        <Input label="Phone (any format)" placeholder="+91 98924-45555" value={form.primary_phone} onChange={(e) => patch('primary_phone', e.target.value)} />
        <Input label="Email" type="email" value={form.primary_email} onChange={(e) => patch('primary_email', e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Opt-in status</span>
            <select className="input" value={form.opt_in_status} onChange={(e) => patch('opt_in_status', e.target.value)}>
              <option value="unknown">unknown</option>
              <option value="pending">pending</option>
              <option value="opted_in">opted_in</option>
              <option value="opted_out">opted_out</option>
            </select>
          </label>
          <Input label="Source" value={form.opt_in_source} onChange={(e) => patch('opt_in_source', e.target.value)} />
        </div>
        {err && <div className="text-xs text-red-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button disabled={busy}>{busy ? 'Saving…' : 'Create'}</Button>
        </div>
      </form>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Table } from '../components/Table.jsx';
import Badge from '../components/Badge.jsx';
import Input from '../components/Input.jsx';
import Button from '../components/Button.jsx';

export default function Appointments() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ contact_id: '', starts_at: '', title: '', source: 'manual' });
  const [contactsList, setContactsList] = useState([]);

  async function load() {
    try {
      const data = await api.appointments({});
      setRows(data.rows || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function openCreate() {
    setShowCreate(true);
    if (!contactsList.length) {
      try {
        const c = await api.contacts({ limit: 200 });
        setContactsList(c.rows || []);
      } catch { /* ignore */ }
    }
  }

  async function create(e) {
    e.preventDefault();
    setErr(null);
    try {
      await api.createAppointment({
        contact_id: form.contact_id,
        starts_at: new Date(form.starts_at).toISOString(),
        title: form.title || null,
        source: form.source,
      });
      setShowCreate(false);
      setForm({ contact_id: '', starts_at: '', title: '', source: 'manual' });
      load();
    } catch (e) { setErr(e.body?.message || e.message); }
  }

  const columns = [
    { key: 'starts_at', header: 'When', render: (r) => new Date(r.starts_at).toLocaleString() },
    { key: 'contact', header: 'Contact', render: (r) => r.contacts?.name || r.contacts?.wa_id || '—' },
    { key: 'title', header: 'Title', render: (r) => r.title || '—' },
    { key: 'source', header: 'Source', render: (r) => <Badge tone="blue">{r.source}</Badge> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'cancelled' ? 'red' : r.status === 'completed' ? 'green' : 'amber'}>{r.status}</Badge> },
  ];

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Appointments</h1>
        <Button onClick={openCreate}>+ Create appointment</Button>
      </div>
      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</div>}

      {showCreate && (
        <form onSubmit={create} className="card mb-4 grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Contact</span>
            <select className="input" value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })} required>
              <option value="">Select a contact…</option>
              {contactsList.map((c) => (
                <option key={c.id} value={c.id}>{c.name || c.wa_id} ({c.wa_id})</option>
              ))}
            </select>
          </label>
          <Input label="Starts at" type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} required />
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Discovery call" />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Source</span>
            <select className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              <option value="manual">manual</option>
              <option value="calendly">calendly</option>
              <option value="wix">wix</option>
              <option value="other">other</option>
            </select>
          </label>
          <div className="md:col-span-2 flex gap-2">
            <Button type="submit">Create</Button>
            <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </form>
      )}

      <Table columns={columns} rows={rows} empty="No appointments scheduled" />
    </div>
  );
}

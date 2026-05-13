import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Button from '../components/Button.jsx';
import { Table } from '../components/Table.jsx';
import ContactPicker from '../components/ContactPicker.jsx';
import DateTimePicker from '../components/DateTimePicker.jsx';
import Input from '../components/Input.jsx';

const STATUS_FILTERS = [
  { v: '', label: 'All' },
  { v: 'scheduled', label: 'Scheduled' },
  { v: 'rescheduled', label: 'Rescheduled' },
  { v: 'cancelled', label: 'Cancelled' },
  { v: 'completed', label: 'Completed' },
  { v: 'no_show', label: 'No-show' },
];

function fmtTs(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function Appointments() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showNew, setShowNew] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.appointments({
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: 100,
      });
      setItems(r.items || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, from, to]);

  return (
    <div className="p-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Appointments</h1>
          <p className="text-xs text-slate-500">{loading ? 'Loading…' : `${items.length} shown`}</p>
        </div>
        <Button onClick={() => setShowNew(true)}>+ New appointment</Button>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input max-w-[160px]" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        <Input type="date" value={from?.slice(0, 10) || ''}
          onChange={(e) => setFrom(e.target.value ? new Date(e.target.value).toISOString() : '')} />
        <Input type="date" value={to?.slice(0, 10) || ''}
          onChange={(e) => setTo(e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : '')} />
      </div>

      <Table
        columns={[
          {
            key: 'starts_at', header: 'When',
            render: (r) => <span className="font-medium">{fmtTs(r.starts_at)}</span>,
          },
          {
            key: 'contact', header: 'Contact',
            render: (r) => r.contact ? (
              <Link to={`/contacts/${r.contact.id}`} className="text-emerald-700 hover:underline">
                {r.contact.display_name || r.contact.primary_phone || '(unnamed)'}
              </Link>
            ) : '—',
          },
          { key: 'title', header: 'Title', render: (r) => r.title || '—' },
          { key: 'source', header: 'Source' },
          {
            key: 'status', header: 'Status',
            render: (r) => <StatusPill status={r.status} />,
          },
          {
            key: 'reminders', header: 'Reminders',
            render: (r) => <ReminderDots id={r.id} />,
          },
          {
            key: 'actions', header: '',
            render: (r) => (
              <button
                className="text-xs text-red-600 hover:underline"
                onClick={async () => {
                  if (!confirm(`Cancel appointment "${r.title || r.id}"?`)) return;
                  await api.cancelAppointment(r.id, 'cancelled by coach');
                  load();
                }}
              >
                Cancel
              </button>
            ),
          },
        ]}
        rows={loading ? [] : items}
        empty={loading ? 'Loading…' : 'No appointments yet.'}
      />

      {showNew && <NewApptModal onClose={() => setShowNew(false)} onCreated={load} />}
    </div>
  );
}

function StatusPill({ status }) {
  const tone = {
    scheduled: 'bg-emerald-100 text-emerald-700',
    rescheduled: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-slate-200 text-slate-600',
    completed: 'bg-blue-100 text-blue-700',
    no_show: 'bg-red-100 text-red-700',
  }[status] || 'bg-slate-100 text-slate-600';
  return <span className={`badge ${tone}`}>{status}</span>;
}

function ReminderDots({ id }) {
  const [reminders, setReminders] = useState(null);
  useEffect(() => {
    let cancel = false;
    api.appointment(id).then((r) => { if (!cancel) setReminders(r.reminders || []); }).catch(() => {});
    return () => { cancel = true; };
  }, [id]);
  if (!reminders) return <span className="text-xs text-slate-400">…</span>;
  const order = ['confirmation', 't_minus_24h', 't_minus_2h', 'post_session'];
  const byKind = Object.fromEntries(reminders.map((r) => [r.kind, r]));
  return (
    <div className="flex gap-1">
      {order.map((k) => {
        const r = byKind[k];
        const tone = !r ? 'bg-slate-200'
          : r.status === 'sent' ? 'bg-emerald-500'
          : r.status === 'failed' ? 'bg-red-500'
          : r.status === 'skipped' ? 'bg-slate-300'
          : r.status === 'sending' ? 'bg-amber-400'
          : 'bg-blue-300';
        return <span key={k} title={`${k}: ${r?.status || 'missing'}`} className={`inline-block h-2.5 w-2.5 rounded-full ${tone}`} />;
      })}
    </div>
  );
}

function NewApptModal({ onClose, onCreated }) {
  const [contact, setContact] = useState(null);
  const [startsAt, setStartsAt] = useState(defaultFutureIso());
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!contact?.id) return setErr('Pick a contact');
    if (!startsAt) return setErr('Pick a date/time');
    setBusy(true); setErr('');
    try {
      await api.createAppointment({
        contactId: contact.id,
        startsAt,
        title: title || undefined,
        notes: notes || undefined,
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
        <h2 className="text-base font-semibold">New appointment</h2>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Contact</span>
          <ContactPicker value={contact} onChange={setContact} />
        </label>
        <DateTimePicker label="Starts at" value={startsAt} onChange={setStartsAt} />
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Discovery call" />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {err && <div className="text-xs text-red-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button disabled={busy}>{busy ? 'Saving…' : 'Create'}</Button>
        </div>
      </form>
    </div>
  );
}

function defaultFutureIso() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

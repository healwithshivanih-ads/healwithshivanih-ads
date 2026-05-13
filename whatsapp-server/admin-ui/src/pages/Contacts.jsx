import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { Table } from '../components/Table.jsx';
import Input from '../components/Input.jsx';
import Badge from '../components/Badge.jsx';
import TagInput from '../components/TagInput.jsx';

export default function Contacts() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [tags, setTags] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = { limit: 100 };
      if (search) params.search = search;
      if (tagFilter) params.tag = tagFilter;
      const data = await api.contacts(params);
      setRows(data.rows || []);
      const t = await api.tags();
      setTags((t.rows || []).map((r) => r.name));
    } catch (e) { setErr(e.message); }
  }, [search, tagFilter]);

  useEffect(() => { load(); }, [load]);

  async function openDetail(c) {
    setSelected(c);
    setDetail(null);
    try {
      const d = await api.contact(c.id);
      setDetail(d);
    } catch (e) { setErr(e.message); }
  }

  async function addTag(tag) {
    if (!detail) return;
    await api.addTag(detail.contact.id, tag);
    const d = await api.contact(detail.contact.id);
    setDetail(d);
    load();
  }
  async function removeTag(tag) {
    if (!detail) return;
    await api.removeTag(detail.contact.id, tag);
    const d = await api.contact(detail.contact.id);
    setDetail(d);
    load();
  }

  const columns = [
    { key: 'name', header: 'Name', render: (r) => r.name || <span className="text-slate-400">—</span> },
    { key: 'wa_id', header: 'WhatsApp ID' },
    { key: 'opt_in_source', header: 'Source', render: (r) => r.opt_in_source ? <Badge tone="blue">{r.opt_in_source}</Badge> : '—' },
    { key: 'tags', header: 'Tags', render: (r) => (
      <div className="flex flex-wrap gap-1">
        {(r.tags || []).map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
      </div>
    ) },
    { key: 'last_seen_at', header: 'Last seen', render: (r) => r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : '—' },
  ];

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_360px]">
      <div className="overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Contacts</h1>
        </div>
        {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</div>}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Input placeholder="Search name, phone, wa_id…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="input" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">All tags</option>
            {tags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <Table columns={columns} rows={rows} onRowClick={openDetail} empty="No contacts yet" />
      </div>

      <aside className="hidden border-l border-slate-200 bg-white lg:block">
        {!selected && <div className="p-6 text-sm text-slate-400">Select a contact to view details.</div>}
        {selected && (
          <div className="space-y-4 p-6">
            <div>
              <div className="text-lg font-semibold">{detail?.contact?.name || selected.name || '—'}</div>
              <div className="text-sm text-slate-500">{detail?.contact?.phone || `+${selected.wa_id}`}</div>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Tags</h3>
              <TagInput
                tags={(detail?.tags || []).map((t) => t.name)}
                onAdd={addTag}
                onRemove={removeTag}
                suggestions={tags}
              />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Appointments</h3>
              {(!detail?.appointments || detail.appointments.length === 0) && <div className="text-sm text-slate-400">None yet.</div>}
              <ul className="space-y-1.5">
                {detail?.appointments?.map((a) => (
                  <li key={a.id} className="rounded-lg border border-slate-200 p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.title || 'Appointment'}</span>
                      <Badge tone={a.status === 'cancelled' ? 'red' : a.status === 'completed' ? 'green' : 'amber'}>{a.status}</Badge>
                    </div>
                    <div className="text-xs text-slate-500">{new Date(a.starts_at).toLocaleString()}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Table } from '../components/Table.jsx';
import Badge from '../components/Badge.jsx';

function inWindow(lastInboundAt) {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() < 24 * 60 * 60 * 1000;
}

export default function Conversations() {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState(null);
  const nav = useNavigate();

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const data = await api.conversations({ limit: 100 });
        if (!stop) setRows(data.rows || []);
      } catch (e) { setErr(e.message); }
    }
    load();
    const t = setInterval(load, 15_000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const columns = [
    { key: 'name', header: 'Contact', render: (r) => r.contacts?.name || r.contacts?.wa_id || '—' },
    { key: 'phone', header: 'Phone', render: (r) => r.contacts?.phone || `+${r.contacts?.wa_id}` },
    { key: 'window', header: 'Window', render: (r) => inWindow(r.last_inbound_at)
      ? <Badge tone="green">In 24h window</Badge>
      : <Badge tone="amber">Template only</Badge> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={r.status === 'open' ? 'green' : 'default'}>{r.status}</Badge> },
    { key: 'last_message_at', header: 'Last message', render: (r) => r.last_message_at ? new Date(r.last_message_at).toLocaleString() : '—' },
  ];

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Conversations</h1>
      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{err}</div>}
      <Table columns={columns} rows={rows} onRowClick={(r) => nav(`/conversations/${r.id}`)} empty="No conversations yet" />
    </div>
  );
}

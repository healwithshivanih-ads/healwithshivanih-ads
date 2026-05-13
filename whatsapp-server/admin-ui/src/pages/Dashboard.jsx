import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function Stat({ label, value }) {
  return (
    <div className="card p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-slate-900">{value ?? '—'}</div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const [s, m] = await Promise.all([api.stats(), api.messages({ limit: 10 })]);
        if (stop) return;
        setStats(s);
        setRecent(m.rows || []);
      } catch (e) {
        setErr(e.message);
      }
    }
    load();
    const t = setInterval(load, 30_000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>
      {err && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Error: {err}</div>}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Contacts" value={stats?.contacts} />
        <Stat label="Open conversations" value={stats?.open_conversations} />
        <Stat label="Upcoming appts" value={stats?.upcoming_appointments} />
        <Stat label="Messages today" value={stats?.messages_today} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Recent messages</h2>
      <div className="card divide-y divide-slate-100">
        {recent.length === 0 && <div className="p-4 text-sm text-slate-400">No recent messages</div>}
        {recent.map((m) => (
          <div key={m.id} className="flex items-start gap-3 p-3">
            <span className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${m.direction === 'inbound' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
              {m.direction === 'inbound' ? '↓' : '↑'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{m.contacts?.name || m.contacts?.wa_id || '—'}</span>
                <span className="text-xs text-slate-400">{new Date(m.created_at).toLocaleString()}</span>
              </div>
              <div className="truncate text-sm text-slate-600">{m.body || `[${m.type}]`}</div>
            </div>
            <span className="badge bg-slate-100 text-slate-600">{m.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

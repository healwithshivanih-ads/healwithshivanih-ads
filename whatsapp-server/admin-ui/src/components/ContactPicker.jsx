import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * Autocomplete picker for contacts. Calls /api/contacts?search= as the user
 * types. Selecting an item calls onChange({id, display_name, primary_phone}).
 */
export default function ContactPicker({ value, onChange, placeholder = 'Search contact…' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.contacts({ search: q || undefined, limit: 25 });
        if (!cancel) setItems(r.items || []);
      } finally { if (!cancel) setLoading(false); }
    }, 200);
    return () => { cancel = true; clearTimeout(t); };
  }, [q, open]);

  const label = value
    ? (value.display_name || value.primary_phone || value.id)
    : '';

  return (
    <div ref={wrap} className="relative">
      <input
        className="input"
        placeholder={placeholder}
        value={open ? q : label}
        onFocus={() => { setOpen(true); setQ(''); }}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {loading && <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>}
          {!loading && items.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-400">No contacts.</div>
          )}
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onChange?.(c); setOpen(false); }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-emerald-50"
            >
              <div className="font-medium">{c.display_name || '(unnamed)'}</div>
              <div className="text-xs text-slate-500">
                {c.primary_phone || '—'}{c.primary_email ? ` · ${c.primary_email}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import Badge from './Badge.jsx';

export default function TagInput({ tags = [], onAdd, onRemove, suggestions = [] }) {
  const [value, setValue] = useState('');
  function submit(e) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    onAdd && onAdd(v);
    setValue('');
  }
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {tags.length === 0 && <span className="text-xs text-slate-400">No tags yet</span>}
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
            {t}
            <button onClick={() => onRemove && onRemove(t)} className="text-brand-700/70 hover:text-brand-700">×</button>
          </span>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Add a tag…"
          list="tag-suggestions"
          className="input"
        />
        <datalist id="tag-suggestions">
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
        <button type="submit" className="btn-ghost">Add</button>
      </form>
    </div>
  );
}

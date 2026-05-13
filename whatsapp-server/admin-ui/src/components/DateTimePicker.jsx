import React from 'react';

/**
 * Thin wrapper around <input type="datetime-local">. Stores ISO strings on
 * the model side; converts to/from local time for the browser.
 */
export default function DateTimePicker({ label, value, onChange, ...rest }) {
  const local = isoToLocal(value);
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>}
      <input
        type="datetime-local"
        className="input"
        value={local}
        onChange={(e) => onChange?.(localToIso(e.target.value))}
        {...rest}
      />
    </label>
  );
}

function isoToLocal(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().slice(0, 16);
  } catch { return ''; }
}
function localToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  if (isNaN(d)) return null;
  return d.toISOString();
}

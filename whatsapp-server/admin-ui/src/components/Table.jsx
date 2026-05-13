import React from 'react';

export function Table({ columns, rows, onRowClick, empty = 'No rows' }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500">{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(!rows || rows.length === 0) && (
            <tr><td colSpan={columns.length} className="px-4 py-6 text-center text-slate-400">{empty}</td></tr>
          )}
          {rows && rows.map((r, i) => (
            <tr
              key={r.id || i}
              onClick={() => onRowClick && onRowClick(r)}
              className={onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}
            >
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-2.5 align-top">
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

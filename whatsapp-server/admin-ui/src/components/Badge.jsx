import React from 'react';

const STYLES = {
  default: 'bg-slate-100 text-slate-700',
  brand: 'bg-brand-100 text-brand-700',
  red: 'bg-red-100 text-red-700',
  amber: 'bg-amber-100 text-amber-800',
  blue: 'bg-blue-100 text-blue-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  green: 'bg-emerald-100 text-emerald-700',
};

export default function Badge({ tone = 'default', children }) {
  return <span className={`badge ${STYLES[tone] || STYLES.default}`}>{children}</span>;
}

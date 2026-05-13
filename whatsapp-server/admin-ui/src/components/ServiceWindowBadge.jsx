import React from 'react';

export default function ServiceWindowBadge({ withinWindow, lastInboundAt }) {
  if (withinWindow) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
        ● in 24h window
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title={lastInboundAt ? `last inbound: ${new Date(lastInboundAt).toLocaleString()}` : 'no inbound yet'}>
      ⚠ outside window — use a template
    </span>
  );
}

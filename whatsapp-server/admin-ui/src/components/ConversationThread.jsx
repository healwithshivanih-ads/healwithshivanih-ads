import React from 'react';

const STATUS_ICON = {
  queued:   { icon: '⏳', cls: 'text-slate-400', title: 'queued' },
  sending:  { icon: '⏳', cls: 'text-slate-400', title: 'sending' },
  sent:     { icon: '✓',  cls: 'text-slate-400', title: 'sent' },
  delivered:{ icon: '✓✓', cls: 'text-slate-400', title: 'delivered' },
  read:     { icon: '✓✓', cls: 'text-blue-500',  title: 'read' },
  failed:   { icon: '✗',  cls: 'text-red-500',   title: 'failed' },
  draft:    { icon: '✎',  cls: 'text-amber-500', title: 'draft' },
  received: { icon: '',   cls: '',                title: '' },
};

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
}

export default function ConversationThread({ messages = [] }) {
  if (!messages.length) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        No messages yet.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {messages.map((m) => {
        const outbound = m.direction === 'outbound';
        const ai = m.ai_generated;
        const s = STATUS_ICON[m.status] || STATUS_ICON.sent;
        return (
          <div key={m.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                outbound
                  ? `bg-emerald-600 text-white ${ai ? 'border-2 border-amber-300' : ''}`
                  : 'bg-white text-slate-800 ring-1 ring-slate-200'
              }`}
            >
              {m.type === 'template' && (
                <div className={`mb-1 text-[10px] font-medium uppercase tracking-wide ${outbound ? 'text-emerald-100' : 'text-slate-400'}`}>
                  Template · {m.template_name}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words">{m.body || `[${m.type}]`}</div>
              <div className={`mt-1 flex items-center gap-1.5 text-[11px] ${outbound ? 'text-emerald-100' : 'text-slate-400'}`}>
                <span>{fmtTime(m.sent_at || m.created_at)}</span>
                {outbound && s.icon && (
                  <span className={s.cls} title={s.title}>{s.icon}</span>
                )}
                {ai && (
                  <span className="rounded bg-amber-200/30 px-1 text-[10px] text-amber-100">AI</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Badge from '../components/Badge.jsx';
import Button from '../components/Button.jsx';
import ServiceWindowBadge from '../components/ServiceWindowBadge.jsx';
import ConversationThread from '../components/ConversationThread.jsx';

// Static template fallback list. Round 2 will pull these from the
// /api/templates endpoint backed by Meta + local registry.
const STATIC_TEMPLATES = [
  { name: 'fm_checkin_nudge', language: 'en' },
  { name: 'fm_lab_reminder', language: 'en' },
  { name: 'fm_session_confirm', language: 'en' },
];

function fmtAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function Inbox() {
  const { id } = useParams();
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.conversations({ status: 'open', limit: 100 });
      setList(res.items || []);
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  return (
    <div className="flex h-screen">
      {/* left rail */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h1 className="text-sm font-semibold text-slate-800">Inbox</h1>
          <button onClick={refresh} className="text-xs text-slate-500 hover:text-slate-800">
            ↻ Refresh
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-4 text-sm text-slate-400">Loading…</div>}
          {!loading && list.length === 0 && (
            <div className="p-4 text-sm text-slate-400">No open conversations.</div>
          )}
          {list.map((c) => {
            const active = id === c.id;
            const name = c.contact?.display_name || c.contact?.primary_phone || '(unnamed)';
            return (
              <button
                key={c.id}
                onClick={() => nav(`/inbox/${c.id}`)}
                className={`flex w-full flex-col gap-0.5 border-b border-slate-100 px-4 py-3 text-left transition ${
                  active ? 'bg-emerald-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">{name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{fmtAgo(c.last_inbound_at)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{c.channel}</span>
                  {c.unread_count > 0 && (
                    <span className="rounded-full bg-emerald-600 px-1.5 text-[10px] font-medium text-white">
                      {c.unread_count}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* right pane */}
      <section className="flex flex-1 flex-col">
        {!id && (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            Pick a conversation on the left.
          </div>
        )}
        {id && <ConversationPane id={id} onChange={refresh} />}
      </section>
    </div>
  );
}

function ConversationPane({ id, onChange }) {
  const [data, setData] = useState(null);
  const [contact, setContact] = useState(null);
  const [tab, setTab] = useState('reply'); // 'reply' | 'template'

  async function load() {
    const conv = await api.conversation(id);
    setData(conv);
    api.markRead(id).catch(() => {});
    if (conv?.contact_id) api.contact(conv.contact_id).then(setContact).catch(() => setContact(null));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!data) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading…</div>;
  }

  return (
    <>
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-semibold text-slate-900">
              {contact?.display_name || contact?.primary_phone || data.contact_id}
            </div>
            <div className="text-xs text-slate-500">
              {contact?.primary_phone || '—'} · {data.channel}
            </div>
          </div>
          <ServiceWindowBadge withinWindow={data.within_service_window} lastInboundAt={data.last_inbound_at} />
        </div>
        {contact?.tags?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {contact.tags.map((t) => (
              <span key={t.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                #{t.name}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto bg-slate-50">
        <ConversationThread messages={data.messages} />
      </div>

      <ReplyBox
        conversation={data}
        onSent={() => { load(); onChange?.(); }}
        tab={tab}
        setTab={setTab}
      />
    </>
  );
}

function ReplyBox({ conversation, onSent, tab, setTab }) {
  const [body, setBody] = useState('');
  const [tplName, setTplName] = useState(STATIC_TEMPLATES[0].name);
  const [tplLang, setTplLang] = useState('en');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  const within = conversation.within_service_window;

  async function send() {
    setSending(true); setErr('');
    try {
      if (tab === 'reply') {
        await api.reply(conversation.id, { type: 'text', body });
        setBody('');
      } else {
        await api.reply(conversation.id, { type: 'template', templateName: tplName, templateLanguage: tplLang });
      }
      onSent?.();
    } catch (e) {
      if (e.code === 'outside_service_window') {
        setErr('Outside the 24h window — switch to Send template.');
        setTab('template');
      } else {
        setErr(e.message);
      }
    } finally { setSending(false); }
  }

  return (
    <div className="border-t border-slate-200 bg-white">
      {!within && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          The 24-hour service window is closed. Free-text replies are blocked by Meta. Use a template instead.
        </div>
      )}
      <div className="flex border-b border-slate-200 px-4 text-xs">
        <TabButton active={tab === 'reply'} onClick={() => setTab('reply')} disabled={!within}>
          Reply
        </TabButton>
        <TabButton active={tab === 'template'} onClick={() => setTab('template')}>
          Send template
        </TabButton>
      </div>
      <div className="px-4 py-3">
        {tab === 'reply' && (
          <textarea
            className="input min-h-[80px] resize-y"
            placeholder={within ? 'Type a reply…' : 'Disabled — outside 24h window'}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!within || sending}
          />
        )}
        {tab === 'template' && (
          <div className="space-y-2">
            <label className="block text-xs text-slate-500">Template (placeholder list — wired to /api/templates in Round 2)</label>
            <div className="flex gap-2">
              <select
                className="input flex-1"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
              >
                {STATIC_TEMPLATES.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
              <select className="input w-24" value={tplLang} onChange={(e) => setTplLang(e.target.value)}>
                <option value="en">en</option>
                <option value="hi">hi</option>
                <option value="en_GB">en_GB</option>
              </select>
            </div>
            <p className="text-xs text-slate-400">
              No template loaded yet. The body and variables are picked up server-side from Meta's template config.
            </p>
          </div>
        )}
        {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
        <div className="mt-3 flex justify-end">
          <Button onClick={send} disabled={sending || (tab === 'reply' && (!body || !within))}>
            {sending ? 'Sending…' : tab === 'reply' ? 'Send reply' : 'Send template'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, disabled, onClick, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 -mb-px border-b-2 ${
        active
          ? 'border-emerald-600 text-emerald-700 font-medium'
          : 'border-transparent text-slate-500 hover:text-slate-800'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      {children}
    </button>
  );
}

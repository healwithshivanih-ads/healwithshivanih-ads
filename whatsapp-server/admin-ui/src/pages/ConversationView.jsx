import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import Badge from '../components/Badge.jsx';
import Button from '../components/Button.jsx';

function inWindow(lastInboundAt) {
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() < 24 * 60 * 60 * 1000;
}

export default function ConversationView() {
  const { id } = useParams();
  const [conv, setConv] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState(null);
  const bottomRef = useRef(null);

  async function load() {
    try {
      const data = await api.conversationMessages(id);
      setConv(data.conversation);
      setMsgs(data.messages || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.length]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true); setErr(null);
    try {
      await api.reply(id, text.trim());
      setText('');
      await load();
    } catch (e) {
      setErr(e.body?.message || e.message);
    } finally {
      setSending(false);
    }
  }

  const open24h = inWindow(conv?.last_inbound_at);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <Link to="/conversations" className="text-xs text-slate-500 hover:underline">← All conversations</Link>
          <div className="mt-1 text-base font-semibold">
            {conv?.contacts?.name || conv?.contacts?.wa_id || '—'}
          </div>
          <div className="text-xs text-slate-500">{conv?.contacts?.phone || (conv?.contacts?.wa_id ? `+${conv.contacts.wa_id}` : '')}</div>
        </div>
        <div>
          {open24h
            ? <Badge tone="green">In 24-hour service window</Badge>
            : <Badge tone="amber">Outside 24h — template only</Badge>}
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-6">
        {msgs.length === 0 && <div className="text-center text-sm text-slate-400">No messages yet.</div>}
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-md rounded-2xl px-3 py-2 text-sm shadow-sm ${
              m.direction === 'inbound' ? 'bg-white text-slate-900' : 'bg-brand-600 text-white'
            }`}>
              <div>{m.body || `[${m.type}]`}</div>
              <div className={`mt-1 text-[10px] ${m.direction === 'inbound' ? 'text-slate-400' : 'text-white/70'}`}>
                {new Date(m.created_at).toLocaleString()} · {m.status || m.type}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="border-t border-slate-200 bg-white p-3">
        {err && <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{err}</div>}
        {!open24h && (
          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            This contact hasn't replied in over 24 hours. Free-form text is blocked by WhatsApp — use Send Template instead.
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={open24h ? 'Type a reply…' : 'Outside service window'}
            disabled={!open24h || sending}
            className="input"
          />
          <Button type="submit" disabled={!open24h || sending || !text.trim()}>{sending ? 'Sending…' : 'Send'}</Button>
        </div>
      </form>
    </div>
  );
}

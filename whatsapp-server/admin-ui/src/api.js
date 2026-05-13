// Thin fetch wrapper. API key is stored in localStorage and sent on every call.

const LS_KEY = 'wa_admin_key';

export function getKey() { return localStorage.getItem(LS_KEY) || ''; }
export function setKey(k) {
  if (k) localStorage.setItem(LS_KEY, k); else localStorage.removeItem(LS_KEY);
}
export function isLoggedIn() { return !!getKey(); }

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const key = getKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code = data?.code || data?.error;
    err.body = data;
    throw err;
  }
  return data;
}

const qs = (p = {}) => {
  const e = Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return e.length ? `?${new URLSearchParams(Object.fromEntries(e)).toString()}` : '';
};

export const api = {
  stats: () => req('/api/stats'),

  contacts: (p) => req(`/api/contacts${qs(p)}`),
  contact: (id) => req(`/api/contacts/${id}`),
  createContact: (data) => req('/api/contacts', { method: 'POST', body: JSON.stringify(data) }),
  patchContact: (id, data) => req(`/api/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addTag: (id, name) => req(`/api/contacts/${id}/tags`, { method: 'POST', body: JSON.stringify({ name }) }),
  removeTag: (id, name) => req(`/api/contacts/${id}/tags/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  conversations: (p) => req(`/api/conversations${qs(p)}`),
  conversation: (id) => req(`/api/conversations/${id}`),
  reply: (id, data) => req(`/api/conversations/${id}/reply`, { method: 'POST', body: JSON.stringify(data) }),
  markRead: (id) => req(`/api/conversations/${id}/read`, { method: 'POST' }),
  patchConversation: (id, data) => req(`/api/conversations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  tags: () => req('/api/tags'),
  createTag: (data) => req('/api/tags', { method: 'POST', body: JSON.stringify(data) }),

  messages: (p) => req(`/api/messages${qs(p)}`),
};

// Thin fetch wrapper. API key is stored in localStorage and sent on every call.

const LS_KEY = 'wa_admin_key';

export function getKey() {
  return localStorage.getItem(LS_KEY) || '';
}
export function setKey(k) {
  if (k) localStorage.setItem(LS_KEY, k);
  else localStorage.removeItem(LS_KEY);
}
export function isLoggedIn() {
  return !!getKey();
}

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const key = getKey();
  if (key) headers['x-api-key'] = key;
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const api = {
  stats: () => req('/api/stats'),
  contacts: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/api/contacts${qs ? `?${qs}` : ''}`);
  },
  contact: (id) => req(`/api/contacts/${id}`),
  addTag: (id, tag) => req(`/api/contacts/${id}/tags`, { method: 'POST', body: JSON.stringify({ tag }) }),
  removeTag: (id, tag) => req(`/api/contacts/${id}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }),
  conversations: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/api/conversations${qs ? `?${qs}` : ''}`);
  },
  conversationMessages: (id) => req(`/api/conversations/${id}/messages`),
  reply: (id, body) => req(`/api/conversations/${id}/reply`, { method: 'POST', body: JSON.stringify({ body }) }),
  appointments: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/api/appointments${qs ? `?${qs}` : ''}`);
  },
  createAppointment: (data) => req('/api/appointments', { method: 'POST', body: JSON.stringify(data) }),
  sendTemplate: (data) => req('/api/send-template', { method: 'POST', body: JSON.stringify(data) }),
  tags: () => req('/api/tags'),
  messages: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/api/messages${qs ? `?${qs}` : ''}`);
  },
};

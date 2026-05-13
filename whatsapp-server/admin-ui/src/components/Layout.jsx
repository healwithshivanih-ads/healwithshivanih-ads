import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { setKey } from '../api.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/contacts', label: 'Contacts', icon: '👥' },
  { to: '/conversations', label: 'Conversations', icon: '💬' },
  { to: '/appointments', label: 'Appointments', icon: '🗓' },
  { to: '/send-template', label: 'Send Template', icon: '📤' },
];

export default function Layout() {
  const nav = useNavigate();
  function logout() {
    setKey('');
    nav('/login');
  }
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <span className="text-xl">🌿</span>
          <span className="font-semibold tracking-tight">WhatsApp Admin</span>
        </div>
        <nav className="flex flex-col gap-0.5 p-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                  isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-50'
                }`
              }
            >
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 w-60 border-t border-slate-200 p-2">
          <button onClick={logout} className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50">
            🔓 Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

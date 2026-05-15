import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { setKey } from '../api.js';

const NAV = [
  { to: '/inbox',        label: 'Inbox',        icon: '💬' },
  { to: '/broadcast',    label: 'Broadcast',    icon: '📣' },
  { to: '/contacts',     label: 'Contacts',     icon: '👥' },
  { to: '/appointments', label: 'Appointments', icon: '📅' },
  { to: '/settings',     label: 'Settings',     icon: '⚙️' },
];

export default function Layout() {
  const nav = useNavigate();
  function logout() { setKey(''); nav('/login'); }
  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-56 shrink-0 flex-col bg-slate-900 text-slate-100">
        <div className="flex h-14 items-center gap-2 border-b border-slate-800 px-4">
          <span className="text-lg">🌿</span>
          <span className="font-semibold tracking-tight">Heal Coach</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <button
          onClick={logout}
          className="border-t border-slate-800 px-4 py-3 text-left text-xs text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          🔓 Log out
        </button>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

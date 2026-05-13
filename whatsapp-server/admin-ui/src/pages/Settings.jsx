import React from 'react';
import { NavLink, Outlet, useLocation, Navigate } from 'react-router-dom';

const SUB = [
  { to: '/settings/integrations', label: 'Integrations' },
  { to: '/settings/imports', label: 'Imports' },
  { to: '/settings/workspace', label: 'Workspace' },
];

export default function Settings() {
  const loc = useLocation();
  // Default to /settings/integrations when landing on /settings exactly.
  if (loc.pathname === '/settings' || loc.pathname === '/settings/') {
    return <Navigate to="/settings/integrations" replace />;
  }
  return (
    <div>
      <nav className="border-b border-slate-200 bg-white px-6">
        <div className="flex gap-1 py-2">
          {SUB.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm transition ${
                  isActive ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {s.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Outlet />
    </div>
  );
}

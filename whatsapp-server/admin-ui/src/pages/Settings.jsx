import React from 'react';
import Button from '../components/Button.jsx';
import { setKey } from '../api.js';

export default function Settings() {
  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold">Settings</h1>
      <p className="text-xs text-slate-500">Workspace settings UI lands in a later round.</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Workspace</h2>
          <p className="mt-2 text-sm text-slate-600">Single workspace today (multi-tenant data model).</p>
          <p className="mt-1 text-xs text-slate-500">Update name + WA tier from <code className="rounded bg-slate-100 px-1">workspaces</code> in the DB until the UI lands.</p>
        </section>
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Admin API key</h2>
          <p className="mt-2 text-sm text-slate-600">
            Set on the server via the <code className="rounded bg-slate-100 px-1">ADMIN_API_KEY</code> env var. To rotate, change the env var on the server then sign in again with the new key.
          </p>
          <Button variant="ghost" className="mt-3" onClick={() => { setKey(''); window.location = '/login'; }}>
            Reset stored key + log out
          </Button>
        </section>
      </div>
    </div>
  );
}

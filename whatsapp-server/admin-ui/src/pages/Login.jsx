import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setKey } from '../api.js';
import Input from '../components/Input.jsx';
import Button from '../components/Button.jsx';

export default function Login() {
  const [key, setK] = useState('');
  const nav = useNavigate();
  function submit(e) {
    e.preventDefault();
    if (!key.trim()) return;
    setKey(key.trim());
    nav('/');
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-emerald-50 p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-2xl">🌿</span>
          <h1 className="text-lg font-semibold">WhatsApp Admin</h1>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          Sign in with your admin API key (the <code className="rounded bg-slate-100 px-1">ADMIN_API_KEY</code> env var on the server).
        </p>
        <Input
          label="API key"
          type="password"
          value={key}
          onChange={(e) => setK(e.target.value)}
          placeholder="paste key…"
        />
        <Button className="mt-4 w-full">Sign in</Button>
      </form>
    </div>
  );
}

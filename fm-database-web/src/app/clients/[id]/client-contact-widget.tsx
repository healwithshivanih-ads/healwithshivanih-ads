"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateClientFieldsAction } from "@/app/api/email/actions";

interface Props {
  clientId: string;
  email?: string;
  nextContactDate?: string;
  mobile?: string;
}

export function ClientContactWidget({ clientId, email: initEmail, nextContactDate: initDate, mobile }: Props) {
  const [editingEmail, setEditingEmail] = useState(false);
  const [editingDate,  setEditingDate]  = useState(false);
  const [email,   setEmail]   = useState(initEmail ?? "");
  const [date,    setDate]    = useState(initDate  ?? "");
  const [saving,  setSaving]  = useState(false);

  async function saveEmail() {
    setSaving(true);
    const res = await updateClientFieldsAction(clientId, { email });
    setSaving(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success("Email saved");
    setEditingEmail(false);
  }

  async function saveDate(newDate: string | null) {
    setSaving(true);
    const res = await updateClientFieldsAction(clientId, { next_contact_date: newDate });
    setSaving(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(newDate ? `Follow-up set for ${newDate}` : "Follow-up cleared");
    setDate(newDate ?? "");
    setEditingDate(false);
  }

  const today = new Date().toISOString().slice(0, 10);
  const overdueDate = date && date < today;

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {/* Email */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">📧</span>
        {editingEmail ? (
          <span className="flex items-center gap-1">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveEmail(); if (e.key === "Escape") setEditingEmail(false); }}
              autoFocus
              className="rounded border px-2 py-0.5 text-xs bg-background w-44 focus:outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="client@example.com"
            />
            <button
              onClick={saveEmail}
              disabled={saving}
              className="px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-semibold disabled:opacity-50"
            >
              Save
            </button>
            <button onClick={() => setEditingEmail(false)} className="text-muted-foreground hover:text-foreground">✕</button>
          </span>
        ) : email ? (
          <span className="flex items-center gap-1">
            <a href={`mailto:${email}`} className="underline underline-offset-2 hover:text-primary font-medium">
              {email}
            </a>
            <button onClick={() => setEditingEmail(true)} className="text-muted-foreground hover:text-foreground opacity-50 hover:opacity-100">✏️</button>
          </span>
        ) : (
          <button
            onClick={() => setEditingEmail(true)}
            className="text-muted-foreground hover:underline"
          >
            + Add email
          </button>
        )}
      </div>

      {/* Mobile */}
      {mobile && (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span>📱</span>
          <a href={`tel:${mobile}`} className="hover:underline">{mobile}</a>
        </div>
      )}

      {/* Follow-up reminder */}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">📅</span>
        {editingDate ? (
          <span className="flex items-center gap-1">
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              autoFocus
              className="rounded border px-2 py-0.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <button
              onClick={() => saveDate(date || null)}
              disabled={saving}
              className="px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-semibold disabled:opacity-50"
            >
              Save
            </button>
            {date && (
              <button
                onClick={() => saveDate(null)}
                className="px-2 py-0.5 rounded border text-[10px] text-muted-foreground hover:bg-muted/50"
              >
                Clear
              </button>
            )}
            <button onClick={() => setEditingDate(false)} className="text-muted-foreground hover:text-foreground">✕</button>
          </span>
        ) : date ? (
          <span className="flex items-center gap-1">
            <span
              className={`font-medium ${overdueDate ? "text-red-600" : ""}`}
            >
              {overdueDate ? "⚠️ overdue · " : "Follow-up "}{date}
            </span>
            <button onClick={() => setEditingDate(true)} className="text-muted-foreground hover:text-foreground opacity-50 hover:opacity-100">✏️</button>
          </span>
        ) : (
          <button
            onClick={() => setEditingDate(true)}
            className="text-muted-foreground hover:underline"
          >
            + Set follow-up date
          </button>
        )}
      </div>
    </div>
  );
}

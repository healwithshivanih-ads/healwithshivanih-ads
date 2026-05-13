-- Optional sample tags. Re-runnable.
insert into tags (name, color) values
  ('cortisol-belly-lead', '#f59e0b'),
  ('booked-call', '#10b981'),
  ('reminder-sent', '#6366f1'),
  ('health-coaching-lead', '#0ea5e9'),
  ('no-show', '#ef4444'),
  ('follow-up-due', '#a855f7')
on conflict (name) do nothing;

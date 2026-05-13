-- Round 1 seed: one workspace + a handful of default tags.
-- Re-runnable. The workspace name comes from env (WORKSPACE_NAME) at app boot
-- if it's missing; this seed just gives you something to point at directly.

-- Single default workspace (idempotent on name)
insert into workspaces (name)
values ('Heal With Shivani')
on conflict do nothing;

-- Default tags scoped to that workspace.
-- Uses the workspace just inserted (or the first one already present).
insert into tags (workspace_id, name, color, kind, description)
select w.id, t.name, t.color, 'system', t.description
from workspaces w
cross join (values
  ('cortisol-lead',         '#f59e0b', 'Cortisol-belly funnel lead'),
  ('booked-call',           '#10b981', 'Has a scheduled discovery call'),
  ('reminder-sent',         '#6366f1', 'Last 24/2h reminder fired'),
  ('health-coaching-lead',  '#0ea5e9', 'General coaching enquiry'),
  ('no-show',               '#ef4444', 'Failed to attend a booked call'),
  ('follow-up-due',         '#a855f7', 'Needs a manual nudge'),
  ('vip',                   '#fb7185', 'Priority contact'),
  ('do-not-contact',        '#64748b', 'Suppress all outreach')
) as t(name, color, description)
where w.name = 'Heal With Shivani'
on conflict (workspace_id, name) do nothing;

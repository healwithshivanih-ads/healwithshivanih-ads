-- WhatsApp server schema. Run this in the Supabase SQL editor.
-- RLS is left OFF on every table — the server connects with the service role key.

create extension if not exists pgcrypto;

-- updated_at trigger function ----------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- contacts -----------------------------------------------------------------
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  wa_id text not null unique,
  phone text,
  name text,
  opt_in_source text check (opt_in_source in ('meta_ad','website','booking','form','manual','whatsapp','other')),
  opt_in_at timestamptz,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contacts_wa_id_idx on contacts(wa_id);
create index if not exists contacts_last_seen_idx on contacts(last_seen_at desc);
drop trigger if exists contacts_set_updated on contacts;
create trigger contacts_set_updated before update on contacts
  for each row execute function set_updated_at();

-- tags ---------------------------------------------------------------------
create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text,
  created_at timestamptz not null default now()
);

-- contact_tags -------------------------------------------------------------
create table if not exists contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);
create index if not exists contact_tags_tag_idx on contact_tags(tag_id);

-- conversations ------------------------------------------------------------
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null unique references contacts(id) on delete cascade,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  status text not null default 'open' check (status in ('open','closed','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_last_msg_idx on conversations(last_message_at desc);
drop trigger if exists conversations_set_updated on conversations;
create trigger conversations_set_updated before update on conversations
  for each row execute function set_updated_at();

-- messages -----------------------------------------------------------------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  wa_message_id text unique,
  type text not null,
  body text,
  payload jsonb,
  template_name text,
  status text check (status in ('queued','sent','delivered','read','failed','received')),
  error jsonb,
  retry_count int not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on messages(conversation_id, created_at desc);
create index if not exists messages_wa_idx on messages(wa_message_id);
create index if not exists messages_contact_idx on messages(contact_id, created_at desc);

-- appointments -------------------------------------------------------------
create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  external_id text,
  source text not null check (source in ('calendly','wix','manual','other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled','rescheduled','cancelled','completed','no_show')),
  title text,
  notes text,
  location text,
  join_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists appointments_source_external_idx
  on appointments(source, external_id) where external_id is not null;
create index if not exists appointments_contact_idx on appointments(contact_id, starts_at desc);
create index if not exists appointments_starts_idx on appointments(starts_at);
drop trigger if exists appointments_set_updated on appointments;
create trigger appointments_set_updated before update on appointments
  for each row execute function set_updated_at();

-- reminders ----------------------------------------------------------------
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  kind text not null check (kind in ('confirmation','t_minus_24h','t_minus_2h','post_session')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped')),
  error jsonb,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  unique (appointment_id, kind)
);
create index if not exists reminders_due_idx on reminders(status, scheduled_for);

-- templates_sent (convenience view) ----------------------------------------
create or replace view templates_sent as
  select id, contact_id, template_name, payload as variables, sent_at, status
  from messages
  where type = 'template';

-- webhook_events -----------------------------------------------------------
create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('meta','calendly','wix','meta_ad','form','other')),
  event_type text,
  payload jsonb,
  signature_valid boolean,
  processed boolean not null default false,
  error jsonb,
  received_at timestamptz not null default now()
);
create index if not exists webhook_events_src_idx on webhook_events(source, received_at desc);

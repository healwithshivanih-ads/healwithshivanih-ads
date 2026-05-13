-- ============================================================================
-- WhatsApp + Conversational Automation Platform
-- Postgres / Supabase schema, v0.1
--
-- Conventions:
--   - All PKs are uuid, default gen_random_uuid()
--   - All tables have workspace_id (scope-by-default)
--   - created_at / updated_at timestamptz, updated_at via trigger
--   - Soft deletes via deleted_at where relevant
--   - Indexes called out inline; foreign keys ON DELETE behaviour explicit
--   - jsonb wherever shape is fluid or extends per integration
-- ============================================================================

create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;


-- ============================================================================
-- 1. WORKSPACES — tenant root
-- ============================================================================

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  wa_phone_number_id text,
  wa_business_account_id text,
  wa_tier text check (wa_tier in ('tier_1k','tier_10k','tier_100k','unlimited')) default 'tier_1k',
  suppression_policy jsonb not null default '{
    "max_broadcasts_per_week": 3,
    "min_hours_between_broadcasts": 24,
    "skip_if_in_active_flow": true,
    "skip_if_appointment_within_hours": 48
  }'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger workspaces_updated_at before update on workspaces
  for each row execute function set_updated_at();


-- ============================================================================
-- 2. CONTACTS — the unified person
-- ============================================================================

create table contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  display_name text,
  primary_phone text,
  primary_email text,
  city text,
  country text,
  locale text,
  timezone text,

  opt_in_status text not null default 'unknown'
    check (opt_in_status in ('unknown','pending','opted_in','opted_out')),
  opt_in_at timestamptz,
  opt_in_source text,
  consent_text text,
  consent_method text,

  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_broadcast_received_at timestamptz,

  deleted_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on contacts (workspace_id);
create index on contacts (workspace_id, primary_phone) where primary_phone is not null;
create index on contacts (workspace_id, primary_email) where primary_email is not null;
create index on contacts (workspace_id, last_inbound_at desc);
create index on contacts using gin (metadata);
create trigger contacts_updated_at before update on contacts
  for each row execute function set_updated_at();


-- ============================================================================
-- 3. CONTACT_IDENTITIES — per-channel reachability
-- ============================================================================

create table contact_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,

  channel text not null check (channel in ('whatsapp','instagram','wix','email','sms')),
  external_id text not null,
  is_primary bool not null default false,
  verified bool not null default false,

  subscription_status text not null default 'unknown'
    check (subscription_status in ('unknown','subscribed','unsubscribed','never_subscribed')),

  sync_version int not null default 0,
  last_synced_at timestamptz,
  last_sync_direction text check (last_sync_direction in ('in','out')),

  last_seen_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, channel, external_id)
);
create index on contact_identities (contact_id);
create index on contact_identities (workspace_id, channel);
create trigger contact_identities_updated_at before update on contact_identities
  for each row execute function set_updated_at();


-- ============================================================================
-- 4. TAGS / CONTACT_TAGS
-- ============================================================================

create table tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  color text,
  kind text not null default 'manual' check (kind in ('system','manual','dynamic')),
  description text,
  wix_label_id text,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create index on tags (workspace_id);

create table contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by text,
  primary key (contact_id, tag_id)
);
create index on contact_tags (tag_id);


-- ============================================================================
-- 5. CONVERSATIONS
-- ============================================================================

create table conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','instagram','sms','email')),

  status text not null default 'open'
    check (status in ('open','closed','blocked','archived')),

  last_inbound_at timestamptz,
  last_outbound_at timestamptz,

  ai_policy text check (ai_policy in ('off','draft','auto')),

  assigned_to text,
  unread_count int not null default 0,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, contact_id, channel)
);
create index on conversations (workspace_id, status, last_inbound_at desc);
create index on conversations (contact_id);
create trigger conversations_updated_at before update on conversations
  for each row execute function set_updated_at();


-- ============================================================================
-- 6. MESSAGES
-- ============================================================================

create table messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,

  channel text not null check (channel in ('whatsapp','instagram','sms','email')),
  direction text not null check (direction in ('inbound','outbound')),

  external_message_id text,
  type text not null check (type in (
    'text','template','interactive_button','interactive_list',
    'image','document','video','audio','sticker',
    'flow','status','system','reaction'
  )),

  body text,
  payload jsonb,

  template_name text,
  template_language text,
  template_variables jsonb,

  status text not null default 'queued' check (status in (
    'draft','queued','sending','sent','delivered','read','failed','received'
  )),
  error jsonb,
  retry_count int not null default 0,
  sent_at timestamptz,

  ai_generated bool not null default false,
  ai_confidence numeric(4,3),
  ai_review_status text check (ai_review_status in (
    'pending','approved','rejected','edited','auto'
  )),
  ai_job_id uuid,

  origin text check (origin in (
    'inbound_webhook','manual','ai_draft','ai_auto',
    'reminder','broadcast','flow','sync','api'
  )),
  origin_ref uuid,

  created_at timestamptz not null default now(),

  unique (workspace_id, channel, external_message_id)
    deferrable initially deferred
);
create index on messages (conversation_id, created_at desc);
create index on messages (contact_id, created_at desc);
create index on messages (workspace_id, status) where status in ('queued','sending','draft');
create index on messages (origin, origin_ref) where origin_ref is not null;


-- ============================================================================
-- 7. APPOINTMENTS
-- ============================================================================

create table appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,

  source text not null check (source in ('calendly','wix','manual','other')),
  external_id text,

  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'scheduled' check (status in (
    'scheduled','rescheduled','cancelled','completed','no_show'
  )),

  title text,
  notes text,
  location text,
  join_url text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, source, external_id)
);
create index on appointments (workspace_id, starts_at);
create index on appointments (contact_id, starts_at desc);
create trigger appointments_updated_at before update on appointments
  for each row execute function set_updated_at();


-- ============================================================================
-- 8. REMINDERS
-- ============================================================================

create table reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,

  kind text not null check (kind in (
    'confirmation','t_minus_24h','t_minus_2h','post_session'
  )),
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in (
    'pending','sending','sent','failed','skipped'
  )),

  message_id uuid references messages(id) on delete set null,
  attempts int not null default 0,
  sent_at timestamptz,
  error jsonb,

  created_at timestamptz not null default now(),

  unique (appointment_id, kind)
);
create index on reminders (workspace_id, status, scheduled_for)
  where status = 'pending';


-- ============================================================================
-- 9. SEGMENTS + SEGMENT_MEMBERS
-- ============================================================================

create table segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  filter jsonb not null,
  is_dynamic bool not null default true,
  last_computed_at timestamptz,
  member_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create index on segments (workspace_id);
create trigger segments_updated_at before update on segments
  for each row execute function set_updated_at();

create table segment_members (
  segment_id uuid not null references segments(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (segment_id, contact_id)
);
create index on segment_members (contact_id);


-- ============================================================================
-- 10. SUPPRESSION_LIST
-- ============================================================================

create table suppression_list (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  reason text not null check (reason in (
    'unsubscribed','bounced','manual','in_active_flow',
    'recently_messaged','no_consent','customer_service_flag'
  )),
  source text,
  added_at timestamptz not null default now(),
  expires_at timestamptz,
  notes text,
  unique (workspace_id, contact_id, reason)
);
create index on suppression_list (contact_id);
create index on suppression_list (workspace_id, expires_at)
  where expires_at is not null;


-- ============================================================================
-- 11. BROADCASTS + BROADCAST_RECIPIENTS
-- ============================================================================

create table broadcasts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  name text not null,
  description text,
  channel text not null check (channel in ('whatsapp','instagram')),

  status text not null default 'draft' check (status in (
    'draft','scheduled','sending','paused','done','cancelled','failed'
  )),

  template_name text not null,
  template_language text not null default 'en',
  template_variables_schema jsonb,

  audience_segment_id uuid references segments(id) on delete restrict,
  audience_filter jsonb,

  suppression_overrides jsonb not null default '{}'::jsonb,
  exclude_contact_ids uuid[] not null default '{}',

  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,

  audience_resolved_count int,
  suppressed_count int,
  net_recipient_count int,

  stats jsonb not null default '{
    "queued":0,"sent":0,"delivered":0,"read":0,"failed":0,"replied":0
  }'::jsonb,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (
    (audience_segment_id is not null and audience_filter is null) or
    (audience_segment_id is null and audience_filter is not null) or
    (status = 'draft')
  )
);
create index on broadcasts (workspace_id, status);
create index on broadcasts (workspace_id, scheduled_for)
  where status = 'scheduled';
create trigger broadcasts_updated_at before update on broadcasts
  for each row execute function set_updated_at();

create table broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references broadcasts(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,

  status text not null default 'queued' check (status in (
    'queued','sending','sent','delivered','read','failed','skipped','replied'
  )),
  variables_resolved jsonb,
  error jsonb,
  attempts int not null default 0,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  reply_message_id uuid references messages(id) on delete set null,

  unique (broadcast_id, contact_id)
);
create index on broadcast_recipients (broadcast_id, status);
create index on broadcast_recipients (contact_id);
create index on broadcast_recipients (status, queued_at)
  where status = 'queued';


-- ============================================================================
-- 12. AI_POLICIES + AI_JOBS
-- ============================================================================

create table ai_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,

  scope_filter jsonb not null default '{}'::jsonb,

  mode text not null default 'draft' check (mode in ('off','draft','auto')),

  model text not null default 'claude-haiku-4-5',
  system_prompt text not null,
  max_tokens int not null default 600,
  temperature numeric(3,2) default 0.7,

  confidence_threshold numeric(4,3) default 0.700,
  escalation_tags text[] not null default '{}',

  active_hours_start time,
  active_hours_end time,
  active_days int[],

  priority int not null default 0,
  enabled bool not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create index on ai_policies (workspace_id, enabled);
create trigger ai_policies_updated_at before update on ai_policies
  for each row execute function set_updated_at();

create table ai_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  trigger_message_id uuid not null references messages(id) on delete cascade,
  policy_id uuid references ai_policies(id) on delete set null,

  status text not null default 'pending' check (status in (
    'pending','processing','done','failed','escalated','skipped'
  )),

  draft_message_id uuid references messages(id) on delete set null,
  model_response jsonb,
  prompt_tokens int,
  completion_tokens int,
  confidence numeric(4,3),
  escalation_reason text,
  error jsonb,
  attempts int not null default 0,

  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index on ai_jobs (status, created_at)
  where status in ('pending','failed');
create index on ai_jobs (conversation_id);


-- ============================================================================
-- 13. FLOWS + FLOW_RUNS  (schema only, runner not implemented in v1)
-- ============================================================================

create table flows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  version int not null default 1,

  trigger jsonb not null,
  states jsonb not null,

  is_published bool not null default false,
  is_active bool not null default false,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name, version)
);
create index on flows (workspace_id, is_active) where is_active;
create trigger flows_updated_at before update on flows
  for each row execute function set_updated_at();

create table flow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  flow_id uuid not null references flows(id) on delete restrict,
  contact_id uuid not null references contacts(id) on delete cascade,

  current_state text not null,
  status text not null default 'active' check (status in (
    'active','completed','exited','timed_out','failed','paused'
  )),

  context jsonb not null default '{}'::jsonb,
  state_history jsonb not null default '[]'::jsonb,

  started_at timestamptz not null default now(),
  last_transition_at timestamptz not null default now(),
  next_check_at timestamptz,
  ended_at timestamptz,

  unique (flow_id, contact_id, status)
    deferrable initially deferred
);
create index on flow_runs (workspace_id, status, next_check_at)
  where status = 'active';
create index on flow_runs (contact_id);


-- ============================================================================
-- 14. WEBHOOK_EVENTS
-- ============================================================================

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  source text not null check (source in (
    'meta_whatsapp','meta_ad','calendly','wix','form','instagram','other'
  )),
  event_type text,
  signature_valid bool,
  payload jsonb not null,
  headers jsonb,
  processed bool not null default false,
  processing_attempts int not null default 0,
  error jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index on webhook_events (source, received_at desc);
create index on webhook_events (processed, received_at)
  where not processed;


-- ============================================================================
-- 15. INTEGRATIONS + SYNC_EVENTS
-- ============================================================================

create table integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null check (type in ('wix','calendly','meta_ads','meta_whatsapp')),
  status text not null default 'disconnected'
    check (status in ('connected','disconnected','error','pending')),
  credentials_encrypted jsonb,
  config jsonb not null default '{}'::jsonb,
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, type)
);
create trigger integrations_updated_at before update on integrations
  for each row execute function set_updated_at();

create table sync_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integrations(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  entity_type text not null,
  entity_id uuid,
  external_id text,
  operation text not null check (operation in ('create','update','delete','merge')),
  payload jsonb,
  status text not null default 'pending'
    check (status in ('pending','done','failed','skipped')),
  error jsonb,
  attempts int not null default 0,
  attempted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on sync_events (integration_id, status, created_at)
  where status in ('pending','failed');


-- ============================================================================
-- 16. IMPORTS
-- ============================================================================

create table imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null check (source in ('csv','wix','manual_paste')),
  filename text,
  status text not null default 'pending' check (status in (
    'pending','processing','done','failed','partial'
  )),

  total_rows int,
  matched_existing int,
  created_new int,
  skipped int,
  failed int,
  errors jsonb,

  config jsonb not null default '{}'::jsonb,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz
);
create index on imports (workspace_id, uploaded_at desc);

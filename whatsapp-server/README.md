# whatsapp-server

Production-ready WhatsApp Cloud API webhook server with admin UI.

Built for **Heal With Shivani H** — health coach in India running cortisol-belly
ads on Meta and booking discovery calls via Calendly / Wix. This server is the
back-end that:

- receives inbound WhatsApp messages from the Meta Cloud API
- captures CTWA (Click-to-WhatsApp) leads, Calendly bookings, Wix bookings,
  and generic form submissions
- stores everything in Supabase (Postgres)
- schedules and sends appointment reminders (confirmation, 24h, 2h, post-session)
  using approved WhatsApp message templates
- exposes a small admin REST API
- ships with a React + Tailwind admin UI served by Express in production

Stack: Node 20 (ESM) · Express 4 · Supabase JS · Meta Graph API v21.0 ·
React 18 · Vite · Tailwind 3 · Pino · Helmet · rate-limit. Deployable on
Fly.io (Dockerfile + `fly.toml` included).

---

## Quick start (local)

```bash
# 1. Install everything
cd whatsapp-server
npm install
cd admin-ui && npm install && cd ..

# 2. Configure env
cp .env.example .env
# fill in WHATSAPP_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN, META_APP_SECRET,
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_API_KEY

# 3. Create the database schema in Supabase (paste sql/schema.sql + sql/seed.sql
#    into the SQL editor and run them).

# 4. Start the server
npm run dev          # nodemon-style watcher on src/

# 5. (In another terminal) start the admin UI in dev mode
cd admin-ui && npm run dev   # opens http://localhost:5173

# 6. Run the curl smoke test
./test/curl-examples.sh
```

For production, `npm run build` builds the admin UI into `admin-ui/dist`, and
Express serves it at the root path. So a single `node src/index.js` (or
`docker run`) gives you the full stack on port 3000.

---

## 1. Meta WhatsApp Cloud API setup

1. **Create a Meta app** at <https://developers.facebook.com/apps> (type:
   *Business*). Note the **App ID** and **App Secret** (`META_APP_SECRET`).
2. **Add the WhatsApp product** to the app. You'll get a **Phone Number ID**
   (`PHONE_NUMBER_ID`) and **WhatsApp Business Account ID**
   (`WHATSAPP_BUSINESS_ACCOUNT_ID`).
3. **Get an access token**:
   - For dev: copy the temporary token from the WhatsApp > API setup page.
     Valid for 24h, fine for first end-to-end test.
   - For prod: create a **system user** in Meta Business Suite > Business
     Settings > Users > System Users, assign it to your WhatsApp Business
     Account with `whatsapp_business_management` + `whatsapp_business_messaging`,
     and generate a **permanent token** (`WHATSAPP_TOKEN`).
4. **Add test recipients (dev only)**: WhatsApp > API setup > "To" — add 1-5
   personal numbers. You can only message these from a dev phone-number ID
   until you complete business verification.
5. **Business verification** (required to message non-test numbers): Meta
   Business Suite > Business Settings > Security Center > Start Verification.
   Submit a registered business + a utility bill. Takes 1-5 days.
6. **Register your number** (display phone): in the API setup page, click
   "Register". Pick a display name (your business name).
7. **Configure the webhook**:
   - In WhatsApp > Configuration: set **Callback URL** to
     `https://<your-domain>/webhook` and **Verify token** to whatever you
     put in `VERIFY_TOKEN`. Click "Verify and save".
   - Subscribe to the `messages` field (and any others you want — `message_template_status_update`
     is handy for catching template approvals).
8. **Approve message templates**: WhatsApp Manager > Message Templates.
   Create the 4 reminder templates the server uses:
   - `appt_confirmation` (3 body vars: name, time, title)
   - `appt_reminder_24h` (same 3 vars)
   - `appt_reminder_2h` (same 3 vars)
   - `appt_post_session` (same 3 vars)
   Category: **UTILITY**. Languages: **English (en)**.
9. **Embedded signup** (later, when you onboard clients onto your own WABA):
   <https://developers.facebook.com/docs/whatsapp/embedded-signup>.

---

## 2. Environment variables

| Name | Example | Where to get it |
|------|---------|-----------------|
| `WHATSAPP_TOKEN` | `EAAG...` | Meta App > WhatsApp > API setup → permanent system-user token |
| `PHONE_NUMBER_ID` | `1234567890` | WhatsApp > API setup |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `1234567890` | WhatsApp > API setup |
| `VERIFY_TOKEN` | `pick-any-long-random-string` | You invent it — paste same value into Meta's webhook config |
| `META_APP_SECRET` | `abc123...` | Meta App > Settings > Basic |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` | Supabase project > Project Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Supabase project > Project Settings > API (use the **service_role** key, NOT anon) |
| `ADMIN_API_KEY` | `<random 32+ chars>` | You generate (`openssl rand -hex 32`) |
| `BASE_URL` | `https://your-app.fly.dev` | Public URL (for docs/integrations) |
| `PORT` | `3000` | Express listen port (Fly maps :443 → :3000) |
| `NODE_ENV` | `production` | `development` for local |
| `LOG_LEVEL` | `info` | pino level (`debug`, `info`, `warn`, `error`) |
| `CALENDLY_SIGNING_SECRET` | `(optional)` | Calendly > Integrations > Webhooks → secret. Skip and we accept all Calendly POSTs unverified. |

`.env.example` is committed. Copy to `.env` for local dev. **Never commit
`.env`** (it's in `.gitignore`).

---

## 3. Supabase setup

1. Create a new project at <https://supabase.com>.
2. Open the **SQL Editor**.
3. Paste the contents of `sql/schema.sql` and run.
4. (Optional) paste `sql/seed.sql` and run — seeds 6 default tags.
5. Project Settings > API:
   - copy **URL** → `SUPABASE_URL`
   - copy the **service_role** key (NOT `anon`!) → `SUPABASE_SERVICE_ROLE_KEY`

The server connects with the service-role key, so RLS is irrelevant (it's
left off in the schema). Don't ship the service-role key to a browser — it
only ever sits in this server's env.

The schema creates 7 tables + 1 view: `contacts`, `tags`, `contact_tags`,
`conversations`, `messages`, `appointments`, `reminders`, `webhook_events`,
plus `templates_sent` (view over `messages where type='template'`).

---

## 4. Deploy to Fly.io

```bash
# One-time setup
brew install flyctl                    # or curl -L https://fly.io/install.sh | sh
fly auth login
cd whatsapp-server
fly launch --no-deploy                 # accept the included fly.toml when asked
                                        # (it'll detect Dockerfile automatically)

# Push every secret (these go into fly's secrets vault, NOT fly.toml)
fly secrets set \
  WHATSAPP_TOKEN="..." \
  PHONE_NUMBER_ID="..." \
  WHATSAPP_BUSINESS_ACCOUNT_ID="..." \
  VERIFY_TOKEN="..." \
  META_APP_SECRET="..." \
  SUPABASE_URL="https://....supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  ADMIN_API_KEY="..." \
  BASE_URL="https://<app-name>.fly.dev"

# Deploy
fly deploy

# Tail logs
fly logs

# Open the admin UI
open https://<app-name>.fly.dev
```

The Dockerfile is a 3-stage build (admin UI build → server deps → slim runtime).
Final image is ~150MB. `fly.toml` runs 1 shared-cpu-1x machine (512MB) in
Mumbai (`bom`) — change `primary_region` if your users are elsewhere. Min
machines = 1 so the reminder scheduler never sleeps.

---

## 5. Local testing with ngrok

```bash
npm run dev                            # localhost:3000
ngrok http 3000                        # → https://abcd-1-2-3-4.ngrok-free.app
```

Then in Meta App > WhatsApp > Configuration:

- Callback URL: `https://abcd-1-2-3-4.ngrok-free.app/webhook`
- Verify token: whatever you set as `VERIFY_TOKEN`
- Click **Verify and save**. Meta hits `GET /webhook` with `hub.mode=subscribe`
  and we echo the challenge.

Now send your business number a WhatsApp message from one of the test
recipient phones. You should see an `inbound message` log line and a row in
`messages` in Supabase.

`./test/curl-examples.sh` exercises every endpoint with sample payloads. Most
work without real Meta credentials (signature check will fail — webhook still
logs the event with `signature_valid=false`).

---

## 6. Connecting Calendly, Wix, Meta CTWA, generic forms

All external webhook URLs go to `https://<your-domain>/webhooks/<source>`:

| Integration | URL | Notes |
|-------------|-----|-------|
| Calendly | `/webhooks/calendly` | Calendly > Integrations > Webhooks — subscribe to `invitee.created` + `invitee.canceled`. Optionally set `CALENDLY_SIGNING_SECRET` for HMAC verification. |
| Wix Bookings | `/webhooks/wix-booking` | Use Wix Automations or Velo to POST booking events. We accept either `{phone, startsAt, name}` shape or nested `{booking: {startTime, formInfo: {phone}}}`. |
| Meta CTWA (lead form) | `/webhooks/meta-ad` | Use Meta Business Suite > Instant Forms → Zapier/Make to POST `{phone_number, full_name, campaign_name}`. Campaign name containing `cortisol` auto-tags `cortisol-belly-lead`. |
| Generic form (e.g. Tally, Typeform via Make.com) | `/webhooks/form` | POST `{phone, name?, tags?: [], source?}`. Phone gets normalised, tags get applied. |

Every external POST is persisted to `webhook_events` first (full payload),
then processed. If processing crashes, the raw event survives. Always
returns 200 quickly so the upstream service doesn't retry.

---

## Architecture notes

- **Idempotency**: `reminders` has `unique(appointment_id, kind)` so re-running
  `scheduleReminders` is a no-op. Each due reminder is *claimed* with an
  atomic `status: pending → sending` UPDATE before sending, so multi-replica
  setups don't double-send.
- **24h service window**: WhatsApp only allows free-form text within 24h of the
  customer's last inbound. `sendText` checks `conversations.last_inbound_at`
  and throws `OutsideServiceWindowError` if outside the window. Templates can
  be sent any time.
- **Signature verification**: `POST /webhook` requires `X-Hub-Signature-256`
  to match `HMAC_SHA256(META_APP_SECRET, raw_body)`. We capture raw bytes via
  `express.raw({type:'application/json'})` *before* JSON parsing — JSON.parse
  re-serialisation would change the bytes and break the HMAC. Invalid
  signatures get logged with `signature_valid=false` but still ack 200 (Meta
  retries indefinitely on 4xx/5xx — we'd rather log + ignore).
- **Reminder cadence**: 4 kinds. `confirmation` fires immediately on booking
  (regardless of when the appointment is). `t_minus_24h`, `t_minus_2h`, and
  `post_session` (+1h after start) are skipped if their scheduled_for is
  already in the past (e.g. an appointment booked 30 minutes before start
  skips both the 24h + 2h reminders but still gets a confirmation +
  post-session).
- **Logging**: pino with `pino-pretty` in dev, structured JSON in prod. Secrets
  are redacted in log output via the `redact` config in `src/logger.js`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401` on `/api/*` | wrong/missing `x-api-key` | Use `ADMIN_API_KEY` value |
| `403` on `GET /webhook` | `VERIFY_TOKEN` mismatch | Make sure Meta's "Verify token" === your `.env` value |
| `409 outside_service_window` on reply | last inbound is >24h old | Use `POST /api/send-template` with an approved template instead |
| `132012` from Meta on template send | template not approved or wrong language code | Check WhatsApp Manager > Message Templates; status must be `APPROVED` |
| `131047` from Meta | re-engagement: customer hasn't replied in 24h | Same fix — send a template |
| Webhook verify works but no messages arrive | not subscribed to `messages` field | WhatsApp > Configuration → Webhook fields → check `messages` |
| `signature_valid: false` on every event | `META_APP_SECRET` is wrong | Re-copy from Meta App > Settings > Basic |
| Reminders never send | scheduler not running, or templates not yet approved | Check `fly logs` for `reminder scheduler started`; check template status |
| Reminders sending duplicates | shouldn't happen — unique constraint + atomic claim | Open an issue with reminder ID + appointment ID |

---

## API reference (admin)

All require `x-api-key: <ADMIN_API_KEY>`.

```
GET    /api/stats                              counts: contacts, open convs, upcoming appts, msgs today
GET    /api/contacts?search=&tag=&limit=&offset=
GET    /api/contacts/:id                       contact + tags + recent appointments
POST   /api/contacts/:id/tags          { tag } add tag
DELETE /api/contacts/:id/tags/:tag             remove tag
GET    /api/conversations?status=&limit=
GET    /api/conversations/:id/messages
POST   /api/conversations/:id/reply    { body }  send text (24h window)
GET    /api/appointments?status=&from=&to=
POST   /api/appointments               { contact_id, starts_at, title?, source? }
POST   /api/send-template              { contact_id, template_name, language_code?, variables? }
GET    /api/tags
GET    /api/messages?limit=            recent messages, newest first
GET    /api/healthz                    unauthenticated ping
```

Public/health:
```
GET    /healthz
GET    /webhook                        Meta hub verification
POST   /webhook                        Meta event delivery (HMAC verified)
POST   /webhooks/calendly
POST   /webhooks/wix-booking
POST   /webhooks/meta-ad
POST   /webhooks/form
```

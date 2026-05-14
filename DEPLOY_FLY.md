# FM Coach — Fly.io deployment runbook (intake-only)

End-to-end recipe to ship the FM Coach **intake form** to Fly.io with
custom domain `intake.theochretree.com`. The coach UI stays on the
Mac mini + laptop, exactly as today. Data syncs bidirectionally via
**Mutagen** — see `MUTAGEN_SYNC.md`.

Time budget: ~**2–3 hours** end-to-end including Mutagen setup, custom
domain, and smoke test.

## Prerequisites

- `flyctl` installed + logged in (`flyctl auth login` once)
- Existing Fly account with payment
- `Dockerfile`, `fly.toml` (app = `theochretree-coach`), `.dockerignore` at repo root
- `fm-database-web/src/middleware.ts` — already wired for `FLY_INTAKE_ONLY=1` mode
- `fm-database-web/src/app/api/health/route.ts` — Fly health probe

## Step 1 — Create the Fly app

```bash
cd /Users/shivani/code/healwithshivanih-ads
flyctl apps create theochretree-coach --org personal
```

(If `theochretree-coach` is taken globally, pick a different slug and
update line 12 of `fly.toml`. Then rerun `flyctl apps create`.)

## Step 2 — Create the persistent volume

```bash
flyctl volumes create fmcoach_data \
  --region bom \
  --size 3 \
  -a theochretree-coach
```

`bom` matches `primary_region` in `fly.toml`. 3 GB is generous — each
session YAML is < 50 KB, 3 GB holds ~60,000 sessions.

## Step 3 — Set secrets

```bash
# Generate + save the coach auth password BEFORE running this.
# Even though intake-only mode doesn't strictly need it, set it
# anyway so if you ever flip FLY_INTAKE_ONLY=0 the auth is ready.
COACH_PASS="$(openssl rand -hex 12)"
echo "Coach password: $COACH_PASS  ← save this to your password manager NOW"

flyctl secrets set \
  ANTHROPIC_API_KEY="sk-ant-..." \
  AISENSY_API_KEY="..." \
  AISENSY_WEBHOOK_SECRET="$(openssl rand -hex 16)" \
  GMAIL_USER="shivanihari@gmail.com" \
  GMAIL_APP_PASSWORD="..." \
  COACH_AUTH_USERNAME="shivani" \
  COACH_AUTH_PASSWORD="$COACH_PASS" \
  -a theochretree-coach
```

Copy `ANTHROPIC_API_KEY`, `AISENSY_API_KEY`, `GMAIL_USER`,
`GMAIL_APP_PASSWORD` from your local `.env` and `.env.local`.

## Step 4 — First deploy

```bash
flyctl deploy -a theochretree-coach
```

First build: ~5–8 min (npm install + next build + pip install).

When it finishes, hit the temporary `*.fly.dev` URL:

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" \
  https://theochretree-coach.fly.dev/api/health
# Expect: HTTP 200

curl -sS -o /dev/null -w "HTTP %{http_code}\n" \
  https://theochretree-coach.fly.dev/clients-v2
# Expect: HTTP 404 — coach UI is invisible from Fly ✓
```

If both return as expected, intake-only mode is live.

## Step 5 — Set up Mutagen sync

**Don't proceed past this step until Mutagen is syncing your local
`~/fm-plans/` to the Fly volume.** Without sync, the intake form on Fly
won't see any clients and tokens won't resolve.

See `MUTAGEN_SYNC.md` — single file with the full setup. Comes back to
this runbook at Step 6 once `mutagen sync list` shows Watching status.

## Step 6 — Custom domain + TLS

Only ONE hostname needed:

```bash
flyctl certs add intake.theochretree.com -a theochretree-coach
```

Output prints the CNAME target — usually `theochretree-coach.fly.dev`.

## Step 7 — Add CNAME at Wix DNS

1. Wix Studio → Settings → Domains → `theochretree.com`
2. Open **Advanced DNS** / **DNS Records**
3. Add one record:

   | Type  | Host   | Value                              | TTL  |
   | ----- | ------ | ---------------------------------- | ---- |
   | CNAME | intake | `theochretree-coach.fly.dev`       | 1h   |

4. Save. Propagation usually <5 min globally.

## Step 8 — Verify TLS

```bash
flyctl certs check intake.theochretree.com -a theochretree-coach
```

Wait until output shows `Configured: Yes` and `Issued: Yes` (typically
<2 min after DNS propagates).

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" \
  https://intake.theochretree.com/api/health
# Expect: HTTP 200
```

## Step 9 — End-to-end smoke test

```bash
# A real client token from your existing ~/fm-plans/ should now resolve on Fly
# because Mutagen has synced your client.yaml files to the volume.
# Replace with a real active token (or generate one on localhost first):
TOKEN="<some-token-from-your-Mac>"

# Public — should load
curl -sSL -o /dev/null -w "intake form: %{http_code}\n" \
  "https://intake.theochretree.com/intake/$TOKEN"

# Coach UI on the public domain — should 404
curl -sS -o /dev/null -w "coach via public: %{http_code}\n" \
  https://intake.theochretree.com/clients-v2

# Coach UI on localhost — still works as before
curl -sS -o /dev/null -w "coach via localhost: %{http_code}\n" \
  http://localhost:3002/clients-v2
```

Now in a browser, open `https://intake.theochretree.com/intake/$TOKEN`
on your phone. Fill a section, watch the autosave indicator. Confirm:

1. On your Mac, `cat ~/fm-plans/clients/<id>/client.yaml | grep intake_form_draft` shows the draft fields propagating in (sub-second via Mutagen).
2. Coach UI on `http://localhost:3002/clients-v2/<id>` shows the partial draft live.

## Step 10 — Wire up Nidhi's link

Nidhi's existing intake token (`ZrRNZjBHdrICRajl7RtD1LuROFOXh1Pg`,
valid until 28 May) is already in `~/fm-plans/clients/nidhi-jain/client.yaml`
which Mutagen has now synced to Fly. So her permanent link is:

```
https://intake.theochretree.com/intake/ZrRNZjBHdrICRajl7RtD1LuROFOXh1Pg
```

WhatsApp share — open this URL in your browser to launch WhatsApp with
the message pre-composed:

```
https://wa.me/919810299762?text=Hi+Nidhi%2C%0A%0APlease+fill+in+this+intake+form+before+our+session+%E2%80%94+it+takes+about+25+minutes+and+helps+me+prepare+the+best+plan+for+you%3A%0A%0Ahttps%3A%2F%2Fintake.theochretree.com%2Fintake%2FZrRNZjBHdrICRajl7RtD1LuROFOXh1Pg%0A%0AYour+progress+saves+automatically%2C+so+feel+free+to+pause+and+come+back.+Looking+forward+to+it.%0A%0AShivani
```

## Step 11 — Stop the temporary cloudflared tunnel

```bash
pkill -f "cloudflared tunnel --url http://localhost:3002"
```

The old `dated-myers-dayton-hill.trycloudflare.com` URL dies — no longer
needed.

## Operational notes

### Deploying a code change

```bash
cd /Users/shivani/code/healwithshivanih-ads
git pull          # if changes came from another Mac
flyctl deploy -a theochretree-coach
```

Rolling restart — the intake form blips for ~5s during the swap. If
this becomes a problem we add a second machine (`flyctl scale count 2`).

### Updating a secret

```bash
flyctl secrets set ANTHROPIC_API_KEY="sk-ant-newkey" -a theochretree-coach
# Triggers a redeploy automatically.
```

### Tail logs

```bash
flyctl logs -a theochretree-coach          # live
flyctl logs -a theochretree-coach -i 1h    # last hour
```

### SSH into the machine

```bash
flyctl ssh console -a theochretree-coach
# Now you're root inside the container.
# Useful for: inspecting /data, debugging Python venv, etc.
```

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Build fails on `npm ci` | lockfile drift | `npm install` locally, commit, redeploy |
| `/api/health` 502 | Next process not bound to PORT | check `flyctl logs`; PORT is 3002 in both Dockerfile + fly.toml |
| Cert stuck in "Awaiting configuration" | DNS not propagated | `dig CNAME intake.theochretree.com` — verify it points at fly.dev |
| Intake form 200 but submit fails | Anthropic key wrong / Python venv broken | `flyctl ssh console` then `/app/fm-database/.venv/bin/python -c "import anthropic; print(anthropic.__version__)"` |
| Volume full | growing session count | `flyctl volumes extend <vol-id> --size 10` (live resize) |
| Token resolves on Mac but 404 on Fly | Mutagen not syncing | See MUTAGEN_SYNC.md troubleshooting |
| Coach can hit `/clients-v2` on `intake.theochretree.com` | `FLY_INTAKE_ONLY` not set | `flyctl secrets list -a theochretree-coach` — should NOT be in secrets (it's in fly.toml `[env]`); if missing redeploy |

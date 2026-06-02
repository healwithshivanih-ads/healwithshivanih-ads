# DEPLOY_NAS.md — Coach dashboard on the Synology NAS, reached privately via Tailscale

> **Chosen architecture (2026-06-02): HYBRID with auto-failover.** Mac mini is
> primary; the NAS is an always-on standby; a Caddy proxy on the NAS gives you a
> single URL that auto-routes to whichever is up. Build the NAS node per Phases
> 1–7 below (with the **one port change** noted in Appendix H), then do
> **Appendix H** for the mini + failover layer. Read Appendix H first for the
> big picture.

> **✅ AS-BUILT & LIVE (2026-06-02).** The hybrid is deployed and failover-tested.
> Actual values + deviations from the plan:
> - **Login URL:** `http://coach.theochretree.com:3002` (Tailscale devices only) — a Wix
>   DNS A record `coach.theochretree.com → 100.68.140.54` (the NAS Tailscale IP, CGNAT,
>   only routable on the tailnet). Also works directly: `http://100.68.140.54:3002` or,
>   at home, `http://192.168.1.9:3002`. User `shivanihari`. Plain HTTP, but the
>   transport is encrypted by Tailscale/WireGuard regardless. Added via Wix Domain DNS
>   API (additions-only; intake/email records untouched).
> - **Bare hostname (no `:3002`):** Synology **Application Portal → Reverse Proxy** rule
>   — Source `HTTP / coach.theochretree.com / 80` → Destination `HTTP / localhost / 3002`
>   (points at Caddy, so failover is preserved). Lets `http://coach.theochretree.com`
>   work without the port. NAS port 80 otherwise redirects to DSM (`:5000`).
> - **Mini** = `shivanis-mac-mini` / Tailscale `100.107.120.127`, runs `fm-coach` under
>   PM2 on `:3002` (now with `COACH_AUTH_*` in `.env.local`). **NAS** = Tailscale
>   `100.68.140.54`, LAN `192.168.1.9`, DSM 6.2.4, user `shivanihari`.
> - **NAS containers:** `fm-coach` (`fm-coach:nas` image, `127.0.0.1:3003`,
>   `--env-file /volume1/fm-coach/coach.env`, mounts `/volume1/fm-coach/{fm-plans,fm-resources}`)
>   + `coach-proxy` (`caddy:2-alpine`, `--network host`, `/volume1/fm-coach/Caddyfile`).
> - **Data sync deviation:** did NOT do NAS↔Fly. The **mini is the hub** — a second
>   Mutagen session `fm-plans-nas` on the mini syncs mini-iCloud-fm-plans ↔
>   `shivanihari@100.68.140.54:/volume1/fm-coach/fm-plans` (two-way-safe, over Tailscale).
>   Nothing extra installed/scheduled on the NAS; the mini's existing Mutagen daemon
>   does it. NAS reboots self-heal (containers `--restart unless-stopped`).
> - **Image transfer:** Fly remote build → `skopeo copy --format v2s2
>   --dest-compress-format gzip` to a docker-archive → streamed to the NAS via
>   `curl … | sudo docker load` (DSM 6.2's old engine rejects modern OCI/zstd layers;
>   NAS `/tmp` too small for the 1.6 GB tar — streaming dodges both).
> - **Mutagen agent** pre-placed at `~/.mutagen/agents/0.18.1/mutagen-agent` on the NAS
>   via SSH+curl (Synology sshd lacks the scp/sftp subsystem Mutagen pushes its agent with).
> - **Gotcha:** `docker restart` does NOT re-read `--env-file`. To change a secret
>   (e.g. password), edit `coach.env` then `docker rm -f fm-coach && docker run …` — a
>   restart silently keeps the old env.

Goal: run `fm-coach` (the coach UI) on the **Synology DS218+** so the dashboard is
always-on and reachable from your phone/laptop **anywhere**, over a private
Tailscale tunnel — invisible to the public internet. Clients keep hitting
`intake.theochretree.com` → Fly (unchanged). You hit
`http://<nas-name>:3002` → NAS → same dashboard you use on the Mac today.

This is the "full build" path (chosen 2026-06-02). The lighter alternative —
Tailscale on the Mac mini — was declined in favour of NAS independence.

```
iPhone / MacBook  (Tailscale app)
        │   WireGuard, private — public internet cannot see this
        ▼
DS218+  ── Docker ── fm-coach :3002   (coach UI, behind HTTP Basic Auth)
        │
        └── Mutagen ↔ Fly /data/fm-plans   (client PHI sync)

intake.theochretree.com → Fly machine (intake-only)   ← unchanged, untouched
```

---

## Target hardware & the three constraints that shape every step

| Fact | Value | Consequence |
|---|---|---|
| Model | DS218+ (Intel Celeron J3355, **x86_64 / apollolake**) | Image MUST be `linux/amd64`. |
| RAM | **2 GB** (ships), 1 SODIMM slot → up to 6 GB | Browsing works at 2 GB; **AI generation (letters/assess) is the OOM risk** — see Phase 0. |
| DSM | **6.2.4-25556 u8** (NOT DSM 7) | Package is **"Docker"** not "Container Manager"; Tailscale is **sideloaded `.spk`**, not in Package Center. |
| Build host | Mac is **arm64**, no Docker installed | Don't build locally. Use Fly's **amd64 remote builder** (Phase 3). |

Your `fm-plans` is **~253 MB** and your local Mutagen is **0.18.1** (exact match
for the agent baked into the Dockerfile — do not upgrade it without rebuilding).

---

## How the one image runs in two modes (why no code changes are needed)

`src/middleware.ts` selects mode by env var:

- `FLY_INTAKE_ONLY=1` → **intake-only** (this is how Fly runs; coach routes 404).
- `COACH_AUTH_PASSWORD=…` set, `FLY_INTAKE_ONLY` **unset** → **coach UI behind Basic Auth** ← the NAS mode.
- neither set → local dev, no auth.

So the NAS runs the **same image** as Fly, just with different env:
`FLY_INTAKE_ONLY` unset + `COACH_AUTH_USERNAME`/`COACH_AUTH_PASSWORD` set.
Username defaults to `shivani` if you only set the password.

---

## Phase 0 — RAM decision (do this first)

The image is built **off-device** (Phase 3), so the build never runs on the NAS —
that removes the biggest 2 GB risk. What remains:

- **Browsing the dashboard, editing plans, reading clients** → fine at 2 GB.
- **AI features** (letter generation, assess synthesis, plan-chat, intake insights)
  shell out to a Python process that loads the Anthropic SDK and builds a catalogue
  subgraph (tens of MB to a few hundred MB transiently) **on top of** the Node
  server. Under 2 GB, concurrent AI work can trip the OOM killer.

**Recommendation:** add a **4 GB DDR3L SO-DIMM** (1.35 V, PC3L-12800, ~₹2,000) →
6 GB total. Then everything — including AI generation — has headroom. You can
*start* at 2 GB to prove the pipeline (Phases 1–4) and add RAM before you rely on
AI generation in production.

- [ ] Decide: start at 2 GB (prove it) or upgrade to 6 GB now.

---

## Phase 1 — Install Docker on the NAS (DSM 6.2)

1. DSM web UI → **Package Center**.
2. Search **Docker** → **Install**. (On DSM 6.2 the package is literally named
   "Docker"; on DSM 7 it's "Container Manager" — you have 6.2, so "Docker".)
3. Open Docker once to confirm it launches.

- [ ] Docker package installed and opens.

> If "Docker" doesn't appear in Package Center for the DS218+, it's because the
> model/DSM combo filters it out — it *is* supported on DS218+/DSM 6.2. Make sure
> Package Center → Settings → Trust Level allows **Synology Inc.** packages.

---

## Phase 2 — Install & connect Tailscale (sideload, DSM 6.2)

Tailscale isn't in Package Center for DSM 6.2, so install the `.spk` by hand.

1. On the Mac, find the right package at <https://pkgs.tailscale.com/stable/#synology>.
   DS218+ = **apollolake / x86_64**, and you're on **DSM 6**, so download the
   `…apollolake…DSM6…spk` (file name looks like
   `tailscale-apollolake-1.xx.x_DSM6.spk`).
2. DSM → **Package Center** → **Manual Install** (top-right) → upload the `.spk`
   → proceed past the "publisher not Synology" warning (expected for sideloads).
3. Open the **Tailscale** package → **Log in** → it prints a URL → open it on the
   Mac, sign in with the **same Tailscale account** you use on your phone/MacBook.
4. On your **iPhone** and **MacBook**: install the Tailscale app (App Store / menubar)
   and sign in to the same account if not already.
5. In the Tailscale admin (<https://login.tailscale.com/admin/machines>) confirm the
   NAS shows up. Note its name (e.g. `ds218`) and `100.x.x.x` address.
6. **Prove connectivity now, before any app:** from your phone (on cellular, Wi-Fi
   off) open `http://<nas-name>:5000` (DSM). If DSM loads, the private tunnel works.

- [ ] NAS appears in Tailscale admin; reachable from phone over cellular.

> MagicDNS: if enabled (Tailscale admin → DNS), `http://ds218:3002` works by name.
> Otherwise use the `100.x.x.x` address.

---

## Phase 3 — Get an amd64 image onto the NAS

> **Current image (built 2026-06-02, ready to pull):**
> `registry.fly.io/theochretree-coach:deployment-01KT3A78MD40TKD2AH976YBAR0` (401 MB, amd64).
> Use this exact ref in the `docker pull` / `docker tag` commands below. Rebuild
> (Phase 7) only when you want the NAS to reflect newer app/catalogue changes.

**Primary route — Fly remote builder (nothing to install on the Mac):**

Fly's builders are amd64 and your repo's `Dockerfile` is already proven there.
Build & push to Fly's registry **without deploying** (the live intake machine is
untouched):

```bash
cd /Users/shivani/code/healwithshivanih-ads
fly deploy --build-only --push --app theochretree-coach
# → prints an image ref like: registry.fly.io/theochretree-coach:deployment-XXXX
```
Copy that full `registry.fly.io/…:deployment-XXXX` ref. Also grab a registry token:
```bash
fly auth token        # copy the long token
```

On the **NAS** (SSH in: DSM → Control Panel → Terminal & SNMP → enable SSH, then
`ssh shivani@<nas-name>`):
```bash
# log in to Fly's registry with the token (user is literally 'x')
docker login registry.fly.io -u x -p '<paste-fly-auth-token>'
docker pull registry.fly.io/theochretree-coach:deployment-XXXX
docker tag  registry.fly.io/theochretree-coach:deployment-XXXX fm-coach:nas
```

**Fallback route — build locally with Colima (if you'd rather not use Fly's registry):**
```bash
brew install colima docker docker-buildx
colima start --arch x86_64 --vm-type vz --vz-rosetta --memory 4 --cpu 2
docker buildx build --platform linux/amd64 -t fm-coach:nas --load .
docker save fm-coach:nas | gzip > /tmp/fm-coach-nas.tar.gz
scp /tmp/fm-coach-nas.tar.gz shivani@<nas-name>:/tmp/
# on the NAS:
gunzip -c /tmp/fm-coach-nas.tar.gz | docker load
```

- [ ] `docker images` on the NAS lists `fm-coach:nas`.

> The image **bakes the catalogue** (`fm-database/data`). When the catalogue
> changes meaningfully and you want the NAS to reflect it, rebuild + re-pull
> (Phase 7). Client PHI is **never** in the image — it's a runtime mount (Phase 5).

---

## Phase 4 — First run (smoke test, before wiring real data)

Make host dirs and an env file on the NAS:
```bash
sudo mkdir -p /volume1/fm-coach/fm-plans /volume1/fm-coach/fm-resources
sudo chown -R "$(id -u)":"$(id -g)" /volume1/fm-coach
nano /volume1/fm-coach/coach.env
```
`coach.env` (no quotes, KEY=VALUE per line — **gitignored equivalent; never commit**):
```
COACH_AUTH_USERNAME=shivani
COACH_AUTH_PASSWORD=<pick-a-strong-password>
ANTHROPIC_API_KEY=<your key>
GMAIL_USER=shivanihari@gmail.com
GMAIL_APP_PASSWORD=<app password>
WHATSAPP_SERVER_URL=https://whatsapp-server-shivani.fly.dev
WHATSAPP_SERVER_API_KEY=<shared admin token>
WHATSAPP_WEBHOOK_SECRET=<shared webhook secret>
NEXT_PUBLIC_BASE_URL=http://<nas-name>:3002
```
Run it:
```bash
docker run -d --name fm-coach --restart unless-stopped \
  -p 3002:3002 \
  --env-file /volume1/fm-coach/coach.env \
  -v /volume1/fm-coach/fm-plans:/data/fm-plans \
  -v /volume1/fm-coach/fm-resources:/data/fm-resources \
  fm-coach:nas
docker logs -f fm-coach          # watch for "Ready" / listening on 3002
```
Test from your phone (cellular): `http://<nas-name>:3002` → Basic Auth prompt →
log in → dashboard loads (empty client list — that's expected, no data yet).

- [ ] Dashboard loads over Tailscale, Basic Auth enforced, no client data yet.

> `FLY_INTAKE_ONLY` is deliberately **absent** from `coach.env`. If it ever creeps
> in, the NAS would 404 the coach UI. Keep it out.

---

## Phase 5 — Sync client data onto the NAS (the careful part)

The container reads/writes `/data/fm-plans` (= host `/volume1/fm-coach/fm-plans`).
That host dir must stay in sync with Fly (so client intake submissions reconcile)
and, ideally, the Mac. Approach: run the **Mutagen binary natively on the NAS**
(it's a single static amd64 Go binary) and create a **NAS ↔ Fly** session — the
same star topology the Mac already uses, with Fly as the hub.

1. Put Mutagen **0.18.1** on the NAS (must match the agent baked in the image and
   your Mac's client):
   ```bash
   cd /volume1/fm-coach && mkdir -p bin && cd bin
   curl -fsSL https://github.com/mutagen-io/mutagen/releases/download/v0.18.1/mutagen_linux_amd64_v0.18.1.tar.gz -o m.tgz
   tar -xzf m.tgz mutagen && rm m.tgz
   ./mutagen version    # → 0.18.1
   ```
2. Reach Fly's private network from the NAS. Replicate the Mac's setup: install
   `flyctl` on the NAS (linux amd64 binary), `fly wireguard create` a peer for the
   NAS, and confirm `ssh root@theochretree-coach.internal` works. (See
   `MUTAGEN_SYNC.md` — the Fly side already has the Mutagen agent baked in, so it's
   ready as a sync target. The 72-hour SSH-cert refresh cron applies here too.)
3. Create the session (two-way-safe, same mode as the Mac):
   ```bash
   ./mutagen daemon start
   ./mutagen sync create --name fm-plans-nas \
     /volume1/fm-coach/fm-plans \
     root@theochretree-coach.internal:/data/fm-plans \
     --sync-mode=two-way-safe
   ./mutagen sync monitor fm-plans-nas   # wait for "Watching for changes"
   ```
4. After it converges, `ls /volume1/fm-coach/fm-plans/clients/` shows your clients.
   Refresh the NAS dashboard → real client list appears.

**Single-writer rule (important):** you now have Mac and NAS both syncing to Fly.
Mutagen `two-way-safe` *flags* conflicts rather than losing data, but to avoid them,
**pick the NAS as your daily driver** and treat the Mac as backup/occasional. Don't
edit the same plan on both within the same minute. The Mac's iCloud copy remains
your safety net (authoritative + backed up) if anything ever looks wrong.

- [ ] NAS dashboard shows real clients; Mutagen status = "Watching for changes".

---

## Phase 6 — Make it durable

1. **Auto-start on boot:** the `--restart unless-stopped` flag restarts the
   container after reboots. For Mutagen + its daemon, add a **DSM Task Scheduler**
   boot task (Control Panel → Task Scheduler → Create → Triggered → Boot) running:
   ```
   /volume1/fm-coach/bin/mutagen daemon start
   ```
2. **Tailscale** runs as a DSM service automatically once logged in.
3. **Fly SSH cert refresh:** the NAS's `fly ssh` cert expires every 72 h (same as
   the Mac). Add a Task Scheduler cron (e.g. daily) that runs `fly ssh issue` /
   the refresh step from `MUTAGEN_SYNC.md`, or Mutagen silently stops after 3 days.
4. **Confirm the lockdown:** from a device **not** on your Tailscale, the NAS is
   unreachable. From a Tailscale device, `:3002` prompts for Basic Auth. Both true.

- [ ] Survives a NAS reboot: dashboard back up, Mutagen syncing, auth enforced.

---

## Phase 7 — Maintenance / updating the app

When you change the app or the catalogue and want the NAS to reflect it:
```bash
# Mac:
fly deploy --build-only --push --app theochretree-coach     # new deployment-YYYY
# NAS:
docker pull registry.fly.io/theochretree-coach:deployment-YYYY
docker tag  registry.fly.io/theochretree-coach:deployment-YYYY fm-coach:nas
docker stop fm-coach && docker rm fm-coach
# re-run the Phase 4 `docker run …` command
```
(Or script the run command into `/volume1/fm-coach/run.sh` so updates are 3 lines.)

**Version pins to keep aligned:** Mutagen must be **0.18.1** on all three of
{Mac client, NAS client, image agent}. Bumping one means bumping all + rebuilding
the image (`MUTAGEN_VERSION` ARG in the `Dockerfile`).

---

## Gotchas (learned-the-hard-way list, mirroring MUTAGEN_SYNC.md)

- **2 GB OOM under AI load** → upgrade RAM before relying on letter/assess generation.
- **`FLY_INTAKE_ONLY` must stay unset on the NAS** → otherwise coach UI 404s.
- **Image is amd64 only** → never `docker load` an arm64 build onto the NAS.
- **Catalogue is baked into the image** → rebuild to update it; PHI is a mount, not baked.
- **Mutagen version skew** → all three nodes pinned to 0.18.1.
- **Fly SSH cert is 72 h** → needs the refresh cron on the NAS too, or sync dies after 3 days.
- **Two writers (Mac + NAS)** → in the hybrid (Appendix H) the proxy makes this a
  non-issue: traffic only ever lands on one box at a time, so you're always a
  single writer. Without the proxy, make one box the daily driver.

---

# Appendix H — Hybrid: Mac mini primary, NAS standby, one URL with auto-failover

This is the chosen setup. The mini does the heavy lifting (it far out-muscles a
2 GB DS218+, so AI letter/assess generation runs full-speed there); the NAS is a
warm standby that takes over automatically whenever the mini is off/asleep. You
open **one URL** and never think about which is up.

```
iPhone / MacBook (Tailscale)
        │   one URL → NAS:3002 (the proxy)
        ▼
DS218+  ── Caddy proxy :3002 ──┬─(healthy?)→ Mac mini :3002   PRIMARY (fast)
 (always on)                   └─(else)────→ NAS fm-coach :3003 STANDBY
        │                                         │
        └── Mutagen ↔ Fly ───────── Fly /data/fm-plans ──────── Mutagen ↔ mini
```

**Why this is safe on the data side:** both boxes sync to Fly (hub). Caddy sends
all traffic to exactly one box at a time, so there is never a concurrent writer —
no edit conflicts. Whatever the NAS writes while the mini sleeps flows
NAS → Fly → mini when the mini wakes.

## H.1 — Credentials must match on both boxes

Use the **same** `COACH_AUTH_USERNAME` + `COACH_AUTH_PASSWORD` on the mini and the
NAS, so login is seamless whichever serves you. (`/api/health` is public, so
Caddy's health checks don't need auth.)

## H.2 — Mac mini: add Tailscale + auth

The mini currently runs `fm-coach` via PM2 in **no-auth local-dev mode**. On a
tailnet it MUST have auth.

1. Install Tailscale on the mini (menubar app), sign in to the same tailnet.
   Note its Tailscale name + `100.x.x.x` (Tailscale admin → Machines).
2. Add to the mini's `fm-database-web/.env.local`:
   ```
   COACH_AUTH_USERNAME=shivani
   COACH_AUTH_PASSWORD=<same strong password as the NAS>
   ```
   Do **not** set `FLY_INTAKE_ONLY` (it must stay unset — coach mode).
3. Reload PM2 so it picks up the new env (ecosystem.config.js loads `.env.local`;
   a plain restart may not re-read it):
   ```bash
   ./node_modules/.bin/pm2 delete fm-coach && ./node_modules/.bin/pm2 start ecosystem.config.js
   ```
4. Verify from your phone over cellular: `http://<mini-name>:3002` → Basic Auth
   → dashboard. (This alone already gives you anywhere-access to the mini.)

- [ ] Mini reachable over Tailscale, behind Basic Auth, same creds as the NAS.

## H.3 — NAS port change (overrides Phase 4's `docker run`)

The Caddy proxy takes host `:3002`, so the NAS `fm-coach` container must move to an
internal `:3003` that **only Caddy** can reach. Re-run the Phase 4 container with
the publish line changed to bind localhost-only on 3003:

```bash
docker run -d --name fm-coach --restart unless-stopped \
  -p 127.0.0.1:3003:3002 \
  --env-file /volume1/fm-coach/coach.env \
  -v /volume1/fm-coach/fm-plans:/data/fm-plans \
  -v /volume1/fm-coach/fm-resources:/data/fm-resources \
  fm-coach:nas
```
(`127.0.0.1:3003` means it's not independently exposed — reachable only via the
host-networked Caddy below. Everything else from Phase 4 is identical.)

## H.4 — Caddy failover proxy on the NAS

1. Write the Caddyfile at `/volume1/fm-coach/Caddyfile` — **use the mini's
   `100.x.x.x` Tailscale IP** (avoids any in-container DNS surprises):
   ```
   :3002 {
       reverse_proxy {
           to <mini-tailscale-ip>:3002 127.0.0.1:3003
           lb_policy first
           health_uri      /api/health
           health_interval 10s
           health_timeout  3s
           lb_try_duration 5s
           fail_duration   10s
       }
   }
   ```
   - `lb_policy first` → always prefer the first **available** upstream (the mini);
     fall to the NAS container only when the mini fails its health check.
   - `lb_try_duration` also retries in-flight requests to the backup if the mini
     dies mid-request (covers the ~10s detection gap).
2. Run Caddy with **host networking** so it can reach both the mini over Tailscale
   and `127.0.0.1:3003` locally:
   ```bash
   docker run -d --name coach-proxy --restart unless-stopped \
     --network host \
     -v /volume1/fm-coach/Caddyfile:/etc/caddy/Caddyfile:ro \
     caddy:2-alpine
   docker logs -f coach-proxy     # should report serving :3002, upstreams healthy
   ```

- [ ] `docker ps` shows both `fm-coach` and `coach-proxy` running.

## H.5 — The single URL + failover test

Your one bookmark is the **NAS** proxy: `http://<nas-name>:3002`
(or `http://<nas-tailscale-ip>:3002`).

Test the failover for real:
1. Mini ON → open the URL → you're served by the **mini** (fast). Confirm by doing
   anything AI-heavy (generate a letter) — it should be quick.
2. Stop the mini's app (`pm2 stop fm-coach`) or sleep the mini → wait ~15 s →
   reload the URL → still works, now served by the **NAS** (browsing/light edits
   fine; AI generation slower/at-risk on 2 GB — hence the RAM note).
3. Bring the mini back → within ~15 s new requests route back to the mini.

- [ ] One URL serves through a simulated mini outage and recovers automatically.

## H.6 — What you end up maintaining

- **Mini:** Tailscale + PM2 (already there) + the two auth env vars. The daily
  driver; gets app/catalogue updates the normal way you update the mini today.
- **NAS:** Docker (`fm-coach` + `coach-proxy`), Tailscale, the NAS↔Fly Mutagen.
  Update its image per Phase 7 occasionally so the standby doesn't drift far from
  the mini. The proxy/Caddyfile rarely changes (only if the mini's Tailscale IP
  changes — pin it in Tailscale admin to avoid that).
- **Both:** keep `COACH_AUTH_*` identical; keep Mutagen at 0.18.1 everywhere.

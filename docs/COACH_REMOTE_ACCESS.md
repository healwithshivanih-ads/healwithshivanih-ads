# Reaching the coach UI away from the Mac

The full dashboard — `/clients-v2`, `/plans`, **📨 Send intake form**, everything —
runs only on the Mac at `localhost:3002`. It is published to the outside world
by a **Cloudflare tunnel** at `https://fmcoach.shivanihari.com`.

This is the third surface, and the three are easy to confuse:

| Host | Runs on | What you get |
|---|---|---|
| `intake.theochretree.com` | Fly | client-facing only; every coach route 404s |
| `intake.theochretree.com/m` | Fly | phone-shaped coach view — read-mostly, **cannot issue intake links** |
| `fmcoach.shivanihari.com` | tunnel → the Mac | the whole coach UI |

`/m` reads a projected index on Fly. Issuing an intake token writes the
authoritative `client.yaml`, which only the Macs hold — which is why the mobile
client card has WhatsApp / call / email / chat but no intake action, and why the
tunnel is the only remote route to re-issuing a link.

---

## ⚠ The auth trap — read this before starting the tunnel

`src/proxy.ts` has four modes. On the Mac it is in **mode 3, LOCAL DEV — a
no-op**: `FLY_INTAKE_ONLY` is Fly-only, and `COACH_AUTH_PASSWORD` was never set
locally because localhost never needed it.

**So `localhost:3002` has no authentication at all.** Fine on the LAN. Put a
public tunnel in front of it without setting a password and the entire
dashboard — every client's records — is served to anyone with the URL.

Set the password FIRST. Every time. The order below is the safe one.

---

## Bringing it up

**1. Set the credentials** in `fm-database-web/.env.local`:

```
COACH_AUTH_USERNAME=shivani
COACH_AUTH_PASSWORD=<long random>
```

**2. Restart pm2 so it re-reads the file.** `pm2 restart` is NOT enough — it
does not re-read `ecosystem.config.js`:

```bash
cd ~/code/healwithshivanih-ads/fm-database-web
./node_modules/.bin/pm2 delete fm-coach
./node_modules/.bin/pm2 start ecosystem.config.js
```

**3. Verify the wall — this is the gate, not a formality:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3002/clients-v2
```

Must print **401**. If it prints **200** the password did not load: stop, and do
not start the tunnel.

Clients are unaffected either way — `/intake/`, `/s/`, `/letter/`, `/app/` and
the other public prefixes bypass the Basic wall by design.

**4. Start the tunnel:**

```bash
cloudflared tunnel list        # find the name
cloudflared tunnel run <name>
```

**5. Make it survive a reboot:**

```bash
sudo cloudflared service install
```

---

## Error 1033

Cloudflare's "tunnel configured, nothing connected" — the DNS route exists but
no `cloudflared` is running on the Mac. It does not mean the tunnel is
misconfigured or the hostname is wrong.

Historically the usual cause was `scripts/restart-mac-daemons.sh`, which used to
kill `cloudflared tunnel` as a "stray dev server". It no longer does — but a
reboot without step 5, or a manual `pkill`, produces the same thing.

Fix: re-run step 4. Nothing needs reconfiguring.

**Known incident (2026-08-15):** the tunnel was down, the coach was away from
her Mac, and a client's intake link needed re-issuing. There was no remote path
at all — `/m` cannot issue links, Fly cannot write the authoritative record, and
`/api/m-bridge` runs on the Mac and so was equally unreachable. It took someone
physically at the Mac. Step 5 is what prevents a repeat.

---

## The watchdog (`/api/cron/infra-health`, every 5 min)

Since 2026-08-15 a cron job watches the remote route and **repairs it itself**.
Alerting alone was the wrong shape: an email saying "the tunnel is down" is no
use on a phone, away from the Mac — which is precisely when you need the tunnel.

Each cycle it probes, and:

| Finding | What it does |
|---|---|
| tunnel not answering 200 | `launchctl kickstart` the service, re-probe, and only email after ~15 min of failed repairs |
| a coach route answering **200 publicly** | emails immediately — that is the whole dashboard served with no auth |
| no auth on localhost | warning only; that is the correct state with no tunnel in front |
| Fly not answering 200 | emails — clients cannot open their forms |

It never takes the tunnel **down** on its own, even on an exposure. Closing that
hole means removing your own remote access, which is your call, not a cron's —
so it sends the command instead.

### It needs one sudoers line to actually repair

The service lives in `/Library/LaunchDaemons`, so restarting it needs root, and
the cron runs as you. Without this the watchdog still detects and emails, but
cannot fix anything — it reports the failure rather than pretending:

```bash
sudo visudo -f /etc/sudoers.d/fmcoach-tunnel
```

One line (no wildcards — this grants exactly one command, nothing else):

```
shivani ALL=(root) NOPASSWD: /bin/launchctl kickstart -k system/com.cloudflare.cloudflared
```

Verify it took:

```bash
sudo -n launchctl kickstart -k system/com.cloudflare.cloudflared && echo "watchdog can repair"
```

### Env it reads

| Var | Purpose |
|---|---|
| `COACH_PUBLIC_URL` | the tunnel hostname to watch. **Unset = watchdog disabled** |
| `COACH_TUNNEL_SERVICE` | launchd label, default `com.cloudflare.cloudflared` |
| `COACH_DIGEST_EMAIL` | where alerts go, default `GMAIL_USER` |

State (the consecutive-failure counter) lives in `~/fm-plans/_infra_health.json`.
Deleting it is harmless — the probes are stateless; you only lose escalation
timing.

---

## Issuing an intake link from the phone (`/m` → bridge)

`/m` used to be read-only for a reason: issuing a token WRITES the authoritative
`client.yaml`, and Fly holds only a projection. So on 2026-08-15, with the
tunnel down, the phone could show you the client who needed a link and do
nothing about it.

The client card now has **"Send <name> a fresh intake link"**. It posts to
`/api/m/intake-link`, which resolves three ways, in order:

1. the full record is on this host (you're on the Mac) → issue directly;
2. it isn't → bridge to `COACH_MAC_URL/api/m-bridge/intake-link`;
3. no bridge configured → say so plainly, rather than failing vaguely.

It issues a fresh 14-day token **and** WhatsApps it from the business number. A
failed send is not a failed request — the link is already live, so it comes back
for you to paste rather than tempting you to issue a second one. Existing
answers are untouched and come back pre-filled.

### ⚠ `COACH_MAC_URL` must NOT be the tunnel

This is the whole point. If `COACH_MAC_URL` is set to
`https://fmcoach.shivanihari.com`, the bridge dies with the tunnel — and the
outage this was built for is exactly a dead tunnel. Point it at a path that
fails independently:

- a **Tailscale** address for the mini (`http://100.x.y.z:3002`), which is how
  the MacBook already reaches it, or
- any other private link that does not terminate at Cloudflare.

Both hosts need the same `COACH_BRIDGE_SECRET`; with it unset the bridge route
404s as though it did not exist, on both sides.

### What it still cannot do

If the Mac is **off or off the internet**, nothing here helps — the record only
exists there. The watchdog above will tell you, which is the honest limit of a
single-machine authoritative store.

---

## What still needs a human at the Mac

Even with the tunnel up and healthy:

- anything writing the authoritative store while the Mac is **off** — the tunnel
  publishes the Mac, it does not replace it;
- `flyctl deploy` (deploys are manual; CI only verifies);
- `git pull` on the Mac to pick up merged Python changes.

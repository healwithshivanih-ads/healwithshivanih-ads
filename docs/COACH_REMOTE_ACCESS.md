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

## What still needs a human at the Mac

Even with the tunnel up and healthy:

- anything writing the authoritative store while the Mac is **off** — the tunnel
  publishes the Mac, it does not replace it;
- `flyctl deploy` (deploys are manual; CI only verifies);
- `git pull` on the Mac to pick up merged Python changes.

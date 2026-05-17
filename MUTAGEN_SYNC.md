# Mutagen sync — `~/fm-plans/` ↔ Fly volume

Mutagen keeps your client PHI bidirectionally in sync between your Macs
(authoritative source of truth) and the Fly machine that serves the
public intake form.

## What's installed on the Mac mini (2026-05-17)

After a silent sync outage on 2026-05-17 (Sudarshan got a `localhost:3002`
intake link because Mutagen's beta endpoint had been disconnected for
days with no alert), the following hardening is in place:

| Path | Purpose |
| --- | --- |
| `~/.ssh/fly_id` + `fly_id-cert.pub` | Fly SSH keyfile + 72h cert (refreshed daily) |
| `~/.ssh/config` `Host *.internal` block | Routes all Fly SSH through the keyfile — no ssh-agent dependency, survives reboots |
| `~/bin/fly-ssh-refresh.sh` | Re-issues the cert daily (wrapped in `perl alarm 60` after flyctl was observed hanging at 90% CPU indefinitely on transient API issues) |
| `~/bin/mutagen-health.sh` | Daily health check — flags `Connected: No`, `Last error:`, `Conflicts: [1-9]+`; posts macOS notification + appends to `~/Library/Logs/mutagen-health.log` |
| `crontab -l` | `0 6 * * *` cert refresh, `0 8 * * *` health check |
| `/etc/resolver/internal` | Pins `.internal` DNS to WG (`nameserver fdaa:70:83a::3`) so the Mac resolver can reach Fly hostnames |

**One quirk worth knowing**: `flyctl ssh issue --overwrite` refuses to replace
an existing keyfile unless its own heuristic decides "we created this."
After any manual mtime/perms change, that check fails with `File exists,
but isn't a fly.io ed25519 private key`. The refresh script therefore
`rm -f`s both files before re-issuing.

## Empirical gotchas (resolved 2026-05-14 during first setup)

Three things tripped us up during the initial bring-up. All three are
documented + workarounds noted in the steps below; capturing here too so
they're in one place.

1. **Don't use the `~/fm-plans/` symlink path** — Mutagen errors with
   `too many levels of symbolic links` because the home-dir symlink
   resolves into iCloud's CloudDocs which has its own internal symlinks.
   Use the **fully-resolved iCloud path** instead. On Shivani's setup:
   `/Users/shivani/Library/Mobile Documents/com~apple~CloudDocs/fm-plans/`.
   Look yours up via `readlink -f ~/fm-plans` if different.

2. **Mutagen agent path inside the Fly container** — Mutagen looks for
   `.mutagen/agents/<version>/mutagen-agent` **relative to the SSH
   shell's PWD**, not `$HOME`. Fly's SSH-exec lands in the Docker
   `WORKDIR` which is `/app/fm-database-web`, NOT `/root`. The agent
   has to be at `/app/fm-database-web/.mutagen/agents/<version>/mutagen-agent`.
   **The Dockerfile now bakes the agent at both `WORKDIR/.mutagen/...`
   AND `/root/.mutagen/...`** (via the `mutagen-agent-fetch` build
   stage) so this survives every redeploy automatically. Bump the
   `MUTAGEN_VERSION` ARG in `Dockerfile` when you `brew upgrade mutagen`
   — versions must match exactly client ↔ agent.

3. **Fly slim image has no `scp`/`tar`/`openssh-client`** — Mutagen's
   auto-install of the agent fails on first connect because it tries to
   `scp` the binary across. Workaround for one-off bring-up: stream the
   binary via `cat | flyctl ssh console -C 'cat > file'`. **No longer
   needed** with the agent baked into the Dockerfile (gotcha #2 above).

## Why Mutagen and not rsync / git / iCloud

- **rsync**: not bidirectional; running it both ways with cron risks last-write-wins data loss on simultaneous edits.
- **git**: a 25-minute intake session triggers ~50 autosaves → 50 commits per intake. Repo turns into noise; autosave latency jumps from <10 ms to ~500 ms over WAN.
- **iCloud**: doesn't reach Fly (Apple's network), and Fly can't speak iCloud protocol.

Mutagen is purpose-built for "developer doing local-edits, container running in cloud" — handles concurrent writes via conflict detection + content-based merge.

## Architecture

```
Mac mini (~/fm-plans)  ←──→  iCloud  ←──→  MacBook (~/fm-plans)
        ↕
   Mutagen daemon  (runs on the always-on Mac, e.g. Mac mini)
        ↕
   Fly machine (/data/fm-plans)
```

**The Mac mini is the sync hub.** Laptop and iCloud already cross-sync. Mutagen's job is just to bridge Mac ↔ Fly.

## Conflict policy

Mutagen mode: **`two-way-resolved`** — newest mtime wins per file. Per the FM Coach app design, simultaneous writes to the SAME `client.yaml` from both sides are extremely rare (coach edits while client is mid-form on the SAME client). When they do happen, the side with the later `updated_at` field wins, which is the desired outcome.

A safer alternative is **`two-way-safe`** which refuses to overwrite either side on conflict — instead it copies the conflicting file with a `.conflict-<timestamp>` suffix and you resolve manually. More conservative; recommended for production until you've watched a few weeks of activity and confirmed no real conflicts.

## Setup steps

### 1. Install Mutagen on the Mac mini

```bash
brew install mutagen-io/tap/mutagen
mutagen version
# Expect: 0.18.x or later
```

If `brew tap mutagen-io/tap` complains, fall back to:

```bash
brew install mutagen-io/mutagen/mutagen
```

### 2. Start the Mutagen daemon

```bash
mutagen daemon start
```

Should print `Daemon started`. Verify with `mutagen daemon status` — `running`.

To make Mutagen survive reboots:

```bash
mutagen daemon register
```

Adds a LaunchAgent. Reboot to verify.

### 3. Get the Fly SSH cert

Mutagen connects to Fly via SSH. Fly's SSH is gated by short-lived certificates issued by `flyctl`.

```bash
flyctl ssh issue --agent personal --app theochretree-coach
```

`--agent` writes the cert into your local ssh-agent so any process (including Mutagen) can use it.

`personal` is your Fly org name — change if you're using a different org. `flyctl orgs list` to check.

The cert is valid for 1 hour by default. **For ongoing sync** we need an always-valid identity. Two options:

**Option A (simpler)**: re-issue daily via cron on your Mac mini:

```cron
0 6 * * * /opt/homebrew/bin/flyctl ssh issue --agent personal --app theochretree-coach >/dev/null 2>&1
```

**Option B (cleaner)**: use a long-lived Fly WireGuard tunnel + plain SSH. Detailed below at the bottom — skip for now if Option A is enough.

### 4. Verify SSH access

```bash
flyctl ssh console --app theochretree-coach -C "echo hello && ls /data"
```

Should print `hello` and then a directory listing (probably empty if you haven't synced yet, just `fm-plans` and `fm-resources` directories from the Dockerfile).

### 5. Create the sync session

**Use the fully-resolved iCloud path**, not `~/fm-plans/` (see Gotcha #1
at the top). Run from the Mac mini:

```bash
# Confirm the resolved path on your machine
ICLOUD_FM=$(readlink -f ~/fm-plans)
echo "$ICLOUD_FM"
# Expect: /Users/shivani/Library/Mobile Documents/com~apple~CloudDocs/fm-plans

mutagen sync create \
  --name=fm-plans \
  --mode=two-way-safe \
  --ignore-vcs \
  --ignore=".DS_Store" \
  --ignore="*.swp" \
  --ignore="_aisensy_unmatched.yaml" \
  "$ICLOUD_FM/" \
  root@theochretree-coach.internal:/data/fm-plans/
```

Same shape for resources if you have them:

```bash
ICLOUD_RES=$(readlink -f ~/fm-resources)
mutagen sync create \
  --name=fm-resources \
  --mode=two-way-safe \
  "$ICLOUD_RES/" \
  root@theochretree-coach.internal:/data/fm-resources/
```

(Both target paths use `root@theochretree-coach.internal` — that's the
WireGuard-tunnelled SSH endpoint inside Fly's mesh, set up in Option B
at the bottom of this doc.)

### 6. Verify sync is working

```bash
mutagen sync list
```

Expected output:

```
Name: fm-plans
Identifier: sync_xxxx
Alpha: ~/fm-plans
Beta: root@theochretree-coach.internal:/data/fm-plans
...
Status: Watching for changes
```

Make a tiny change on your Mac:

```bash
date > ~/fm-plans/.mutagen-test
sleep 3
flyctl ssh console --app theochretree-coach -C "cat /data/fm-plans/.mutagen-test"
```

Should print the date you just wrote. Then delete from the Fly side and verify it disappears on your Mac:

```bash
flyctl ssh console --app theochretree-coach -C "rm /data/fm-plans/.mutagen-test"
sleep 3
ls ~/fm-plans/.mutagen-test
# Expect: ls: cannot access...: No such file or directory
```

If both work, sync is alive. Initial sync of your existing `~/fm-plans/` (probably 10-50 MB) takes ~30 seconds.

### 7. Watch for conflicts

```bash
mutagen sync list --long
```

Look for `Conflicts` count. If non-zero, Mutagen has flagged simultaneous edits — investigate with:

```bash
mutagen sync flush fm-plans
```

For ongoing monitoring on the Mac mini, set up a daily cron that emails you if conflicts appear:

```cron
0 8 * * * /opt/homebrew/bin/mutagen sync list --long | grep -A2 "Conflicts: [1-9]" && \
  echo "Mutagen has unresolved conflicts" | mail -s "fm-coach sync" shivanihari@gmail.com
```

## Option B — Permanent Fly WireGuard tunnel (recommended for production)

A WireGuard tunnel from your Mac mini into Fly's private network. Once it's up, your Mac can reach `*.internal` hostnames directly via SSH without per-hour cert reissues.

```bash
# 1. Create a WireGuard peer for your Mac mini
flyctl wireguard create personal mac-mini-fm-sync > ~/Downloads/fm-sync.conf

# 2. Open the file — confirm it's a valid WireGuard config
cat ~/Downloads/fm-sync.conf

# 3. Install WireGuard.app from the Mac App Store (free)
# 4. WireGuard.app → "Import Tunnel(s) from File…" → pick the conf
# 5. Activate the tunnel (toggle on)

# 6. Test
ping -c 2 theochretree-coach.internal
# Should resolve and ping ~50–80 ms (Mumbai)

# 7. Test SSH
ssh root@theochretree-coach.internal
# First connection prompts for host key — accept
# You'll get a root shell on Fly. exit.
```

WireGuard auto-reconnects on Mac wake from sleep. Mutagen detects the tunnel coming back and resumes sync.

If you don't want WireGuard always on, you can connect on demand (just keep in mind Mutagen will pause sync while it's off).

## Common issues

| Symptom | Cause | Fix |
| --- | --- | --- |
| `mutagen sync list` shows `Connection error` | Fly machine isn't reachable | Confirm WireGuard tunnel is up (`ping theochretree-coach.internal`). Restart tunnel if needed. |
| Sync stuck in "Initial scan" forever | First sync of large local tree | Wait — initial sync of 50 MB across Mumbai latency takes ~30-60 s. |
| Files keep flipping back to old version | Two-way-resolved mode + clock skew between Mac and Fly | Run `flyctl ssh console -a theochretree-coach -C "date"` and compare to local. NTP both. |
| Mutagen daemon won't start | LaunchAgent corrupted | `mutagen daemon stop && mutagen daemon start` |
| Lots of `.DS_Store` files showing in conflicts | macOS Finder creating them | They're in the `--ignore` list above; if you forgot, run `mutagen sync terminate fm-plans` and recreate with the ignore flags |
| Sync seems slow | Mutagen falls back to scanning when filesystem watch fails | `mutagen sync list --long` and check `Watching: yes` — if no, restart daemon |

## When to terminate sync

If you ever want to stop syncing (e.g. doing a manual data migration):

```bash
mutagen sync terminate fm-plans fm-resources
```

The volume on Fly retains whatever was synced. Coach's Mac is unchanged. Re-create the sync session when you want bidirectional again.

## Ongoing ops — three things that need attention

### 1. SSH cert refresh (72-hour expiry)

`flyctl ssh issue --agent` writes a short-lived cert (typically 72h)
into the user's ssh-agent. Once it expires, Mutagen's SSH connection
fails until you re-issue.

**Fix**: daily cron. Add to your crontab on the Mac mini:

```bash
crontab -e
```

Append:

```cron
# Refresh Fly SSH cert every morning at 06:00. flyctl reads ~/.fly auth
# state; SSH_AUTH_SOCK is whatever the user shell sets. Wrap in shell
# so the env is sane under cron.
0 6 * * * /bin/zsh -lc '/opt/homebrew/bin/flyctl ssh issue --agent personal --app theochretree-coach' >> ~/Library/Logs/flyctl-ssh-issue.log 2>&1
```

Verify:

```bash
crontab -l
tail -f ~/Library/Logs/flyctl-ssh-issue.log
```

Wait until 06:00 the next morning, then `mutagen sync list` should
still show `Watching for changes` without you having touched anything.

### 2. macOS LaunchAgent + SSH_AUTH_SOCK survivability

`mutagen daemon register` installs Mutagen as a macOS LaunchAgent so
the daemon survives reboots. But LaunchAgents inherit a **minimal**
environment — they don't get the user shell's `SSH_AUTH_SOCK` by
default. After a reboot, Mutagen's daemon may not be able to reach
ssh-agent, and the sync stays paused with "Connection error".

**Two fixes, pick one**:

**Fix A — embed SSH_AUTH_SOCK in the LaunchAgent plist** (cleaner):

```bash
# Find the plist
ls ~/Library/LaunchAgents/io.mutagen.mutagen.plist

# Add SSH_AUTH_SOCK key. On modern macOS the launchd-managed socket lives at:
launchctl getenv SSH_AUTH_SOCK
# (might print /private/tmp/com.apple.launchd.XXXXX/Listeners)

# Edit the plist (with PlistBuddy or any editor) to add an
# EnvironmentVariables key:
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables dict" \
  ~/Library/LaunchAgents/io.mutagen.mutagen.plist 2>/dev/null
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:SSH_AUTH_SOCK string $(launchctl getenv SSH_AUTH_SOCK)" \
  ~/Library/LaunchAgents/io.mutagen.mutagen.plist

# Reload
launchctl unload ~/Library/LaunchAgents/io.mutagen.mutagen.plist
launchctl load ~/Library/LaunchAgents/io.mutagen.mutagen.plist
```

**Fix B — use a key file instead of ssh-agent** (simpler, slightly less secure):

```bash
# Write the Fly SSH cert + key to ~/.ssh/fly_id_ed25519 instead of agent
flyctl ssh issue --keyfile ~/.ssh/fly_id_ed25519 --app theochretree-coach
# This generates ~/.ssh/fly_id_ed25519 + ~/.ssh/fly_id_ed25519-cert.pub

# Add to ~/.ssh/config so SSH picks it up automatically when connecting
# to *.internal Fly hostnames
cat >> ~/.ssh/config <<EOF

Host *.internal
  IdentityFile ~/.ssh/fly_id_ed25519
  CertificateFile ~/.ssh/fly_id_ed25519-cert.pub
  UserKnownHostsFile /dev/null
  StrictHostKeyChecking no
EOF

# Update the cron from §1 to write to keyfile instead of agent
crontab -e
# Change the line to:
# 0 6 * * * /bin/zsh -lc '/opt/homebrew/bin/flyctl ssh issue --keyfile $HOME/.ssh/fly_id_ed25519 --app theochretree-coach'
```

After Fix B, ssh-agent isn't in the picture at all and LaunchAgent
restarts pick up the key from disk. Recommended unless you have
specific reasons to want agent-managed certs.

### 3. MacBook — direct sync vs iCloud bridge

You have a Mac mini (always on, primary Mutagen host) and a MacBook
(intermittent). Two options:

- **iCloud bridge** (current setup): MacBook ↔ iCloud ↔ Mac mini ↔ Fly.
  When the MacBook edits a file, iCloud syncs to Mac mini in seconds,
  then Mutagen on Mac mini syncs to Fly. No Mutagen setup on the
  MacBook. Adds 2 sync hops of latency for laptop-originated edits
  (typically still <10s end-to-end).
- **Direct dual-sync**: install Mutagen on the MacBook too with its
  own sync session pointing at the same Fly volume. Same setup steps
  as on Mac mini. **Caveat**: two clients writing to the same Fly path
  is a recipe for conflicts; use `--mode=two-way-safe` (the default
  above) so conflicts surface as `.conflict-*` files rather than data
  loss. Only worth doing if the iCloud-bridge latency bites you on
  real workflows.

Recommendation: stick with iCloud bridge unless you find yourself
actively editing client.yaml on the MacBook while clients are mid-form
on Fly. Most edits are coach-side (token generation, notes) which
happen on Mac mini anyway.

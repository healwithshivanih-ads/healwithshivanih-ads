# Laptop ↔ Mac mini sync — let the MacBook author client data

This sets up a second Mutagen sync session so the MacBook can read/write
`~/fm-plans/` and have changes reach the Mac mini (and from there, Fly).

```
MacBook (~/fm-plans)  ←──[Mutagen over SSH + Tailscale]──→  Mac mini (iCloud fm-plans)
                                                                    ↓
                                                            [existing Mutagen session]
                                                                    ↓
                                                            Fly (/data/fm-plans)
```

**Source of truth stays on the mini.** This just makes the laptop a live mirror.

---

## Prereqs

- Mac mini already running the existing `fm-plans` Mutagen session to Fly.
- Mutagen 0.18.1 on the mini (matches Fly agent — pinned in Dockerfile).
- Apple ID / login on both Macs.

---

## 1. Install Tailscale on both Macs

Download from https://tailscale.com/download/mac and install on **both** Macs.

Sign in with the same Google/Apple/email identity on both. After a few seconds
each Mac gets a private `100.x.y.z` address visible in the menu-bar Tailscale
icon → "This device".

Note the **Mac mini's Tailscale address** — you'll need it below. Example:
`100.64.0.5`.

Test from the MacBook:

```bash
ping -c 2 100.64.0.5     # use the mini's actual Tailscale IP
```

Should respond.

---

## 2. Enable Remote Login (SSH) on the Mac mini

On the **Mac mini**: System Settings → General → Sharing → toggle on
**Remote Login**. Set "Allow access for" to your user.

Note your mini's macOS username (e.g. `shivani`) — used below.

---

## 3. SSH key from MacBook to Mac mini

On the **MacBook**:

```bash
# Generate a key if you don't have one
ls ~/.ssh/id_ed25519.pub 2>/dev/null || ssh-keygen -t ed25519 -C "macbook-to-mini" -N "" -f ~/.ssh/id_ed25519

# Copy it to the mini (replace USER + IP with real values)
ssh-copy-id shivani@100.64.0.5
# (type the mini's macOS login password once)

# Verify passwordless login works
ssh shivani@100.64.0.5 "hostname && whoami"
# should print the mini's hostname + your username with no password prompt
```

Save the host alias so the rest of the runbook can use `mini` instead of the IP.
Append to `~/.ssh/config` on the MacBook:

```
Host mini
    HostName 100.64.0.5
    User shivani
    ServerAliveInterval 30
    ServerAliveCountMax 4
```

Test: `ssh mini "uptime"` should just work.

---

## 4. Install Mutagen on the MacBook

Must match the mini's version exactly (which matches Fly's agent — currently
0.18.1).

```bash
# Check the mini's version
ssh mini "/opt/homebrew/bin/mutagen version || /usr/local/bin/mutagen version"

# Install matching version on the MacBook
brew install mutagen-io/mutagen/mutagen@0.18
mutagen version       # confirm
```

If brew gives you a newer version, pin to 0.18 with the tap above, OR upgrade
the mini + Fly Dockerfile in lockstep (see MUTAGEN_SYNC.md — non-trivial).

---

## 5. Find the mini's fm-plans path

The mini stores `fm-plans` inside iCloud Drive. The `~/fm-plans` you see on the
mini is a symlink; Mutagen needs the resolved path.

```bash
ssh mini "readlink -f ~/fm-plans"
# Expect something like:
# /Users/shivani/Library/Mobile Documents/com~apple~CloudDocs/fm-plans
```

Save that string — it's the **beta endpoint** for the sync.

---

## 6. Create the Mutagen sync session

On the **MacBook**:

```bash
mutagen sync create \
  --name=fm-plans-laptop \
  --mode=two-way-resolved \
  --default-file-mode=0644 \
  --default-directory-mode=0755 \
  --ignore-vcs \
  --ignore="**/.DS_Store" \
  --ignore="**/_audit.jsonl" \
  --ignore="**/_backlog.yaml" \
  ~/fm-plans \
  "mini:/Users/shivani/Library/Mobile Documents/com~apple~CloudDocs/fm-plans"
```

(Adjust the right-hand path to whatever step 5 returned. The quotes matter —
the path has spaces.)

**Mode choice:** `two-way-resolved` means the most-recently-modified file wins
on conflict. Use `two-way-safe` instead if you want Mutagen to halt on every
conflict and ask. Safe is more cautious but more annoying day-to-day.

Verify:

```bash
mutagen sync list
# Status should reach: Watching for changes
```

First scan will copy any files that differ. If the MacBook's `~/fm-plans` was
empty/stale, it will populate from the mini. If both sides have divergent data,
review carefully before running.

---

## 7. Smoke-test the full chain

On the **MacBook**:

```bash
echo "test from laptop $(date)" > ~/fm-plans/_laptop_sync_test.txt
```

Within ~5 seconds:

```bash
ssh mini "cat '/Users/shivani/Library/Mobile Documents/com~apple~CloudDocs/fm-plans/_laptop_sync_test.txt'"
```

Should print the line. Then within another ~5 seconds (the mini → Fly session):

```bash
flyctl ssh console -a theochretree-coach -C "cat /data/fm-plans/_laptop_sync_test.txt"
```

Should also print it. Once confirmed, clean up:

```bash
rm ~/fm-plans/_laptop_sync_test.txt
```

---

## 8. Ongoing ops

- **Tailscale must be running** on both Macs whenever you want sync to flow.
  Set it to start at login (Tailscale menu → Preferences).
- **Mutagen daemon auto-starts** on macOS via launchd after `mutagen sync create`.
  Survives reboots.
- **If the mini is asleep**, sync pauses. The mini needs to be awake (caffeinate,
  or System Settings → Energy → "Prevent automatic sleeping when display is off").
- **Conflicts**: `mutagen sync list` shows count. `mutagen sync flush fm-plans-laptop`
  forces a re-scan. If both sides edited the same `client.yaml`, `two-way-resolved`
  picks the newer mtime; `two-way-safe` halts so you can pick manually.

---

## Failure modes to know

| Symptom | Cause | Fix |
|---|---|---|
| `Halted on problems` in `mutagen sync list` | Conflict on a file edited on both sides | `mutagen sync list -l fm-plans-laptop` to see paths, resolve by deleting one copy, then `mutagen sync resume` |
| `Connection lost` | Tailscale dropped / mini asleep | Check Tailscale menu on both, wake the mini |
| New token on laptop never appears on Fly | Mutagen laptop→mini stalled, OR mini→Fly stalled | `mutagen sync list` on both Macs; whichever shows non-Watching is the stuck link |
| Version mismatch error | MacBook Mutagen ≠ mini Mutagen | Pin both to 0.18.x via the brew tap |

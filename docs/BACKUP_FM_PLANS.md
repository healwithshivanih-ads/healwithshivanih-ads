# Backup & DR for `~/fm-plans` (client PHI)

All client PHI lives in `~/fm-plans` (an iCloud-backed folder) on the Mac, with
a writable Fly replica synced by Mutagen. **Neither iCloud nor the Fly volume is
a backup** — a bad Mutagen conflict, an accidental delete, or a dead SSD can
lose real client data with no independent recovery point.

`scripts/backup-fm-plans.sh` takes **versioned, restore-verified** snapshots.

## What it does

- Hardlink-incremental snapshots into `~/fm-plans-backups/snapshot-<ts>/`
  (Time-Machine style: every snapshot is a full tree, but unchanged files cost
  no extra disk). `latest` symlink points at the newest.
- **Verifies every snapshot** by restoring a real `client.yaml` out of it and
  confirming it round-trips. A snapshot that can't restore a client record is a
  failed backup (non-zero exit).
- Retains the newest 30 snapshots (`FM_PLANS_BACKUP_KEEP`), prunes older.

## Run it

```bash
scripts/backup-fm-plans.sh            # snapshot + verify
scripts/backup-fm-plans.sh --verify   # verify latest snapshot only (no new one)
scripts/backup-fm-plans.sh --help
```

A stable copy is installed at `~/bin/backup-fm-plans.sh` (so scheduling survives
git-worktree churn). If you move/re-clone the repo, re-copy it there.

## Scheduled daily (launchd)

`~/Library/LaunchAgents/com.shivani.fm-plans-backup.plist` runs it daily at
02:00 (and once at load). Logs to `~/fm-plans-backups/_backup.log`.

```bash
launchctl load -w ~/Library/LaunchAgents/com.shivani.fm-plans-backup.plist
launchctl list | grep fm-plans-backup        # col 2 = last exit code (want 0)
launchctl kickstart -k gui/$(id -u)/com.shivani.fm-plans-backup   # run now
```

### ⚠️ One-time manual step: Full Disk Access (REQUIRED for the scheduled run)

macOS blocks launchd/cron jobs from reading **iCloud Drive** unless granted Full
Disk Access. Manual runs from Terminal work; the scheduled run will log a
"cannot read source … Operation not permitted" error until you do this once:

> System Settings → Privacy & Security → **Full Disk Access** → **+** →
> add `~/bin/backup-fm-plans.sh` (Cmd-Shift-G to type the path). If a shell
> script isn't accepted, add `/bin/bash` instead. Toggle **ON**.
> Then: `launchctl kickstart -k gui/$(id -u)/com.shivani.fm-plans-backup`

The agent self-heals the moment FDA is granted — no further setup.

## ⚠️ Off-site (REQUIRED for true DR — opt-in)

Local snapshots survive deletes/conflicts/corruption but **not a lost/dead Mac**.
Set an off-site target **you own** (external SSD or NAS) and the script mirrors
the latest snapshot there each run:

```bash
export FM_PLANS_OFFSITE_DEST="/Volumes/BackupSSD/fm-plans-backups"   # external disk
export FM_PLANS_OFFSITE_DEST="user@nas.local:/backups/fm-plans"      # ssh/rsync target
```

For the scheduled run, uncomment the `EnvironmentVariables` block in the plist
and reload. This is client health data — only point it at storage you trust.

## Gotcha: iCloud-evicted files

If "Optimize Mac Storage" is on, iCloud may evict file bodies, leaving `.icloud`
placeholders whose real bytes aren't local. The script **warns** when it sees
them — those files won't be in the backup until materialized (open the folder in
Finder to force-download).

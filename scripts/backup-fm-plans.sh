#!/usr/bin/env bash
#
# backup-fm-plans.sh — versioned, restore-verified backup of ~/fm-plans
# ============================================================================
#
# WHY THIS EXISTS
#   All client PHI lives in ~/fm-plans (an iCloud-backed folder) on the Mac,
#   with a writable Fly replica synced by Mutagen. The Fly volume + iCloud are
#   NOT a backup — a bad Mutagen conflict, an accidental delete, or a dead SSD
#   can lose real client data with no independent recovery point. This script
#   takes point-in-time, versioned snapshots you can actually restore from, and
#   PROVES each snapshot is restorable before declaring success.
#
# WHAT IT DOES
#   1. Snapshots ~/fm-plans into a timestamped dir using rsync --link-dest, so
#      unchanged files are hardlinked to the previous snapshot (Time-Machine
#      style: every snapshot is a full browsable tree, but only changed files
#      cost disk).
#   2. Verifies the snapshot: parses a real client.yaml out of it as YAML.
#      A snapshot that can't round-trip a client record is a FAILED backup.
#   3. Prunes old snapshots beyond the retention count.
#   4. OFF-SITE (opt-in): if FM_PLANS_OFFSITE_DEST is set, mirrors the latest
#      snapshot there. If it is NOT set, the script does NOT send PHI anywhere
#      — it prints how to turn it on and exits cleanly.
#
# OFF-SITE — READ THIS
#   Local snapshots protect against deletes/conflicts/corruption but NOT against
#   the Mac itself being lost/stolen/dead. For real DR you must set an off-site
#   destination YOU control, e.g.:
#       export FM_PLANS_OFFSITE_DEST="/Volumes/BackupSSD/fm-plans-backups"   # external disk
#       export FM_PLANS_OFFSITE_DEST="user@nas.local:/backups/fm-plans"      # ssh/rsync target
#   This is client health data — only point it at storage you own and trust.
#
# USAGE
#   scripts/backup-fm-plans.sh            # snapshot + verify (+ off-site if set)
#   scripts/backup-fm-plans.sh --verify   # verify the latest snapshot only (no new one)
#   scripts/backup-fm-plans.sh --help
#
# ENV OVERRIDES
#   FM_PLANS_DIR          source to back up         (default: ~/fm-plans)
#   FM_PLANS_BACKUP_DIR   where snapshots live      (default: ~/fm-plans-backups)
#   FM_PLANS_BACKUP_KEEP  snapshots to retain       (default: 30)
#   FM_PLANS_OFFSITE_DEST off-site mirror target    (default: unset → skipped)
#
# SCHEDULING (recommended: daily)
#   launchd/cron entry, e.g.:  0 2 * * *  /path/to/scripts/backup-fm-plans.sh
# ============================================================================

set -euo pipefail

# ---- resolve config -------------------------------------------------------
SRC="${FM_PLANS_DIR:-$HOME/fm-plans}"
DEST_ROOT="${FM_PLANS_BACKUP_DIR:-$HOME/fm-plans-backups}"
KEEP="${FM_PLANS_BACKUP_KEEP:-30}"
OFFSITE="${FM_PLANS_OFFSITE_DEST:-}"

MODE="snapshot"
case "${1:-}" in
  --verify|--verify-only) MODE="verify" ;;
  --help|-h)
    sed -n '2,55p' "$0"; exit 0 ;;
  "" ) ;;
  * ) echo "Unknown arg: $1 (try --help)" >&2; exit 2 ;;
esac

log() { printf '[backup-fm-plans] %s\n' "$*"; }
die() { printf '[backup-fm-plans] ERROR: %s\n' "$*" >&2; exit 1; }

# Resolve the source through the iCloud symlink to the real directory.
if command -v realpath >/dev/null 2>&1; then
  SRC_REAL="$(realpath "$SRC" 2>/dev/null || echo "$SRC")"
else
  SRC_REAL="$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$SRC")"
fi
# Probe READABILITY, not just existence: a launchd/cron job without Full Disk
# Access can SEE the iCloud symlink but gets "Operation not permitted" trying
# to read inside it. Fail loudly with the fix so the nightly run never dies
# silently (the empty-log failure mode this script must avoid).
if ! ls "$SRC_REAL" >/dev/null 2>&1; then
  uid="$(id -u)"
  {
    echo "[backup-fm-plans] ERROR: cannot read source: $SRC_REAL"
    echo ""
    echo "If manual runs work but the SCHEDULED (launchd) run shows this,"
    echo "macOS is blocking this background job from reading iCloud Drive."
    echo ""
    echo "FIX (one-time, ~30s):"
    echo "  System Settings → Privacy & Security → Full Disk Access → [ + ]"
    echo "  Add  ~/bin/backup-fm-plans.sh  (Cmd-Shift-G to type the path),"
    echo "  or if that's not accepted, add  /bin/bash . Toggle it ON."
    echo "  Then re-run:"
    echo "    launchctl kickstart -k gui/${uid}/com.shivani.fm-plans-backup"
  } >&2
  exit 1
fi

LATEST_LINK="$DEST_ROOT/latest"

# ---- verify helper (the failable check) -----------------------------------
# Proves a snapshot is RESTORABLE: pull a client.yaml out of it, copy it to a
# scratch dir, and confirm it parses as YAML. Exits non-zero if it can't.
verify_snapshot() {
  local snap="$1"
  [ -d "$snap" ] || die "verify: snapshot dir missing: $snap"

  local sample
  sample="$(find "$snap/clients" -name client.yaml 2>/dev/null | head -1 || true)"
  [ -n "$sample" ] || die "verify: no client.yaml found inside $snap (empty/broken backup)"

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  cp "$sample" "$tmp/restored-client.yaml" || die "verify: could not copy $sample"

  # PyYAML-optional so the script is self-contained (cron/bare-python safe):
  # full parse when PyYAML is present, structural check otherwise.
  python3 - "$tmp/restored-client.yaml" <<'PY' || die "verify: restored client.yaml did NOT round-trip"
import sys, re
p = sys.argv[1]
raw = open(p, encoding="utf-8").read()        # must decode as UTF-8 text
assert raw.strip(), "restored file is empty"
try:
    import yaml
    data = yaml.safe_load(raw)
    assert isinstance(data, dict) and data, "parsed YAML is empty / not a mapping"
    print(f"[backup-fm-plans] verify OK (PyYAML): {p} -> {len(data)} top-level keys")
except ModuleNotFoundError:
    # No PyYAML in this interpreter — structural fallback: confirm it looks
    # like a YAML mapping (>=1 top-level 'key:' line). Proves the file copied
    # intact and is restorable text, without a full parse.
    keys = [ln for ln in raw.splitlines() if re.match(r"^[A-Za-z0-9_]+\s*:", ln)]
    assert keys, "no top-level YAML keys found (file may be corrupt)"
    print(f"[backup-fm-plans] verify OK (structural, no PyYAML): {p} -> {len(keys)} top-level keys")
PY

  # Freshness: how old is this snapshot?
  local age_h
  age_h="$(python3 - "$snap" <<'PY'
import os, sys, time
print(int((time.time() - os.path.getmtime(sys.argv[1])) / 3600))
PY
)"
  log "snapshot age: ${age_h}h"
  if [ "$MODE" = "verify" ] && [ "$age_h" -gt 26 ]; then
    die "latest snapshot is ${age_h}h old (>26h) — the backup job may have stopped running"
  fi
}

# ---- verify-only mode -----------------------------------------------------
if [ "$MODE" = "verify" ]; then
  [ -e "$LATEST_LINK" ] || die "no snapshots yet at $DEST_ROOT (run without --verify first)"
  TARGET="$(readlink "$LATEST_LINK" 2>/dev/null || true)"
  [ -n "$TARGET" ] && [ -d "$DEST_ROOT/$TARGET" ] && TARGET="$DEST_ROOT/$TARGET" || TARGET="$LATEST_LINK"
  log "verifying latest snapshot: $TARGET"
  verify_snapshot "$TARGET"
  log "VERIFY PASSED."
  exit 0
fi

# ---- snapshot mode --------------------------------------------------------
mkdir -p "$DEST_ROOT"
STAMP="$(date +%Y%m%d-%H%M%S)"
SNAP="$DEST_ROOT/snapshot-$STAMP"

# Warn (don't fail) on iCloud-evicted placeholder files: if "Optimize Mac
# Storage" has dataless-ed files, their real bytes aren't on disk and won't be
# backed up. Surfacing this is the whole point — a silent gap is the danger.
PLACEHOLDERS="$(find "$SRC_REAL" -name '*.icloud' 2>/dev/null | wc -l | tr -d ' ')"
if [ "${PLACEHOLDERS:-0}" -gt 0 ]; then
  log "WARNING: $PLACEHOLDERS iCloud-evicted (.icloud) placeholder file(s) in source."
  log "         Their real data is NOT local and will be MISSING from this backup."
  log "         Run: find \"$SRC_REAL\" -name '*.icloud'   to list them, then open the"
  log "         folder in Finder to force-download before relying on this snapshot."
fi

RSYNC_OPTS=(-a --delete --exclude '.DS_Store' --exclude '.Trash*')
if [ -d "$LATEST_LINK" ]; then
  RSYNC_OPTS+=(--link-dest "$LATEST_LINK")
fi

log "snapshotting $SRC_REAL -> $SNAP"
rsync "${RSYNC_OPTS[@]}" "$SRC_REAL/" "$SNAP/" || die "rsync snapshot failed"

# Re-point 'latest' (relative symlink so the backup tree is portable).
ln -sfn "snapshot-$STAMP" "$LATEST_LINK"

# Verify the snapshot we just took — a backup we can't restore is not a backup.
verify_snapshot "$SNAP"

# ---- retention prune ------------------------------------------------------
# NB: bash 3.2-safe (macOS /bin/bash) — no `mapfile` (bash 4+). Read into an
# array with a while-read loop instead.
SNAPS=()
while IFS= read -r d; do SNAPS+=("$d"); done < <(
  find "$DEST_ROOT" -maxdepth 1 -type d -name 'snapshot-*' | sort
)
COUNT=${#SNAPS[@]}
if [ "$COUNT" -gt "$KEEP" ]; then
  PRUNE=$((COUNT - KEEP))
  log "pruning $PRUNE old snapshot(s) (keeping newest $KEEP)"
  i=0
  while [ "$i" -lt "$PRUNE" ]; do
    rm -rf "${SNAPS[$i]}"
    i=$((i + 1))
  done
fi

# ---- off-site mirror (opt-in only) ----------------------------------------
if [ -n "$OFFSITE" ]; then
  log "off-site mirror -> $OFFSITE"
  rsync -a --delete "$SNAP/" "$OFFSITE/" || die "off-site rsync failed (dest: $OFFSITE)"
  log "off-site mirror complete."
else
  log "OFF-SITE NOT CONFIGURED — local snapshot only."
  log "  Local snapshots survive deletes/conflicts but NOT a lost/dead Mac."
  log "  Set an off-site target you own to enable real DR, e.g.:"
  log "    export FM_PLANS_OFFSITE_DEST=\"/Volumes/BackupSSD/fm-plans-backups\""
  log "    export FM_PLANS_OFFSITE_DEST=\"user@nas.local:/backups/fm-plans\""
fi

log "DONE. snapshot=$SNAP  retained=$(find "$DEST_ROOT" -maxdepth 1 -type d -name 'snapshot-*' | wc -l | tr -d ' ')"

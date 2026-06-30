#!/usr/bin/env bash
#
# check-fm-backup-fresh.sh — watchdog: shout if the fm-plans backup goes stale.
# ============================================================================
#
# WHY THIS EXISTS
#   ~/bin/backup-fm-plans.sh already snapshots ~/fm-plans AND restore-verifies
#   each snapshot. What was MISSING is anyone NOTICING when it silently stops.
#   On 2026-06-26 the scheduled (launchd) backup began failing — the background
#   job lost Full Disk Access and could no longer read the source — and nothing
#   flagged it. A backup that fails quietly is worse than no backup, because you
#   believe you're covered. This is the watchdog that makes that impossible.
#
# WHAT IT DOES
#   1. Finds the newest snapshot (the `latest` symlink, else newest snapshot-*).
#   2. Fails LOUDLY (non-zero exit + a desktop notification) if there are no
#      snapshots at all, or the newest is older than the staleness threshold.
#   3. With --verify, also runs the main script's restore-verify on the latest
#      snapshot (proves it's not just present but actually restorable).
#
# EXIT CODES (so cron/launchd + any alerting can branch on them)
#   0  fresh and (if asked) verified
#   1  stale — newest snapshot older than the threshold
#   2  no snapshots found / backup dir missing
#   3  --verify requested but the snapshot failed restore-verification
#
# ENV OVERRIDES
#   FM_PLANS_BACKUP_DIR             where snapshots live  (default: ~/fm-plans-backups)
#   FM_PLANS_BACKUP_MAX_AGE_HOURS  staleness threshold    (default: 48)
#
# WIRING (recommended): run DAILY, a couple of hours AFTER the backup job, e.g.
#   launchd: a second StartCalendarInterval entry at 04:00 calling this script,
#   or cron:  0 4 * * *  /path/to/scripts/check-fm-backup-fresh.sh --verify
#   Pipe a non-zero exit to whatever you actually read (it already posts a macOS
#   notification; add an email/WhatsApp ping here if you want belt-and-braces).
#
# STILL A USER ACTION (this watchdog only DETECTS these; it can't fix them):
#   - Full Disk Access for the launchd job (the 2026-06-26 root cause) — see the
#     fix printed in ~/fm-plans-backups/_backup.log.
#   - Off-site copy: export FM_PLANS_OFFSITE_DEST to storage you own (external
#     SSD / NAS / ssh target) so a dead/stolen Mac isn't total data loss.
# ============================================================================

set -euo pipefail

BACKUP_DIR="${FM_PLANS_BACKUP_DIR:-$HOME/fm-plans-backups}"
MAX_AGE_HOURS="${FM_PLANS_BACKUP_MAX_AGE_HOURS:-48}"
VERIFY=0
[ "${1:-}" = "--verify" ] && VERIFY=1

# Best-effort desktop notification (macOS). Never fail the script if it can't.
notify() {
  local msg="$1"
  command -v osascript >/dev/null 2>&1 &&
    osascript -e "display notification \"${msg//\"/\'}\" with title \"fm-plans backup\"" >/dev/null 2>&1 || true
}

fail() {
  local code="$1" msg="$2"
  echo "[check-fm-backup] FAIL: $msg" >&2
  notify "$msg"
  exit "$code"
}

[ -d "$BACKUP_DIR" ] || fail 2 "backup dir missing: $BACKUP_DIR"

# Newest snapshot: prefer the 'latest' symlink, else the lexically-last dir
# (names are snapshot-YYYYMMDD-HHMMSS, so sort order == chronological).
newest=""
if [ -L "$BACKUP_DIR/latest" ]; then
  target="$(readlink "$BACKUP_DIR/latest")"
  case "$target" in
    /*) newest="$target" ;;
    *)  newest="$BACKUP_DIR/$target" ;;
  esac
fi
if [ -z "$newest" ] || [ ! -d "$newest" ]; then
  newest="$(find "$BACKUP_DIR" -maxdepth 1 -type d -name 'snapshot-*' 2>/dev/null | sort | tail -1)"
fi
[ -n "$newest" ] && [ -d "$newest" ] || fail 2 "no snapshots found in $BACKUP_DIR"

# Age of the newest snapshot, in whole hours. stat -f %m is the macOS spelling.
if mtime="$(stat -f %m "$newest" 2>/dev/null)"; then :; else
  mtime="$(stat -c %Y "$newest" 2>/dev/null)" || fail 2 "cannot stat $newest"
fi
now="$(date +%s)"
age_h=$(( (now - mtime) / 3600 ))

if [ "$age_h" -gt "$MAX_AGE_HOURS" ]; then
  fail 1 "newest snapshot is ${age_h}h old (> ${MAX_AGE_HOURS}h): $(basename "$newest") — backups may have stopped"
fi

if [ "$VERIFY" -eq 1 ]; then
  if [ -x "$HOME/bin/backup-fm-plans.sh" ]; then
    if ! "$HOME/bin/backup-fm-plans.sh" --verify; then
      fail 3 "latest snapshot failed restore-verification"
    fi
  else
    echo "[check-fm-backup] note: --verify asked but ~/bin/backup-fm-plans.sh not found; skipped" >&2
  fi
fi

echo "[check-fm-backup] OK: newest snapshot is ${age_h}h old: $(basename "$newest")"

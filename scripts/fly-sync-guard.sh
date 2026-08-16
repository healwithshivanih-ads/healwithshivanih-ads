#!/usr/bin/env bash
# fly-sync-guard.sh — reconnect + verify the Mutagen sessions that feed Fly.
#
# WHY THIS EXISTS. A `flyctl deploy` replaces the machine, which kills the
# Mutagen agent on the BETA side. Mutagen usually reconnects on its own, but it
# is not guaranteed and it fails SILENTLY: alpha keeps accepting writes, the
# staging tree on the Mac looks perfectly healthy, and nothing reaches Fly. On
# 2026-08-16 that stranded Nazneen's approved week-4 menu — the file was correct
# locally and on ~/fm-plans-staging, and her app still served the old week,
# because beta had died with "unable to read message length: unexpected EOF"
# after the v379 deploy. The same failure mode cost a client a working intake
# link on 2026-05-17 (see MUTAGEN_SYNC.md).
#
# ~/bin/mutagen-health.sh already DETECTS this — but it runs once a day at 08:00
# and only notifies. This script closes the window that matters: it runs
# immediately after a deploy, it RECOVERS rather than only alerting, and it
# fails loudly so a broken sync can never be mistaken for a clean deploy.
#
# SCOPE. Only sessions whose BETA endpoint is on the Fly host are touched. The
# NAS backup session (fm-plans-nas -> shivanihari@100.68.140.54) is reported and
# otherwise left completely alone — it has its own connectivity story and is not
# what a Fly deploy breaks.
#
# Usage:
#   fly-sync-guard.sh                 # recover + verify (default)
#   fly-sync-guard.sh --verify-only   # verify without flushing (read-only check)
#   FLY_SYNC_HOST=... fly-sync-guard.sh   # override the beta host match
#
# Exit codes:
#   0  every Fly-targeting session is connected on both endpoints
#   1  at least one could not be recovered  <-- deploy scripts MUST NOT ignore
#   2  mutagen missing, or no Fly-targeting session found at all

set -uo pipefail

MUTAGEN="${MUTAGEN_BIN:-/opt/homebrew/bin/mutagen}"
# Matched against the BETA url. Anything not matching is never touched.
FLY_SYNC_HOST="${FLY_SYNC_HOST:-theochretree-coach.internal}"
ATTEMPTS="${FLY_SYNC_ATTEMPTS:-6}"     # total recovery attempts per session
SLEEP_SECS="${FLY_SYNC_SLEEP:-10}"     # wait between attempts

VERIFY_ONLY=0
[[ "${1:-}" == "--verify-only" ]] && VERIFY_ONLY=1

command -v "$MUTAGEN" >/dev/null 2>&1 || { echo "❌ mutagen not found at $MUTAGEN"; exit 2; }

# ── Which sessions point at Fly? ────────────────────────────────────────────
# `mutagen sync list` prints Name, then Alpha URL, then Beta URL. We take the
# session name only when the SECOND (beta) url matches the Fly host, so an
# alpha path that happens to contain the string can never opt a session in.
fly_sessions() {
  "$MUTAGEN" sync list 2>/dev/null | awk -v host="$FLY_SYNC_HOST" '
    /^Name:/       { name=$2; urls=0; next }
    /URL:/         { urls++; if (urls==2 && index($0, host) > 0) print name; next }
  '
}

# Both endpoints connected? Returns 0 (healthy) / 1 (not).
session_connected() {
  local name="$1" out yes
  out="$("$MUTAGEN" sync list "$name" 2>/dev/null)"
  yes="$(printf '%s\n' "$out" | grep -c 'Connected: Yes')"
  [[ "$yes" -eq 2 ]]
}

session_status()  { "$MUTAGEN" sync list "$1" 2>/dev/null | sed -n 's/^Status: //p' | head -1; }
session_error()   { "$MUTAGEN" sync list "$1" 2>/dev/null | sed -n 's/^Last error: //p' | head -1; }

echo "🔗 Fly sync guard — beta host: $FLY_SYNC_HOST"

# Portable collection — `mapfile` is bash 4+, and /bin/bash on macOS is 3.2.
SESSIONS=()
while IFS= read -r line; do
  [[ -n "$line" ]] && SESSIONS+=("$line")
done < <(fly_sessions)

if [[ "${#SESSIONS[@]}" -eq 0 ]]; then
  echo "❌ No Mutagen session targets $FLY_SYNC_HOST."
  echo "   Client app data cannot be reaching Fly. See MUTAGEN_SYNC.md."
  exit 2
fi
echo "   sessions in scope: ${SESSIONS[*]}"

FAILED=()
for s in "${SESSIONS[@]}"; do
  echo
  echo "── $s"
  for ((i = 1; i <= ATTEMPTS; i++)); do
    if session_connected "$s"; then
      echo "   ✓ connected on both endpoints (status: $(session_status "$s"))"
      err="$(session_error "$s")"
      # A stale error line on an otherwise-connected session is residue from the
      # outage we just recovered from — worth showing, not worth failing on.
      [[ -n "$err" ]] && echo "   ℹ️  last error (stale, session is connected): $err"
      break
    fi

    if [[ "$VERIFY_ONLY" -eq 1 ]]; then
      echo "   ✗ not connected (status: $(session_status "$s")) — verify-only, not recovering"
      FAILED+=("$s")
      break
    fi

    echo "   attempt $i/$ATTEMPTS — status: $(session_status "$s")"
    # flush forces a reconnect + a full sync cycle; resume is the escalation for
    # a session that has been paused rather than merely dropped. Neither is
    # destructive: no `terminate`, no `reset`, nothing that rebuilds state.
    "$MUTAGEN" sync flush "$s" >/dev/null 2>&1 || "$MUTAGEN" sync resume "$s" >/dev/null 2>&1 || true

    if [[ "$i" -eq "$ATTEMPTS" ]]; then
      echo "   ✗ still not connected after $ATTEMPTS attempts"
      FAILED+=("$s")
    else
      sleep "$SLEEP_SECS"
    fi
  done
done

# ── Report the NAS session, never touch it ──────────────────────────────────
nas="$("$MUTAGEN" sync list 2>/dev/null | awk -v host="$FLY_SYNC_HOST" '
  /^Name:/ { name=$2; urls=0; next }
  /URL:/   { urls++; if (urls==2 && index($0, host)==0) print name; next }
' | sort -u)"
if [[ -n "$nas" ]]; then
  echo
  echo "ℹ️  Other sessions (reported only, NOT touched by this guard):"
  for n in $nas; do
    if session_connected "$n"; then st="connected"; else st="DISCONNECTED"; fi
    echo "   · $n — $st (status: $(session_status "$n"))"
  done
fi

echo
if [[ "${#FAILED[@]}" -gt 0 ]]; then
  cat <<MSG
❌ SYNC GUARD FAILED — ${FAILED[*]}

The deploy may have succeeded, but client app data is NOT reaching Fly.
Every client's app is now serving whatever was last synced.

  mutagen sync list ${FAILED[*]}          # look at Last error
  mutagen sync flush ${FAILED[*]}         # retry by hand
  ~/bin/fly-ssh-refresh.sh                # if the Fly SSH cert has expired
  MUTAGEN_SYNC.md                          # full troubleshooting

MSG
  exit 1
fi

echo "✅ Fly sync healthy — client data is reaching the app."

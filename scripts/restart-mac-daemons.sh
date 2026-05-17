#!/usr/bin/env bash
# restart-mac-daemons.sh — clean restart of the FM-Coach Mac daemons.
#
# Use when you hit `forkpty: Device not configured` or any other "Mac
# resource exhausted" symptom. Safe to run anytime — does NOT touch:
#   - ~/fm-plans/ data
#   - fm-database/data/ catalogue
#   - Fly machine (intake.theochretree.com stays up)
#   - AiSensy webhook configuration
#   - Mutagen sync session config (only stops the daemon — sessions resume)
#   - PM2 ecosystem.config.js
#
# What it does:
#   1. Stops PM2 fm-coach (the local Next.js coach UI on :3002)
#   2. Stops Mutagen daemon (sync sessions PERSIST — they auto-resume)
#   3. Kills stray dev servers (next dev / turbopack / streamlit / cloudflared)
#   4. Reports process count before + after
#   5. Restarts Mutagen daemon → sync sessions auto-resume
#   6. Restarts PM2 fm-coach
#
# Usage:
#   bash scripts/restart-mac-daemons.sh
#
# Or with --no-restart to just clean up:
#   bash scripts/restart-mac-daemons.sh --no-restart

set -uo pipefail
# Note: deliberately NOT `set -e` — we want to continue even if a step
# fails (e.g. PM2 was already stopped). Each step prints its own status.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PM2="${REPO_ROOT}/fm-database-web/node_modules/.bin/pm2"
ECOSYSTEM="${REPO_ROOT}/fm-database-web/ecosystem.config.js"

RESTART=1
if [[ "${1:-}" == "--no-restart" ]]; then
  RESTART=0
fi

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
yellow() { printf "\033[33m%s\033[0m\n" "$1"; }
red() { printf "\033[31m%s\033[0m\n" "$1"; }
dim() { printf "\033[2m%s\033[0m\n" "$1"; }

bold "═══ FM-Coach Mac daemon restart ═══"
echo

# ── Snapshot before ─────────────────────────────────────────────────
BEFORE_PROCS=$(ps -u "$USER" | wc -l | tr -d ' ')
SOFT_PROC_LIMIT=$(ulimit -u)
SOFT_FD_LIMIT=$(ulimit -n)
dim "Before:  ${BEFORE_PROCS} processes  /  ulimit -u=${SOFT_PROC_LIMIT}  ulimit -n=${SOFT_FD_LIMIT}"
echo

# ── 1. Stop PM2 fm-coach ────────────────────────────────────────────
bold "1. Stopping PM2 fm-coach…"
if [[ -x "$PM2" ]]; then
  if "$PM2" list 2>/dev/null | grep -q "fm-coach"; then
    "$PM2" stop fm-coach 2>&1 | tail -3 || true
    green "   ✓ fm-coach stopped"
  else
    dim "   (fm-coach not running in PM2 — skipping)"
  fi
else
  yellow "   ⚠ PM2 not found at ${PM2} — skipping"
fi
echo

# ── 2. Stop Mutagen daemon ──────────────────────────────────────────
# Mutagen's `daemon stop` cleanly stops the daemon. Sync sessions are
# persisted in ~/.mutagen and auto-resume when the daemon starts again.
# We do NOT use `mutagen sync terminate` — that deletes the session.
bold "2. Stopping Mutagen daemon (sync sessions PERSIST)…"
if command -v mutagen >/dev/null 2>&1; then
  CURRENT_SESSIONS=$(mutagen sync list 2>/dev/null | grep -c "^Name:" || echo 0)
  dim "   Current sync sessions configured: ${CURRENT_SESSIONS}"
  mutagen daemon stop 2>&1 | tail -2 || true
  green "   ✓ mutagen daemon stopped (sessions preserved)"
else
  yellow "   ⚠ mutagen not in PATH — skipping"
fi
echo

# ── 3. Kill stray dev servers ───────────────────────────────────────
bold "3. Killing stray dev servers…"
for pattern in "next-server" "turbopack" "streamlit" "cloudflared tunnel"; do
  COUNT=$(pgrep -fc "$pattern" 2>/dev/null || echo 0)
  if [[ "$COUNT" -gt 0 ]]; then
    pkill -f "$pattern" 2>/dev/null || true
    sleep 0.3
    REMAINING=$(pgrep -fc "$pattern" 2>/dev/null || echo 0)
    if [[ "$REMAINING" -gt 0 ]]; then
      pkill -9 -f "$pattern" 2>/dev/null || true
    fi
    green "   ✓ killed ${COUNT}× ${pattern}"
  else
    dim "   (no ${pattern} running)"
  fi
done
echo

# ── 4. Snapshot mid ─────────────────────────────────────────────────
sleep 1
MID_PROCS=$(ps -u "$USER" | wc -l | tr -d ' ')
FREED=$((BEFORE_PROCS - MID_PROCS))
green "Freed: ${FREED} processes  (${BEFORE_PROCS} → ${MID_PROCS})"
echo

if [[ "$RESTART" -eq 0 ]]; then
  yellow "──── --no-restart — stopping here. Restart manually with:"
  echo "      mutagen daemon start"
  echo "      ${PM2} start ${ECOSYSTEM}"
  exit 0
fi

# ── 5. Restart Mutagen ──────────────────────────────────────────────
bold "5. Starting Mutagen daemon (sync sessions auto-resume)…"
if command -v mutagen >/dev/null 2>&1; then
  mutagen daemon start 2>&1 | tail -2 || true
  sleep 2
  mutagen sync list 2>&1 | grep -E "^(Name|Status):" | head -10
  green "   ✓ mutagen daemon started"
else
  yellow "   ⚠ mutagen not in PATH — skipping"
fi
echo

# ── 6. Restart PM2 fm-coach ─────────────────────────────────────────
bold "6. Starting PM2 fm-coach on :3002…"
if [[ -x "$PM2" ]]; then
  if [[ -f "$ECOSYSTEM" ]]; then
    "$PM2" start "$ECOSYSTEM" 2>&1 | tail -10 || true
    green "   ✓ fm-coach started"
  else
    yellow "   ⚠ ecosystem.config.js not found at ${ECOSYSTEM} — skipping"
  fi
else
  yellow "   ⚠ PM2 not found — skipping"
fi
echo

# ── Snapshot after ──────────────────────────────────────────────────
sleep 2
AFTER_PROCS=$(ps -u "$USER" | wc -l | tr -d ' ')
dim "After:   ${AFTER_PROCS} processes"
echo
bold "═══ Verify ═══"
echo "   Coach UI:        curl -sI http://localhost:3002/api/health"
echo "   Mutagen:         mutagen sync list"
echo "   Fly (untouched): curl -sI https://intake.theochretree.com/api/health"
echo
green "Done."

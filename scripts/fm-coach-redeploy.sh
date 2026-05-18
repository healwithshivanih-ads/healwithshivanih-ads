#!/usr/bin/env bash
# fm-coach-redeploy.sh — rebuild + restart fm-coach after edits to
# fm-database-web/ source files.
#
# Production PM2 serves a baked `.next/` build. Hot-reload only works in
# `npm run dev`. After editing protocol templates, components, server
# actions, or anything else in fm-database-web/src/, run this to make
# the changes live for the coach.
#
# Usage:
#   fm-coach-redeploy.sh            # full rebuild + restart (default)
#   fm-coach-redeploy.sh --quick    # skip type-check (faster, less safe)
#   fm-coach-redeploy.sh --restart  # restart only — no rebuild
#                                     (use when only .env.local changed)
#
# Catalogue edits (fm-database/data/*.yaml) do NOT need a redeploy.
# Server components read YAML directly at request time.
#
# Idempotent. Fails fast on build error — PM2 keeps serving the old build.

set -uo pipefail

REPO_ROOT="${HOME}/code/healwithshivanih-ads"
WEB_DIR="${REPO_ROOT}/fm-database-web"
PM2="${WEB_DIR}/node_modules/.bin/pm2"

# ─── Parse args ─────────────────────────────────────────────────────────────
MODE="full"
for arg in "$@"; do
  case "$arg" in
    --quick)   MODE="quick" ;;
    --restart) MODE="restart" ;;
    --help|-h)
      sed -n '2,/^set -/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "❌ unknown arg: $arg (use --help)"
      exit 1
      ;;
  esac
done

# ─── Preflight ──────────────────────────────────────────────────────────────
if [[ ! -d "$WEB_DIR" ]]; then
  echo "❌ fm-database-web not found at $WEB_DIR"
  exit 1
fi

if [[ ! -x "$PM2" ]]; then
  echo "❌ pm2 not found at $PM2"
  echo "   run: (cd $WEB_DIR && npm install)"
  exit 1
fi

# Check pm2 fm-coach exists
if ! "$PM2" jlist 2>/dev/null | grep -q '"name":"fm-coach"'; then
  echo "❌ pm2 process 'fm-coach' is not registered"
  echo "   run: (cd $WEB_DIR && $PM2 start ecosystem.config.js)"
  exit 1
fi

cd "$WEB_DIR" || exit 1

# ─── Restart-only mode ──────────────────────────────────────────────────────
if [[ "$MODE" == "restart" ]]; then
  echo "🔄 Restart-only mode (no rebuild)"
  "$PM2" restart fm-coach --update-env
  echo "✅ fm-coach restarted (serving previous build)"
  exit 0
fi

# ─── Full / quick rebuild ───────────────────────────────────────────────────
BUILD_START=$(date +%s)

if [[ "$MODE" == "full" ]]; then
  echo "🔍 Type-checking..."
  if ! npm run --silent type-check 2>&1 | tee /tmp/fm-coach-typecheck.log | grep -q "error TS"; then
    echo "✓ type-check clean"
  else
    echo "❌ type-check failed — fix errors before rebuilding"
    echo "   full output: /tmp/fm-coach-typecheck.log"
    tail -20 /tmp/fm-coach-typecheck.log
    exit 1
  fi
fi

echo "📦 Building production bundle..."
if ! npm run --silent build 2>&1 | tee /tmp/fm-coach-build.log | tail -3; then
  echo "❌ build failed — PM2 keeps serving the previous build"
  echo "   full output: /tmp/fm-coach-build.log"
  tail -20 /tmp/fm-coach-build.log
  exit 1
fi

BUILD_DURATION=$(($(date +%s) - BUILD_START))
echo "✓ build complete (${BUILD_DURATION}s)"

# ─── Restart PM2 ────────────────────────────────────────────────────────────
echo "🔄 Restarting fm-coach (PM2)..."
"$PM2" restart fm-coach --update-env >/dev/null 2>&1

# Brief pause for the process to come up before status check
sleep 2

if "$PM2" jlist 2>/dev/null | grep -q '"name":"fm-coach".*"status":"online"'; then
  echo "✅ fm-coach live at http://localhost:3002 (new build)"
  "$PM2" list 2>&1 | grep -E "id |fm-coach" | head -3
else
  echo "❌ fm-coach failed to come up — check pm2 logs"
  echo "   $PM2 logs fm-coach --lines 30"
  exit 1
fi

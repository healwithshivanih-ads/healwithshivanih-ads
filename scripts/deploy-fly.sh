#!/usr/bin/env bash
# deploy-fly.sh — THE deploy path for theochretree-coach.
#
# Deploy, then guarantee the Mutagen sync to Fly is actually alive.
#
# A `flyctl deploy` replaces the machine and kills the Mutagen agent on the beta
# side. Mutagen usually reconnects — but when it does not, it fails silently:
# flyctl prints a green "successfully deployed", every local file looks right,
# and no client app receives another byte until someone notices by hand. That is
# how Nazneen's approved week-4 menu sat invisible on 2026-08-16, and how a
# client got a localhost intake link on 2026-05-17.
#
# So the deploy is not "done" when flyctl exits 0. It is done when the sync is
# verified. If the sync cannot be recovered this script exits NON-ZERO even
# though the deploy itself succeeded — a loud failure is the entire point.
#
# Usage:
#   scripts/deploy-fly.sh                    # deploy (remote builder) + sync guard
#   scripts/deploy-fly.sh --local-only       # any flag is passed through to flyctl
#   SKIP_DEPLOY=1 scripts/deploy-fly.sh      # run the sync guard alone
#
# Everything after `--` (or any flag) is forwarded to `flyctl deploy`.

set -uo pipefail

APP="${FLY_APP:-theochretree-coach}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$REPO_ROOT/scripts/fly-sync-guard.sh"

cd "$REPO_ROOT" || { echo "❌ cannot cd to $REPO_ROOT"; exit 2; }

if [[ "${SKIP_DEPLOY:-0}" != "1" ]]; then
  echo "🚀 Deploying $APP …"
  # --remote-only matches the documented runbook (DEPLOY_FLY.md) and keeps the
  # Docker build off the Mac.
  flyctl deploy -a "$APP" --remote-only "$@"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    echo
    echo "❌ Deploy failed (exit $rc) — not running the sync guard."
    echo "   The previous release is still serving; sync is untouched."
    exit "$rc"
  fi
  echo
  echo "✓ Deploy reported success. Now proving the sync survived it."
else
  echo "⏭  SKIP_DEPLOY=1 — running the sync guard only."
fi

echo
[[ -x "$GUARD" ]] || { echo "❌ sync guard missing or not executable: $GUARD"; exit 2; }
"$GUARD"
guard_rc=$?

if [[ $guard_rc -ne 0 ]]; then
  echo
  echo "⚠️  DEPLOY SUCCEEDED BUT SYNC IS DOWN — treat this as an outage."
  echo "   Clients are served stale data until the sync is restored."
  exit "$guard_rc"
fi

echo
if [[ "${SKIP_DEPLOY:-0}" == "1" ]]; then
  echo "🎉 Sync verified. (No deploy ran — SKIP_DEPLOY=1.)"
else
  echo "🎉 Deploy complete and sync verified."
fi

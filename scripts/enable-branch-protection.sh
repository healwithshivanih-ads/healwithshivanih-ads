#!/usr/bin/env bash
#
# Enable branch protection on `main` so a red build can never land there again.
# This is the durable fix for "main is red / I keep getting failure emails":
# with it on, CI runs on a PR branch and the failure is on the PR, not main.
#
# NOT run automatically. Flip it deliberately, and only when the parallel
# authoring/agent sessions are QUIESCENT — turning it on mid-flight blocks the
# direct-to-main pushes those sessions are doing and can strand their work.
# After it is on, sessions must push a branch and open a PR (they already create
# claude/* branches), and `gh pr merge --auto` will merge once checks are green.
#
# Requires: gh authenticated with admin on the repo.
#
#   bash scripts/enable-branch-protection.sh          # apply
#   bash scripts/enable-branch-protection.sh --show   # just print current state
#
set -euo pipefail
REPO="healwithshivanih-ads/healwithshivanih-ads"

if [ "${1:-}" = "--show" ]; then
  gh api "repos/$REPO/branches/main/protection" 2>&1 | sed -n '1,40p' || echo "main is not protected."
  exit 0
fi

# ── the required checks ─────────────────────────────────────────────────────
# CAVEAT — both workflows are PATH-FILTERED (web-ci on fm-database-web + catalogue
# paths; catalogue-ci on catalogue paths). A required check that does NOT trigger
# for a given PR sits "Expected" forever and blocks the merge. Two safe options:
#   (a) List them anyway and rely on GitHub treating a never-triggered required
#       check as skipped — this is NOT reliable across all repo settings.
#   (b) RECOMMENDED: keep required-checks EMPTY here and rely on
#       "require a PR + require branches up to date"; reviewers/agents watch the
#       checks that did run. Or add a tiny always-runs "ci-gate" job (no path
#       filter) that needs [verify, catalogue] and make ONLY that required.
# This script uses option (b): require PRs + up-to-date, no brittle per-check
# requirement. Add contexts to `CHECKS` below only after adding an always-on gate.
CHECKS='[]'   # e.g. '["ci-gate"]' once such a job exists

gh api -X PUT "repos/$REPO/branches/main/protection" \
  --input - <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ${CHECKS} },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

echo ""
echo "Branch protection enabled on main:"
echo "  • direct pushes to main are now rejected — use a PR"
echo "  • 'strict' requires the branch to be up to date before merge"
echo "  • enforce_admins is OFF, so you can still hotfix main directly if needed"
echo ""
echo "Next: to make catalogue-ci/web-ci HARD-required without the path-filter"
echo "'Expected' trap, add an always-runs 'ci-gate' job that needs both, then set"
echo "CHECKS='[\"ci-gate\"]' above and re-run. To undo entirely:"
echo "  gh api -X DELETE repos/$REPO/branches/main/protection"

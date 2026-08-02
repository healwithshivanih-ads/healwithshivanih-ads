# CI hardening & parallel work

Why this exists: catalogue-ci was failing ~2 in 5 runs and web-ci occasionally,
every failure landing on `main` and emailing failure notices. Root causes and
the fixes now in place are below.

## Root causes

1. **CI was a post-hoc alarm, not a gate.** `main` has no branch protection and
   the workflows run on push, so a red commit is already on `main` before CI
   fails — and you get the email.
2. **No local pre-push check** ran the exact CI gates, so collisions/regressions
   were discovered only after the push.
3. **A path-filter blind spot:** web-ci triggered only on `fm-database-web/**`,
   but 10+ web test suites read the Python catalogue. A catalogue-only change
   could break web tests, stay "green," and blow up on the next web commit —
   blaming the wrong author.
4. **The duplicate ratchet is tripped by design.** AI ingest generates aliases
   that collide with existing canonical slugs, so every large catalogue push
   tends to fail the ratchet, then get fixed in a follow-up.
5. **Several sessions push directly to `main` / share one working tree**, so
   they build on each other's broken states and can clobber each other's
   uncommitted work.

## What's in place now

- **Pre-push hook** (`.githooks/pre-push`) mirrors CI before a push leaves the
  machine: catalogue → `fmdb validate` + `duplicates --check-new` (+ `npm test`,
  since web suites read the catalogue); web → lint + type-check. Enabled per
  clone with `git config core.hooksPath .githooks`. Bypass once with
  `git push --no-verify`.
- **web-ci now also triggers on catalogue changes** (`fm-database/data/**`,
  `fm-database/fmdb/**`), closing the blind spot.
- **catalogue-ci ratchet is advisory on push, blocking on PR**
  (`continue-on-error: ${{ github.event_name != 'pull_request' }}`). New dupes
  still print in the log and are caught locally by the pre-push hook, but a
  push no longer fails (no more churn emails). The PR run is the hard gate.
- **`fmdb duplicates --fix-aliases`** mechanically strips the most common
  collision class (an alias equal to another entity's slug) at the source.
- **`scripts/enable-branch-protection.sh`** — the durable fix, ready to flip
  once the active authoring settles (see below).

## Working alongside other sessions (avoid losing work)

- **Use an isolated git worktree per session**, not the shared checkout:
  `git worktree add ../my-task -b claude/my-task origin/main`. This is the
  single biggest safeguard against clobbering another session's uncommitted
  edits. (Symlink the venv if a Python gate is needed:
  `ln -s <main>/fm-database/.venv fm-database/.venv`.)
- **Commit before you run destructive git** (`reset --hard`, `checkout --`,
  `stash drop`) — uncommitted work is what gets lost.
- Prefer a **branch + PR** over pushing to `main` directly.

## Turning on branch protection (the durable fix)

When the parallel authoring/agent sessions are done for now:

```bash
bash scripts/enable-branch-protection.sh          # apply (review it first)
bash scripts/enable-branch-protection.sh --show   # inspect current state
```

Read the caveat in that script about path-filtered required checks before
marking any check "required".

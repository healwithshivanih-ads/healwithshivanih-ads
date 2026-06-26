# Codex Audit — 2026-06-26 (recovered) + remediation tracker

**Auditor:** Codex (GPT-5, Codex Desktop) · read-only pass, no app files changed.
**Recovered from:** `~/.codex` session `019f01bb-4c66-75e0-a79a-3da246545e8a` ("Audit app for improvements") after the thread was deleted by mistake.
**Scope:** `/Users/shivani/code/healwithshivanih-ads` — full coach ops system + The Ochre Tree client PWA, WhatsApp, intake, lab orders, reminders, handouts, recipes, supplements, token-gated public surfaces.

## Health checks Codex ran
- `npm run type-check` — **passed**
- `npm test` — **passed** (8 files, 128 tests at the time)
- `npm run build` — **stalled** after "Creating an optimized production build…" (~90s silent)
- `npm run dev` — starts but throws repeated **`EMFILE: too many open files`** (Watchpack)

Visual UI inspection was blocked twice (local Basic Auth, then the watcher/file-limit issue), so findings are grounded in code, docs, and the passing type/test checks. The May-20 UI/UX audit was treated as baseline, not re-flagged.

## Remediation tracker

| # | Finding | Status |
|---|---------|--------|
| 5 | Stale auth comments (recipes page + middleware said "slug/none") | ✅ done — commit `8425a9a9` |
| 2a | Middleware logic made testable (`decideGate()` + 53 boundary tests) — survives a future proxy migration | ✅ done — commit `8425a9a9` |
| — | PHI backup/DR for `~/fm-plans` | ✅ done — commit `8425a9a9` |
| 3 | Replace in-memory `Map` rate limits with a persisted store | ✅ done — see below |
| 4 | Token-admin UI (issued / last-opened / expiry / revoke) | ✅ done — see below |
| 1 | EMFILE / build reliability | ⬜ open |
| 2b | The actual `middleware.ts` → Next 16 `proxy` migration | ⬜ open |
| 6 | Split the 4 giant files (intake-form, assess-client, client-app, plan-editor) | ⬜ open |

### #3 Persistent rate limits — done 2026-06-26

Codex named two routes (`app-copilot`, `app-checkin`); in fact **9** public client-app
write routes had the identical copy-pasted in-memory `Map<token,{day,count}>` daily
throttle that resets on every restart/redeploy: `app-checkin`, `app-copilot`, `app-msq`,
`app-travel`, `app-travel-guide`, `app-photo`, `app-practice`, `app-swap`, `app-body`.

Fix: one shared helper `src/lib/fmdb/rate-limit.ts` — `allowDaily(bucket, token, limit)`.
In-memory hot map mirrored to a single JSON sidecar (`<plansRoot>/_rate_limits.json`,
atomic tmp+rename, write-serialized) loaded once on cold start, so a restart no longer
zeroes the counter. Fails open if the sidecar is missing/corrupt (a counter file must
never lock a client out of their own app). All 9 routes now call the helper; per-route
limits unchanged (4–40; copilot keeps its `DEFER` response instead of 429).

Tests: `src/lib/fmdb/rate-limit.test.ts` (count semantics, bucket/token isolation,
**survives-restart** reload, fail-open on corrupt sidecar). `npm run type-check` clean;
full suite 194 tests green.

Note: counts are per-instance (one PM2 on the Mac, one Fly machine) — a file sidecar is
sufficient; no cross-instance store (Redis/Upstash) is warranted at this scale.

### #4 Token-admin UI — done 2026-06-26

New coach route **`/token-admin`** (Settings → "🔑 Token links") enumerating every
public bearer URL across all clients + plans: the 4 token kinds (`app`, `letter`,
`intake`, `start_confirmation`) with derived status (active / expired / finalised /
submitted / used), expiry, first-opened (intake), what each unlocks, a masked token,
copy-link / open, and a **revoke** button.

- `src/lib/fmdb/token-admin-types.ts` — pure `buildIssuedTokens()` flattener (no fs, no
  "use server"), unit-tested in `token-admin-types.test.ts`.
- `src/lib/server-actions/token-admin.ts` — `listIssuedTokens()` (reads via
  `loadAllClients`/`loadAllPlans`) + `revokeToken({kind, clientId?, planSlug?})`
  dispatcher. intake + start_confirmation reuse the existing revoke actions; app +
  letter are new: clear the field on disk + re-stage so the public Fly host drops it.
- `src/app/(v2)/token-admin/{page,token-admin-client}.tsx` — server page + table.

Caveats: "last opened" only exists for intake (`intake_first_opened_at`, first open
only) — no rolling last-access is tracked for any token; the table shows what exists.
The app/letter revoke writes locally and re-stages via the same `app-staging-action.py`
path the issue flow uses; **its propagation to the Fly public host should be smoke-tested
on the next deploy** (the worktree can't reach Fly). Verified here via type-check +
unit tests (201 green); visual pass deferred — the dev server is EMFILE-flaky on this
machine (finding #1).

## Coach/user side (Codex, not yet actioned)
- Make the dashboard ONE "what needs my attention now" queue, not many equal-weight panels.
- "Today's clinical risk" strip: medication changes, red flags, lab abnormalities, missed check-ins.
- Unified client timeline: WhatsApp + sessions + check-ins + app actions + lab orders + plan changes.
- "Ready to send?" safety checklist before plan/package/message send.
- Global search across clients, messages, plans, labs, supplements, files.

## Client side — The Ochre Tree PWA (Codex, not yet actioned)
- Clearer "what changed" when the coach updates a plan.
- Make token/session status visible: "This plan link is active until / revoked when…"
- Offline/error states for every write-back action (check-ins, body measurements).
- Tests for the copilot defer/emergency gates.
- Client privacy/settings screen: photo, reminders, data shared with coach, revoke device.

# Short share links for forms (and letters) — Part 2 spec

**Status:** spec'd 2026-06-05, to build. Part 1 (stable per-plan letter_token on
/recipes + /supplements) is already shipped (commit 0b49c32).

## Goal
Shorter, nicer URLs to share over WhatsApp instead of the long 32-char token
URLs — e.g. `intake.theochretree.com/s/k7Qm2P` instead of
`…/intake/QBQ-QUiOWEJFgWR8OK7o8YDYFvp13s1a`.

## Hard rule
The short code MUST be a **random secret, NOT a readable/guessable string**
(no `firstname-…`). The intake form collects PHI on submit and the letter shows
PHI, so a guessable short code would recreate the exact exposure the audit
flagged. ~7 random base62 chars (~42 bits) is plenty for this practice size,
collision-checked on generation.

## Design
1. **Short-code field** alongside each token:
   - `client.intake_short_code` (issued when the intake token is generated).
   - `plan.letter_short_code` (optional, issued with letter_token) for letters.
2. **Redirect routes** (same Next app, so they work on the Fly intake host):
   - `/s/[code]` → look up the client whose `intake_short_code === code` → 302 to
     `/intake/<intake_token>`. (Or `/start/<token>` depending on stage.)
   - `/l/[code]` → look up the plan whose `letter_short_code === code` → 302 to
     `/letter/<letter_token>`.
   - 302 is fine here — the destination is itself a secret token URL, so the
     redirect doesn't leak anything guessable (unlike the /recipes-slug case).
3. **Middleware:** add `/s/` and `/l/` to `PUBLIC_PATH_PREFIXES` so they're
   reachable on the Fly intake-only host.
4. **Share UI:** the existing WhatsApp share buttons (intake invite, letter send)
   emit the short link instead of the long token URL.

## Lookup implementation
Mirror `lookupLetterToken`: scan clients/published plans for the matching short
code. Cheap at this scale. (Or maintain a tiny `_short_links.yaml` index map
`code → {kind, token}` if scanning ever gets slow.)

## Build checklist
- [ ] generate + store `intake_short_code` in the intake-token issue path
      (intake-token-action.py / generateIntakeToken)
- [ ] generate + store `letter_short_code` in ensureLetterToken (optional)
- [ ] `/s/[code]` + `/l/[code]` redirect routes
- [ ] middleware allowlist `/s/`, `/l/`
- [ ] share buttons emit the short link
- [ ] collision check on code generation
- [ ] Fly deploy (forms live on the Fly host) + smoke test the redirect

## Effort / risk
~Half a day. Touches the Fly-deployed intake host, so needs a `flyctl deploy` +
a redirect smoke test — best done as a focused piece, not bolted onto a long
session.

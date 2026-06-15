# Lab Vault — client-facing lab markers in the app — spec

**Status:** spec'd 2026-06-15. **Phase 1 (shared logic + view-model) built &
verified 2026-06-15** — `src/lib/fmdb/lab-vault.ts`; type-check + build clean,
coach app restarted, no behaviour change. Phases 2–6 pending. Core design
decisions closed; the open decisions below still apply to the discovery tier
(Phases 3–5).

## The core idea

Surface each client's lab markers inside The Ochre Tree app, shown against **two
yardsticks**: the standard lab "normal" range, and the tighter functional-optimal
range. That gap — "your doctor said fine, here's where you'd actually feel best" —
is the FM value proposition made visible. No one else in the client's life shows
them that.

Almost all of this exists server-side already (`health_snapshots`,
`lab_reference_ranges`, the 152-marker `lab_tests` catalogue with both range sets,
the 4-state status dot, the sparkline code in `health-trends.tsx`). The build is
mostly **reading existing data back** into a new client-app surface — not new
infrastructure.

Two audiences, **one screen, tiered**:

- **Discovery client** (free): vault + FM-optimal flags + retest reminders. No
  plan. This is a lead-nurture / reconnect engine — a push-enabled surface on
  their home screen that you control.
- **Plan client**: the same screen + plan linkage + recheck loop + coach context.

The free tier is deliberately incomplete: it shows the *gap* but withholds the
*fix* (the plan = paid, and also the coaching-scope line). The reminders are what
pull a discovery client back to book.

## Scope guardrail (non-negotiable)

NBHWC/FMCA: educate, never diagnose / prescribe / interpret labs. Every string is
education-framed. The FM-optimal range is presented as *"where many people feel
their best — a conversation starter for our session, not a diagnosis."* Any
AI-generated interpretation copy obeys the no-hallucination rule: state only
on-file facts, defer to "Shivani will confirm." See
[feedback_no_hallucinations_in_client_letters].

## Decisions locked

- Two-band range bar: sage = functional-optimal, gray = standard normal, the
  client's value pinned on top. This is the core visual.
- Status language is amber-not-red: "In optimal range" / "Worth exploring."
  Never "abnormal" / "red." This is the anxiety guardrail in the design language.
- Trend sparkline appears with ≥2 snapshots; bands-only with 1.
- Tiered, same screen. Discovery = vault + flags + retest reminders, no plan.
  Plan client = that + plan linkage + recheck + coach context.
- Pinned section on top, two modes:
  - Plan client → **"What we're working on"** — populated by plan-targeted
    markers, each links to the protocol.
  - Discovery → **"Worth exploring together"** — populated by out-of-optimal
    markers; leads with the positive count ("4 in optimal · 2 worth exploring");
    CTA footer ("Bring these to a discovery call →"); NO clinical
    pre-prioritization (the prioritization is the value of the call).
- Same `LabCard` component everywhere; one `PinnedSection` component, two modes.
- The "slot card" below the list: discovery = upload/book CTA; plan = "next
  retest" prompt.

## Open decisions — answer before Phase 1

1. **Which markers show.** Recommend: everything on file, grouped by system
   (Thyroid / Metabolic / Iron / Inflammation / Hormones / Nutrients / Other).
2. **Entry point.** New "Labs" tab in the app vs a section in an existing tab.
   Lean: new tab.
3. **Anxiety control.** Is global gentle framing enough, or also a per-client
   coach toggle to soften/hide specific markers?
4. **Discovery upload.** Do discovery clients self-upload (manual, free), or does
   the coach upload once at discovery? (bounds cost + abuse)
5. **Discovery data on Fly.** Discovery `client.yaml` + `health_snapshots` must be
   reconciled to Fly for the vault to render there — today's reconciler carries
   only *active intakes* (`~/fm-plans-staging`). Extend it, or scope discovery
   vaults to Fly-resident data.

## Cost model

The cost is a **one-time event per upload**, never ongoing:

- Reading a lab (OCR → structured values) is one API call. Normal panel via Haiku
  ≈ ₹1–3; a large functional panel (DUTCH/GI-MAP) via Sonnet ≈ ₹10–25.
- Everything after — viewing, bands, sparklines, trends, reminders — is **zero
  API**, pure rendering of data already on file.
- Levers to drive the free tier to ≈₹0: manual entry (no AI); a lean **labs-only**
  extractor (no symptom catalogue loaded, unlike `extract-symptoms.py`);
  cap N uploads/month for free users; or coach does the discovery upload once.

The real risk is not cost-per-upload (trivial) but *uncontrolled upload volume*
from non-paying users — bound it with caps + manual-entry-as-default-free-path.

---

## Phase 1 — Foundation: shared lab logic + view-model (no UI)  ✅ DONE 2026-06-15

Built in `src/lib/fmdb/lab-vault.ts` (pure; type-only server imports so it's safe
in the client bundle). `health-trends.tsx` now imports the range primitives from
it — single source of truth, behaviour unchanged.

- [x] Port `findCatalogueLabTest` + `rangeStatus` (4-state) out of
      `health-trends.tsx` into a shared pure module usable by coach UI AND client app
- [x] Define `LabMarker` view-model: value, unit, date, conventional + FM-optimal
      bounds, status, system group, interpretation, trend points, `targetedByPlan`,
      `unitMismatch`
- [x] System-grouping map — keyed off `LAB_PANELS` (`lab-panels.ts`), NOT a
      catalogue category (the lab_test YAML has no category field). Non-matching
      markers → "Other".
- [x] Pinned-section population: `buildLabVault({mode})` — plan mode = markers
      matching `targetedMarkers` (Phase 2 wires these from `plan.lab_followups`);
      discovery mode = status `explore`
- [x] Trend builder: per-`test_name` series across snapshots, sorted, `hasTrend`
      at ≥2 points
- [x] Edge handling: unknown marker → `no_reference` (value only); unit mismatch →
      `unitMismatch` flag + status forced `no_reference` (don't assert on
      mismatched units)

Client-facing status is 2-state by design (`optimal` / `explore` /
`no_reference`) — amber-not-red baked in. Display helpers `clientStatusLabel()` +
`vaultSummaryLine()` (lead-with-positive) ship for both tiers' UI.

## Phase 2 — Client-app Labs tab (read-only render)  ✅ BUILT 2026-06-15 (not yet on Fly)

Built + verified on the dev server against real client data (cl-005 Hariharan).
Plan mode only (discovery mode is Phase 3+). New files/edits:
`app/[token]/ochre-labs.tsx` (the screen), `labVault` added to `ClientAppData` +
built in `loadClientAppData` (self-contained `loadLabCatalogue`), `flask` nav
icon + 5th "Labs" bottom-nav tab. type-check + build clean; localhost restarted.
**Not yet deployed to Fly** — awaiting coach go-live decision.

- [x] New tab/route in `/app/<token>` shell — 5th bottom-nav tab "Labs"
- [x] Education banner + sage/gray legend
- [x] `LabCard` (bands + value pin + status pill + sparkline + readout) — matches mockup
- [x] Grouped lists by system (via `LAB_PANELS`); pinned markers de-duped out of groups
- [x] `PinnedSection` "What we're working on" (plan mode). Discovery mode supported by
      `buildLabVault` but not wired in this slice.
- [ ] Slot card: discovery CTA / plan "next retest" prompt — DEFERRED (not in thin slice)
- [x] Interpretation copy — DECIDED NOT to show catalogue clinical interpretation to
      clients (scope + leak safety). No scrubber needed; the only text is computed
      (value, bands, status pill, trend caption). Revisit for a plan-tier coach note later.
- [x] Empty states: no labs (CTA card) + all-optimal (celebratory); single-snapshot
      handled by the `hasTrend` guard (no sparkline)

**Runtime fix caught in verification:** `normUnit` was flagging false unit
mismatches (`uIU/mL` vs `mIU/L`, `µmol/L` vs `umol/L`) and suppressing TSH +
homocysteine. Fixed: micro-sign → `u` + the `µIU/mL ≡ mIU/L` equivalence. Both
markers now show the band comparison correctly.

**Refinement (coach request, same day):** every section is collapsible (chevron;
sections with flagged markers default-open, all-optimal collapsed, header shows
"N worth exploring"). System groups are ordered by the client's concern areas
(conditions + goals) via `SYSTEM_CONCERN_HINTS` in `lab-vault.ts`, AFTER the
pinned "worth exploring" section — concern-relevant first, then by flagged-marker
count, then alpha; "Other" always last. `concernTerms` flows in from
`loadClientAppData`.

**Tier-aware wording (coach request):** active/plan clients must NOT see "Worth
exploring" (that's discovery's conversion framing — they're already in care).
`LabVault.mode` now drives the vocabulary: plan tier → pill **"Working on it"** +
count **"N we're working on"** (echoes the "What we're working on" pin); discovery
tier keeps **"Worth exploring"**. Helpers `clientStatusLabel(status, mode)` /
`vaultSummaryLine(summary, mode)` / `exploreNoun(mode)` in `lab-vault.ts` — one
place to swap if the coach wants different words. The client app is plan-mode, so
all current clients see "Working on it".

## Phase 3 — Data entry / upload

- [ ] Manual entry in-app (port `HealthDataEditor` pattern) — free, zero API
- [ ] AI-OCR path: lean labs-only extractor on Haiku; capped N/month for
      discovery, unlimited for coach
- [ ] Confirm/edit-before-save step (never silently trust OCR)
- [ ] Write-back via `update-client-data.py` — append snapshot, dedupe
      same-date+source, tag source (`client_upload` / `coach_upload` /
      `discovery_upload`)

## Phase 4 — Reminders / reconnect engine (the lead-gen part)

- [ ] Retest rule: plan clients → `effectiveRecheckDate`; discovery → cadence
      since last snapshot
- [ ] Delivery via existing PWA push (`/api/app-push`, SW `/ochre-app/sw.js`) + a
      WhatsApp template (register via `whatsapp-server/scripts/submit-templates.js`,
      never the Meta dashboard) [feedback_whatsapp_template_registration]
- [ ] Discovery conversion nudge ("X still worth exploring → book"), gated +
      frequency-capped
- [ ] Coach dashboard chip: active discovery vaults + who's due

## Phase 5 — Access / security / deploy

- [ ] **Token-gate the Labs route** — PHI, and the open security item from the
      codebase audit [project_codebase_audit]. Verify before exposing anything.
- [ ] Discovery `client.yaml` + snapshots reconcile to Fly (extend reconciler, or
      scope discovery vaults to Fly-resident data)
- [ ] Tier gating server-enforced (plan features not merely hidden in UI)
- [ ] Deploy client app to Fly; `npm run build` + `pm2 restart fm-coach
      --update-env` for coach-side pieces; verify on a real phone (add-to-home +
      push permission) [feedback_always_deploy_after_code_changes]

## Phase 6 — QA / scope / anxiety

- [ ] Scope copy review: every string education-framed, "Shivani will confirm"
      fallback, no diagnosis/prescription
- [ ] No-hallucination check on any AI interpretation copy (on-file facts only)
- [ ] Anxiety pass: amber-not-red, lead-with-positive counts, per-client soften
      toggle if chosen
- [ ] Test matrix: discovery × plan; 0/1/many snapshots; unknown marker; unit
      mismatch; all-optimal; many-out-of-optimal

## Invariants for future sessions

- The vault NEVER states a plan for a discovery client — it invites a
  conversation. Pin label is "Worth exploring together," never "we would work on
  this" (scope + over-claim + removes the reason to book).
- Discovery tier withholds the fix on purpose. Don't "helpfully" add intervention
  guidance to the free tier — that's the conversion line AND the scope line.
- Lab data is PHI on a public-ish route. The token gate is load-bearing, not
  optional polish.
- Display is free; only OCR upload costs. Keep manual entry as the zero-cost path.

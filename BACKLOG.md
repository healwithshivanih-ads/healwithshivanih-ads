# Benched / parked features

Tracked separately from CLAUDE.md's status log so this file stays focused on
the queue. Items here have been explicitly deferred — listed roughly by area.
When picking one up, move its entry to a v0.x commit message and delete it
from this file.

Last updated: 2026-05-15

---

## /assess (Analyse panel)

### UI polish
- **Auto-collapsing input steps** — collapse each step to a 1-line summary chip once filled ("4 symptoms picked", "3 lab values entered"). Reduces left-column scroll length.
- **"AI's one-sentence read"** — single-line synthesis at the very top of the right column, before all the detailed cards (e.g. *"Primary picture is HPA-axis-dysregulation + insulin resistance driving the fatigue + central adiposity."*).
- **"What changed since last session"** chip at top of synthesis column — delta of BP / weight / new symptoms vs previous session.
- **Differential view** for likely root causes — top 3 ranked with confidence bars + click-to-expand evidence.
- **Action queue** — each AI suggestion gets a checkbox; checked items batch-flow into the generated plan / labs ordered / referrals made instead of needing manual transfer.

### Upload flow
- **Prior-transcript picker** — surface previous session transcripts on the Uploads card so coach can attach an earlier one ("use transcript from 2026-04-29 session") instead of re-uploading. Equivalent to the lab "files already on this client" picker already shipped.
- **Unified upload box with AI classifier** — replace the four separate upload panels (transcript / lab / functional test / genetic / other reports) with one upload zone. AI classifies the document and routes to the right pipeline. Bigger redesign — needs an AI routing layer on the backend.

---

## /clients (Client overview)

- **Multiple draft plans** — `activePlan = plans.find(...)` currently shows only the first matching plan. If coach has more than one draft for the same client, the rest are invisible. Either surface a "N other drafts" picker or change to "most recent".
- **Session notes PDF export** — clean PDF of session notes shareable with a referring doctor or specialist.

---

## Catalogue

- **Additional lab markers** — still pending (not yet shipped):
  - **Mycotoxin urine panel** — water-damaged-building / mould exposure
  - **Heavy metals panel** — Hg / Pb / As / Cd
  - **EBV reactivation panel** — post-viral fatigue clients
  - **Salivary cortisol curve full panel** — already a single lab; expand to AM/midday/PM/night with FM optimal curves

- **Additional curated mindmaps** — coach can flag conditions where she wants the AI to have explicit pathway context:
  - Migraine + headaches
  - IBS (vs already-existing gut-health)
  - Acne / hormonal skin
  - Anxiety / panic (vs existing emotional-wellbeing)
  - Insulin-resistant hair loss / androgenic alopecia
  - Long COVID / post-viral fatigue

---

## /plan

- **Multi-coach support** — currently `updated_by: shivani` is hardcoded. When other coaches join, need a `coach_id` selector + per-coach branding on letters.
- **Inline plan editor on client page** — instead of navigating to `/plans/[slug]`, expand the editor inline on the Plan tab. Faster session workflow.
- **Bulk regenerate letters** — when the plan changes after letters were generated, surface a "regenerate all letters" button instead of clicking each.

---

## Backend / engine

- **Smart-merge evidence_tier handling** — currently `--update` smart-merge will downgrade `evidence_tier` to the weaker value if the new candidate is weaker. Should never downgrade unless `--overwrite`.
- **AI sanity check broader coverage** — currently flags coherence / client-fit / translation accuracy. Add: protocol-sequencing realism (don't suggest 8 supplements at once for a newly intolerant gut), regional availability (don't suggest grass-fed beef to a vegetarian client even by accident).
- **Plan-check field-name compat** — `tracking.monitor_symptoms` vs Pydantic's `symptoms_to_monitor`: fixed at read time in render-client-letter.py but should be normalised at write time too.

---

## Operational

- **Order-through-coach for VitaOne supplements** — phased plan in CLAUDE.md (waiting on VitaOne partner-API reply).
- **WhatsApp inbound** (when AiSensy plan upgrades) — currently inbound is manual paste via Message Capture Panel; webhook handler exists but skipped on free tier.
- **`fm_checkin_nudge` template** — pending AiSensy review; works automatically once approved.
- **Validator integration of new lab tests** — 25+ lab_tests added in v0.63 and v0.66+; ensure validator's pending-refs run shows clean.

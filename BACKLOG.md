# Benched / parked features

Tracked separately from CLAUDE.md's status log so this file stays focused on
the queue. Items here have been explicitly deferred — listed roughly by area.
When picking one up, move its entry to a v0.x commit message and delete it
from this file.

Last updated: 2026-05-12 (post v0.68 — v1→v2 migration FULLY complete. Every v1 URL now redirects to its v2 equivalent. Zero v1 surfaces are reachable through normal navigation.)

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
- **Session notes PDF export** — `SessionBriefModal` shipped 2026-05-12 in v2 Sessions (`📄 Brief / Print` button) + v1 client-tabs. Print CSS isolates `#session-brief-print`, so Cmd+P → clean A4. Optional follow-up: also mount on the v2 Plan tab and Communicate tab if coach wants to print without leaving those surfaces.
- **🧠 Memory panel** — small card on overview that surfaces what the AI has learned about this client via plan-chat (last N writes to `foods_to_avoid` / `non_negotiables` / `reported_triggers` / `dietary_preference`). Currently the only signal is the per-turn 👤 chip in the chat; coach can't see the cumulative profile at a glance.
- **Pre-session brief on Sessions tab** — `<PreSessionBrief>` is mounted on v2 overview (2026-05-12). Cheap second mount on `/clients-v2/[id]/sessions` so coach can launch it from where she's reviewing prior session history. ~10 min.

---

## Catalogue

- **Expand lab_tests catalogue** — ~30 missing FM markers identified during the v0.64 mindmap mining pass: ApoB, Lp(a), oxidized LDL, fibrinogen, Lp-PLA2, MPO, LH/FSH ratio, free / total testosterone, SHBG, AMH, prolactin, 17-OH progesterone, salivary cortisol curve, DUTCH metabolites (oestrone / oestriol / 2-OH / 4-OH / 16-OH / cortisol / cortisone), organic acids (OAT) markers, CoQ10 status, carnitine profile, lactate, ESR, PTH, CTX, P1NP, alkaline phosphatase, urinary calcium, mycotoxin urine, EBV / viral panel, heavy metals panel, food sensitivity IgG, GI-MAP. Each gets a YAML in `data/lab_tests/` with `conventional_low/high` + `fm_optimal_low/high` + India `typical_cost_inr`. ~2-3 hours; can agent-parallelise per panel.
- **Add missing FM mechanisms** — 7 referenced in mindmaps as free-text but not canonicalised: `hla-genetics-immune-tolerance`, `ebv-reactivation`, `sympathetic-overdrive`, `late-light-melatonin-suppression`, `cortisol-awakening-response`, `post-viral-fatigue`, `pacing-energy-envelope`. ~1 hour to seed all 7 with summary + parent mechanisms + linked topics.
- **Re-run catalogue cleanup tool** — `/catalogue/cleanup` last ran in v0.64. New ingest since may have introduced new duplicates / miscategorisations. Re-run + triage. ~1 hour.
- **Promote freeform → catalogue entities** — Practice, TrackingHabit, Food, LabTest, Recipe, EducationalModule. Watch for duplication in real plans first; only promote when ≥3 plans repeat the same string.
- **Commit pending `fm-database/data/` YAML changes** — check `git status` from `fm-database/` and commit any uncommitted catalogue edits before they accumulate. ~5 min.

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
- ~~**v2 plan editor (Phase 4.5)**~~ — shipped 2026-05-12 as Phase 2 of the v1→v2 migration. /clients-v2/[id]/plan/edit/[slug] mounts the existing v1 PlanEditor (verbatim, no fork) inside the v2 shell. All Edit-in-classic CTAs across v2 surfaces now point here.
- **Inline plan editor on client page** — alternative / overlapping with v2 plan editor: expand the editor inline on the Plan tab instead of navigating. Pick one approach.
- **Bulk regenerate letters** — when the plan changes after letters were generated, surface a "regenerate all stale letters" button on v2 Communicate (right above SendPackageButton, only when staleness banner is showing). Coach currently has to re-tick each type. ~20 min.
- **Notes-for-coach formatting** — `notes_for_coach` renders as a wall of text. Coach wants it structured (subheadings, bullets). Either (a) extend the AI prompt in generate-draft.py and the chat tool to emit markdown-friendly structure, OR (b) parse it on render. Open question: should the AI structure it from the start, or should the human structure it during the chat session?
- **Letter QA validation report viewer** — the Haiku letter QA pass writes `{stem}.validation.json` alongside saved letters. Surface a viewer that shows which tips it rewrote + why, so coach can audit the QA. Currently the data is on disk but no UI reads it.

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
- **Persistent public URL** — `cloudflared tunnel --url http://localhost:3002` if coach wants the app reachable from her phone / outside Wi-Fi. ~15 min infra; only needed if remote access becomes a real workflow.
- **Client letter design finalisation** — review `hariharan-plan-3-2026-05-06-cl-005.html` and decide on layout / branding changes. Human review task, can't be coded.

---

## UI polish (low priority — pick up when bored)

- **Mindmap node click-to-recenter** — clicking a linked node on `/mindmap/[slug]` should recenter the Mermaid diagram on that node, not just navigate to its catalogue page.
- **Plan diff split colored view** — current `plan-diff` viewer is unified diff (green +, red -). Side-by-side split view is easier to scan.
- **Backlog pagination** — `/backlog` lists everything in one scroll; paginate to 50/page once it grows past ~200 open items.
- **Health trends chart axis labels** — sparklines have no Y-axis labels; date axis would help.
- **JSON export contract for Project 2 (client mobile app)** — explicitly deferred indefinitely per CLAUDE.md ("desktop-first").

# Dirty Genes screen → app/programme build spec

Status: **validated on 4 real clients, build on hold pending go-ahead.**
Author: coach-side pathway-burden tool (see `project_dirty_genes_screen_tool` memory).
Prereq shipped: coach-side screen tool (questionnaire + pure scorer + genetics overlay)
at `fm-database-web/src/app/(v2)/clients-v2/[id]/dirty-genes/*`,
`src/lib/fmdb/dirty-genes.ts`, `fm-database/data/dirty_genes_assessment.yaml`.

## 1. What the 4 validation cases proved

Every client's true priority was **under-called by the symptom quiz alone** and only
correct once their existing record (labs / conditions / triggers) was read in.

| Client | Symptom-quiz top | True priority (record) | Gap exposed |
|---|---|---|---|
| Hariharan cl-005 (M) | COMT moderate | **MTHFR + NOS3 HIGH** — Hcy 22, TSH 8.3, HTN, LDL 143 | **Lab overlay** |
| Geetika cl-006 (F) | DAO 75% (only when hand-mapped) | **DAO HIGH** — "histamine intolerance" named condition, Allegra daily, food+heat triggers | **Symptom/condition overlay** |
| Niti cl-014 (F) | COMT 66% HIGH | + **MTHFR HIGH** (Hcy 15.98, functional B12 low); **PEMT mild** (vegetarian choline); PCOS→estrogen items fired | Lab overlay + female items work |
| Sudarshan cl-008 (M) | PEMT/GST mild | **PEMT HIGH** (NAFLD grade II — the hallmark); **NOS3** (LDL 172/ApoB 124); ⚠ **CKD eGFR 59 + PPI** | Lab overlay + **safety gate** |

**Core principle:** the client's record already holds the answers. The screen must
**pre-flag pathways from existing data and let the coach confirm** — never rely on
re-ticking from memory. Coach confirms/edits; nothing auto-writes to the plan.

## 2. Build components

### A. Lab-signal overlay  (new: pure module `dirty-genes-labs.ts`)
Map key markers from `client.health_snapshots` → pathway escalation. Escalation raises
the displayed band and adds a "🔬 lab" chip; it never silently rewrites the questionnaire.

Encode per-pathway in `dirty_genes_assessment.yaml` as `lab_signals`:
```yaml
# under pathways[id=mthfr]
lab_signals:
  - marker_match: [homocysteine]
    op: ">"  ; value: 10 ; unit: umol/L
    escalate_to: high
    note: "Elevated homocysteine — methylation cycle under strain"
  - marker_match: [vitamin b12] ; op: ">" ; value: 900
    escalate_to: moderate
    note: "High B12 with high homocysteine = methylation not running"
```
Seed set (from the 4 cases): homocysteine→MTHFR; B12-high+Hcy-high→MTHFR;
TSH>4→MTHFR (hypothyroid blunts B2); BP/HTN + LDL/ApoB/TG/hsCRP→NOS3;
NAFLD markers (ALT/GGT/USG note)→PEMT; HbA1c/HOMA-IR→NOS3 context; CRP→GST.

### B. Symptom/condition overlay  (new: pure module, `tier1-advisory.ts` pattern)
Regex/keyword-scan `active_conditions`, `reported_triggers`, `foods_to_avoid`, and
recent session narrative → pre-tick matching questionnaire items + add "📋 from record"
provenance. This is the Geetika fix.

Encode per-item or per-pathway as `condition_signals`:
```yaml
# under pathways[id=dao]
condition_signals:
  - match: ["histamine intolerance","antihistamine","allegra","hives","urticaria","flush"]
    ticks: [dao_food_react, dao_flush]
    note: "Histamine intolerance documented in record"
  - match: ["multiple food intolerance","leftover protein","aged cheese","fermented"]
    ticks: [dao_gut, dao_leftovers]
```
Mirror the `tier1-advisory.ts` scanner (pure fn over the raw client dict, returns
provenance snippets). Reuse `_coerceText` / `_firstMatch` helpers.

### C. Genetics overlay  — **built.** `matchGenetics()` in `dirty-genes.ts`; reads
`functional_tests/*.yaml` where `test_type: genetic`. Nudge, never verdict.

### D. Safety / contraindication gate  (reuse existing)
Before showing pathway supplement suggestions, gate them against the client's meds +
renal/hepatic flags. Sudarshan proves it: CKD eGFR 59 → suppress nephrotoxic + high-dose
protein items; PPI → flag B12/Mg. Reuse `checkMedicationImpactsAction` +
`fmdb/plan/checker.py` contraindication logic — do NOT re-implement.
Also apply the **project protein rule** (renal/urate-flagged → protein suppressed).

### E. Sequencing rules  (data, surfaced in results)
Encode per-pathway `sequencing` notes the results panel shows verbatim:
- MTHFR: "lead with riboflavin, titrate methylfolate LOW, niacin rescue in reserve —
  more so if slow-COMT (Hariharan, Niti) or hypothyroid (blunts B2)."
- MAOA/COMT: "no serotonin-precursor loading (5-HTP/tryptophan/melatonin) on an SSRI
  (Deepti cl-011) or slow MAOA."
- NOS3: "clean upstream genes + homocysteine first; NOS3 often self-corrects."

## 3. How it plugs into the programme

```
Full Assessment / recheck (complex multi-system clients only)
  → open Dirty Genes screen
  → auto-prefilled: lab overlay (A) + condition overlay (B) + genetics (C)
  → coach reviews/edits ticks  ← human in the loop, always
  → results: ranked pathways + sequenced interventions, gated by safety (D,E)
  → one-click "add pathway interventions to plan draft" (suggestions, coach approves)
  → flagged pathway sets its lab as a tracked recheck marker (e.g. homocysteine)
  → next phase-letter reads the delta
```
It is a **lens on the existing arc**, not a new programme or enrolment track.

## 4. Client-app surface (later phase, guarded)
Ochre Tree `/app`: **no SNP / "dirty genes" language, no labs, no grams.** A warm,
coach-approved-before-visible "what your body's leaning into this season" note derived
from flagged pathways, food-first (e.g. "leaning on leafy greens, beets and B-rich foods
for energy and circulation; calm evenings for sleep"). Consistent with the
warm/food-first/labs-coach-mediated house stance.

## 5. Phasing
- **P1 (done):** coach-side screen + pure scorer + genetics overlay.
- **P2 (next):** lab overlay (A) + condition overlay (B) + safety gate (D) + sequencing (E)
  → auto-prefill + coach-confirm. Ship as coach-side only. *Highest value — this is what
  the 4 cases proved.*
- **P3:** feed pathways into the assess suggester + "add to plan draft".
- **P4:** client-app warm note (§4).
- **P5 (optional):** client self-screen questionnaire for complex cases (was explicitly
  NOT a default intake item — keep ad-hoc).

## 6. Guardrails (non-negotiable)
- Coaching screen, **not** a genetic/medical diagnosis. Educate lifestyle; refer for
  labs/meds (homocysteine/BP/thyroid/renal stay MD-managed).
- Overlays **suggest**; the coach confirms. Nothing auto-edits the plan.
- Genetics = nudge, never verdict; never changes a band on its own.
- Safety gate is mandatory before any supplement suggestion renders.
- Pure modules only for scoring/overlays (no fs) so they run live client-side, mirroring
  `dirty-genes.ts` / `tier1-advisory.ts`.
```

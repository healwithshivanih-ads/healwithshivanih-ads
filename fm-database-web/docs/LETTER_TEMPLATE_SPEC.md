# Client Letter Template Spec

**Status:** agreed with coach 2026-06-04. This is the source-of-truth contract for
what goes in which client letter. `render-client-letter.py` (prompt builders +
deterministic injection) should be kept in sync with this. When the two disagree,
this doc wins — fix the code.

The whole point: stop populating letters ad hoc. There are exactly **two
archetypes** — the FIRST letter and the FORTNIGHT (follow-up) letter — and every
section has one defined owner (the AI narrative **or** the Python injector), so
nothing is written twice.

---

## Golden rules (apply to every letter)

1. **One owner per section.** If Python injects a section (Daily Routine, plate,
   supplement schedule, shopping list), the AI prompt must NOT also ask for a prose
   version of it. Duplication = the AI re-writing what Python injects.
2. **Diet-aware always.** No flesh foods / eggs in any section (AI prose OR Python
   injection) for vegetarian / Jain / vegan clients. See
   `feedback_veg_safety_no_meat_in_templates`.
3. **Reference detail lives in the FIRST letter only.** The bulk supplement
   reference (full schedule table + complete shopping list with weekly math) is a
   first-letter thing. Follow-ups don't repeat it.
4. **The day schedule travels with every letter.** The Daily Routine ("what to
   take when", beside each meal) appears in EVERY letter because supplements change
   as the weeks progress — the client must always have the current day's plan.
5. **Any new/changed supplement in a follow-up carries its purchase link** + a
   one-line why. The client must be able to act on the change without hunting.

---

## LETTER 1 — "Your Plan" (comprehensive, sent once at start)

Replaces the old 3-document package (consolidated + supplement_plan +
lifestyle_guide), which overlapped itself. One letter, this order:

| # | Section | Owner | Notes |
|---|---------|-------|-------|
| 1 | Welcome + your story / root cause / why this plan | AI | warm, 2–3 short paras; root cause in plain English |
| 2 | 📋 Your Daily Routine (day schedule) | Python | supplements beside each meal/time; weeks 1–2 window |
| 3 | 🍽 Building Your Plate | Python | diet-aware portion visual |
| 4 | Your meal approach + **Weeks 1–2** meal plan (day cards) | AI | only the first fortnight in full; later weeks teased |
| 5 | 💊 Your Supplement Schedule (full) | Python | dose, timing, rationale, **buy links** |
| 6 | 📦 Your Complete Supplement Shopping List | Python | weekly amounts + start dates + buy links |
| 7 | 🌿 Your daily practices / lifestyle | AI | movement, sleep, stress, etc. |
| 8 | 📊 What to track + labs to recheck | AI | tracking + recheck markers |
| 9 | Recipes | AI → split to sidecar | full recipes ride as `/recipes/<slug>` |
|   | WhatsApp start-date confirm buttons | Python | top of letter |

**AI does NOT write:** any supplement table/list, the plate, the daily routine — Python owns those.

---

## LETTER 2+ — "Weeks N–M" (fortnight follow-up, every 2 weeks)

Lean check-in + the next two weeks. This order:

| # | Section | Owner | Notes |
|---|---------|-------|-------|
| 1 | Short progress note + what's evolving this phase | AI | references her actual progress; no re-teaching basics |
| 2 | 📋 Your Daily Routine (day schedule) | Python | **KEPT** — current supplements for THIS fortnight's window; reflects any changes |
| 3 | 💊 What's new / changed this phase | AI | **only** additions/removals/changes vs last phase, **each new supplement with its purchase link + one-line why**; "everything else is unchanged — full details in your main plan." Omit the section entirely if nothing changed. |
| 4 | **Weeks N–M** meal plan (day cards) | AI | the next two weeks |
| 5 | New dishes + recipes | AI → split to sidecar | only the new dishes this phase |
| 6 | What to notice this phase / phase tips | AI | 3–4 observations |
| 7 | (optional) travel / looking-ahead note | AI | when relevant |

**DROPPED from fortnight letters (vs today):**
- 🍽 Building Your Plate — first letter only (static reference).
- 📦 Complete Supplement Shopping List — first letter + Reference page only.
- 💊 Full Supplement Schedule table — first letter + Reference page only.
- Any prose re-list of the full supplement protocol — replaced by §3 "what's changed" only.

**KEPT in fortnight letters:** the 📋 Daily Routine day schedule (§2) — so the
client always sees the current "take X at breakfast, Y at lunch", which updates as
supplements change.

---

## Where the full reference always lives

Even though follow-ups don't repeat the full schedule/shopping list, the client can
always see the complete, current supplement reference at:
- **Letter 1** (their main plan letter), and
- the **active-plan Reference page** (`/clients-v2/<id>/reference`) — always current.

§3 of every follow-up should point there ("full details in your main plan").

---

## Implementation notes (code → this spec)

`render-client-letter.py`:
- **Injection conditions** (~L7023, L7049, L7109): plate currently injects for
  `consolidated, meal_plan, meal_plan_phase` → drop `meal_plan_phase`. Shopping
  list + full schedule currently inject for `meal_plan_phase` → drop; keep ONLY the
  Daily Routine for `meal_plan_phase`.
- **Prompt builders:** `_build_prompt_meal_plan_phase` must ask the AI for §3
  "what's changed this phase (with buy links)" and must NOT ask for a full
  supplement list, plate, or portion guide. The consolidated/first-letter builder
  must NOT ask the AI for plate/schedule/shopping (Python owns them).
- **First letter consolidation:** decide whether "Letter 1" = the `consolidated`
  type (preferred) and retire sending `supplement_plan` + `lifestyle_guide` as
  separate first-package documents, OR keep them — coach chose ONE comprehensive
  letter, so `consolidated` becomes the single first letter.
- Diet-aware rule already applied to `_build_portion_plate_html`; extend the same
  care to any other hardcoded food list.

Pending coach confirmation before code changes: this spec reflects the 2026-06-04
decisions (1 comprehensive first letter; fortnight = changes-only + day schedule +
new-supplement purchase links; plate dropped from fortnights).

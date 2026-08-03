# Meal-photo check — build spec

**Status:** specified, not built. Phase 2 of the client chat (phase 1, photos, shipped 2026-08-03).
**Ask:** clients want to send a photo of a meal and be told whether it fits their plan, automatically.

---

## 1. What the ground truth actually is

Everything below was measured against the live roster on 2026-08-03, not assumed. Three
measurements changed the design.

### 1.1 We know what they were supposed to eat — this is the whole design

`Plan.app_menu` (`fmdb/plan/models.py:1410`) carries the week's dishes per day, per meal.
**14 of 15 published plans have one.**

That converts the vision problem from the hard version to the tractable one:

- ❌ *"Is this meal healthy and plan-appropriate?"* — open-ended, needs portion estimation,
  ingredient inference and nutrition judgement from a photograph. Unreliable, especially on
  Indian home food where dal, sambar and rasam are three different dishes in identical
  steel katoris, and roti vs paratha differs only by ghee that a camera cannot see.
- ✅ *"Today's lunch on this plan is `moong dal khichdi with lauki`. Is this plate consistent
  with that?"* — a comparison against a named expectation, with a legitimate "I can't tell"
  answer.

**The check is menu-anchored. It is never a free-standing nutritional opinion.** If there is
no `app_menu` for that day, there is no affirmation — see §4.

### 1.2 The allergy field is empty. The real exclusions are prose.

| Field | Populated | Shape |
|---|---|---|
| `Client.known_allergies` | **1 of 16** — and its value is `['None']` | list, effectively unused |
| `Client.foods_to_avoid` | **17 of 17** | free prose, written for a human |
| `Client.dietary_preference` | 15 of 17 non-empty | free string, inconsistent |

Real `foods_to_avoid` values on the roster today:

```
Onion, Garlic
Brinjal, Rice, Wheat
Mushrooms
Gluten (wheat/atta/maida, barley, rye) — Hashimoto's, strictly gluten-free
Eat only chicken and prawns on weekends. No red meat.
TWO STACKED EXCLUSION FRAMEWORKS as of 2026-05-29. …
```

The first three are lists. The last three are **rules with conditions, reasons and
timeframes**. No parser handles that. Only a language model can read it — and a language
model can misread it.

**This single fact determines the safety architecture (§3).** A system that cannot reliably
parse the exclusion list must never be the thing that tells a client their food is safe.

### 1.3 Diet strings are inconsistent, and naive matching is a live bug class

Actual values: `Vegetarian` ×6, `Non-vegetarian` ×4, `Eggetarian` ×3, `vegetarian` ×1,
`Vegetarian Jain` ×1, `Non vegetarian` ×1, empty ×2.

`"vegetarian"` is a **substring of** `"Non-vegetarian"`. This codebase has already shipped
that bug once (see memory: *App supplement phasing + diet trap*). Any diet handling here
uses an explicit normalisation table with a test, never `includes()`.

Two clients have **no** dietary preference recorded. They must not receive affirmations.

---

## 2. What it must never do

These are not preferences. Each one is a way this feature actively harms a coaching
relationship.

1. **Never tell a client a meal is wrong.** Not "off plan", not "try to avoid this", not a
   frowning emoji. An app issuing food verdicts to someone who cannot argue back is food
   shaming, and it arrives at the exact moment they were being open with their coach. The
   client-visible surface is *affirmation or neutral acknowledgement*. Nothing else.
2. **Never state or imply a quantity.** No calories, no grams, no portion assessment. The
   brand is warm and food-first precisely because numbers invite the calorie anxiety FM
   coaching exists to undo (see memory: *Phase D client-facing nourishment note*).
3. **Never affirm on uncertainty.** "Looks great!" over a plate containing something the
   client must avoid is the worst outcome this feature can produce — worse than saying
   nothing, because it carries the coach's authority.
4. **Never diagnose or interpret.** Out of coaching scope, and no photo supports it.
5. **Never replace the coach's eyes.** The output is a triage queue, not a verdict log.

---

## 3. The decision model

Four outcomes. **Only one is visible to the client as anything other than a plain
acknowledgement.**

| Outcome | When | Client sees | Coach sees |
|---|---|---|---|
| **AFFIRM** | Recognised, consistent with today's `app_menu` (or clearly plan-aligned), diet known, **no** exclusion risk | A warm one-liner naming what it recognised | Nothing (in the thread as normal) |
| **QUIET** | Can't tell what it is, or no menu for today | Plain acknowledgement | Queue, low |
| **REVIEW** | Recognised but inconsistent with the plan | *The same plain acknowledgement* | Queue, normal |
| **SAFETY** | Possible `foods_to_avoid` or diet violation | *The same plain acknowledgement* | **Push immediately** |

The client cannot distinguish QUIET, REVIEW and SAFETY. That is deliberate and load-bearing:
if the neutral reply differed by outcome, clients would learn to read the silence, and the
feature would become a verdict system with extra steps.

**Known hole — the affirm/non-affirm split is itself readable.** Hiding the three non-affirm
outcomes from each other does not hide the binary. A client who gets a warm line on seven
plates and silence on three will conclude the three were bad, and that is the same shaming
this design exists to prevent, arriving more quietly. Three mitigations, in order of
preference:

1. **Affirm the food, not the compliance.** If the plate is recognisable, safe and
   reasonable, affirm it even when it is not today's menu item — REVIEW still queues for the
   coach, but the client is not met with silence for eating a good meal on the wrong day.
   This collapses most of the readable gap and is the recommended default.
2. **Vary the neutral reply** so it does not read as a withheld compliment.
3. **Accept the gap** only if 1 proves to affirm things the coach disagrees with during
   calibration.

This should be settled during shadow mode, when the real distribution of outcomes is visible.
It cannot be settled now: it depends entirely on how often clients eat off-menu, which is
unmeasured (see §7.4).

### 3.1 Client-visible copy

**AFFIRM** — names the food, warm, no numbers, no praise inflation:

> Lovely — that looks like the khichdi and lauki from today's plan. 🌿

**Everything else** — identical in all three non-affirm outcomes:

> Got it, thanks for sending this. Shivani will see it.

That sentence is true in every case, promises only what is certain, and closes the loop the
client opened. It is never a hedge about the food.

### 3.2 Fail-closed conditions (all → non-affirm)

- `dietary_preference` empty or unrecognised → no affirm *(2 clients today)*
- no `app_menu` entry for that day/meal → no affirm
- model confidence below threshold → no affirm
- model reports it could not fully interpret `foods_to_avoid` → no affirm **and** SAFETY
- photo is not food → no reply at all beyond delivery
- any error, timeout, or malformed model output → QUIET, never affirm

**The default on every failure is silence, not encouragement.**

### 3.3 The safety layer

Runs on every photo, independent of the affirm decision, and reads `foods_to_avoid`,
`dietary_preference` and `known_allergies` as prose alongside the image.

It answers one question: **could this plate contain something this client has been told to
avoid?** Any answer other than a confident no →

- suppress affirmation,
- push to the coach immediately (tagged, so it is distinguishable from an ordinary message),
- client still sees only the neutral acknowledgement.

It is deliberately trigger-happy. A false alarm costs the coach ten seconds. A missed
gluten exposure in a Hashimoto's client costs a flare.

**It is a coach alert, never a client warning.** The client is not told their food may be
unsafe by an automated system.

---

## 4. Calibration gate — this ships OFF

There are **zero** meal photos in the system today, so there is no evaluation set and no
honest accuracy estimate. Shipping auto-affirmation on an unmeasured vision task would mean
discovering the error rate on real clients.

So:

1. **Phase 2a — shadow mode.** Every photo is scored. **No client ever sees an affirmation.**
   The coach sees the proposed outcome alongside the photo and marks agree / disagree.
2. **Gate:** ≥30 scored photos **and** ≥90% coach agreement on AFFIRM decisions **and** zero
   missed safety flags.

   **The 30 and the 90% are starting values, not derived ones.** There is no prior here to
   compute them from. They are set to be revised once shadow mode produces a real
   distribution — the number that matters is not the threshold but that the gate exists and
   is checked before any client sees an automated affirmation.
3. **Phase 2b — live.** Affirmations enabled. The disagree button stays forever; a sustained
   drop re-arms shadow mode.

The gate is a stored config value per environment, not a code edit.

---

## 5. Cost

| Item | Per photo | At 34 photos/month |
|---|---|---|
| Vision + reasoning (Haiku, ~2,500 image tokens + ~800 text in, ~200 out) | ~₹0.32 | **~₹11/month** |

Trims already assumed: photos arrive pre-compressed at ~1600px (phase 1), the menu excerpt
sent is one day not the week, and the check is skipped entirely for photos that are not food.

Sonnet would cost ~5×. Recommend Haiku, revisited only if the calibration gate fails on
recognition rather than on judgement.

---

## 6. Implementation notes

- **Trigger:** on `kind: "photo"` arriving via `/api/chat-photo`, async — never blocking the
  upload response. The client's photo must appear instantly whatever the checker is doing.
- **Storage:** the outcome attaches to the thread message (new optional field), so it is
  auditable and re-reviewable. Never overwrite the message.
- **Reply:** written into the thread as a normal outbound message so it appears in both apps
  and in history, marked as automated so the coach can tell her words from the system's.
- **Diet normalisation:** explicit table (`vegetarian | non-vegetarian | eggetarian |
  pescatarian | vegan | jain | unknown`), exact-match after lowercase/punctuation strip,
  **never substring**, with a test asserting `Non-vegetarian` never resolves to vegetarian.
- **Retention:** flagged photos should survive the 365-day media sweep — a safety flag is
  part of the record. Pin on SAFETY.
- **Prompt:** the client's `foods_to_avoid` prose goes in verbatim. Do not pre-summarise it;
  the summarisation is where the meaning gets lost.

---

## 7. Open questions for the coach

1. **Frequency.** Should the affirmation fire on every photo, or would daily become noise?
   Recommendation: every photo initially; it is the reward that drives the behaviour.
2. **Should the client ever see the flag?** Recommendation: no, per §2. Worth an explicit
   decision because it is the one that most changes the feel of the feature.
3. **Off-menu but healthy** — a client eats a good meal that simply is not on today's plan.
   Currently REVIEW (neutral to client, queued for coach). Alternative: affirm the food
   without referencing the plan. **Revised recommendation after review: affirm it** — see the
   known hole in §3.1. "Good but not what we agreed" is a coaching conversation, and the
   coach still gets it in the queue; it does not need to cost the client a silence.

4. **Unmeasured volume risk.** If clients routinely eat off-menu, REVIEW becomes the default
   outcome and the coach queue floods — the feature then costs attention instead of saving
   it. Nothing in the current data says how often that happens, because no meal photos exist
   yet. Shadow mode measures it before anything is automated. If REVIEW exceeds roughly half
   of photos, the menu-anchored comparison is the wrong frame and the design needs revisiting,
   not tuning.

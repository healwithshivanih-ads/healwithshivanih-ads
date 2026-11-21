# Client app scorecard: ours against best practice (21 November 2026)

Every client-facing feature of the client app is scored 1–10 on five aspects, and so is the best
outside example of the same feature, so the two can be compared. "The client app" means the new
Sequoya front on `main` (the `sq-*` screens under `fm-database-web/src/app/app/[token]/`, with
the old overlays it hosts) plus the client pages outside it.

**How it was done.** Three agents worked on it:

- one read our code and scored our app;
- one scored the best outside example, mostly from the sources in `CLIENT-VALUE-RESEARCH.md`
  plus 10 new searches;
- one checked the two sets against each other and verified the bugs found in the code.

Ten scores (and one reason) were changed by the checker; they are marked † in the appendix.

**Limits.**

- Nobody saw a screen. Our design scores come from markup and copy, and best-practice scores come
  from docs, App Store listings and reviews.
- Several "best" examples are not like for like:
  - A7 is an iPhone setting.
  - A6 and I4 are coaching practices, not screens.
  - B5's only comparator is a weak US app.
- Treat gaps under about 1 point as noise.

**The five aspects.**

- **D**esign: look, clarity, layout.
- **F**unction: does it work fully and reliably.
- **U**seful: does it help the client get better.
- **E**ase of use.
- **T**rust and safety: correct, safe, no pressure.

Scores run 9–10 for best in class, 7–8 for good with minor gaps, 5–6 for works with notable
gaps, 3–4 for partly works, and 1–2 for broken or harmful.

**Gap** = best average minus ours. A plus means best practice is ahead; a minus means we are
ahead. A best-practice example that breaks one of the coach's rules (no chasing or automatic
nudges, no evidence-hedging to clients, all genders) is marked ⚠ conflict. The part that breaks
the rule is not rewarded.

---

## Summary

| | Design | Function | Useful | Ease | Trust | **Overall** |
|---|---|---|---|---|---|---|
| **Ours** (33 features scored) | 6.7 | 7.1 | 7.2 | 7.5 | 7.9 | **7.3** |
| **Best practice** (31 with an outside example) | 6.6 | 7.2 | 6.7 | 7.0 | 6.9 | **6.9** |

On the 30 features both sides scored, ours averages 7.3 and best practice 6.9.

**What the averages say.**

- **Trust is our clearest lead.** The coach's rules are built into the code: the contact gate,
  coach-approved letters, and prices fixed on the server.
- **Best practice loses trust points where it nudges, upsells or auto-refills.**
- **Design is our weakest aspect.** Several screens still wear the old look inside the new
  shell: the menu, the shopping list, the check-in, the lab vault and the movement session.

| Feature group | Ours avg | Best avg (same features) | Note |
|---|---|---|---|
| Today (A1–A7) | 7.4 | 7.4 | We lead on the next card; the "This week" line has a bug |
| Food (B1–B5) | 7.0 | 6.8 | Recipes lead; the menu and shopping list trail; the cook's sheet has a safety defect |
| Ask & coach (C1–C3) | 7.3 | 6.7 | The ask box leads clearly; the check-in does not screen symptoms |
| Practices (D1–D2) | 7.9 | 7.0 | The coach's voice, no streaks, no upsell |
| Supplements (E1–E4) | 7.0 | 7.0 | The public order page is the weakest screen we have |
| Record & progress (F1–F5) | 7.4 | 6.7 | But F4 "Your progress" is **not built** |
| Tests, movement, travel (G1, G2, H1) | 7.1 | 6.9 | No outside example for travel |
| Outside the app (I1–I5) | 7.2 | 6.6 | Money pages are safe; design is generic |

### The 5 gaps that matter most to clients

These are ranked by client impact (from `CLIENT-VALUE-RESEARCH.md`), not only by the size of the
number.

1. **F4 Your progress: not built.**
   - The week ring in the top bar, one of the most prominent taps, opens "This screen is not built
     yet" (`sq-app.tsx:466`).
   - Seeing progress is the 8th thing clients value. Slow early results predict drop-out, and
     visible results drive recommendation.
   - The old `ochre-progress.tsx` already has a symptom-score chart, weight and blood-pressure
     trends and lab checkpoints, ready to port.
2. **B4 Cook's sheet: gap +1.0, and a safety defect.**
   - When a food is removed for a client, the English steps are rewritten but the Hindi line, which
     is printed large and read first, keeps the original recipe. It pairs to the English by position
     (`recipe-adapt.ts:399-446`, `menu-translate.ts:281-293`).
   - Traced example: the green chana sprout salad says "cucumber and tomato" in English but still
     says onion (प्याज़) in Hindi. A Jain or no-onion-garlic household gets the wrong instruction.
   - This applies to the adaptable foods: onion, garlic, citrus, herbs, chilli, celery. Recipes with
     nuts, dairy, gluten or egg are hidden, not adapted.
   - There is no "made without X" line on the sheet or on the keepsake (I5).
3. **C3 Weekly check-in: trust 5 against 6.**
   - The box invites "new symptoms…" (`ochre-checkin.tsx:168`), but nothing screens what is typed.
     "Chest pain" or self-harm words get no urgent card and no alert to the coach, unlike the ask box
     and the coach thread.
   - It shows raw "(HTTP 500)" errors.
   - It never reaches the Home "This week" line, because `shopped: false` is hard-coded
     (`sq-home.tsx:253`). It is still reachable from Everything.
     *Fixed 21 Nov 2026 (coach's decision): the shopping list is a convenience, not a job, so it no
     longer gates anything. The "This week" line now shows only the check-in, until it is sent.*
4. **C2 Coach thread: function 6 against 7.**
   - A message marked "Not sent yet" is held only in memory and lost on reload (`sq-coach.tsx:56`).
   - There is no photo and no notification that the coach has replied. A notification answering the
     client's own message is not chasing.
   - "A real person who replies" is the top complaint across every platform.
5. **B3 Shopping list: gap +1.0.**
   - There is no share button, though the cook or family often shops; the build plan asked for one.
   - Ticks are kept only on the phone.
   - It still has the old look, and the ⇄ swap control cannot be reached by keyboard
     (`ochre-week-menu.tsx:336-346`).

Next in line:

- **B1** This week's menu (+0.6): old look, dishes not tappable, no family version.
- **E3** The public supplement page (+0.6): raw timing text, later phases listed. (No commission line, by the coach's decision of 21 Nov.)
- **G1** Tests (+0.2): raw errors on a real-money flow.

### Where we already beat best practice

1. **C1 Ask box (−1.4).**
   - It answers from the client's own plan and record.
   - The safety rules run on the phone first and again on the server.
   - It has a lapsed-client gate and a daily cap, and it hands off to the coach.
   - NHS 111 online only routes.
2. **B2 Recipes with nutrients (−1.2).**
   - "Made without X for you" sits before the method, and nutrients are recomputed after the removal.
   - Grams show only when the figures cover 90% of the recipe.
   - That Clean Life has no per-client omissions.
3. **D1 Practice player (−1.2).**
   - The coach's own voice, working offline, with pause and resume.
   - No streaks and no upsell.
   - The before-and-after rating is logged for the coach.

B5, the eating-out guide, has the biggest lead (−2.8): the coach's own lines, Hinglish included.
Its only comparator is weak, though, so it is not counted here.

### Bugs found and checked in the code

- **Confirmed:**
  - B4 Hindi mismatch, and the missing "made without X" line on B4 and I5.
  - C3 symptoms unscreened, and raw errors.
  - A4 check-in never shown on Home.
  - The week ring opens a "not built" screen.
  - C2 unsent message lost on reload.
  - G2 only the first exercise session can be reached (`sq-host.tsx:66`).
  - B3 swap control not reachable by keyboard.
  - F3 against the lab vault: the same numbers are tagged "within / above / below" on one screen
    and "Worth exploring" against functional-medicine ranges on the other.
- **Refuted:**
  - Undo after "I already have them all" does work on every row. The real bug: if one save fails,
    the screen reverts rows the server did save (`sq-everything.tsx:87,107`).
  - The public supplement page has no lapsed check, but that is by design. The library floor
    deliberately keeps re-order links after a programme ends.

---

## Scores by feature group

Scores are in the order D · F · U · E · T. The reason for every score is in the appendix.

### Today

| Feature | Ours D · F · U · E · T | Ours avg | Best practice | Best D · F · U · E · T | Best avg | Gap |
|---|---|---|---|---|---|---|
| A1 Next card with Done / Undo (one thing at a time) | 8 · 8 · 8 · 9 · 9 | 8.4 | Apple Health Medications: Taken / Skipped per dose, editable after ([Apple](https://support.apple.com/en-ca/105064)) | 8 · 8 · 7 · 8 · 8 | 7.8 | -0.6 |
| A2 Supplements taken with a meal as their own tap (capsule pills) | 8 · 8 · 8 · 8 · 8 | 8.0 | Apple Health Medications: doses grouped by scheduled time, logged together ([Apple](https://support.apple.com/en-ca/105064)) | 7 · 8 · 7 · 8 · 8 | 7.6 | -0.4 |
| A3 Later today + Your whole day (the full day by time band) | 7 · 8 · 7 · 7 · 8 | 7.4 | Nutrium client meal plan, by meal, offline ([help](https://help.nutrium.com/en/articles/5195586-can-my-client-create-a-shopping-list), [App Store](https://apps.apple.com/ca/app/nutrium/id1136652584)) | 7 · 8 · 7 · 7 · 7 | 7.2 | -0.2 |
| A4 "This week" line (shopping list, then check-in) | 7 · 5 · 6 · 7 · 8 | 6.6 | No outside example found (Healthie programmes run on a schedule, but that is drip content, which would conflict) | – | – | – |
| A5 Return-after-a-break card (3+ days away) | 7 · 7 · 6 · 8 · 9 | 7.4 | No outside example found (apps' "welcome back" is push re-engagement, which would conflict) | – | – | – |
| A6 First-day start card + "How this app works" | 7 · 6 · 6 · 8 · 8 | 7.0 | Healthie: coach walks the client through the app in the first session ([Healthie blog](https://gethealthie.com/blog/introducing-healthie-to-your-wellness-clients)) | 5 · 6 · 6 · 6 · 7 | 6.0 | -1.0 |
| A7 Larger text + "track every item" switches; Keep the app on your phone | 7 · 7 · 7 · 7 · 8 | 7.2 | Apple Dynamic Type text sizing ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/typography)) | 8 · 9 · 6 · 9 · 9 | 8.2 | +1.0 |

### Food

| Feature | Ours D · F · U · E · T | Ours avg | Best practice | Best D · F · U · E · T | Best avg | Gap |
|---|---|---|---|---|---|---|
| B1 This week's menu (day by day) | 5 · 7 · 8 · 6 · 8 | 6.8 | Nutrium in-app meal plan, day by day, offline ([App Store](https://apps.apple.com/ca/app/nutrium/id1136652584)) | 7 · 8 · 8 · 7 · 7 | 7.4 | +0.6 |
| B2 Recipes with nutrients (protein, carbs, fat, fibre) and day total | 8 · 8 · 8 · 8 · 9 | 8.2 | That Clean Life recipes with nutrition; client swaps within limits ([Practice Better](https://practicebetter.io/integrations/that-clean-life)) | 7 · 7 · 7 · 7 · 7 | 7.0 | -1.2 |
| B3 Shopping list (ticked off as you go, share) | 5 · 6 · 8 · 7 · 8 | 6.8 | Nutrium shopping list: up to 5 weeks, non-food items, private to client ([help](https://help.nutrium.com/en/articles/5195586-can-my-client-create-a-shopping-list)) | 7 · 8 · 8 · 8 · 8 | 7.8 | +1.0 |
| B4 Cook's sheet (printable, English + Hindi) | 6 · 5 · 7 · 6 · 4 | 5.6 | SMART Eating trial: diet messages to the household cook in 3 languages ([PMC6953835](https://pmc.ncbi.nlm.nih.gov/articles/PMC6953835)) | 4 · 6 · 8 · 7 · 8 | 6.6 | +1.0 |
| B5 Eating out guide | 8 · 7 · 8 · 8 · 8 | 7.8 | NutriFinder: best pick, compromise, skip per restaurant ([App Store](https://apps.apple.com/app/id6765716394)) | 6 · 5 · 4 · 6 · 4 | 5.0 | -2.8 |

### Ask & coach

| Feature | Ours D · F · U · E · T | Ours avg | Best practice | Best D · F · U · E · T | Best avg | Gap |
|---|---|---|---|---|---|---|
| C1 Ask box (safety rules first, plan lookups, model answers from own plan, hand-off) | 7 · 8 · 8 · 8 · 9 | 8.0 | NHS 111 online: triage that routes to 999 / A&E, no diagnosis ([NHS](https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-use-111/how-nhs-111-online-works), [NIHR](https://evidence.nihr.ac.uk/alert/impact-of-online-or-app-based-assessment-for-urgent-health-problems-largely-unclear)) | 6 · 7 · 6 · 7 · 7 | 6.6 | -1.4 |
| C2 Coach message thread (reply within 24 h, "Not sent yet" kept) | 7 · 6 · 8 · 8 · 8 | 7.4 | Nutrium in-app messaging with quick replies ([App Store](https://apps.apple.com/ca/app/nutrium/id1136652584)) | 6 · 7 · 8 · 7 · 7 | 7.0 | -0.4 |
| C3 Weekly check-in | 5 · 7 · 8 · 8 · 5 | 6.6 | Practice Better forms in the client portal for check-ins ([Practice Better](https://practicebetter.io/feature/client-portal)); regular contact helps ([JAND](https://doi.org/10.1016/j.jand.2019.01.023)) ⚠ conflict | 6 · 7 · 7 · 6 · 6 | 6.4 | -0.2 |

### Practices

| Feature | Ours D · F · U · E · T | Ours avg | Best practice | Best D · F · U · E · T | Best avg | Gap |
|---|---|---|---|---|---|---|
| D1 Practice player: tapping, sleep wind-down, body reset, breathing; coach's voice, scenes, pause/resume, dim | 8 · 8 · 8 · 8 · 8 | 8.0 | Insight Timer: teachers' own voices, timer works offline ([App Store](https://apps.apple.com/us/app/insight-timer-meditation-timer/id337472899), [offline help](https://insight-timer.freshdesk.com/en/support/solutions/articles/67000664574-can-i-use-insight-timer-offline-)) ⚠ conflict | 8 · 7 · 7 · 7 · 5 | 6.8 | -1.2 |
| D2 Goodnight screen + bedtime-supplement tick | 8 · 7 · 6 · 9 · 9 | 7.8 | Apple Sleep Focus Wind Down with bedtime shortcuts ([Apple](https://support.apple.com/guide/iphone/intro-to-sleep-schedules-iphaf56dceb4/14.0)) | 7 · 7 · 6 · 7 · 9 | 7.2 | -0.6 |

### Supplements

| Feature | Ours D · F · U · E · T | Ours avg | Best practice | Best D · F · U · E · T | Best avg | Gap |
|---|---|---|---|---|---|---|
| E1 Your supplements (what each is for, when) | 7 · 7 · 7 · 8 · 8 | 7.4 | Fullscript treatment plan: products, dosage, when and how ([help](https://support.fullscript.com/articles/navigating-your-patient-account/?cc=us)) | 7 · 7 · 7 · 7 · 7 | 7.0 | -0.4 |
| E2 Order supplements in the app ("I've ordered it" tick) | 7 · 7 · 8 · 7 · 8 | 7.4 | Fullscript in-app ordering, order history, auto refill ([help](https://support.fullscript.com/articles/navigating-your-patient-account/?cc=us), [adherence](https://fullscript.com/en-US/adherence-insights)) ⚠ conflict | 7 · 8 · 7 · 7 · 5 | 6.8 | -0.6 |
| E3 Public supplement order page /supplements/<planSlug> | 4 · 6 · 6 · 7 · 6 | 5.8 | Fullscript practitioner plan link to the patient's catalogue ([patients](https://fullscript.com/en-US/patients)) | 6 · 7 · 6 · 7 · 6 | 6.4 | +0.6 |
| E4 Reminders (opt-in phone reminders at supplement times) | 7 · 7 · 7 · 7 · 9 | 7.4 | Apple Health Medications reminders; follow-ups off by default ([Apple](https://support.apple.com/en-ca/105064)) | 8 · 8 · 7 · 8 · 8 | 7.8 | +0.4 |

### Record & progress

| Feature | Ours D · F · U · E · T | Ours avg | Best practice | Best D · F · U · E · T | Best avg | Gap |
|---|---|---|---|---|---|---|
| F1 Your record (every tick, by day, with times) | 7 · 7 · 6 · 8 · 9 | 7.4 | Apple Health Medications log history ([Apple](https://support.apple.com/en-ca/105064)) | 7 · 8 · 6 · 7 · 8 | 7.2 | -0.2 |
| F2 Log weight or blood pressure (+ history) | 7 · 8 · 7 · 8 · 8 | 7.6 | Healthie metrics: weight, BP, Apple Health sync, weight-hiding option ([Healthie](https://help.gethealthie.com/article/510-metrics-faqs)) | 6 · 7 · 7 · 6 · 8 | 6.8 | -0.8 |
| F3 Your results (released labs + body age, within/above/below tag) | 7 · 7 · 6 · 8 · 7 | 7.0 | Orange Health "smart reports", shareable archive ([App Store](https://apps.apple.com/in/app/id1534689588)) | 6 · 6 · 6 · 7 · 6 | 6.2 | -0.8 |
| F4 Your progress (before-and-after) | not built | – | Noom progress view ([App Store](https://apps.apple.com/us/app/noom-weight-loss-health/id634598719)); slow early results predict drop-out ([Obes Facts](https://doi.org/10.1159/000345951)) ⚠ conflict | 7 · 7 · 7 · 7 · 4 | 6.4 | **not built** |
| F5 Food diary (photos for a few days the coach chooses) | 7 · 8 · 7 · 7 · 9 | 7.6 | Healthie photo food journal with coach comments, alert to coach per log ([help](https://help.gethealthie.com/article/781-food-journaling-in-healthie), [blog](https://www.gethealthie.com/blog/photo-food-logging-a-pictures-worth-a-thousand-nutrients)) | 6 · 6 · 7 · 7 · 7 | 6.6 | -1.0 |

### Tests

| Feature | Ours D · F · U · E · T | Ours avg | Best practice | Best D · F · U · E · T | Best avg | Gap |
|---|---|---|---|---|---|---|
| G1 Tests and results: book a test, pay (Razorpay), reports | 5 · 8 · 8 · 6 · 7 | 6.8 | Orange Health: book, pay online, track collector, digital report ([App Store](https://apps.apple.com/in/app/id1534689588)) | 7 · 7 · 7 · 8 · 6 | 7.0 | +0.2 |

### Movement

| Feature | Ours D · F · U · E · T | Ours avg | Best practice | Best D · F · U · E · T | Best avg | Gap |
|---|---|---|---|---|---|---|
| G2 Movement / strength session | 6 · 6 · 7 · 8 · 8 | 7.0 | Trainerize: workouts with video demos, set logging, coach video feedback ([review](https://dupple.com/reviews/trainerize)) ⚠ conflict | 7 · 7 · 7 · 6 · 7 | 6.8 | -0.2 |

### Travel

| Feature | Ours D · F · U · E · T | Ours avg | Best practice | Best D · F · U · E · T | Best avg | Gap |
|---|---|---|---|---|---|---|
| H1 Going away / Your trip (dates, Travelling card) | 7 · 7 · 7 · 8 · 8 | 7.4 | No outside example found | – | – | – |

### Outside the app

| Feature | Ours D · F · U · E · T | Ours avg | Best practice | Best D · F · U · E · T | Best avg | Gap |
|---|---|---|---|---|---|---|
| I1 Intake form | 7 · 8 · 9 · 5 · 8 | 7.4 | Practice Better intake forms in the client portal ([Practice Better](https://practicebetter.io/feature/client-portal)) | 7 · 8 · 7 · 7 · 7 | 7.2 | -0.2 |
| I2 Foundation session page + pay | 6 · 8 · 7 · 8 · 8 | 7.4 | Practice Better: booking, packages and invoices in one portal ([Practice Better](https://practicebetter.io/feature/client-portal)) | 7 · 8 · 6 · 7 · 7 | 7.0 | -0.4 |
| I3 Maintenance pay page/link | 5 · 8 · 7 · 7 · 9 | 7.2 | Practice Better packages and online invoice payment ([Practice Better](https://practicebetter.io/feature/client-portal)) | 6 · 8 · 5 · 7 · 6 | 6.4 | -0.8 |
| I4 Renewal letter (email) + end-of-programme screens (review, maintenance, library floor) | 6 · 7 · 7 · 7 · 8 | 7.0 | Planned graduation: consolidation session plus written relapse-prevention plan ([NBC-HWC study guide](https://open-exam-prep.com/study-guides/nbchwc/ch1/sec1-6-routine-termination), [BetterUp](https://support.betterup.com/hc/en-us/articles/360047532051-Program-Endings-Pausing-Coaching)) ⚠ conflict | 5 · 5 · 7 · 6 · 7 | 6.0 | -1.0 |
| I5 Recipe keepsake (printable, at graduation) | 7 · 7 · 7 · 7 · 6 | 6.8 | That Clean Life printable meal plans and recipes ([setup guide](https://help.thatcleanlife.com/article/323-setup-guide)) | 6 · 7 · 6 · 7 · 7 | 6.6 | -0.2 |

### Not built (from the build plan's "What stays out of this build")

| Feature | Status |
|---|---|
| N1 Hindi screens | Not built, no score. The ask box understands Hinglish, and the cook's sheet is in Hindi. |
| N2 Printable report of the numbers | Not built, no score |
| N3 Full trip mode across time zones | Not built, no score. H1 covers trip dates and the Travelling card. |
| F4 Your progress (new front) | Not built, no score. The old front's `ochre-progress.tsx` has a symptom-score chart, a watch list, lab checkpoints, a daily-feeling strip, weight and blood-pressure trends and a journey timeline. |

## Appendix: the reason for every score

Ours comes from reading the code (paths under `fm-database-web/src/`; design is judged from markup and copy, since the screens were not seen). Best practice comes from docs and reviews, not hands-on use. Cells the checker changed are marked †.


### Today

| ID | Side | Design | Function | Useful | Ease | Trust |
|---|---|---|---|---|---|---|
| A1 | Ours | 8: one hero card, eyebrow "Next · part · time", dish photo (sq-home.tsx:81) | 8: skeleton until ticks and clock are known, no card swap; sq-day.ts pure and tested | 8: one clear next step through the day | 9: one tap Done; Undo line shows the tick time | 9: earlier parts never shown as "next" or missed; "That's today. Rest well." |
| A1 | Best | 8: one dose, two clear buttons (from docs) | 8: log any time, change status later | 7: adherence log, no plan context | 8: one tap, works from Watch | 8: client-set schedule, no pressure |
| A2 | Ours | 8: "Take with it" pills with aria-pressed (sq-home.tsx:72) | 8: own ticks; "Took these with it?" after Done | 8: capsules tracked apart from meals | 8: one tap each, on card or Undo bar | 8: Undo reverses only the meal tick, so pills stay as she left them |
| A2 | Best | 7: grouped by time, not by meal (from docs) | 8: per-dose and as-needed logging | 7: ties dose to a time of day | 8: single tap per group | 8: no nudges beyond user's own schedule |
| A3 | Ours | 7: folded "Later today" with a summary; time column | 8: every prescribed row is in the whole day, with tick times (tests) | 7: full day by band, with macros and target | 7: Later is collapsed; rows tick only with "track" on | 8: not-every-day items are left out of the count, so a day can be completed |
| A3 | Best | 7: meals laid out per day (from docs/reviews) | 8: offline plan reads reliably | 7: food only, no supplements/practices in one day | 7: clear, some menus deep | 7: coach-authored plan |
| A4 | Ours | 7: one card, badge icon, short sub | 5: `shopped: false` is hard-coded (sq-home.tsx:253), so Home never reaches the check-in; Everything still does † | 6: the check-in prompt is hidden on Home for anyone with a shopping list † | 7: one tap opens the screen | 8: one line, nothing on day 1, no pressure |
| A5 | Ours | 7: soft card, one "Carry on" button | 7: shows at 3+ days away (sq-day.ts:440), put away for the day | 6: kind, but carries no content | 8: one tap away | 9: "Your plan is right where you left it", never "you missed" |
| A6 | Ours | 7: short titled points, steps list (sq-start.tsx) | 6: stale; does not mention the Ask box, Coach tab, Practices or Everything | 6: covers only the basics | 8: one minute, never opens by itself | 8: lost-link fix via WhatsApp, "Do I have to do all of it?" |
| A6 | Best | 5: advice, not an in-app screen (from docs) | 6: depends on the coach doing it | 6: sets expectations early | 6: human-led, needs a call | 7: personal, no pressure; auto intake flows not scored |
| A7 | Ours | 7: switch rows say their state ("On · tap to go back") | 7: localStorage wrapped in try/catch; "Keep the app" opens the whole start sheet | 7: install steps target the No. 1 tester problem | 7: settings scattered across Start here and You | 8: device-only settings, no data risk |
| A7 | Best | 8: layouts scale with chosen text size (from docs) | 9: system-wide, reliable | 6: access aid, not a health gain | 9: set once in Settings | 9: client's own choice |

### Food

| ID | Side | Design | Function | Useful | Ease | Trust |
|---|---|---|---|---|---|---|
| B1 | Ours | 5: old ochre look with inline styles inside the Sequoya shell (sq-host.tsx:11) | 7: week pills, swap notes, travel pause; dishes not tappable | 8: whole week visible, so shopping can be planned | 6: separate overlay; the new day row duplicates part of it | 8: sample menus show no dates or "today" |
| B1 | Best | 7: clean daily plan (from reviews) | 8: offline, synced from coach | 8: core of the programme | 7: easy to browse | 7: coach-written |
| B2 | Ours | 8: macro line under title, photo, You need / Method cards | 8: needs 90% coverage, 700 kcal sanity cap, "about" when incomplete (meal-macros.ts) | 8: protein/fibre per dish and per day | 8: one tap from Next or Later | 9: "Made without X for you" shown before the method (sq-sheets.tsx:186) |
| B2 | Best | 7: recipe cards with nutrients (from docs) | 7: swaps keep master plan intact | 7: nutrients plus safe flexibility | 7: swap in a tap | 7: coach sets the limits |
| B3 | Ours | 5: old look, inline styles, a ⇄ glyph for swaps | 6: ticks are local only; no share button exists; swap span has no keyboard handler | 8: grouped by Indian shopping categories, staples folded away | 7: tap to tick, a count in the eyebrow | 8: swaps are pre-gated to the plan, "Quantities are for one person" |
| B3 | Best | 7: simple checklist (from docs) | 8: built from the plan, editable | 8: removes a weekly chore | 8: one tap to build | 8: coach cannot see it, privacy kept |
| B4 | Ours | 6: clean print page, but "The Ochre Tree" and the coach's name in the footer | 5: Hindi steps are paired to English by position, so they drift once a step is adapted (menu-translate.ts:289) † | 7: made for the cook, but the cook's own language can contradict the plan † | 6: opens a new tab, then Save as PDF | 4: the Hindi line keeps the original recipe, so it can name a removed food such as onion (recipe-adapt.ts:446) † |
| B4 | Best | 4: SMS text, not a designed sheet (study) | 6: delivered, but one-way messages | 8: intake improved about 20% | 7: cook reads own language | 8: study-backed, family-inclusive |
| B5 | Ours | 8: rules, then places, then one card each with check/x icons | 7: only when the plan has a guide; 33 tests in eating-out.test.ts | 8: coach's own lines, used at the table | 8: one tap per place; also reachable from the Ask box | 8: "every line is the coach's, as written" |
| B5 | Best | 6: clear three-way split (from listing only) | 5: US chains only, unverified | 4: not Indian food, not client-specific | 6: quick to read | 4: AI-generated, generic, unreviewed |

### Ask & coach

| ID | Side | Design | Function | Useful | Ease | Trust |
|---|---|---|---|---|---|---|
| C1 | Ours | 7: chips + cards with a source line ("From your plan") | 8: lookups run on the phone and offline; offline and limit cards; no fetch timeout | 8: answers from her own plan and record | 8: tappable chips; Hinglish handled | 9: safety rules run first and again on the server; lapsed gate, daily cap, auto answers go to the coach (api/app-copilot) |
| C1 | Best | 6: plain question flow (from docs) | 7: ~120 topics, one symptom at a time | 6: safety routing, not plan answers | 7: plain language | 7: hands off to humans, but NIHR finds its impact largely unclear † |
| C2 | Ours | 7: plain thread, "Your coach", 24 h promise | 6: "Not sent yet" lives in memory only and is lost on reload; no photos or notifications yet | 8: direct line to the coach | 8: same box as Ask; retry link | 8: urgent card shown beside the message, never instead of it |
| C2 | Best | 6: basic chat (from reviews) | 7: works, speed depends on coach | 8: quick human replies top the praise | 7: familiar chat | 7: real person; no stated reply promise |
| C3 | Ours | 5: old look, inline styles | 7: prefilled from daily ticks; error kept on screen | 8: rating, adherence and guidelines in a minute | 8: "Taking all of these" group answers | 5: raw "(HTTP 500)" (ochre-checkin.tsx:129); typed "new symptoms" are never safety-screened † |
| C3 | Best | 6: generic forms (from docs) | 7: forms reliable, history kept | 7: regular contact linked to results | 6: form-heavy on a phone | 6: scored form only **Partial conflict:** forms can be auto-sent on a schedule; not scored |

### Practices

| ID | Side | Design | Function | Useful | Ease | Trust |
|---|---|---|---|---|---|---|
| D1 | Ours | 8: step, Prev/Pause/Next, Dim; settings behind one button | 8: sound fails quietly to text; reopens paused with Resume; 49 tests | 8: tapping, wind-down, resets, breath in the coach's voice | 8: nothing competes with the words at 3 am | 8: logs SUDS before/after; nothing speaks unasked |
| D1 | Best | 8: polished player (from listing) | 7: guided offline only for paid members | 7: teacher's voice builds connection | 7: simple play/pause | 5: upsell to MemberPlus **Partial conflict:** streak and daily-reminder notifications plus a members' upsell; only the player scored |
| D2 | Ours | 8: "Goodnight. Put the phone down now." Two lines only | 7: offers only bedtime supplements not ticked | 6: small closing nicety | 9: one tick, one Close | 9: nothing to read, no prompts |
| D2 | Best | 7: dimmed lock screen, shortcuts (from docs) | 7: needs a sleep schedule first | 6: routine, no supplement link built in | 7: set once | 9: user-set, quiets notifications |

### Supplements

| ID | Side | Design | Function | Useful | Ease | Trust |
|---|---|---|---|---|---|---|
| E1 | Ours | 7: name, dose · timing, why | 7: includes bought remedies and "Starting next week" | 7: "why" uses the coach's client_note first | 8: one list | 8: the client_note wins over mined rationale (client-app.ts:4721) |
| E1 | Best | 7: plan per goal with instructions (from docs) | 7: dosage schedule, iOS-only in places | 7: clear what and when | 7: plan in Shop tab | 7: practitioner-set; why-it's-for less clear |
| E2 | Ours | 7: state line per row plus one action | 7: optimistic with rollback; but if one save in "I already have them all" fails, the screen reverts rows the server saved (sq-everything.tsx:87,107) † | 8: feeds the Running-low card on Home | 7: Buy, then ordered, then arrived: three taps over time | 8: "The shop page shows the real price", no invented prices |
| E2 | Best | 7: cart from the plan (from docs) | 8: orders, tracking, receipts | 7: fewer missed supplies | 7: easy, but part of the ease is autoship (the conflicting part) † | 5: refill emails and autoship push buying **Conflict:** automatic refill reminder emails |
| E3 | Ours | 4: generic system font, emoji clock, off-brand green | 6: token-gated, latest published plan file | 6: a WhatsApp-linked list, no tracking | 7: one Order button per item | 6: no lapsed check, by design (the library floor keeps re-order links); raw timing, later phases listed (no commission line is her decision, not a fault) † |
| E3 | Best | 6: store-like page (from docs) | 7: plan opens as a cart | 6: convenience, not care | 7: link to purchase | 6: practitioner margin, disclosure varies |
| E4 | Ours | 7: state sentence, one button, phone-specific steps | 7: works; iOS needs Home Screen; on/off only, no times | 7: supplement-time and check-in reminders | 7: Android and iPhone fix-it steps | 9: client opt-in; the cron checks the contact gate for lapsed clients (cron/app-reminders:181) |
| E4 | Best | 8: tidy notification with actions (from docs) | 8: reliable, snooze 10 min | 7: fewer missed doses | 8: act from the alert | 8: user creates the schedule |

### Record & progress

| ID | Side | Design | Function | Useful | Ease | Trust |
|---|---|---|---|---|---|---|
| F1 | Ours | 7: This week / Last week / Earlier sections | 7: 14 days only; times per item | 6: a log, not insight | 8: tap a day to see it | 9: neutral "not ticked: …", "No ticks saved" |
| F1 | Best | 7: dated log (from docs) | 8: every log kept, editable | 6: record only, no coach view | 7: Browse > Medications | 8: client's own data |
| F2 | Ours | 7: two labelled inputs, entries list | 8: validation keeps what was typed; rolls back on failure | 7: change line in words; no chart (old front had one) | 8: "Takes ten seconds" | 8: 180/120 → "measure again… see a doctor today" |
| F2 | Best | 6: charts (from docs) | 7: manual or synced entries | 7: coach sees trends | 6: setup varies per coach | 8: eating-disorder setting hides weight |
| F3 | Ours | 7: big body-age number, grouped rows, tag words | 7: coach-released only; empty state explains why | 6: no trend or history across tests | 8: Ask my coach on every view | 7: no interpretation here, but the Labs vault tags the same numbers "Worth exploring" (FM-optimal range) |
| F3 | Best | 6: content of smart reports undocumented | 6: delays named in reviews | 6: archive plus sharing | 7: reports in-app | 6: no detail on ranges shown |
| F4 | Ours | not built | not built | not built | not built | not built |
| F4 | Best | 7: clear trend view (from reviews) | 7: weight-centred | 7: seeing progress keeps people going | 7: always visible | 4: streaks, pushes, scripted coaching **Conflict:** streak nudges and push re-engagement; only the view scored |
| F5 | Ours | 7: one big camera button on Home | 8: photo shrink, minute polling, back-dating, "Not right?" | 7: real data for the coach | 7: camera opens straight away | 9: no numbers unless the coach turns them on, no judging, no unasked reminders |
| F5 | Best | 6: photo feed (from docs) | 6: App Store reviews call the app buggy | 7: coach replies to real meals | 7: snap and send | 7: alert goes to coach, not client |

### Tests

| ID | Side | Design | Function | Useful | Ease | Trust |
|---|---|---|---|---|---|---|
| G1 | Ours | 5: old Lab Vault look, inline styles | 8: Razorpay with webhook as source of truth; rebook at current price | 8: book, pay and see reports in one place | 6: long form inside a hosted overlay | 7: raw error strings ("could not rebook"); numbers held until released |
| G1 | Best | 7: clear booking flow (from listing) | 7: 4 metros only; delays reported | 7: home collection, fast reports | 8: slot, pay, track | 6: service inconsistency in reviews |

### Movement

| ID | Side | Design | Function | Useful | Ease | Trust |
|---|---|---|---|---|---|---|
| G2 | Ours | 6: old look; video or figure per step | 6: only `exerciseSessions[0]` can be reached (sq-host.tsx:66) | 7: coach-ordered strength work | 8: self-paced, no timer | 8: "stop if anything…", logs on unmount too |
| G2 | Best | 7: video-led sessions (from reviews) | 7: logging works; client uploads unconfirmed | 7: coach checks form | 6: dense for beginners | 7: coach-led; group challenges not scored **Partial conflict:** automated messages and reminders not scored |

### Travel

| ID | Side | Design | Function | Useful | Ease | Trust |
|---|---|---|---|---|---|---|
| H1 | Ours | 7: date inputs, Travelling card on Home | 7: date checks; end or cancel the trip | 7: links to the eating-out guide while away | 8: two dates and send | 8: "Your coach knows"; shopping list paused while away |

### Outside the app

| ID | Side | Design | Function | Useful | Ease | Trust |
|---|---|---|---|---|---|---|
| I1 | Ours | 7: wizard steps, Bristol icons, pain body map | 8: 5 s autosave through a stable API; locked/expired/submitted states | 9: the base for the whole plan | 5: very long (intake-form.tsx is 4,845 lines) | 8: a locked form says "closed", not "expired" |
| I1 | Best | 7: branded portal forms (from docs) | 8: save, sign, store | 7: coach gets full history | 7: one portal | 7: secure portal |
| I2 | Ours | 6: generic Tailwind emerald cards | 8: webhook confirms paid; page polls; gift view | 7: pay, then intake, then book, in order | 8: numbered steps | 8: booking link only after she has paid |
| I2 | Best | 7: one place to pay and book (from docs) | 8: payment tied to booking | 6: admin, not care | 7: few steps | 7: clear what was paid |
| I3 | Ours | 5: mostly Razorpay's hosted page | 8: price is a server constant; token auth; rate limit; webhook-only "paid" | 7: easy way to keep going | 7: one link | 9: amount never taken from the caller (api/maintenance/[clientId]/pay) |
| I3 | Best | 6: generic invoice page (from docs) | 8: card payment, receipts | 5: admin only | 7: pay from the portal | 6: depends on coach's terms |
| I4 | Ours | 6: old-front cards and banner | 7: letter withheld if the pay link fails; idempotent send | 7: review, maintenance and library floor | 7: banner keeps the app usable | 8: coach approves each letter; library floor is never a lock-out |
| I4 | Best | 5: a practice, not a screen (low-authority source) | 5: depends on the coach | 7: plan for life after coaching | 6: one session | 7: normalises lapses, no pressure; BetterUp auto-reminder not scored **Partial conflict:** BetterUp's automatic 30-day reminder would conflict; not scored |
| I5 | Ours | 7: print-styled brand page | 7: every recipe in the pack; Save as PDF | 7: a parting gift she keeps | 7: one page, print button | 6: no "made without X" line; steps that name the removed food print as written † |
| I5 | Best | 6: plain PDF layout (from docs) | 7: exports cleanly | 6: keeps recipes after the plan | 7: print or save | 7: coach-chosen recipes |

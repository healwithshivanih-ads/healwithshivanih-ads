# Sequoya client app: round 5 re-test (step 6)

The first round on the **real, deployed app**, not the prototype. Run it against the test account
(cl-900) on Fly. Get the app link from the coach app (the client's overview); never paste the token
into notes, findings or messages.

Round 4 (18 Nov 2026) ran eight testers on the round 3 prototype. Its findings are in
`docs/client-app-redesign/BUILD-PLAN.md` under "Round 4 tester findings". This round checks that
those were built, and tests everything added since.

## Before you start

- **Restore the test account afterwards.** Testers log weight, tick items, send check-ins, tap
  "It's arrived" and add diary photos. Take a copy of `~/fm-plans/clients/cl-900/` before the round
  and put it back after, or the coach's test data is overwritten.
- **Switch on what the round needs**, on the test account's overview in the coach app:
  - menu grams: **Show**;
  - a carb level, if carbs should appear in the day's target.
- **Same testers as round 4**, same scoring (0 to 10 per tester, plus the checker's defect count),
  so scores compare. Each tester answers in their own words; no tester sees another's notes.
- **Phones:** one small Android (320 to 360 px wide) and one iPhone. The iPhone tester runs the
  silent-switch check below.

## 1. Round 4 fixes, check each one

| Area | What should happen now |
|---|---|
| The ask box | Every row of the round 4 input table gives the "Must do" answer. Run the whole table, typed exactly. |
| Coach tab | A message typed there still goes through the safety list: it is sent, and the emergency card or "see a doctor today" line shows beside it. |
| Practice screen | Only Pause, Close and Dim visible; Voice, Music, Volume, Pace and Scene behind Settings. Pace only on voiced practices. |
| Dim | On by default for a practice opened after 8 pm; Home never goes dark. |
| Half-finished practice | Reopens paused, with Resume and Start again. Closing the wind-down on its last step goes to the goodnight screen. |
| Travelling card | Shows from the day of travel, not before. Ending a trip that has not started says "Trip cancelled". |
| "Has my plan changed?" | Never says "nothing has changed" when a trip has been sent. |
| "How did today go? Not really" | Always gets one kind line. |
| Numbers | "Above the lab's range" / "Below the lab's range"; "See your booking" once a test is booked. |
| Panels | One Close returns to where the flow started. |
| Forms | A rejected entry keeps what was typed; "the first number is the higher one" for blood pressure. |
| Check-in sent | Says the coach reads it before the next session and replies within 24 hours. |
| Cook sheet | Leaves out lines that are not for the cook. |
| The record | Each tick with its time; re-ticking keeps the first time; a day with nothing ticked still lists the plan; check-ins and blood pressure appear. |

## 2. New since round 4, test each

**Food diary** (Home card while a diary runs)
- Add a photo now, and one for an earlier meal with its time. Correct a "Looks like" that is wrong.
- Mark the day done; check the card folds to the thank-you.
- No grams anywhere in the diary, unless the coach switched grams on for the diary.

**Order supplements and supply** (Everything → Order supplements)
- Buy (opens the shop) → "I've ordered it" → "It's arrived" → "Lasts until about …".
- Undo at each step returns exactly one step.
- "I already have them all" marks every row without a date.
- A product with a known pack size and dose shows a date; one without shows none.
- Tester instruction: to see the "Running low" card, the coach (or the person running the round)
  sets an arrival date in the past. Do not wait weeks.

**Weight, blood pressure, trip** (Everything → You)
- A swapped reading (76/118) is refused with the typed text kept; 182/96 shows the high-reading message.
- The change line reads "down 1.5 kg since …".

**Menu grams and the day's target** (needs grams switched on)
- The next-meal card and each recipe show Protein · Carbs · Fat · Fibre in grams. Never calories.
- "About:" in front when part of the meal has no figure.
- Your whole day: the menu total, and "Your day's target" under it.
- Testers say whether the total and the target are close enough not to confuse them (the coach's
  test: "menu and target can't be so far apart").

**Everything tab part 2**: this week's menu, shopping list, check-in, tests and results, movement.
- The shopping list can be sent to someone else (share sheet or WhatsApp), and the cook sheet leaves
  out non-cook lines.

**Results you release** (step 5), if live by the round: a lab number appears only after the coach
shares it, with its range tag.

## 3. Rules every tester checks on every screen

- The coach is "Coach", never a first name. The app never offers a booking link or chases.
- Nothing names a condition, a lab, an evidence grade, or says "titrate".
- No calories on any client screen.
- The word Sequoya appears only for the test account (embargo to 2 January 2027).
- Text is readable at the phone's default size and with **Larger text** on (Everything → Larger text).

## 4. Checks only a real phone can do

- **iPhone silent switch:** with the side switch on silent, start a voiced practice. The voice and
  music must still play (the app starts an audio element from the tap for this). Then lock the
  screen mid-practice and unlock: it should be where it was.
- **Push:** with app notifications on, a coach reply arrives as a notification; the Coach tab shows the dot.
- **Offline:** airplane mode, tick two items, reconnect; both ticks are there with their times. A
  message sent offline shows "Not sent yet".

## 5. Already found before the round (fix list for step 6)

From the automated pass on 20 Nov 2026 (320 px wide, light and dark):

- **Passed everywhere:** no sideways scroll; every button has a name; dark mode keeps the app light;
  reduced motion honoured; the coach's name appears nowhere; only the test account has the new front.
- **Section labels at 11.5 px** (the small capitals over each group: "Start here", "This week",
  "Food diary · Day 2 of 5"). Raise to 12 px or more.
- **Screens carried over from the old app** (shopping list, check-in, tests and results, parts of
  this week's menu) still use the old app's sizes:
  - back and swap buttons are 28 px tall (aim for 44);
  - portions and "for Roti, Upma" notes are 11 px;
  - several labels sit just under the 4.5 contrast ratio (3.9 to 4.4): "Back", "Back to plan",
    the result group names, the check-in answer chips, the menu slot names;
  - shopping-list rows are buttons with no spoken name for a screen reader.
- **Home is blank while it loads** on the development server (about 10 seconds there). Check the load
  time on Fly; if it is more than a second or two, Home needs a loading state.

## 6. After the round

1. Write findings into the coach's notes in the same four groups as round 4.
2. Fix, re-deploy, re-check the failed rows only.
3. Restore the test account (see "Before you start").
4. The coach names who moves on 2 January; only then set `app_shell: v2` for those clients
   (ACTIVE clients only; `_APP_CLIENT_KEYS` already carries the field).

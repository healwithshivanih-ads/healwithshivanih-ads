# Food diary in the client app — plan

Status: planned 2026-10-23, not built. Prompted by Shweta (cl-906): her BUN was low twice and
we were guessing at her protein intake. The coach asked her for a 3-day photo food diary on
WhatsApp and wants it to be an app feature instead.

## What it is

A **time-boxed photo food diary** the coach switches on for one client: "for the next 3 days,
snap everything you eat and drink". The client taps one button per meal; the coach gets a
day-by-day picture of what was actually eaten, and — when she asks for it — a rough protein
estimate per day against that client's floor.

It is NOT a permanent food logger, a calorie counter, or a chase. It runs only when the coach
starts it, for the days she picks, and then stops by itself.

## Ground rules (from standing decisions — do not break)

- **Coach-initiated only.** No automatic nudges, no "you haven't logged lunch" pushes, no
  silent-for-N-days lists (`feedback_no_auto_chasing_clients`, 2026-10-23). The coach starts a
  diary and tells the client herself. A reminder exists only if the CLIENT turns it on in the
  diary card, default off.
- **No numbers to the client.** No grams, calories or protein figures on any client screen
  (`docs/MEAL_PHOTO_CHECK_SPEC.md`, v0.76 nourishment note). Estimates are coach-only.
- **Crisp client screens** — headline first, one action, reasoning a tap away
  (`feedback_client_screens_crisp_bullets`).
- **No AI spend without the coach asking.** Estimates run only when she presses the button,
  on the Mac, through the cost guard (`scripts/anthropic_client.py::build_client`, FM_API_OK).
- **Protein floor suppressed** for renal/urate-flagged clients (CLAUDE.md v0.76) — the estimate
  must use `clientProteinFloor` and its suppression, never a hand-rolled number.

## What already exists (reuse, don't rebuild)

- **Photo upload + privacy:** `api/chat-photo/route.ts` + `lib/fmdb/chat-media.ts` — phone-side
  downscale (1600px, JPEG 0.8), server re-encode with sharp (strips EXIF/GPS), server-generated
  filenames, mode 0600, daily cap via `allowDaily`, token resolved server-side via
  `resolveAppToken`. The diary upload should call the same helpers.
- **Fly → Mac sync:** `scripts/app-staging-action.py` already mirrors `files/chat/*.jpg` and
  `_thread.*.jsonl` back to the Mac (copy, never delete) and `_daily_ticks.jsonl` (merge by date).
  Mac → Fly is `client.yaml` filtered by `_APP_CLIENT_KEYS`.
- **Fly route gate:** `lib/fmdb/middleware-policy.ts` `PUBLIC_PATH_PREFIXES` — every new
  `/api/app-*` route must be added or it 404s on Fly (this has broken routes before).
- **Coach phone review:** `/m/meals` (`lib/fmdb/meal-queue.ts`), media via `api/m/media`.
- **Nutrient engine:** `lib/fmdb/menu-nutrients.ts` (`dayNutrition`, `clientProteinFloor`,
  `supplementProteinPerDay`), recipe `nutrients_per_serving`, fallback dish table.
- **Vision call pattern:** `lib/fmdb/meal-check.ts` (Haiku, image block, forced tool) — but it
  runs on Fly with no cost guard; the diary estimate must not copy that part.
- **Assessment input:** the assess suggester already treats an uploaded `food_journal` as the
  primary nutrition source (suggester rules 10 + 24).

## Design

### 1. Coach starts a diary (desktop client page, and /m)
- "Start food diary" on the client page (Record tab). Fields: start date (default today),
  number of days (default 3; suggest including one weekend day), optional focus note for herself
  ("protein", "what she snacks on").
- Writes `food_diary: {id, start, days, focus, status: active, started_at}` to client.yaml.
  Add `food_diary` to `_APP_CLIENT_KEYS` (the staging allowlist trap, v0.78) and to the Pydantic
  `Client` model (extra="forbid").
- Gives her a ready-to-send WhatsApp line with the app link ("For the next 3 days, could you
  snap everything you eat and drink in the app? Just tap 'Add a photo'"). She sends it; nothing
  sends itself.
- "End diary" / "Extend a day" controls while active.

### 2. Client card (app, Today → "Your day")
- While a diary is active: one card at the top — "Food diary · Day 2 of 3", a big
  "📷 Add what you're eating" button, today's thumbnails in time order, and an optional
  one-line note per photo ("homemade, half a bowl").
- The meal slot is inferred from the time (`day-plan.ts::bandForHour`); the client can change
  it, and can add a photo for earlier ("I forgot breakfast") with a time picker.
- "Done for today" collapses the card. On the last day: "Thank you — Shivani will go through
  this with you." No numbers, no verdicts, no per-photo AI reply (unlike the chat).
- Optional reminder toggle inside the card (client's choice, default off) at 3 times she picks.

### 3. Storage + sync
- Photos: `clients/<id>/files/diary/<uuid>.jpg` via the chat-media helpers (separate folder so
  retention rules can differ from chat).
- Entries: append-only `clients/<id>/_food_diary.<device>.jsonl` (same pattern as the thread
  files) — `{diary_id, entry_id, at, band, photo, note, edited_at?, deleted?}`.
- New route `POST /api/app-diary` (add / note / delete), token-scoped, daily cap, added to
  `PUBLIC_PATH_PREFIXES`. Serving the client's own thumbnails: reuse `api/chat-media` with a
  diary scope, or a sibling route — token-scoped either way.
- `app-staging-action.py`: mirror `_food_diary.*.jsonl` and `files/diary/*.jpg` Fly → Mac
  (copy, never delete), exactly like chat photos.
- Fly volume is 3 GB: once a diary is closed AND its photos are confirmed on the Mac, the
  staging copies can be swept (Mac keeps the originals).

### 4. Coach review
- **Desktop client page:** a "Food diary" panel — one column per day, rows by band, photos +
  notes, click to enlarge. Coach can type what each photo is ("2 moong chilla + mint chutney")
  — that typed label always wins over any AI guess.
- **Phone:** a diary view under the client in `/m` (reuse `/m/meals` media serving).
- **Decisions inbox:** one item when a diary finishes — "Shweta's 3-day food diary is ready"
  (add a `diary` kind to `lib/fmdb/decisions.ts`).

### 5. Estimate (phase 2, coach-pressed only)
- "Estimate protein" button on the diary panel. For photos without a coach label, a Haiku
  vision call names the dishes and rough portions (Mac-side Python shim via `build_client`,
  forced tool output, never free text to the client). Coach can correct any line.
- Dish names + portions → the deterministic engine (`dayNutrition` / recipe nutrients /
  fallback table) → per-day protein + fibre, per meal, with a coverage %.
- Shown against `clientProteinFloor` (honouring its renal/urate suppression) and
  `supplementProteinPerDay`. Output is a short coach read: "~38 g/day vs floor 86 g; breakfast
  and dinner carry almost none".
- "Save to record" writes a session `sessions/<date>-NNN-app-fooddiary.yaml`
  (`session_type: quick_note`, `[source: app_food_diary]`, a `food_diary_summary` block) so
  the assessment, renewal brief and `/client` brief can read it. Also offer "Use in next
  assessment" which passes it as the `food_journal` input.

### 6. Later (phase 3, only if useful)
- Repeat diaries to compare (week 1 vs week 8).
- Focus presets beyond protein: fibre, triggers vs symptoms (the pending v0.78 item).

## Phases

1. **Diary + review, no AI** — coach start/end, client card + capture + notes, storage + sync,
   desktop + phone review, decisions-inbox item. Also fix the desktop thread panel so in-app
   chat photos render (`components/client-widgets/whatsapp-thread-panel.tsx`: kind `photo`
   missing from its attachment kinds, and `/api/client-file` looks in `files/` not
   `files/chat/`) — the coach reviews on desktop, so this matters here too.
2. **Estimate** — coach-pressed vision + deterministic nutrients + save-to-record + assess input.
3. Comparisons / other focuses.

## Tests that must exist
- `food_diary` survives the Mac→Fly allowlist (a test in the style of
  `test_intake_mrs_baseline.py`: allowlist ↔ Pydantic model).
- `/api/app-diary` is in `PUBLIC_PATH_PREFIXES` (middleware-policy test).
- Staging mirror carries `_food_diary.*.jsonl` + `files/diary/*.jpg` Fly → Mac and never deletes.
- No client-facing component renders a number from the estimate (grep-style test on the
  diary card props).
- No push or WhatsApp is sent by the system when a diary starts, runs or ends (unless the
  client switched on their own reminder).
- Estimate uses `clientProteinFloor` and returns the suppressed floor for a urate/renal-flagged
  fixture.

## Out of scope / separate
- `lib/fmdb/meal-check.ts` (the chat meal-photo check) calls the API on Fly on every chat photo
  with no cost guard — fix separately.
- `docs/MEAL_PHOTO_CHECK_SPEC.md` still says "specified, not built" and `client-thread.ts` says
  "shadow mode"; both are stale.

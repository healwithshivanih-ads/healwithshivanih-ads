# Food diary in the client app — plan

Status: **phases 1 and 2 built 2026-10-23** — see "Phase 1 as built" and "Phase 2 as built" at
the end. Phase 3 (comparisons, other focuses) not built. Prompted by Shweta (cl-906): her BUN was low twice and
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
- **AI reads every photo automatically — the coach is NOT the interpreter** (coach decision
  2026-10-23: "let AI process the photos unless it really can't understand it. Don't send them
  to me for manual interpretation"). Calls run on the Mac through the cost guard
  (`scripts/anthropic_client.py::build_client`, FM_API_OK) so the switch still works; Haiku,
  one call per photo, never on Fly.
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

### 5. Automatic reading + estimate (phase 2)
- **Every photo is read automatically** once it reaches the Mac (a cron step after the staging
  mirror, or the sync itself): one Haiku vision call names the dishes and rough portions with a
  forced tool output and a confidence. No coach button.
- **Only a photo the AI truly cannot read** (blurry, not food, a packet with no label, confidence
  below a threshold) goes to the coach as ONE decisions-inbox item listing those photos. Everything
  else never needs her. The coach can still correct any line, and her label always wins.
- Dish names + portions → the deterministic engine (`dayNutrition` / recipe nutrients /
  fallback table) → per-day protein + fibre, per meal, with a coverage %. Shown against
  `clientProteinFloor` (honouring its renal/urate suppression) and `supplementProteinPerDay`.
- **When the diary ends, the summary is written by itself**: a session
  `sessions/<date>-NNN-app-fooddiary.yaml` (`session_type: quick_note`, `[source: app_food_diary]`,
  a `food_diary_summary` block — e.g. "~38 g/day vs floor 86 g; breakfast and dinner carry almost
  none") so the assessment, renewal brief and `/client` brief read it, and the decisions-inbox item
  becomes "Shweta's food diary summary is ready". Offered as the `food_journal` input to the next
  assessment.
- Still coach-only: nothing from the reading reaches the client.

### 5b. What the CLIENT sees — plate balance, never grams (phase 2, coach decision 2026-10-23)
The coach asked whether clients should see their protein intake to help them stay on plan, and
added: "it should also show if protein is too little and carbs are too much". Decided shape:
- **Per meal, three marks, read from the plate's proportions** (the AI reading gains a
  `balance: {protein: present|light|none, veg: present|light|none, carbs: balanced|heavy}`
  field): e.g. "Protein ✓ · Veg ✓ · Carbs heavy". Proportions are what a photo can judge; grams
  are not (a photo protein estimate can be 30–50% off, and dish coverage is ~55%).
- **During the diary:** under today's photos, a row of meal dots — filled when that meal had a
  protein, with a soft "carb-heavy" tag on plates that leaned on rice / roti / poha / biscuits
  with little protein or veg.
- **At the end:** one strength + one fix, in plain food words from THIS client's diet
  ("Dinner was well balanced every day — breakfast leaned on poha with no protein. Try a moong
  chilla or a bowl of curd."). Swaps must respect her foods_to_avoid / allergies / diet (no
  wheat for a gluten-free client, no paneer for Shweta).
- **No numbers on any client screen** — no grams, calories or percentages. The gram estimates
  stay in the coach summary.
- **Tone:** observations, never verdicts ("leaned on", "light on", never "bad", "too much",
  "failed"). One fix per diary, not one per meal.
- **Gentler for flagged clients:** where the app already treats a client as anxious / on
  benzodiazepines-SSRIs / ED-risk, show only the protein dots and the end-of-diary tip — no
  "carb-heavy" tags. Coach can switch the balance marks on or off per client
  (`food_diary.show_balance`, default on, default off for flagged clients).
- **Optional grams for clients who want numbers** (e.g. a numbers-driven gym-goer):
  `food_diary.show_grams`, default OFF, never available for flagged clients.

### 6. Later (phase 3, only if useful)
- Repeat diaries to compare (week 1 vs week 8).
- Focus presets beyond protein: fibre, triggers vs symptoms (the pending v0.78 item).

## Phases

1. ✅ **Diary + review, no AI** (built 2026-10-23) — coach start/end, client card + capture + notes, storage + sync,
   desktop + phone review, decisions-inbox item. Also fix the desktop thread panel so in-app
   chat photos render (`components/client-widgets/whatsapp-thread-panel.tsx`: kind `photo`
   missing from its attachment kinds, and `/api/client-file` looks in `files/` not
   `files/chat/`) — the coach reviews on desktop, so this matters here too.
2. ✅ **Automatic reading + estimate** (built 2026-10-23, incl. §5b plate balance) — every photo read by AI on the Mac, only unreadable ones to the coach, summary saved to the record automatically when the diary ends, assess input.
3. Comparisons / other focuses.

## Tests that must exist
- `food_diary` survives the Mac→Fly allowlist (a test in the style of
  `test_intake_mrs_baseline.py`: allowlist ↔ Pydantic model).
- `/api/app-diary` is in `PUBLIC_PATH_PREFIXES` (middleware-policy test).
- Staging mirror carries `_food_diary.*.jsonl` + `files/diary/*.jpg` Fly → Mac and never deletes.
- No client-facing component renders a number from the estimate (grep-style test on the
  diary card props).
- A readable photo never creates a coach review item; only an unreadable one does.
- The client diary view shows balance marks but no number unless `show_grams` is on; flagged clients never get `carbs` tags or grams.
- The vision call goes through `build_client` (FM_API_OK off → no call, photo queued, not lost).
- No push or WhatsApp is sent by the system when a diary starts, runs or ends (unless the
  client switched on their own reminder).
- Estimate uses `clientProteinFloor` and returns the suppressed floor for a urate/renal-flagged
  fixture.

## Out of scope / separate
- `lib/fmdb/meal-check.ts` (the chat meal-photo check) calls the API on Fly on every chat photo
  with no cost guard — fix separately.
- `docs/MEAL_PHOTO_CHECK_SPEC.md` still says "specified, not built" and `client-thread.ts` says
  "shadow mode"; both are stale.


## Phase 1 as built (2026-10-23)

Where it lives:

| Piece | File |
| --- | --- |
| Shape, window, fold, client view, inbox age, reminder ids (pure) | `fm-database-web/src/lib/fmdb/food-diary.ts` |
| Disk: append/read `_food_diary.<host>.jsonl`, read the switch | `src/lib/fmdb/food-diary-store.ts` |
| Coach actions: start / +1 day / end / mark reviewed / correct a photo / load | `src/lib/server-actions/food-diary.ts` |
| Client route (add / edit / delete / done; GET = own thumbnails) | `src/app/api/app-diary/route.ts` (in `PUBLIC_PATH_PREFIXES`) |
| Client card, top of Today → "Your day" (and the maintenance home) | `src/app/app/[token]/ochre-diary.tsx` |
| Desktop panel, Record tab | `src/app/(v2)/clients-v2/[id]/analyse/food-diary-panel.tsx` |
| Phone view (read-only) | `src/app/m/(tabs)/clients/[id]/diary/page.tsx` |
| Inbox item | `lib/fmdb/decisions.ts` kind `diary` |
| Switch on the model | `fmdb/plan/models.py::FoodDiary`, `Client.food_diary` |
| Sync | `scripts/app-staging-action.py` `_APP_CLIENT_KEYS` + `_mirror_food_diary` |
| Tests | `src/lib/fmdb/food-diary.test.ts`, `fm-database/tests/test_food_diary_staging.py`, `middleware-policy.test.ts` |

Where it differs from the design above, and why:

- **Each JSONL line is an EVENT, not a row snapshot**: `{op, diary_id, ts, entry_id, …only the
  fields that event changes}` with `op` ∈ `add | edit | delete | day_done | label | read`. The
  reader folds them in `ts` order across every host's file. This is what lets phase 2 append an AI
  reading (`op: "read"`, `{readable, confidence, dishes[{name, portion}]}`) and the coach correct it
  (`op: "label"`, always wins) on the same entry with no migration.
- **Coach corrections live in `_food_diary.mac.jsonl`** and are forwarded Mac → Fly (like
  `_thread.mac.jsonl`) so `/m` on Fly shows them. Client lines come back Fly → Mac. Photos are
  copy-only Fly → Mac, never deleted by the mirror.
- **`focus` is stripped** from the staged `client.yaml` — it is the coach's own note.
- **Client times/dates are the phone's own**: the card sends `date` + `time`; the route accepts a
  date only if it is a diary day and not more than a day ahead of UTC (`acceptClientDiaryDate`).
- **Thumbnails**: GET on `/api/app-diary` (token-scoped), not a mode of `/api/chat-media`.
  Desktop uses `/api/client-file/<id>/<file>?dir=diary`; `/m` uses `/api/m/media?scope=diary`.
  `chat-media.ts` gained a `scope` ("chat" | "diary") — same re-encode/strip path, separate folder,
  so the chat's 365-day sweep can never reach a diary.
- **Reminders** are three opt-in reminders (`diary-breakfast` 09:00, `diary-lunch` 14:00,
  `diary-dinner` 21:00) derived in `reminders-derive.ts` only while a diary runs, `defaultOn: false`,
  stored and fired through the existing override file + `app-reminders` cron. The card has one
  "Remind me at meal times" switch and editable times. Nothing fires unless the client turns it on.
- **Client band names** are food words: Early morning / Breakfast / Lunch / Evening / Late night
  (same boundaries as `day-plan.ts::bandForHour`, pinned by a test).
- **"Done for today"** is recorded (`op: "day_done"`) so the coach sees which days the client
  called complete; a new photo that day re-opens it.
- **Inbox exit**: "Mark reviewed" on the panel (`food_diary.reviewed_at`) or 14 days. Ending early
  reads "food diary ended early".
- **One diary at a time.** Starting a new one replaces the switch; the old diary's lines stay in
  the JSONL under its own `diary_id` (phase 3 comparisons can list them).
- **Not built in phase 1:** sweeping staging copies of photos off the Fly volume once a diary is
  closed; any AI reading.

Also fixed (phase 1 scope): in-app chat photos now render in the desktop thread
(`whatsapp-thread-panel.tsx` maps kind `photo` → image and asks `/api/client-file` for `?dir=chat`;
the route accepts a closed `dir` list of `chat | diary`).


## Phase 2 as built (2026-10-23)

| Piece | File |
| --- | --- |
| Vision reader (Haiku, forced tool, through `build_client`) | `fm-database-web/scripts/read-diary-photos.py` |
| Summary session writer (one per diary, upserted) | `scripts/save-food-diary-summary.py` |
| Cron (every 5 min, Mac only, quiet) | `src/app/api/cron/food-diary/route.ts`, `scripts/cron-runner.js` |
| Coach estimate (deterministic engine) | `src/lib/fmdb/food-diary-estimate.ts` |
| Client plate balance, gentle rule, end-of-diary tip | `src/lib/fmdb/food-diary-balance.ts` |
| Read states, display switches, client view | `src/lib/fmdb/food-diary.ts` |
| Assessment input | `scripts/assess.py::_load_food_diary_summary` → `client_context.food_diary_summary`, suggester rule 24 |
| Briefs | `scripts/client-brief.py` (`last_food_diary`, `food_diary_running`), `scripts/renewal-brief.py` (`food_diary`) |
| Tests | `food-diary-phase2.test.ts`, `food-diary.test.ts`, `fm-database/tests/test_food_diary_reader.py` |

How it runs:

1. Every 5 minutes the cron lists diaries that are running or finished within 14 days. Any photo with
   no reading → one `read-diary-photos.py` run. Each photo → one Haiku call → one `{"op":"read"}`
   line in `_food_diary.mac.jsonl` with `dishes [{name, count, size}]`, `balance {protein, veg?,
   carbs?}`, `confidence`, `readable`, `reason`. Below 0.5 confidence, not food, or no dish named →
   **unreadable**. `FM_API_OK` unset → no call, nothing written, photos stay queued.
   ~2k input tokens a photo (Haiku) — well under a cent each. Usage is logged per client.
2. Coach-labelled photos are still read, because the client's balance marks come from the reading.
   The coach's label wins for dishes everywhere (estimate, summary, captions).
3. When a diary finishes, and once its photos are read (or a day has passed), the estimate goes to
   `sessions/<date>-NNN-app-fooddiary.yaml` (`[source: app_food_diary]`, `food_diary_summary` with a
   `fingerprint`). Later reads or corrections rewrite the same session; a run with no change writes
   nothing.
4. Readings reach Fly through the existing `_food_diary.mac.jsonl` forward, so the client's marks
   appear a few minutes after the photo.

Decisions made while building, and why:

- **The swap in the tip is deterministic, not AI-written.** A curated table filtered by diet
  (vegetarian / eggetarian / vegan / Jain / non-veg; an unknown diet is treated as vegetarian), by
  the dairy resolver (`resolveDairy` — a milk-protein allergy or an unrecorded "milk" removes curd
  and paneer, lactose intolerance keeps them), and by any food named in allergies / foods to avoid /
  triggers. If nothing is left, there is no fix rather than one she cannot eat. $0, and testable.
- **The tip waits** until every photo is read or named — a tip from half a diary names the wrong
  meal. It shows on the last day after "Done for today", and for 7 days after the diary ends.
- **Gentle** = anxiety / panic, SSRIs / SNRIs / benzodiazepines (generic and common Indian brands),
  or eating-disorder history, in conditions / history / medications (`diaryGentle`). Gentle clients
  get protein marks + the tip worded about adding protein (never "leaned on" or carbs). The coach's
  explicit `show_balance` still wins; `show_grams` is refused for them.
- **Grams to the client** (`show_grams`) are food protein for today, rounded to 5, from the same
  estimate. The protein powder is not included, and the card says "from what you photographed".
- **Inbox:** `diary` says "reading the photos" until the summary exists, then "food diary summary is
  ready — <line>". A separate `diary_photo` item appears only when a photo is unreadable and not yet
  named ("2 diary photos the AI couldn't read — say what they are"). A readable photo never creates
  an item.
- Measured on test photos: dal + 2 rotis read correctly; upma read as poha (close enough for
  balance); a blank image was correctly unreadable. A besan chilla was read as anda bhurji for an
  **eggetarian** client — allowed by her diet. The prompt now tells the model to prefer the dish the
  diet allows when two look alike. One reply came back without veg/carbs, so `balance` now keeps any
  valid axis (protein required).

### Fixes after the first live use (2026-10-23, cl-900)

- **Dinner runs to 11 pm.** `diaryBandForHour` no longer mirrors `day-plan.ts::bandForHour`: a
  9:21 pm dinner was filed as "Late night" (9 pm is "before bed" for the routine, not for food),
  which also kept it out of the tip. Late night is now 11 pm – 5 am.
- **The card shows the result without a reload.** After a photo it says "Added — its marks show
  here in a few minutes" and polls `GET /api/app-diary?view=1` about once a minute (visible tab
  only, ≤ 20 tries) until the marks arrive. Not a page refresh: a refresh logs an app open each time.
- **"Done for today" keeps the day's protein dots** instead of folding to a bare line.

### The client corrects the AI, and gets a line per meal (2026-10-23, coach)

Coach, testing as cl-900: "I took a picture of spaghetti only. If the AI identified it as with egg I
need the option to correct it, else the whole thing will be wrong. Also as the client I want some
feedback on my meals." Then: "it needs to be diet aware — no one will add dal to spaghetti."

- **The client sees what the photo was read as** ("Looks like spaghetti with egg · Not right?") and
  can say what it is. That is an `edit` line with `name` → `client_label`. The coach's label still
  wins; the client's wins over the AI. The rule "nothing from the reading reaches the client" is
  relaxed to "the dish names, never confidence, portions or numbers".
- **A correction re-reads the photo** with the client's words in the prompt
  (`entryNeedsRead` ↔ `read-diary-photos.py::unread_entries`: never read, or labelled after the last
  read). The balance is judged for the real plate. While it is re-read, the old marks are hidden.
- **One feedback line per meal** (`mealFeedback`), breakfast / lunch / dinner only, from the plate
  balance. Observational, no numbers; gentle (or balance off) → protein only.
- **The suggestion comes from the reader, not a list.** The reader returns `protein_idea`: one
  addition that suits THIS dish's cuisine, given the client's diet, allergies, avoid list and dairy
  line. `ideaAllowed` is a hard filter on render (diet / dairy / soy / gluten / nut words + every
  avoid/allergy token). No safe idea → "Adding some protein would help", never a mismatched dish. The
  end-of-diary fix uses the plates' ideas first; the fixed swap list is only the backstop.

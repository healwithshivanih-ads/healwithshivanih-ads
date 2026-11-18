# Recent work log + key invariants, v0.81 → v0.91 (Aug–Nov 2026)

> Moved verbatim out of the root `CLAUDE.md` on 2026-11-17 (original lines 74–250). Index: [`/CLAUDE.md`](../../CLAUDE.md).
> Covers: Contraindication matcher, client_fit gate, food diary, dairy reaction, lifecycle + decisions inbox + contact gate, interest tracking, programme feedback, renewal timing, monthly cards, intake auto-lock, lapsed-client guards, wheat flour / food-caution matching, MRS on intake + check-in, IFM mast-cell ingest.
> Version notes describe the code when written; newer entries in `invariants-v0.81-v0.91.md` and git history override older ones.

**Catalogue ingest — IFM mast-cell content (2026-11-15, PR #168, chat-authored at $0).** 4 IFM articles + 3 Pathways to Well-Being podcasts (Plotnikoff 2022, Afrin 2023, Vojdani 2024 MCAS passage) → 7 sources (`ifm-article-*`, `ifm-podcast-*`), 37 claims, topic `hereditary-alpha-tryptasemia`, lab tests `chromogranin-a` / `n-methylhistamine-urine` / `leukotriene-e4-urine` / `prostaglandin-d2-metabolite-urine`; `tryptase` stub filled in. ifm.org returns 403 to WebFetch, so read it through Chrome. The embedded IFM videos (video.ifm.org player) have no transcript. Contested speaker claims are tiered down with caveats (Afrin's 17–20% prevalence; Plotnikoff's "no methionine in gluten-free plant diets"). 3-letter aliases (`HAT`) left off on purpose: short aliases false-match.

**v0.91 — a supplement's contraindications are tested against the real record (2026-11-02).** `check_plan` compared them by exact string, so "Active peptic or gastric ulcer, gastritis or erosive oesophagitis — ..." never met "GERD / acid reflux" and "Shell cal 500, omez 20, restil 0.25" never met "omeprazole": zero hits across 20 published plans. Measured after, on the same data: +11 WARNINGs, 0 CRITICAL. The one that mattered: cl-023's list says only "blood thinner" and the plan carries K2, which opposes warfarin.

**Key invariants (v0.91):**
- **Conditions join on a concept, never on the strings.** `data/_condition_terms.yaml` (underscore-prefixed, `fmdb validate` skips it) maps catalogue wording and record wording to one concept; `fmdb/plan/supplement_clash.py` reads it. A new spelling is a term on the concept. A string with no concept stays silent on purpose (surgery timing, route of use, alcohol, smoking). 359 of 444 strings map; a test ratchets the coverage.
- **Only the LABEL counts, both sides.** Text after " — " is narrative, and cl-013's hypothyroid entry goes on to say "until H. pylori and ulcer are excluded". The folded search text is not what the coach sees: findings quote the record's own wording.
- **Medications go through `drug_match.py`.** `match_drugs` (TS `matchDrugs`) returns every record on a line; `match_drug` keeps one and loses the rest of "Tazloc AM (telmisartan + amlodipine)". Eye drops and anything stopped are dropped first, including "Taken in place of Janumet."
- **Same class is not same drug.** `_MEMBERS_NEEDED`: antibiotics never expand (23 of the first 37 hits were amoxicillin inheriting doxycycline's chelation rule, all false); beta blockers and CCBs expand only when the supplement names 2+ members, because `propranolol` or `diltiazem` alone is a drug-specific line. Vitamin K antagonists are their own record, since K2 matters for warfarin and not clopidogrel. An unnamed "blood thinner" could be either, so it is asked. Daily aspirin counts as a blood thinner too (`_BLOOD_THINNER_RECORDS`). The class word is read from a line's LABEL only: the K2 line's narrative says "anticoagulant effect", and reading that had put the K2 question in front of every clopidogrel and rivaroxaban client.
- **Firm or soft.** Firm = the record states the diagnosis and the catalogue states the contraindication flatly. `Suspected:`, history, and a hedged catalogue line ("uncontrolled", "monitor", "consult a physician", "may") are soft and never block. A record saying "mild" is no hit on a severe/advanced line.
- **Every hit is a question with somewhere to answer it.** Contraindications and avoid-together drugs are flags in `fit_requirements`, so they appear in `ClientFitPanel` and an answered row clears them. CRITICAL only in draft / ready; published plans get a WARNING (v0.86 rule). `monitor` and `space_by_hours` stay plain WARNINGs, and a spacing warning is dropped when the plan's `timing` line already names the drug. `contraindications.medications` was never read by check_plan; it is now.
- **Dairy is not a concept.** Milk goes through `plan/dairy.py`.
- **One answer on every surface.** `assess/author_gate.py`, `check-supplement-for-client.py` and `checkSupplementInteractionsAction` compare nothing themselves any more; they read `supplement_clash.py` (`condition_clashes`, `medication_clashes`, `active_medications`), and `test_contraindication_surfaces.py` fails if one goes back. `medication_clashes` is the one place that says what blocks, one hit per drug or class.
- **Each surface keeps its own meaning of severity.** Gate: firm = HARD, soft = WARN, because HARD refuses the save and the chat path has no override. A `continue_or_change: stop` row is never refused: taking it off IS the answer. Widget: `avoid` only on a firm hit; a home remedy only ever says `caution`.
- **`unnamed` is not `soft`.** "Blood thinner" with no drug stays a blocking flag in `check_plan`, where the coach has a row to answer it. The gate and the widget have no row, so there it is a WARN / `caution`. Do not fold it into `soft`: that would drop cl-023's K2 question from CRITICAL on a draft.
- **The plan-editor banner matches nothing in TS.** `open-contraindications.ts` takes `fit_required` from `plan-check.py` and keeps a flag only if `check_plan` raised a `client_fit` finding with target `<slug>:<flag id>`, so an answered row and a lapsed client are decided in Python alone. If `plan-check.py` fails the editor toasts rather than showing a clean banner: a plan the model cannot load has no answer.
- **Home remedies use the same vocabulary, and only about a quarter of their 848 lines map.** They are prose ("poor fluid intake — fibre without water worsens constipation"), and an unmapped line stays silent, which is what removed the old substring false hits. The widget still lists every line. `prose_terms` reads a drug named only inside brackets, which is how cl-019's Dinogest reaches ashokarishta and seed cycling; `_term_parts` drops brackets on purpose for supplements.
- **Survey clients in care only** (`lifecycle.py::IN_CARE`, `resolve_all`), not every file in `published/`. A roster survey on lapsed clients is time and credits the coach does not want spent.

---

**v0.86 — a protocol is a template, so every plan is tested against the client.** Shweta (cl-906) took a digestive enzyme because the 5R Replace step lists one. Nothing in her record showed she lacked enzymes, she has daily reflux on Omez, and she is allergic to mushrooms and yeast while the capsule is mould-fermented. Severe burning and reflux was the first test that item had. Nothing had asked: the template picker, `generate-draft` and the chat path all took the protocol's word, and no product was ever chosen for that line (it resolved to the default link).

**Key invariants (v0.86):**
- **`Plan.client_fit` + `fmdb/plan/client_fit.py`.** A plan with a protocol attached needs a row for the protocol and for EVERY supplement: `client_evidence` (what in HER record says she needs it) and `risk_check` (what could go wrong for her, and what was done). Missing, or under 20 characters, is CRITICAL in draft / ready, so `submit_plan` refuses. It lives in `check_plan` because that is the one place every route passes through. The gate cannot judge the answer; it makes the question impossible to skip.
- **`data/_client_screens.yaml` reads the REAL product.** It matches the `ingredients` of the product the client is sent to, because a plan line saying "protein powder" hides the DigeZyme inside it. A hit applies to any plan, protocol or not. Published plans are not re-gated: a hit is a WARNING.
- **Rows never carry to a successor** (`client_fit: []` in `generateFollowUpPlan`). A new phase is tested against who she is by then.
- **Plan editor must not save `client_fit`.** `ClientFitPanel` owns those rows; the editor holds the plan it loaded with and would wipe newer answers, hence `withoutClientFit`.
- **Why the old checks missed it:** `contraindications.conditions` was matched by exact string against free text, and `ai_check` was told not to re-flag contraindications because "the deterministic checker handles them". The AI prompt no longer says that. The matcher is fixed in v0.91.

---

**v0.90 — food diary, phase 2: AI reads every photo; clients see plate balance (2026-10-23).** As built: `docs/FOOD_DIARY_PLAN.md` → "Phase 2 as built".

**Key invariants (v0.90):**
- **The coach is not the interpreter.** `/api/cron/food-diary` (every 5 min, Mac only, quiet in pm2) runs `read-diary-photos.py`: one Haiku call per unread photo through `build_client`, written as an `op:"read"` line to `_food_diary.mac.jsonl`. Confidence < 0.5 / not food / no dish → unreadable → the ONLY thing that reaches her (`diary_photo` inbox item). `FM_API_OK` unset → nothing read, nothing written, photos stay queued.
- **Coach estimate = the menu engine**, never a hand-rolled number: `food-diary-estimate.ts` feeds dishes (coach label wins, else reading with count/size) to `componentNutrients`, the floor from `clientProteinFloor` (suppressed for kidney / liver / urate), the protein powder from `supplementProteinPerDay`, reported separately.
- **Summary goes on the record by itself** when a diary finishes and its photos are read (or after a day): `sessions/<date>-NNN-app-fooddiary.yaml`, `[source: app_food_diary]`, `food_diary_summary` with a `fingerprint` (rewritten in place only when something changed). Read by `assess.py` (`client_context.food_diary_summary`, suggester rule 24 treats it as the food journal), `client-brief.py`, `renewal-brief.py`.
- **Client sees words, never numbers (§5b):** per photo `marks {protein, veg?, carbs?}` (Protein ✓ / Light on protein / No protein · Veg · Carb-heavy), protein dots, and at the end ONE strength + at most ONE fix from `food-diary-balance.ts::diaryTip`. The swap list is deterministic and filtered by diet + `resolveDairy` + allergies / foods to avoid. No fix is better than one she cannot eat. Observational wording is pinned by a test.
- **Gentle clients** (`diaryGentle`: anxiety, SSRI/SNRI/benzo incl. Indian brands, eating-disorder history) get protein marks + the tip, worded about adding protein. `food_diary.show_balance` (default on, off for gentle) and `food_diary.show_grams` (default off, refused for gentle) are on the Pydantic `FoodDiary` and staged. Grams = food protein today, rounded to 5.
- `clientDiaryView` key pin changed deliberately: entries now carry `marks`; the view carries `finished`, `tip`, optional `gramsToday`. After first live use (2026-10-23) each entry also carries `looksLike` (the AI's short read, so the client can tap "Not right?" and correct it — an `edit` line with `name`, which re-reads the photo) and one diet-aware `feedback` line per meal (AI `protein_idea` per dish, hard-filtered by `ideaAllowed`; no list fallback). Confidence, grams per meal and the coach's notes still never reach the client.

---

**v0.89 — food diary, phase 1 (2026-10-23).** Plan + as-built notes: `docs/FOOD_DIARY_PLAN.md`. The coach starts a time-boxed photo food diary on the **Record** tab (start date, days, a private "looking for" note) and gets a WhatsApp line to send herself; the client sees "Food diary · Day N of M" at the top of Today → Your day, one big add-photo button, slot inferred from the clock (changeable, "Earlier" with a time), optional note, "Done for today".

**Key invariants (v0.89):**
- **Coach-initiated, nothing sent.** No push / WhatsApp / email when a diary starts, runs or ends. The only push is one of three meal-time reminders the CLIENT switches on in the card (`diary-*` in `reminders-derive.ts`, `defaultOn: false`, only while the diary runs). `food-diary.test.ts` greps every diary file for a send import.
- **No numbers on the client.** `clientDiaryView()` builds the client payload field by field — no coach correction, no AI reading can ride along. Test pins the key set.
- **`client.yaml#food_diary` is the switch** (`{id, start, days, focus?, status, started_at, ended_at?, reviewed_at?}`, Pydantic `FoodDiary`), in `_APP_CLIENT_KEYS` with `focus` stripped. **What happened lives in `_food_diary.<host>.jsonl`** — append-only EVENT lines (`add | edit | delete | day_done | label | read`) folded in `ts` order; Fly writes the client's, the Mac the coach's corrections. Phase 2's AI reading is just more `read` lines. Photos in `files/diary/` (chat-media `scope: "diary"`, same strip/re-encode, outside the chat sweep).
- **Sync:** `_mirror_food_diary` in `app-staging-action.py` — Fly → Mac every non-mac JSONL + `files/diary/*.jpg` (copy, never delete); Mac → Fly `_food_diary.mac.jsonl`.
- **`/api/app-diary`** is token-scoped and in `PUBLIC_PATH_PREFIXES`; refuses every write unless the coach's diary is active and the date is one of its days. Daily cap 40 photos.
- **Inbox:** `diary` kind in `decisions.ts` — "N-day food diary finished — ready to look at", never "photos to label" (coach decision: she is not the interpreter). Exit: Mark reviewed, or 14 days.
- **Desktop thread now renders in-app chat photos** (`kind: photo` → image, `/api/client-file?dir=chat`).
- **Next: phase 2** — every photo read by Haiku on the Mac through `build_client`, only unreadable ones to the coach, summary auto-saved when the diary ends.

---

**v0.88 — milk-protein allergy vs lactose intolerance (2026-10-23).** cl-906 had "Milk" in `known_allergies`; the coach wanted lactose-free high-protein milk or a BLG whey shot — fine for lactose intolerance, unsafe for a milk-protein allergy, and the intake never asked. **Measured while building: "Milk" was being ignored in BOTH directions** — `recipe_select.is_safe` substring-matched "milk" against the library tag "dairy" (never matches → paneer/curd served), the author gate scanned the token "milk" (never hit `protein-whey-isolate`, DID hit `milk-thistle`), and the weekly drafter got no allergy line at all while rule 10 told it to anchor protein with paneer/curd.

**Key invariants (v0.88):**
- **One module: `fm-database/fmdb/plan/dairy.py`** (TS mirror `src/lib/fmdb/dairy-reaction.ts`; `tests/test_dairy_reaction.py` + `dairy-reaction.test.ts` pin the same cases). `resolve_dairy(client)` → `{kind, source, ghee_ok}` or None. `kind`: `lactose_intolerance` (avoid milk/cream/khoa; lactose-free milk, curd, paneer, ghee, whey ISOLATE fine) · `milk_protein_allergy` (no milk protein at all, lactose-free milk included; ghee only if `tolerates_ghee: yes`) · `unsure` (= allergy until confirmed). **A dairy word in allergies / foods_to_avoid / reported_triggers with no type recorded reads as `unsure`, `source: inferred`** — so un-asked clients (cl-906 today) now get dairy EXCLUDED, not ignored. Read through the resolver, never the raw fields.
- **Intake:** conditional follow-up (`DairyFollowUp` in `intake-form.tsx`) when milk/dairy/lactose is named — symptom chips, how soon, curd/paneer/ghee Fine/Reacts/Not sure. Raw fields `dairy_reaction_symptoms` (list) + `dairy_reaction_timing` / `tolerates_curd` / `tolerates_paneer` / `tolerates_ghee` on the Client model; own allowlist `_DAIRY_SCALAR_FIELDS` / `_DAIRY_LIST_FIELDS` in `intake-token-action.py` — key-validated, **overwrite incl. blanks** (the form posts blanks when the question is hidden). `dairy_reaction_type` is DERIVED at submit (`derive_dairy_reaction_type`: allergy sign → allergy; ghee reacts → allergy; curd AND paneer react → allergy; gut-only + curd or paneer fine → lactose; else unsure) and is **never client-writable**. Curd is the tell: full milk protein, little lactose.
- **Coach override:** intake view → 🥛 Dairy panel → "Confirmed on the call" (`setDairyReactionType`) writes `dairy_reaction_source: coach`, which an intake re-submit never overwrites; "Go back to the intake answers" re-derives (TS mirror of the derivation). Plan-conflicts rule 4c flags `unsure` until confirmed; 4b flags dairy non-negotiables for an allergy; rule 4 drops dairy words for lactose intolerance.
- **Consumers wired:** `allergy_prompt_line` / `allergyPromptLine` append the dairy line and take a lactose-intolerant "Milk" off the ABSOLUTE list (reaches letters, app menu, follow-up, travel guide, meal-photo check) · `recipe_select` (`recipe_dairy_ok`) · weekly drafter (new rule 17 + allergy line) · `protein_logic.pick_protein_source` (lactose → whey isolate) · suggester rule 20 (reads `client.dairy_reaction`; also fixed "whey only for non-veg" — dairy is vegetarian) · `dairy_reaction` in assess / chat / rework / follow-up / plan-chat / quick-chat / intake-insights / plan AI check · author gate HARD-blocks milk-protein supplements for allergy/unsure, none for lactose, and no longer trips on milk thistle · letter product clash set · morning rituals (golden milk) · monthly-card review flag · client app chip ("Lactose-free" vs "Dairy-free") · client brief + snapshot card. `dairy_reaction_type` + `tolerates_ghee` added to `_APP_CLIENT_KEYS`.
- Measured on the live library (458 recipes, vegetarian, "Milk"): unsure 378 pass (0 paneer), lactose 435 (12 paneer kept), allergy 256 (ghee out) / 378 with ghee OK.
- cl-906's record was deliberately NOT changed — the coach is asking her directly; record the answer on her intake view.

---

**v0.87 — one lifecycle state, a decisions inbox, no chasing (2026-10-23).** Review + plan: `fm-database-web/docs/COACH_APP_RESTRUCTURE_REVIEW.md`. Branch `claude/coach-dashboard-restructure-90ee02`.

**Key invariants (v0.87):**
- **ONE lifecycle resolver.** `src/lib/fmdb/lifecycle.ts::resolveLifecycle(client, plans, today, {decisions})` ↔ `fmdb/plan/lifecycle.py::resolve_lifecycle` (parity-pinned by `lifecycle.test.ts`). States, first match wins: `archived` → `maintenance` (paid through ≥ today or a live `is_maintenance` plan) → `active` (newest programme plan in flight; ALSO "between phases" when a successor sits in draft/ready or the decision is `renewed`) → `ending` (end −15..+14d, no decision, no successor) → `onboarding` (signed up, nothing started) → `lapsed` → `prospect` (`declined` is a flag). Plan evidence beats a blank `engagement_status` for ACTIVE. **Nothing reads `engagement_status` / `lifecycle_state` / "has a published plan" for a who-is-in-care decision any more**; `Client.lifecycle_state` is retired (still on the model for back-compat, never read).
- The 06:30 `renewal-sweep` stamps `lifecycle` + `lifecycle_since` on every `clients/*/client.yaml` (surgical line edit, `lifecycle.py::stamp_lifecycles`) and **clears `next_contact_date`** for anyone lapsed / maintenance / archived. `scripts/lifecycle-report.py` prints the resolved states (read-only; chat uses it).
- **The dashboard is an inbox** (`dashboard-v2/page.tsx` + `src/lib/fmdb/decisions.ts::collectDecisions`). Nine item kinds, each with the lifecycle states it applies to (`KIND_STATES`) and an age cap: message ≤7d · renewal (ending only) · onboarding · follow-up draft (prospect, ≤35d after the call; listed ≤45d) · win-back draft (lapsed, ≤70d after the end) · thought-of-you note (prospect, pending note only) · flag (plateau/regression, in care, ≤14d) · feedback ≤14d · archive (prospect quiet >45d, lapsed quiet >70d). **No rule may emit an item without an exit.** Roster-level views (lifecycle tiles, practice overview, MSQ, app links, menu pause roster, interests list, catalogue chips) are on **/practice**. `/clients-v2` filters by lifecycle state.
- **The coach does not chase clients.** Deleted: the booking-link scanner (`scheduling-due.ts`) + bulk send + per-client booking banner, check-in nudges, review nudges, start-date reminders + confirmation tokens + `/start/<token>`, the weekly poll, the broadcast panel, the cycle-date reminder panel, the dormant strip, the feedback "asks". Booking a session is coach-initiated from the header button. Dormancy is no longer a "stalled" signal anywhere.
- **One gate at the send door.** `src/lib/fmdb/contact-gate.ts::mayContact(lifecycle, purpose)` — purposes `reply | transactional | plan | session_booking | intake | followup_drip | renewal | winback | content_note | marketing`; `session_booking` is refused for EVERY state. `marketing_opt_out` blocks every marketing purpose; `declined` allows reply + transactional only. Enforced inside `sendWhatsAppAction` / `sendWhatsAppTextAction` / `sendAndRecordOutboundAction`, `sendClientEmailAction` / `sendEducationPackAction`, `sendPushToClient` (pass `clientId` + `purpose`; a clientId without a purpose is gated as transactional and warned `[contact-gate] ungated send` in pm2). Intake reminders are `transactional` on purpose (coach opts each person in; a ₹999 prospect is a prospect by lifecycle).
- **`scripts/client-brief.py <id|name>`** is the one briefing: who / lifecycle / plan + week / recent (thread in+out, check-in, MSQ, labs, weights, queued sends) / app (opens, ticks, practices, feedback) / do-not. The `/client` skill runs it; `author-assessment` / `author-plan` / `author-renewal` start with it; `/clients-v2/<id>/brief` renders it. **A client now lands on Brief.** Subnav: Brief · Record · Plan · Communicate · History · More (= the old 56-component overview, parked at `/clients-v2/<id>/overview` until the coach says which widgets survive).
- `prospects-sweep` is scheduled (06:35, `/api/cron/prospects-sweep`) and parks **never-signed-up people only**; lapsed clients stay in `clients/`.
- Two superseded plans that still sat in `published/` (`niti-plan-1`, `ochre-plan-2`) were moved to `~/fm-plans/_retired/published-stale-20261023/`.
- Deleted ~20k lines (list in the review doc §5 and the commit `b8af02da`). `render-client-letter.py` (8.6k) is still imported by `generate-app-menu.py` for four helpers — extract, then delete. `zoom-recording.ts` is orphaned. The `com.healwithshivanih.vitaone-covers-audit` LaunchAgent still points at a deleted script — unload after merge.
- **Not done:** the Ochre Social-style redesign of the mobile coach app (`/m`, kept on purpose); pruning the "More" tab; collapsing the 6 phone normalisers / 38 date formatters / 9 session-type re-parses listed in the review doc.

---

**v0.86 — what a prospect came in with, and something useful to send them (2026-10-21).** Plan + work log: `docs/INTEREST_TRACKING_PLAN.md`.

**Key invariants (v0.86):**
- **The concern is the "main concern" answer, never the first form answer.** The cal.com form asks "How long has this been going on?" first, so follow-ups read "what you shared about 1 to 3 years" (cl-907, cl-909). `lib/fmdb/booking-form.ts::bookingConcern` refuses durations and yes/no answers; the drip re-reads the form from the booking note, so old records heal.
- **15 fixed concern ids** (`lib/fmdb/concerns.ts`; storage keys — never rename). `classifyConcerns` is keyword-only ($0) and returns concerns **in the order the person named them** — that order decides what they are sent first.
- **`client.yaml#interests`** = append-only `{concern, source, at, detail}` (Python `Client.interests` / `InterestSignal`). The coach removing a concern sets `dismissed`, and nothing automatic re-adds it. Written by booking intake, the coach (dashboard chips), and a one-off backfill (done 2026-10-21, 11 prospects).
- **Links reach a person ONLY from the content library, and only when YouTube itself says the video is public.** No hand-typed dates: the daily `content-status` cron (10:35 IST) reads each video's watch page (public / private / unlisted / upcoming + YouTube's publish date), discovers new long videos (≥3 min) from the channel feed and tags them from title + description, and checks each guide page. Results in `~/fm-plans/_content_status.yaml`; no fresh answer (≤3 days) → nothing is linked, and the 💬 panel shows a warning. `_content_library.yaml` is optional curation (better tags / line); videos there carry no date. The approve step re-checks the watch page (oEmbed alone passes unlisted videos). Hand dates were wrong within a day — the HRT video went public 18 Oct while the file said 28 Feb.
- **Email replies are read automatically** (`email-replies` cron, hourly :05): the coach mailbox over IMAP, read-only (`BODY.PEEK`, nothing marked read), mail from anyone not signed up only. Each reply lands in the thread as `[source: email_inbound]` (inbound, channel email — never opens the WhatsApp 24h window), so follow-ups hold while they're in conversation. "no more" / unsubscribe / "stop sending" / "remove me" / a short "not interested" → `marketing_opt_out` (+ `marketing_opt_out_source`), call follow-up stopped, anything pending skipped. Quoted text is ignored; "no more bloating!" is not an opt-out. Undo on the panel reverses both.
- **ochre-funnel side (PR #80):** evergreen week 1/2 emails also carry the one live channel video matching the guide(s)/IG keyword the lead came through (`lib/interests/` there; videos auto-tagged from title + blurb). The ₹999 notice carries `interests`, recorded here as `funnel:<guide>` signals. **The concern id list exists in BOTH repos — change them together; each repo's test pins it.**
- Day-1 thank-you and day-12 check-in carry one matched item (`CONTENT_TOUCHES`); never the price touch or the final door-open.
- **"Thought of you" notes** (`lib/fmdb/interest-notes.ts`): drafted by the 10:45 `discovery-followup` cron AFTER the follow-up scan, when a new item (live ≤21 days) matches a quiet prospect. At most one per 30 days, only after the call follow-up finished, never to stopped/declined/signed-up/`marketing_opt_out` people. No price ever (gate refuses ₹/credit/"free call"); opt-out line required. "Stop these notes" sets `marketing_opt_out`. A "no more" reply is NOT auto-detected — the coach presses Stop.
- **The drip and the thread now reach parked prospects** (`prospects/`). The scan read `clients/` only, so the sweep silently ended sequences that run to day 25; `save-session.py` returned "client not found" for parked people, so their sent emails and inbound messages were never recorded.
- Dashboard: **💬 Interested people** panel under 🌱 Call follow-ups.
- Not built: concerns on the (dormant) programme handover payload; IG-DM-captured emails are still not enrolled in the funnel's evergreen sequence (pre-existing, deliberate?).

---

**v0.85 — the client grades the programme.** Everything else the coach saw was measured by us (MSQ, weight, labs, adherence); nothing asked the client how we did. Programme feedback is now asked in the app at three stages, each once — **midpoint** (≥ 8-week plans, from halfway), **graduation** (once the end is actually reached, never in the final-stretch lead-in, and kept open afterwards so a lapsed client is still asked), **followup** (90 days after the end). Coach sees it on the dashboard as **💬 How are we doing**.

**Key invariants (v0.85):**
- **One definition:** `src/lib/fmdb/programme-feedback.ts` — stages, the 5 rated parts (ids are storage keys, never rename), goal-change scale (−1 worse … 3 resolved), `parseClientGoals` (splits + de-dupes the messy `client.goals` field), `resolveFeedbackDue`, `sanitiseFeedback` (the API route's validator), `summariseFeedback`. Midpoint answers are listed but kept OUT of NPS + goal figures — a progress check is not a verdict.
- **Storage = a session**, `sessions/<date>-NNN-app-feedback.yaml` with a `feedback_response` block (`scripts/save-app-feedback.py`, via `POST /api/app-feedback`). It rides the check-in sync path, so `app-staging-action.py` carries it BOTH ways: `*-app-feedback.yaml` in the reverse-mirror pattern AND `feedback_response` in the forward-copy key test. Drop either and the app re-asks a client who already answered.
- **Reaching finished clients:** `/app/<token>?feedback=1` opens the form directly (the param is stripped after). The dashboard panel lists every client whose programme ENDED (all published plans past effective end, within 365 days) with no end-of-programme answer, each with a pre-filled WhatsApp ask carrying that link. No auto-send — the coach taps it.
- **Testimonial consent** (named / anonymous / no) is asked only at graduation + followup, defaults to "no", and the panel quotes only `biggest_change` from consenting answers.
- `renewal-brief.py` now reads app check-ins by their structured `checkin_response` (the old text test for "adherence"/"poll" silently dropped every one) and includes any `feedback`. Renewal letters can now cite what the client reported in the app.
- **Renewal letters send TWO DAYS BEFORE the plan ends, by the decision on the account** (`src/lib/fmdb/renewal-offer.ts`). Each letter carries `offer_kind` — `maintenance` | `continue` | `letter_only` (older records read as letter_only) — picked on the dashboard at approval or passed as the 5th arg to `stage-renewal-letter.mjs`. Approval schedules `renewalSendDate(end) = end − 2 days, never before today`. For `maintenance` the `renewal-send` cron (Mac, 09:30 IST) mints a LIVE payment link via Fly at send time and writes it at `{{payment_link}}` (or above the sign-off); if minting fails the letter is held, not sent linkless; a client already covered by maintenance is skipped and recorded `renewed`. `continue` carries no link — programme payments run through the funnel.
- **Acumen retest add-ons:** `homocysteine`, `insulin-fasting`, `insulin-pp` (each with glucose), `iron-studies`, `ferritin` at DOS list price (2026-10-15), so a 12-week retest no longer means re-buying the ₹12,500 Base panel. Listed in Base's `covered_addon_slugs`.

**Monthly cards run themselves (2026-10-21).** The maintenance do's & don'ts card used to exist only when the coach pressed the button. Now the `monthly-cards` cron (06:20 IST) writes it for every client on a published `is_maintenance` plan (not lapsed, within `maintenance_paid_through`): this month when missing, next month from the 25th (`src/lib/fmdb/monthly-cards.ts::monthsOwed`).
- **A month table per region, picked by `client.country`** (`_REGION_TABLES`: `india`, `us`; unset country = India). The US year (clock changes, real winter, farmers' markets, Halloween / Thanksgiving) was written for Krittika (Fairfax) and carries NO Indian festivals on purpose. A country with no table falls back to India's lines AND is held — add its table to `_REGION_TABLES` + `_COUNTRY_REGION` rather than loosening the flag.
- **Hold only when something stands out.** `generate-monthly-card.py::review_flags` checks: a country with no seasonal table yet, a "do" naming a food on the avoid / allergy / trigger list or one their diet rules out, a moderate+ food caution for their condition, pregnancy, a repeat of last month. A clean card goes `live`; a flagged one is `pending_review`, which `parseMonthlyCard` never shows. It surfaces in **🗓 Monthly cards to check** on the dashboard and in the 07:30 digest; the coach approves (tap a line to leave it out) or skips the month (`skipped`, never rewritten).
- **A card in ANY state is never rewritten by the cron** (`only_if_missing`). Cards with no `status` predate it and are live.
- **Plan pick:** the card lands on the plan the app shows — maintenance first, then newest `plan_period_start` — not "highest version", which tied at v1 and could write onto Niti's dead plan-1 still sitting in `published/`.
- **Condition lines must be true of EVERY client the keyword matches.** The thyroid line said "take your thyroid support" and reached a client on no thyroid supplement. They are food-only now.

**Intake forms lock themselves (2026-10-21).** A submitted intake stays open for re-edits until it is finalised, and the coach never came back to press 🔒 Lock — 12 clients sat "submitted, not finalised" for months, and the reminder cron kept telling ten of them their form was "still waiting" (`intake-reminder.ts` now skips any submitted client). Saving an assessment (`assess.py`, API or chat-authored, never a dry run) or publishing/superseding a plan (`plan-lifecycle.py`) now finalises a SUBMITTED intake via `auto_finalise_after()` in `intake-token-action.py` (reached through `scripts/intake_autofinalise.py`). A never-submitted form is left open; Reopen undoes it; the lock never fails the save. The CLI `fmdb plan-publish` does not trigger it.

---

**v0.84 — a lapsed client costs nothing.** Dhanishta (cl-004) and Archana (cl-007) — `engagement_status: lapsed`, plan windows closed 2026-08-04 / 2026-08-12 — were still listed on the dashboard as "⏸ Menu paused — not opening the app", still scanned daily by the grocery/recipe backfill (Haiku), still pushed reminders, and the app co-pilot + travel guide were still live for them.

**Key invariants (v0.84):**
- **"Has a published plan" is NOT "is in active care."** The renewal sweep (`fmdb/plan/renewals.py`) only flips `engagement_status` + `lapsed_on`; it never ends, supersedes, revokes or moves the plan, so a lapsed client's plan sits in `published/` with `status: published` forever. Every automated path that drafts, generates, regenerates or nudges off a published plan must ALSO check `isLapsed` / `clientIsLapsed` (`src/lib/fmdb/engagement.ts`). Zero of the 17 crons did; the module docstring now says why.
- **The generators are the choke point.** `generateWeekMenuAction`, `generateGroceryListAction`, `generateWeekRecipesAction` refuse a lapsed client FIRST (before any plan read, app load or Haiku call) and `force` does NOT override it — "Draft menu" exists to re-engage someone mid-plan; the way back for a lapsed client is a successor plan, which the sweep restores on. `lapsedRefusal()` is the one sentence they all return.
- **Ordering in `weeklyMenuQueueAction` is load-bearing.** Lapsed AND plan-over (`cur > total`) are decided BEFORE the coach-paused / dormancy short-circuits — those emit a dashboard row and `continue`, which is exactly how an ended programme rendered as a "chase her" prompt. `lapsed-client-guards.test.ts` pins both orderings; the over-run-but-not-yet-lapsed shape (inside the sweep's 14-day grace) is the one the engagement check alone would miss.
- Also gated: `grocery-backfill` (skips in the scan, reports `skipped_lapsed`, so the refusal never lands in `failed`), `maintenance-menu-seasonal`, `app-reminders` (push), `revenue-export` (lapsed no longer counted as `active_care` in the capacity signal), `/api/app-copilot` (DEFER on lapsed OR `mode === "LIBRARY"`), `/api/app-travel-guide` (403).
- **Deliberately NOT gated:** `graduation-notice` (one WhatsApp per graduation, inside a 30-day backfill window — the intended close), `winback-drip` (deterministic template drafts, coach must send), the dashboard triage buckets and the "silent 14d+" chase list (coach-facing signals, no spend). If the coach wants lapsed clients out of triage, that is the archive suggester's job, not a cron gate.
- Measured before the fix: real post-lapse spend was small (one forced grocery regen each on 2026-08-23 during the v0.80 week-restore), but the exposure was structural and unbounded.

---

**v0.83 — whole-wheat flour, honest coverage, and one caution key per MENTION.** `_ingredient_nutrients.yaml` had no wheat flour, so every roti / paratha / thepla under-reported protein and calories — `whole-wheat-roti` itself stored **0.0 g protein and 20 kcal** a serving, which `menu-nutrients.ts` reads straight into the coach's protein-floor strip (worse than the ~3 g its own fallback table would have guessed).

**Key invariants (v0.83):**
- **Coverage SIZES an unmatched line; it does not flat-rate it.** The old engine charged every unmatched ingredient a flat 30 g in the denominator regardless of real mass, so 1.5 cup of untabled atta dented coverage by nothing and `aloo-paratha` reported **91.8%** while missing its dominant ingredient — high enough to keep publishing `rich_in` badges. `nutrients_lib.UNKNOWN_ENTRY` sizes it from its own qty/unit instead; nutrients stay zero, only the denominator moves. Measured on the old table this moves 118 recipes (`mushroom-pepper-fry` 87.1% → 33.7%). **Coverage was over-reporting confidence library-wide — treat any pre-v0.83 coverage figure as unreliable.**
- **`match` vs `match_all` — the same index, two different questions.** `NutrientTable.match` returns the ONE food a text most likely IS (longest alias wins): right for a nutrient line, which is exactly one food, and counting it twice would double its calories. `match_all` returns EVERY food a text names, one key per **mention**. `food_cautions.py` must use `match_all`; the nutrient engine must use `match`. Screening dish names through `match` is what let `"Chicken drumstick curry"` resolve to `drumstick` (a longer alias) so a gout client's chicken carried no purine caution at all.
- **Longest-wins per MENTION is load-bearing and must survive multi-match.** `"foxtail millet"` is `millet-foxtail` and never also `millet-generic` — foxtail is deliberately uncautioned for goitrogens (v0.79), and re-flagging it costs the client the substitute that solves the problem. A naive every-alias-that-matches pass wrongly flagged 20+ foxtail recipes. `finditer` over a longest-first alternation gives non-overlapping, most-specific-per-mention — and is **30× faster** than `match`. `food-cautions.test.ts` fails on BOTH halves: reverting to one-key-per-text fails 6 tests, dropping specificity fails exactly the two species-split tests.
- **Aliases naming more than one food are excluded from the SCANNER, kept for `match`.** The table carries 27 pasted from ingredient lines — `kale` has the literal alias `"kale, swiss chard leaves"` — and as the longest match they swallow the second food whole. The test is structural, not a blocklist: a real compound name never contains a comma or a standalone and/or, so `"sweet potato"` is untouched. Keeping them for `match` is what makes this change move zero nutrient figures.
- **The TS mirror is `loadFoodMatcher` in `recipe-nutrients.ts`**, not a second scan. `foodDisplayTerms` was deleted rather than left as a subtly different surface. A whole-library parity test puts ~1800 dish names and ingredient lines through both resolvers and compares key for key — the same shape as the nutrient replay.
- **A new spelling is an ALIAS on the entry that already owns the food, and it must be SPECIFIC.** A short generic alias can shadow a cautioned food inside a dish name: a bare `roti` alias beat `ragi` in `"Ragi roti"` and killed the week-level goitrogen flag. The entry is keyed `wheat-roti`, not `roti`, because the matcher indexes the key itself as an alias.
- **`compute-recipe-nutrients.py --skip-unchanged`** leaves a recipe alone when its computed block is identical. Without it a no-op pass bumps `nutrients_computed_at` and re-dumps every file, reflowing all 457 Hindi translation blocks for no change in the numbers. **Use it. A re-run rewriting 0 recipes is also the proof that a caution-side change did not touch nutrient data.**
- 14 new entries (`wheat-flour`, `maida`, `suji`, `wheat-roti`, `bread-whole-wheat`, `soya-chunks`, `mushroom-button`, `sugar-white`, `pomegranate`, `makhana`, `arugula`, `bay-leaf`, `amchur`, `chaat-masala`) are **authored-not-verified** — they were not part of the 25-agent IFCT pass the `_meta` header describes. `chaat-masala` is a blend approximation.
- Measured after: 0 cautions stop firing, 0 severity changes, 40 recipes + 38 dish strings start firing one that was being missed — every gain traced to information `normalize_item` destroys (`"jowar or bajra flour"` lost bajra to the `" or "` split; `"mixed vegetables (carrot, beans, cauliflower, peas)"` lost its brassica to the parenthetical). Known trade-off: raw-text scanning also surfaces optional alternatives, so `"olive oil or cold-pressed mustard oil"` trips the brassica caution on mustard OIL. Both such cases land at `monitor` (−0.5).
- **Deployed 2026-09-11** — Fly image `deployment-01M284M9C7YKM6MKG0D7QRP5X5` (machine v409) and the coach UI (PM2 `fm-coach`, rebuilt on `9f936f35`). Verified on the live machine against a baseline captured BEFORE the deploy: `whole-wheat-roti` 0.0 → 12.7 g, `aloo-paratha` 3.2 → 12.8 g (coverage 91.8 → 100.0), `match_all` shipped, and every coach route still 404s on the public host (`FLY_INTAKE_ONLY` intact). The Mac crons need no restart for the caution change — each shim is a fresh Python process, so the next tick imports the new `food_cautions.py`.

---

**v0.82 — Day-0 MRS on the client intake form.** The v0.81 tracker scored only check-ins, so the first check-in doubled as the baseline. The intake's 12-chip "perimenopause inventory" (tick-all, ungraded, never re-scorable) is **replaced** by the 11-item Menopause Rating Scale (0–4 each) plus a 4-chip "Cycle changes" row — replace, not add: the form gets ~1 minute longer only for the women who see it.

**Key invariants (v0.82):**
- **Gate** — `src/lib/fmdb/mrs-intake-gate.ts::showMrsOnIntake(sex, cycleStatus, dob)`: women only; `perimenopausal` / `postmenopausal` → always; `menstruating` → age ≥ `MRS_INTAKE_MIN_AGE` (40) from `date_of_birth`; `not_applicable` / unanswered / under-40 menstruating → hidden. Cycle chips (`showCycleChangesOnIntake`) only while cycles exist. Age is computed by `src/lib/fmdb/age.ts::ageFromDob` (lifted from `lab-orders.ts`). Don't gate on cycle status alone — perimenopause is routinely unrecognised while periods continue.
- **Field names** — `perimenopause_inventory` is KEPT for the 4 cycle chips (its option list shrank; earlier clients' ticks stay valid). MRS lands in new `mrs_baseline` (`Client.mrs_baseline: Optional[MenopauseRatingScale]`, same 11 keys as `Session.mrs`). Client-voice labels live in `intake-form-options.ts::MRS_INTAKE_LABELS`, keyed by `MRS_ITEMS`; keep stems close to the instrument, keep subscale names out of the client's view.
- **Submit allowlist** — new kind `_INTAKE_INT_DICT_FIELDS` + `_clean_int_dict()` in `intake-token-action.py` (known keys, ints in 0–4, overwrite-on-submit, empty clears). `fm-database/tests/test_intake_mrs_baseline.py` fails if the allowlist drifts from the Pydantic model — the silent-drop failure mode this form has hit before. The reconcile path shares `_apply_submit`, so the Mac needs the merged code and Fly needs a deploy.
- **Card** — `OutcomeProgressCard` takes `mrsBaseline` + `mrsBaselineDate` and inserts a scorable baseline as an `intake` point, **dated by `intake_last_submitted_at`** (falls back to `intake_submitted_at`, then `intake_date`) — a Path-A re-edit re-submits and the first-submit stamp would mis-date it. Points are re-sorted by date; `hasMrs` still needs ≥2.
- **Layout** — the form's `RadiosRow` stacks each option full-width on a phone; 11 items became 55 rows. The scale uses `ScaleChips` (one chip row per item, `role=radiogroup`). Don't switch it back.
- **Testing the public form from a worktree** — `server-actions/intake.ts` now honours `FMDB_PYTHON` (it had its own hard-coded venv path, spelled differently from the five files flagged in v0.81, so a grep missed it). A near-empty test form trips the sparse-submit guard and needs the "Submit what I have anyway" confirm — that is not a failure.
- Verified end-to-end in the browser on the test client (cl-900, restored afterwards): all six gate cases, draft autosave carrying the 11 answers, confirmed submit → `mrs_baseline` on `client.yaml`, intake-view field, and the card plotting intake → check-in as "22 → 12 / 44".

---

**v0.81 — Menopause Rating Scale (MRS) for peri/postmenopausal clients.** Prompted by the Elyaman FMCA webinar ingest (claim `mrs-symptom-score-for-tracking-hormone-transition-symptoms`): a validated, repeatable number beats the ad-hoc symptom count for this cohort. The check-in form (`analyse/checkin/checkin-form.tsx`) gains the 11-item MRS (0–4 per item; somato-vegetative / psychological / urogenital) only when `menopauseStage()` ≠ null; `OutcomeProgressCard` promotes the MRS trend to the primary number once a client has 2+ scorable entries and demotes the generic symptom chart to a collapsed disclosure. **Display swap, not a data swap** — `selected_symptoms` tracking keeps running underneath.

**Key invariants (v0.81):**
- `src/lib/fmdb/mrs-score.ts::MRS_ITEMS` is the single source of truth for the 11 keys/labels and mirrors `fmdb/plan/models.py::MenopauseRatingScale` field-for-field — keep in lockstep. `computeMrsScore()` returns `null` unless ALL 11 are answered: partial entries save to the session YAML but never plot (no zero-fill).
- `src/lib/fmdb/menopause-stage.ts` is a port of `fmdb/assess/suggester.py::menopause_stage()`: anchored markers (`perimenopaus` / `postmenopaus`, never bare `menopaus`) so "Premenopausal" can't match, and post beats peri when a record carries both. It now also gates the check-in protein question, replacing a bare regex that had that exact false positive. Tests ported from `tests/test_menopause_stage.py`; keep both files' cases in lockstep.
- **No severity bands in v1** — no properly sourced cutoffs, so the card shows raw total/44 + delta only. Add bands only with a citation.
- `server-actions/assess.ts` now imports `PYTHON`/`SCRIPTS_DIR` from `lib/fmdb/shim.ts` (honours `FMDB_PYTHON`, identical fallback) — it had its own hard-coded venv path and could never save a session from a worktree. Five other server-action files still hard-code it (`catalogue-orphan-action`, `catalogue-duplicate-action`, `api/email/actions`, `(v2)/ingest/actions`, `(v2)/recipes/actions`) — same one-line fix, not yet applied.
- **Worktree dev-server recipe:** `FMDB_PYTHON=<main venv python> next dev --webpack -p <port>` — Turbopack refuses a symlinked `node_modules` ("points out of the filesystem root"), webpack doesn't. After ANY dev-server restart, HARD-reload the tab: HMR drops and a soft navigation renders fresh server data with the stale client bundle, which looks exactly like a logic bug.

---

## Liver & Metabolic Risk indices (17 Nov 2026)

- `lab_ratios.compute_ratios(labs, client_context=None)` adds TyG, TyG-BMI, TyG-WC, HSI, FLI, LAP and FIB-4 under the panel **"Liver & Metabolic Risk"** (section 6b, `_add_liver_metabolic_indices`). Deterministic, $0. Each needs every input or is skipped silently; with no context only TyG appears.
- **Client facts come from `fmdb/assess/client_context.py::lab_client_context(client)`** (dict or `Client`), never from a file read inside `compute_ratios`. Per field, the latest DATED value across `health_snapshots` / `measurements_log` / flat `measurements` wins (log beats snapshot on the same date), then the undated flat block, then the v2.3 top-level intake fields. Bounds mirror `measurements.ts`. Diabetes = a firm active condition through the `supplement_clash` concept matcher (so "prediabetes" never counts), or HbA1c ≥ 6.5 inside HSI.
- All four callers pass it: `assess.py`, `update-client-data.py`, `recompute-lab-markers.py`, and `compute-ratios.py` (reads the client when the payload has `client_id`; the assess page sends it). Existing clients pick the new markers up on the next lab save or 🔄 rebuild — nothing was back-filled.
- Every interpretation carries a read-with-care note: ALT/AST/GGT scores (HSI, FLI, FIB-4) are unreliable within ~4 weeks of paracetamol or acute illness and after hard resistance training the week before; TG/glucose scores (TyG family, LAP) need a true fast. TyG-BMI and TyG-WC have no agreed cut-off and are flagged `normal` (trend only); LAP's 30/50 bands are a rough guide.
- Catalogue: one `lab_tests/*.yaml` per index; each slug is in the passthrough's `_coded_equivalent`, so a lab-printed score never duplicates the computed one. Overview groups them as "Liver & metabolic risk" (first in `groupLabMarkers`, since `find()` takes the first match). The intake IFM burden map does not include this panel on purpose — the inputs already count under Liver/Lipids.
- **Inches in a cm field are rescued for the indices** (`client_context._sane_cm`): a waist of 20–55 or a height of 48–90 is read as inches (× 2.54) and the card says "converted from inches". Real cm values above those ranges are untouched, and the intake's own `waist_in` / `height_ft`+`height_in` fields are converted once, never twice. The stored record is not rewritten.
- **Waist-to-height ratio** joins the Liver & Metabolic Risk panel (<0.5 healthy, 0.5–0.6 raised, >0.6 high) with the South Asian waist line (80 cm women / 90 cm men) in its text; maps to the existing `waist-to-height-ratio` catalogue entry.

---

## Holistic lab read: indices, system scores, rules, pre-test confounders (17 Nov 2026)

- **New indices in `lab_ratios.compute_ratios` (section 8, all $0, each skipped unless every input is present):** SII, PLR, MLR, CRP/albumin (panel "Inflammation & Immune"); remnant cholesterol, LDL-C/ApoB; QUICKI, McAuley; SPINA-GD (with the `1 + K30·TBG` ≈ 601 term — without it the value is 1000× low) and Jostel's TSHI (free T4 only; Thyrocare's total T3/T4 cannot feed them); albumin-corrected calcium, Ca/P, Na/K, Zn/Cu ("Minerals & Electrolytes"); Mentzer index (MCV < 80 only); PhenoAge (Levine 2018, "Biological Age", coach-only research score — worked check 46.6). SHBG is now read sex-aware when `client_context.sex` is set.
- **Inputs without a coded handler are read with `_peek`** (does not claim the row), so calcium, sodium, CRP, copper… still pass through with catalogue interpretation. White-cell differentials go through `_differential`: % and absolute rows are kept apart (NLR used to be able to divide a % by an absolute count), absolute counts in cells/µL are scaled to 10⁹/L, and a missing absolute is worked out from % × WBC. RDW reads RDW-CV only; RDW-SD (fL) is its own marker. Platelets in lakhs are normalised.
- **Thyrocare formats:** a catalogue entry in cells/µL now scales a "X 10³/µL" value ×1000 before flagging (monocytes 0.15 → 150). **A catalogue entry with no FM-optimal range falls back to the lab's own printed range, then the catalogue conventional range** (`_parse_ref_range`: single ranges only — sex/age-banded strings return no range rather than guess). Uncatalogued "Other" markers are judged against the lab range too (toxic metals). One-sided FM ranges now flag.
- **`fmdb/assess/lab_synthesis.py::synthesise_labs(markers, ctx)`** → `client.lab_synthesis` = `{systems[10], patterns[], confounders}`. Systems: Metabolic, Liver, Inflammation-immune-allergy, Thyroid, Sex hormones & adrenal, Nutrients & methylation, Blood, Cardiovascular, Kidney, Toxic load (metals only). red = 2+ firm out-of-range (normal confidence) / any very_high / a red pattern; amber = 1 firm, a low-confidence firm, 2+ suboptimal or an amber pattern. Classifiers: iron (deficiency / inflammatory block / masked / overload / metabolic ferritin / thal-trait screen), anaemia type (MCV × RDW), methylation, thyroid antibody status. Cross-system rules: inflamed T3 conversion, IR-driven fatty liver, allergic/airway, Lp(a)+CRP, ApoB–LDL discordance, low ferritin + raised TSH; the iron block and folate methylation gap are classifier outcomes marked `kind: cross_system` (not repeated). Rules read marker NAMES — renaming a coded marker breaks them; `tests/test_holistic_lab_read.py` pins each.
- **Pre-test answers** live on the draw: `health_snapshots[].pretest`, validated by `fmdb.plan.models.LabPretest` (extra="forbid"; TS mirror `LabPretest` in `types.ts` — keep in step). Saved with a new upload (`update-client-data.py` `pretest`) or for an existing draw by `scripts/save-lab-pretest.py` / `saveLabPretestAction` (sets every same-date lab snapshot, rebuilds via `fmdb/assess/lab_rebuild.py`). Form: `lab-pretest-form.tsx` inside `LabUploadPanel`. The Thyrocare booking flow sends instructions but stores no answers.
- **`lab_client_context` returns the pretest of the LATEST lab draw only** (`pretest`, `pretest_date`); `compute_ratios` ignores it when the newest lab passed in has a different date (a preview of a fresh upload never inherits the last report's answers) and sets `pretest_stale` for the synthesis note. `lab_confounders.apply_confounders` marks `confidence: "low"` + `confounded_by` and appends one "Lower confidence:" sentence — values and flags are never changed. Exercise hits ALT/AST/CK, not GGT; oral oestrogen/OCP hits CRP/SHBG/TG/binding proteins, transdermal does not. Known simplification: answers apply to every marker, including one whose newest value came from an older report.
- Surfaces: Overview shows `LabSynthesisPanel` above the markers; Assess shows it under the computed ratios (`compute-ratios.py` returns `synthesis`). Coach-only — not in `_APP_CLIENT_KEYS`. Existing clients get it on the next lab save or 🔄 rebuild; nothing back-filled.

### Marker rebuilds merge, never replace (18 Nov 2026)

The first in-care rebuild after the Liver & Metabolic Risk indices showed that every
writer of `client.lab_markers` (🔄 Re-run markers → `recompute-lab-markers.py`, lab
save → `update-client-data.py`, AI assess → `assess.py`) REPLACED the list with a fresh
`compute_ratios` run. Ten in-care clients lost hand-entered markers (one lost nine) and
152 written interpretations. All three now go through
`fmdb/assess/marker_merge.py::merge_markers(previous, rebuilt)`:

- every rebuilt marker is kept; if the client already had it (same folded name, or a
  shared distinctive word AND the same value) and the value is unchanged, the old
  `fm_interpretation` is carried over. A changed value gets the fresh engine text.
- an old marker the rebuild does not cover is kept unless `computed: true` (a computed
  index whose inputs are gone is dropped).
- `lab_synthesis` is built from the MERGED list.

Two picker bugs found on the same run (`lab_ratios.py`):
- haemoglobin matched "HbA1c (Glycosylated Hemoglobin)" — a same-day HbA1c 5.8 % read
  as Hb 5.8 g/dL. Lookaheads now drop a1c / glyc / MCH / MCHC / electrophoresis / HbF.
- serum folate matched "RBC folate" — 448 replaced a deficient 3.9. RBC / haemolysate /
  erythrocyte folate are excluded and pass through as their own marker.

Tests: `fm-database/tests/test_marker_rebuild_safety.py`.

## Client app: the new Sequoya front, step 0 (18 Nov 2026)

The front of `/app/<token>` is being replaced before the 2 Jan 2027 launch: keep the engine,
replace the shell. Step 0 adds the per-client switch and an empty new shell. Nothing a real
client sees has changed.

- **One function decides the front:** `fm-database-web/src/lib/fmdb/app-shell.ts::pickAppShell`.
  New shell only when `client.yaml#app_shell` is exactly `v2` AND tier is `package` AND mode is
  `ACTIVE` AND the plan is not on setup hold. Everything else, including a missing or mistyped
  value, is today's app. Never branch on `appShell` anywhere else; `app-shell.test.ts` walks
  every combination and pins that `ochre-app.tsx` is the only caller.
- **Embargo:** the new shell prints the programme name. Until 2 Jan 2027 `app_shell: v2` goes
  on the test client `cl-900` only.
- **Same data both ways.** `ochre-app.tsx` still owns the on-device store
  (`ochre.app.<clientId>`), the day's ticks, the tick sync to the coach, the timezone fix and the
  push refresh. The branch sits after its hooks and hands that state to `sq-app.tsx`, so a
  client switched back finds everything she ticked. Do not give the new shell its own store.
- **New files are `sq-`** beside the `ochre-` ones; `sq.css` is nested under `.sq-app` with
  `--sq-` custom properties so it cannot leak into `.ochre-app` or the other way.
- **`app_shell` is in `_APP_CLIENT_KEYS`** (the app is served from Fly); a plain string on the
  model so a typo reads as "today's app" rather than failing a load.
- **Known gap for later steps:** REVIEW opens 14 days before a plan ends (7 for short plans)
  while the client is still mid-protocol. Under the rule above she drops back to today's app for
  those last days. Decide before any real client is switched.

Tests: `src/lib/fmdb/app-shell.test.ts`, `src/app/app/[token]/sq-app.test.tsx`,
`fm-database/tests/test_app_shell_field.py`.

## Client app: the new Sequoya front, step 1 — Home, ticks, the record (18 Nov 2026)

Test client `cl-900` only (see step 0 above for the switch and the embargo).

- **`sq-day.ts` decides, the screens only draw.** Pure functions on top of `day-plan.ts::buildDay`:
  `buildMoments` (the day as cards), `nextMoment`, `dayCount`, `buildRecord`. Change a rule there,
  with its test in `sq-day.test.ts`.
- **"With it" supplements.** A supplement folds into a MAIN meal (breakfast 19.5, lunch 39.5,
  dinner 59.5) when its rank is within 5.5 after it and it is not empty-stomach. Snacks never take
  one. It is its own tick: a meal tick records the meal only.
- **"Next" never looks back.** The next card is the first unticked moment from the part of the
  day the phone is in onward. Earlier parts are not offered and not listed as overdue; they stay
  tickable in "Your whole day". Home must never say something was missed.
- **Meal ticks** use kind `meal` and id `mealTickId` (`m-<slot>`), kept in the same `logged` map
  as supplements. The kind must be allowed in THREE places or it is dropped silently:
  `TickKind` (`app/[token]/daily-ticks.ts`), `KINDS` in `api/app-ticks/route.ts`, `KINDS` in
  `scripts/save-app-ticks.py`. `ochre-app.tsx` sends meal rows ONLY for the new front: today's
  app has no meal tick, so its meals would log as "not done" every day.
- **Practice ticks now keep their time** (`practiceAt` in the on-device store, sent as `at`). This
  also applies to today's app; older ticks have none.
- **The record** reads `ClientAppData.sq.tickHistory` (trailing fortnight from
  `_daily_ticks.jsonl`); today is always shown from the phone. A day with no row says only
  "Nothing ticked". A row with no meal items says meals were not tracked that day.
- **`ClientAppData.sq`** (plan day, tick history, days since last open) is filled only when
  `app_shell` is `v2`, so no other client's payload grows.
- **Recipes in the new front** must keep the "Made without X for you" line (`AppMealExtra.omits`)
  above the method, and every component recipe of a compound meal.
- **Left for later steps, on purpose:** the ask box and "Swap" (step 2); "Begin" on a practice
  (step 3); the shopping list and check-in screens, so the "This week" line opens a placeholder
  (step 4); the evening "How did today go?" question, which needs a place in the coach's view.

Tests: `sq-day.test.ts`, `sq-home.test.tsx`, `sq-app.test.tsx`, `src/lib/fmdb/app-shell.test.ts`,
`fm-database/tests/test_save_app_ticks_meal.py`.

### Client app redesign: the "next" card goes by windows of the day (18 Nov 2026)

- The new front's "next" card and "Later today" no longer go by the five parts of the day. `sq-day.ts::rankFloorAt(hour, minute)` gives a floor on day-plan.ts's ranks, and `upcomingMoments` offers only moments at or above it. Windows: before 8 am everything; 8 am breakfast; 10:30 am mid-morning; 12 noon lunch; 4 pm tea-time snack; 6:30 pm dinner (floor 55, so the evening practice at 58 stays); 9 pm bedtime.
- **Why:** the snack and dinner share "evening" (4 pm to 9 pm), so an unticked snack held the card until 9 pm (the coach saw "Tea with milk" at 8:15 pm). Same for breakfast against the mid-morning bite.
- A window that opens on a part of the day must keep that part's cut from `bandOfRank` (19, 39, 50, 70); a test pins this at every minute. Today's app still uses `bandForHour` and is untouched.
- A skipped item leaves "next" and "Later today" only; it stays in Your whole day and can be ticked late. The clock is read on open and when she comes back to the app, not on a timer.

### Client app redesign step 2: the ask box and the Coach tab (18 Nov 2026)

New front only (`app_shell: v2`, the test account). Today's app, its co-pilot and its chat are untouched.

**The order a question goes through** (do not reorder; the tests walk it):
1. `src/lib/fmdb/ask-safety.ts::askUrgent` — self-harm, then emergency. English, Hindi, Hinglish and common misspellings. A denial written against the phrase ("no chest pain", "chest pain nahi hai") and a figure of speech ("fainted with laughter") are skipped; a bare "not" is NOT a denial ("I can not bear this chest pain"). The live chat list (`triage.ts::EMERGENCY_HINTS`) is the floor.
2. A few questions that cannot be clinical: coach reply time, next session, how the app works, "tell my coach".
3. `askHandoff` — medicine, another person's health, alcohol, results, supplements together, weight change, symptom, dose, the wider health picture. Each goes to the coach; never answered.
4. Plan lookups on the phone, `src/app/app/[token]/sq-ask.ts::routeAsk`: her meals, ticks, record, a supplement's timing and reason, its every-other-day schedule, whether a dish is on this week's menu (`dishOnMenu`: EVERY word of the food must be in one dish).
5. Everything else → the model: `/api/app-copilot` with `format: "card"` → `scripts/app-copilot.py` `mode: "card"`.

**Rules**
- **One module for safety, both sides.** The phone runs `ask-safety.ts` for an instant card; `/api/app-copilot` runs it again first, because a direct POST skips the phone.
- **The model never writes to the client.** It returns one JSON card; `src/lib/fmdb/ask-card.ts::parseModelCard` checks every field and turns anything else into "defer" (hand to the coach). Buttons come only from `MODEL_BUTTONS`. A test pins the route's order: safety, daily cap (15, shared with today's co-pilot), lapsed, LIBRARY, then the model.
- **Not answered by fixed text, on purpose:** tea and coffee, eating out, swaps, portions, "can I eat X". The prototype's answers were written for one demo client. In the app they depend on each client's food list, so they go to the model with her plan in front of it, and the model defers when the plan does not say.
- **Tappable questions cost nothing.** `askChips` returns only questions the router answers on the phone; a test walks every chip at every hour and fails if one would reach the model.
- **Results** (lab values, body age) always hand to the coach until step 5 shares them.
- **Alcohol** always hands to the coach. **A missed capsule** hands to the coach until the coach's own answer is supplied (then check `isMissedCapsule` before `askHandoff`).
- **Hand-off** sends the question into the same chat thread (`/api/app-chat`) as `"<her words>\n\n(Asked in the app · week N of M)"`, then shows "Your coach replies within 24 hours". No plan slug in the text: the thread is per client, and the slug carries the client id.
- **Coach tab** (`sq-coach.tsx`): same thread and route as today's chat. A message typed there passes `coachTabNote`: it is still sent, and the emergency card or "see a doctor today" line shows beside it. A failed send stays on screen as "Not sent yet". The unread dot is asked on open and on return to the app, never on a timer; reading the list marks the coach's messages read, so it is only read while the tab is open. Not built yet: sending a photo, turning on notifications.
- **Copy:** "your coach", never the coach's name, and no pronoun for the coach. Tests check both.
- **Screens from later steps** (shopping list, check-in, weight, reorder, the week's menu, movement) open the "not built yet" sheet from the ask box for now.

**Cost, measured 18 Nov 2026 on the test plan:** a typed question that reaches the model is about 2,700 input tokens on `claude-haiku-4-5`, about US$0.0027 (the build plan estimated $0.001). The first version sent the whole week's menu and cost $0.0041; the context now carries tomorrow only. The cached blocks are under the model's minimum cacheable length, so caching does not engage. Nine test calls were made while building: $0.03.

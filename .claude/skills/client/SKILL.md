---
name: client
description: Brief yourself on one client or prospect before doing anything for them — lifecycle state, live plan and week, what was last sent and received, whether they use the app, and what must not be said. Activate on "/client <name>", "brief me on <name>", "where is <name>", "what's going on with <name>", "catch me up on <name>", or at the start of ANY chat about a specific client before assessing, planning, writing to them or answering a question about them.
---

# Client brief — read this before touching anyone's record

The coach works in chat. Until 2026-10-23 every conversation about a client
started with her re-typing who they are, where they are in the programme, what
was last sent and whether they open the app — because no brief rendered those.
This one does. Run it first, every time, and do not ask her for anything it
already answers.

## 1. Run it

```bash
cd /Users/shivani/code/healwithshivanih-ads
fm-database/.venv/bin/python fm-database-web/scripts/client-brief.py "<id or name fragment>"
```

Add `--json` for the structured form. A name fragment that matches more than one
person refuses and lists them; pick the id and run again. Parked prospects
(`prospects/`) resolve too. Read-only, $0, no model call.

## 2. What it gives you, and what each section is FOR

- **Who** — age, sex, city, diet rules, conditions, history, meds, allergies,
  goals. Clinical facts; cite them, never restate them back to her as news.
- **Lifecycle** — `prospect / onboarding / active / ending / maintenance /
  lapsed / archived`, since when, and why. This is THE state: the same resolver
  the dashboard, the crons and the nightly `lifecycle:` stamp use
  (`fmdb/plan/lifecycle.py`). Do not re-derive it from `engagement_status` or
  from "has a published plan". A `maintenance` client is hands-free: no session
  chasing, no renewal pitch. A `lapsed` client gets win-back drafts only, and
  only inside the 56-day window. A `prospect` gets the call follow-up sequence
  and nothing else. **marketing opt-out: YES** means reply-only, full stop.
- **Plan** — the live plan, week N of M, effective end, every supplement with
  dose/timing/start week, every practice, deferred items, menu weeks live in
  the app. For "what is she on?" answer from here.
- **Recent** — the last 8 thread messages (← in, → out, with the template
  name), the last app check-in in her words, last MSQ, last coach session,
  labs on file and flagged markers, weight trend, anything queued to send.
  For "did we reply?" or "what did I last send?" answer from here.
- **App** — last open, opens in 14 days, ticks this week, practices logged,
  the feedback she gave. A client opening the app daily is engaged whatever
  the session folder says.
- **Do not** — foods to avoid, triggers, non-negotiables (coach-only; never
  client-facing), anxious-client flags, coach notes.

## 3. Rules

- **Run this before** `author-assessment`, `author-plan`, `author-renewal`,
  drafting a message, or answering "how is X doing". Those skills say so too.
- **If a fact is not in the brief, say you do not have it.** Do not guess a
  price, a date or a result. Prices are deliberately absent.
- **Do not chase.** Never propose a booking link, a check-in nudge or a
  "just checking in" message because someone is quiet. The coach does not
  auto-chase clients (decision 2026-10-23). Reply to what they wrote; offer
  what the lifecycle allows.
- **Lifecycle disagrees with what the coach says?** Trust the brief, show her
  the `reason` line, and offer to fix the record (engagement_status, renewal
  decision, maintenance_paid_through) rather than working around it.
- Need the clinical reasoning dossier (catalogue subgraph, drug cautions, the
  47-rule prompt)? That is `assess.py --author_context`, which
  `author-assessment` runs. This brief is the human picture; that is the
  model's.

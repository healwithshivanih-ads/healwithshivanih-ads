---
name: author-renewal
description: Author a client's end-of-plan renewal letter in chat at $0 (no API credits), using the same briefing and the same deterministic gate the paid path would use. Activate on "renewal letter", "write the renewal for <client>", "plan ending letter", "draft the renewal", "/author-renewal", or when the weekly approval digest flags a plan ending and the coach wants the letter written.
---

# Author a renewal letter

The end of a plan is the most commercially significant moment in the
relationship. This writes that letter **in chat, at zero API cost**, from real
data — and refuses to send anything the coach has not approved.

Companion to `author-plan` and `author-assessment`. Same shape: gather
deterministically, author here, gate before it reaches anyone.

---

## 1. Never write from memory

Run the briefing first. Every number in the letter must come from it. A
renewal letter that misstates someone's own progress back to them is worse
than no letter — she has been weighing herself for twelve weeks and will know.

```bash
cd /Users/shivani/code/healwithshivanih-ads
fm-database/.venv/bin/python fm-database-web/scripts/renewal-brief.py <client_id>
```

It returns: plan dates and effective end, the price tier, MSQ scores at each
check-in, adherence replies in the client's own words, the coach's logged call
topics from the NBHWC log, baseline labs with their retest intervals and
whether each is overdue, household members also renewing, and the previous
letters already sent.

**If a fact is not in the briefing, it does not go in the letter.**

## 2. Write it as Shivani, not as an assistant

Read `docs/RENEWAL_LETTER_VOICE.md` before drafting. In short:

- **Lead with something true about them**, from their own data. Their MSQ
  score, their words, the thing they worked out on the last call.
- **Do not claim progress that is not in the briefing.** If the weight has not
  moved, say so plainly — "the scale hasn't moved much, and I won't pretend
  otherwise" earns the rest of the letter.
- **No "I want to be straight with you"**, no "I hope this finds you well", no
  bullet-pointed pitch. It is a letter from a person.
- **The clinical reason to continue comes before the price**, always.
- **Never name a supplement being held back.** Say there is one; do not say
  which.
- **Prices are facts from the briefing** — never invented, never estimated.
- **Close with a call**, not "shall I send you the details".

## 3. Household check — this has already gone wrong

If the briefing lists household members also renewing, STOP and ask the coach
how to sequence before drafting. On 3 Aug 2026 a mother received an email
asking her to pay ₹50,000 for her daughter's programme six days before her own
renewal was due, because nobody checked.

## 4. The gate

Before anything is sent, run:

```bash
node fm-database-web/scripts/check-renewal-letter.mjs <client_id> <draft-file>
```

It **refuses** on: a price not present in the briefing, a number that appears
nowhere in the briefing, clinical jargon in client-facing text, a named
held-back supplement, a recipient mismatch, or a missing call-to-action. It
warns on length and on a claim of progress where the briefing shows none.

A refusal is not advisory. Fix the letter.

## 5. Sending

Show the coach the draft **in chat** and wait. On her approval, send through
the same path the app uses — `sendClientEmailAction`, which now sends from
`shivani@theochretree.com`, not the ops mailbox.

Then record the decision so the queue stops asking:

```bash
node fm-database-web/scripts/renewal-decision.mjs <plan-slug> renewed|not_renewing|deferred "note"
```

**Nothing sends without her explicit approval in chat. Not a draft she skimmed
— an approval she gave.**

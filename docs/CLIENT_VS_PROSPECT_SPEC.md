# Clients vs prospects — why they keep getting clubbed, and what to do

**Status:** specified, not built.
**Ask:** "a different numbering system for prospects, and only paid people should qualify as
clients — I want this to stop happening."

---

## 1. What was measured

All figures taken from the live store and repo on 2026-08-03.

| | |
|---|---|
| Records in `~/fm-plans/clients/` | **16** |
| Records in `~/fm-plans/prospects/` | **5** |
| Id formats in use | `cl-NNN` (20) and one legacy `nidhi-jain` |
| TS files referencing a client id | **334** |
| Python files referencing `client_id` | **67** |
| Published plan files with the id **inside the filename** | **32** |
| Programme-payment records anywhere | **none** |

Two of those numbers decide everything below.

### 1.1 Ids are embedded in derived data, so they cannot move

A published plan is not `plan-3.yaml`. It is:

```
archana-plan-3-2026-05-20-cl-007-v1.yaml
```

The client id is *inside the slug*, and that slug is what letters, app tokens, the staging
projection and every `plan_status` lookup resolve against. Session files, `_api_usage.jsonl`,
the Fly staging tree and the WhatsApp logs all key off the same id.

**An id that appears in 32 filenames and 401 source files is not a label. It is a primary
key.** Renaming one is a data migration with a long tail of silent breakage — a letter token
that resolves to nothing, a plan that stops being found, an app link that dies in a client's
pocket. The failure mode is not a compile error; it is a client opening their app to nothing.

### 1.2 "Paid" is not recorded anywhere

`orders/` exists, but it holds **lab** orders — `amount_inr: 12500, status: booked` is a
pathology booking, not a programme fee. Nothing in `Client`, `Plan` or the orders tree records
whether someone paid for coaching.

So *"only paid people qualify as clients"* is not a rule that can be applied today. It is a
new field first, and a rule second.

### 1.3 The field that decides client-vs-prospect is the weakest field in the system

`engagement_status` — the thing that means "signed up" — **is not declared on the Pydantic
`Client` model at all.** It is written only by TypeScript (the Engagement picker, `createClient`,
the discovery-tier resolver).

From the comment at `fm-database/fmdb/plan/models.py:318`, in the codebase's own words: under
`extra="ignore"` this field *"vanished from a real client's record the moment
generate-draft.py or generate-intake-insights.py did a load_client → write_client
round-trip."* It was patched by moving to `extra="allow"` in July 2026.

That is the actual story of this bug class. **The field that answers "is this person a client?"
is undeclared, unvalidated, unenumerated, and has already been silently deleted from a real
record once.** A prefix on the id would not have prevented that.

---

## 2. Why renumbering does not fix it

The intuition is sound: an id that says `cl-` for someone who declined is lying, and a
`pr-` prefix would make the mistake visible.

But trace what the two screens that broke actually did. Neither read the id. `/m/clients`
iterated `loadCoachIndex()` and rendered every row; the Meals queue iterated the same list and
filtered on `kind !== "photo"` but not on `kind !== "client"`. **A prefixed id would have sat
in those rows being equally ignored.** The defect was a mixed list that every consumer must
remember to filter — not an uninformative identifier.

And ids must be immutable (§1.1), so a prefix can only be assigned at creation — which is
before anyone has signed up, when everyone is a prospect. Either every record starts `pr-` and
paying clients keep a prospect id forever, or conversion renames the id and inherits the
migration problem for exactly the people who matter most.

**Recommendation: do not renumber. Ids stay opaque, stable and meaningless — which is what a
primary key should be. Encode state in state, not in the key.**

---

## 3. What to build instead

Three changes, in priority order. The first is most of the value.

### 3.1 Make the mixed list unrepresentable — *the real fix*

`loadCoachIndex(): CoachIndexRow[]` hands back clients and prospects in one array. Every
consumer must remember `kind`. Two written last week did not, and the two before them did — so
this is a coin flip, repeated on every new surface.

Replace it with an API where the mistake cannot be typed:

```ts
loadClients(): ClientRow[]        // kind is narrowed, not a field to check
loadProspects(): ProspectRow[]
loadEveryone(): { clients: ClientRow[]; prospects: ProspectRow[] }   // explicit, when genuinely both
```

`ClientRow` and `ProspectRow` as distinct types — not one type with a `kind` discriminator —
so passing a prospect where a client is expected fails at compile time rather than at Shivani's
screen. Every existing call site is then a mechanical, compiler-guided edit: **there are 4
callers today**, so the cost is small and the cost of not doing it recurs forever.

Same treatment for the Python side (`loader-extras.ts` already has `loadProspects()`; the
projection script should emit two lists, not one with a field).

### 3.2 Declare `engagement_status`, with an enum and a default

Add it to the Pydantic `Client` model:

```python
engagement_status: EngagementStatus = EngagementStatus.enquiry
```

with values `enquiry | discovery_booked | signed_up | declined | lapsed`. Today it is an
undeclared string that survives only because the model was switched to `extra="allow"`, and
which has already been silently dropped once.

**Declaring it is what makes every other rule enforceable.** While undeclared, any rule keyed
on it is one Python round-trip away from evaluating against a field that is no longer there.

### 3.3 Record payment, if payment is to be the definition

To make *"only paid people are clients"* real, a programme payment must be recordable:

```python
programme_payments: list[ProgrammePayment] = []   # date, amount_inr, method, note
```

Then "client" is derivable rather than asserted: someone with a payment **and** a published
plan. Until that field exists, the honest definition remains `engagement_status == signed_up`,
which is what the code already means (see memory: *engagement_status=signed_up — enrolled only*).

**Do not gate anything on payment before the field exists and is backfilled for all 16
current clients** — a rule that reads an empty field concludes that nobody has paid, and every
client silently becomes a prospect. That is the same failure as the empty allergy list, applied
to the entire roster.

---

## 4. Cosmetic option, if the ids still bother you

New prospect records could take a `pr-NNN` id going forward, with no migration of the 21
existing records and no rename on conversion (a converted prospect keeps `pr-NNN` forever).

This is honest — the id records where someone *entered*, not where they are now — and costs
almost nothing. But it buys readability only. It does not prevent a single bug, because no
consumer branches on the prefix. **Do §3.1 first, and treat this as optional polish.**

---

## 5. What NOT to do

- **Do not rename existing ids.** 32 plan filenames, 401 source files, app tokens live in
  clients' pockets.
- **Do not gate on payment before the field exists.** It would demote all 16 clients.
- **Do not add a third population.** "Lapsed" is a value of `engagement_status`, not a
  directory. Two directories are already one more source of truth than the model has.
- **Do not rely on directory location alone.** `cl-018` sits in `prospects/` with
  `engagement_status: declined` *and* a live app token — the directory moved, the token did
  not. Which raises §6.

---

## 6. Open question, separate from all of the above

**`cl-018` (declined, parked in `prospects/`) still holds a valid `app_token` and a staged app
on Fly.** Someone who declined can still open their client app.

That may be deliberate — a grace period, or simply nobody has needed to revoke it. It is not a
numbering problem and it is not fixed by anything in §3. Worth a decision: should parking
someone as a prospect revoke their app access, and if so, immediately or after a window?

# Session connector — recommending hypnotherapy, massage, and the rest

Status: **plan only, nothing built.** Benched by the coach on 2026-07-29 as
"next stage"; written up 2026-07-30 so the shape is decided before anyone
starts.

---

## What this is

Today the mind-body layer ends at a self-guided practice. A client reads that
their insomnia may be a body that will not stop watching, does five minutes of
legs-up-the-wall, and that is the whole offer. For some clients that is
enough. For others the reading lands hard and the honest next step is a
session with a person — hypnotherapy, bodywork, breathwork, therapy.

The connector is the bridge from *a reading* to *a session*.

## The one finding that decides the design

**Do not map conditions to modalities.** The join key already exists.

`fmdb/assess/somatic_themes.py` defines a 14-theme vocabulary
(`SomaticTheme` + `THEME_LABELS`), already classifies every emotional root in
all 123 maps, and `ChiefRead.themes` already carries the result through to the
coach panel. The client-side `AppMindBodyRead` does not carry themes yet — one
field, already computed upstream.

So the mapping is **theme → modality**, not condition → modality:

| | rows to curate | changes when the book grows |
|---|---|---|
| condition → modality | 123, growing | every new condition |
| **theme → modality** | **14, fixed** | never |

Fourteen rows a human can actually review, argue with, and keep honest. The
themes are also the clinically meaningful unit — "unexpressed anger" is what a
modality treats; "uterine fibroids" is not.

The existing themes:

```
unexpressed anger · silenced voice · grief and loss · fear and hypervigilance
boundaries and intrusion · self-abandonment · control and rigidity
shame and self-rejection · holding on · depletion and overwhelm
trapped or stuck · not being seen · numbing and disconnection
old wound resurfacing
```

## The thing to be careful about

Shivani is a certified hypnotherapist and NLP practitioner. So a meaningful
share of what this connector recommends is **her own paid service**.

That is not a reason to avoid it — she is the right person for it and clients
are already paying her. It is a reason to be deliberate, because the sequence
*"here is the emotional root of your illness → here is a session you can buy"*
is the exact shape of a manipulative funnel, and this app has spent its whole
design avoiding that. Three rules, all of which should be enforced in code
rather than left to prompt copy:

1. **The coach proposes; the app never auto-sells.** A recommendation appears
   for the client only after Shivani has attached it to their plan, the same
   way a practice does. No automatic "clients with grief also booked…".
2. **Never priced inside the reading.** The read card ends at the practice. A
   session offer is a separate, quieter surface — the client should be able to
   finish the reading and take nothing.
3. **Referrals out rank equal with referrals in.** If the honest answer is a
   trauma therapist rather than hypnotherapy, the model must be able to say so.
   A connector that only ever routes to its author is a sales tool.

## Build order

Each stage ships something usable and is worth stopping after.

### Stage 1 — the modality catalogue *(half a day)*

New entity `Modality`, `fm-database/data/modalities/<slug>.yaml`. Fields:
`slug`, `display_name`, `what_it_is` (client-facing, plain), `good_for`
(theme slugs), `not_for` / `cautions`, `delivered_by` (`coach` | `referral`),
`typical_length`, `typical_cost_inr`, `evidence_tier`, `sources`.

Seed ~8: hypnotherapy, NLP, EFT (already in-app), somatic experiencing,
therapeutic massage / bodywork, breathwork, talk therapy, yoga therapy.

*Check: every theme has ≥1 modality; every `good_for` resolves; validator clean.*

### Stage 2 — theme → modality, offline *(half a day)*

Pure function, no UI. `themes → ranked modalities` with the reasoning
attached. Mirrors the `somatic-read.ts` pattern, with the same
cross-language pin if it is needed on both sides.

*Check: run it over all 14 clients; eyeball the ranking with Shivani before
anything renders. If the recommendations are not obviously right at this
stage, stop — the rest is wasted.*

### Stage 3 — coach surface *(1 day)*

Extends `SomaticReadPanel`: under each read, the suggested modalities with
their reasoning, and an **Attach to plan** action. Writes to the existing
`Plan.referrals` (`ReferralItem`: to / reason / urgency) where the modality is
`delivered_by: referral`, and to a new `sessions_suggested` block where it is
`coach` — kept separate precisely so "my own service" and "someone else's" are
never quietly the same field.

*Check: attaching from the panel produces a plan that still validates and
still publishes.*

### Stage 4 — client surface *(1 day)*

A quiet card **below** the reads, gated exactly as they are
(`mind_body_depth: full`, general + ungated map) plus a fourth gate: the coach
attached it. Content: what it is, why it was suggested for them, what a
session involves, and a single **Ask Shivani about this** action that opens
the coach thread with a pre-filled message. No price, no checkout, no booking
inside the reading.

*Check: with nothing attached, nothing renders. Verified on a real client's
app, not a fixture.*

### Stage 5 — later, only if wanted

Booking (Cal.com is already wired for discovery calls), a practitioner
directory for referrals-out, tracking whether a suggested session was taken.

## What would make this fail

- **Recommending on thin data.** Convergence already only fires for ~1 client
  in 3 (v0.77). If a modality suggestion rests on one weak theme match, it
  should not appear. Better silent than glib.
- **Mapping by condition after all**, because it looks easier at row 1. It is
  not easier at row 123.
- **Letting the offer into the read card.** The moment the reading and the
  sale share a card, the reading stops being trustworthy.

## Dependencies

None blocking. The theme vocabulary, `ReferralItem`, the gating, the coach
panel and the client section all already exist. This is assembly, not
foundations — which is why it can wait without rotting.

# Mind-Body module — hypnotherapy, NLP, EFT, affirmations, breathwork — spec (v0)

**Status:** v0 spec'd 2026-06-15, to build (after Lab Vault in code). Direction
set; three product decisions open. Audio content creation has NO code dependency
and can start in parallel today.

## Why this is a moat, not a risk

The coach (Shivani) is a **certified hypnotherapist and NLP graduate.** That
removes the scope concern entirely — these are within her qualification, and very
few health coaches can offer them. This is a genuine differentiator. Build it as a
named pillar of the app, not a "nice extra."

(Contrast: EFT-for-stress, affirmations, and breathwork are in-scope for any
coach; hypnotherapy and clinical NLP are gated on her certification — which she
holds. So the whole module is on the right side of the line.)

## Core principle: audio-first, in her voice

For hypnotherapy the therapeutic value *is* the recorded voice + training — not
TTS, not on-screen text. Record a core library once, reuse forever. That recorded
library is the moat; the app is just the delivery shell.

## The pillars

1. **Hypnotherapy audio library** — recorded guided sessions in her voice. Player
   in-app, downloadable for offline, push-reminder driven ("your evening
   wind-down"). Candidate first themes: sleep, health-anxiety, food/cravings,
   pain, calm/overwhelm, confidence.
2. **NLP interactive modules** — reframing, anchoring, swish, well-formed
   outcomes, submodality shifts. Fixed technique structure; the *presenting issue*
   personalized from the client's intake via Haiku. Text-guided, optionally with
   her audio.
3. **EFT tapping** — guided point sequence with personalized setup statement +
   reminder phrases. Client picks a theme → Haiku writes the script, or coach
   pre-authors per client as a plan module. Her-voice audio optional later.
4. **Personalized affirmations** — Haiku-generated from goals/conditions at plan
   time, daily rotation, delivered via existing PWA push. Favourite / regenerate.
   Pennies per client.
5. **Breathwork pacer** — animated expanding circle, presets (box 4-4-4-4, 4-7-8
   sleep, coherent 5-5). Pure client-side, zero API, strong daily-habit former.

## Sequencing

- **Code:** after Lab Vault ships (Lab Vault is the higher-strategic-leverage
  build — it pulls in people who haven't paid yet).
- **Content:** the audio library needs zero engineering — recording can start
  **now, in parallel.** By the time the module is coded, the content is ready. No
  blocker.
- In-app build order (lowest lift / highest safety first): breathwork pacer →
  affirmations → audio library player → EFT → NLP modules.

## Open decisions — answer before this becomes a build plan

1. **First themes to record** — which 3–5 hypnotherapy tracks lead? (sleep /
   anxiety / cravings / pain / confidence?)
2. **Audio hosting** — S3 (like the reels marketing bucket) vs in-app bundled vs
   another host. Note PII-bucket isolation rules [anthropic-skills:publer].
3. **NLP scripts** — text-only (client reads) or also recorded in her voice?

## Reuse / plumbing (preliminary)

- Delivery: existing PWA push (`/api/app-push`, SW `/ochre-app/sw.js`).
- Personalization: Haiku, from intake fields (goals, stressors, conditions).
- Module surfacing: the plan-modules registry (`plan-modules.ts`,
  `Client.plan_modules`) — this becomes a `mind_body` module.
- Daily affirmation / breathwork reminders share the push + WhatsApp rails already
  built.

## Notes

- Keep hypnotherapy audio = her voice (recorded). Reserve generated/TTS for
  non-therapeutic copy only.
- Breathwork + affirmations are the daily-open engine; hypnotherapy + NLP are the
  depth/differentiator. Ship the daily-open layer first so usage shows up early.

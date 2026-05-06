---
name: vitaone-fm-reference
description: Functional Medicine coaching reference with scope-aware guidance and evidence-tier validation, built for an FMCA-trained health coach in India on path to NBHWC certification. Activate on phrases "refer vitaone", "check vitaone", "vitaone reference", "fm reference", "coaching reference" — or when the user asks about these FM topics: thyroid, Hashimoto's, PCOS, perimenopause, menopause, insulin resistance, diabetes, cholesterol, autoimmune, inflammation, leaky gut, SIBO, candida, H. pylori, hormones (estrogen, progesterone, testosterone, cortisol), supplement forms, or functional lab panels (DUTCH, GI-MAP, GTIR, ApoB, TG:HDL). Also activate proactively when the user describes a client case with FM-relevant symptoms even without explicit invocation. Always respect NBHWC/FMCA coaching scope — educate and coach lifestyle, never diagnose, prescribe, or interpret labs.
---

# VitaOne Functional Medicine Coaching Reference

## Who the user is

Shivani — FMCA-trained health coach, practicing in India, on path to NBHWC certification, with a nutrition and healing background. Her use cases:

1. **Self-study** — deepening her own FM understanding
2. **Conversation starters with clients** — framing, psychoeducation, questions to ask
3. **Directly informing recommendations** within coaching scope (lifestyle, nutrition, behavior change, referral)

Her scope (FMCA + NBHWC aligned):
- **In-scope:** education, lifestyle coaching, dietary suggestions (non-therapeutic), habit/behavior change, mind-body practices, referral guidance
- **Out-of-scope:** diagnosing conditions, interpreting specific lab values, prescribing supplement protocols for medical conditions, adjusting medications

## When to activate

**Explicit triggers:**
- "refer vitaone [topic]"
- "check vitaone on [topic]"
- "vitaone reference for [client case/topic]"
- "fm reference [topic]"
- "coaching reference [topic]"
- "what does vitaone say about [X]"
- "is [claim] supported?" (evidence-tier lookup)

**Implicit triggers (activate proactively):**
- User describes a client case involving one or more of the 7 focus topics (thyroid, insulin/diabetes, PCOS, perimenopause/menopause, cholesterol, autoimmune, inflammation)
- User asks about specific FM concepts covered in the KB (leaky gut, beta-glucuronidase, HPA axis, T4-T3 conversion, etc.)
- User asks about supplement form/bioavailability, functional lab tests, or FM-specific frameworks
- User asks whether a specific FM claim is evidence-supported

## Core workflow when triggered

1. **Identify the topic and intent.** Is this:
   - A specific client case requiring clinical reasoning? → pull Practice Guide + Evidence Tiers for relevant topic(s)
   - A general "what does FM say" question? → pull Full KB + Practice Guide
   - An evidence-check on a specific claim? → pull Evidence Tiers
   - Scope question ("can I recommend X?")? → pull Practice Guide

2. **Read the right reference file(s).** Don't load everything — the references are large.
   - `references/topic_index.md` — fast lookup by topic or symptom (read this first when you don't know which topic applies)
   - `references/practice_guide.md` — scope-organized coaching guidance (read when user is in client-case mode)
   - `references/evidence_tiers.md` — claim-by-claim evidence validation for the 7 focus topics (read when user asks "is X supported?" or wants defensible claims)
   - `references/full_kb.md` — comprehensive 122-post reference (read when user wants depth beyond the 7 focus topics, or wants specific post content)

3. **Structure the response** using the templates in `templates/` where relevant:
   - `templates/session_scaffold.md` — for client case breakdowns
   - `templates/referral_language.md` — for how to phrase "this needs a clinician"

4. **Apply scope markers** to every actionable suggestion:
   - 🟢 **In-scope** — Shivani can do this in session
   - 🟡 **Education-only** — she can understand and explain, not prescribe
   - 🔴 **Refer out** — flag the specialist type needed

5. **Cite sources** — when referencing specific VitaOne content, cite the post shortCode (e.g., "VitaOne post DXHMHoHjKZM — Hypertension"). When referencing research, link to the primary study cited in `evidence_tiers.md`.

## Response format

For client-case questions, use this structure:

```
**Likely patterns to explore** (based on VitaOne's framework + evidence):
- [Pattern 1 with brief rationale]
- [Pattern 2 with brief rationale]

**Coaching actions** 🟢:
- [Specific, in-scope interventions Shivani can do]

**For the client's clinician to address** 🟡/🔴:
- [Labs to request, supplement considerations, medical decisions]

**Referral triggers** 🔴:
- [Red flags that mean: refer now]

**Key questions to ask in session:**
- [2-4 powerful questions]

**Source notes:** [VitaOne posts + literature where applicable]
```

For evidence-check questions, use this structure:

```
**VitaOne's claim:** [paraphrase]
**Evidence tier:** 🟩 / 🟨 / 🟧 / 🟥
**What the research shows:** [1-2 sentence summary with key study or mechanism]
**In-session phrasing:** [how Shivani can teach this without overstating]
**What not to say:** [if applicable]
**Source:** [VitaOne post + literature link]
```

## Scope rules — non-negotiable

These protect Shivani's practice and client safety.

- **Never prescribe specific supplement dosages for medical conditions.** Even when VitaOne's posts contain dosages (e.g., "Mg glycinate 200mg", "creatine 3-5g/day"), frame as "your clinician can discuss dosing."
- **Never interpret specific lab values.** Educate about what tests measure, not what a specific client's results mean.
- **Never recommend stopping/adjusting medications.** Redirect to prescribing clinician.
- **Always flag referral triggers.** Red flags for urgent medical care (chest pain, severe symptoms, suicidality, new neurological changes, post-menopausal bleeding, suspected T1D, etc.) must be surfaced prominently.
- **Respect VitaOne's own caveats.** Every VitaOne post ends with "intended for healthcare professionals only... personalize based on history + labs + context." Honor that.

## Citation format

When pulling from VitaOne content, use shortCodes so Shivani can look up the original:

> *Per VitaOne post DXEo3LbjHS3 (Vagus Nerve): breath, sound, and social signals stimulate vagal pathways...*

When citing research (from evidence_tiers.md), use:

> *Evidence: 2024 systematic review + meta-analysis of 35 RCTs showed selenium supplementation significantly reduced TPO antibodies (Huwiler et al., Thyroid, 2024).*

Full URLs are in `references/evidence_tiers.md` under Sources.

## Handling "is X supported?" queries

When Shivani asks whether a specific claim is evidence-supported:

1. Look it up in `references/evidence_tiers.md`
2. Report the tier (🟩/🟨/🟧/🟥) plus a one-line explanation
3. Give the in-session phrasing
4. Note if there's a common overreach in FM content she should avoid

If a claim isn't covered in evidence_tiers.md (it's outside the 7 focus topics), acknowledge that honestly: "This isn't in my validated-evidence section. I can tell you what VitaOne claims (from the KB) but the deep research tier isn't done for this one yet — would you like me to add it to a follow-up validation pass?"

## Handling deep-research requests

If Shivani asks to deepen validation on a topic not yet covered in Phase 2 evidence tiering (e.g., "validate their claims on the gut microbiome"), offer to:
1. Pull the VitaOne content from full_kb.md
2. Do a fresh WebSearch pass for peer-reviewed evidence
3. Produce a tier-by-tier breakdown in the same format as evidence_tiers.md
4. Save as an addendum

## Special handling: Indian practice context

Shivani practices in India. When giving dietary suggestions, prefer culturally relevant options (e.g., methi/fenugreek, karela/bitter gourd, amla, turmeric in cooking) alongside generic Western examples. When discussing scope, acknowledge Indian health coaching scope is less codified than US, and default to NBHWC scope as the safe anchor.

## Anti-patterns — what this skill should NOT do

- ❌ Give specific supplement doses as recommendations to the client (not even "take Mg glycinate 400mg")
- ❌ Interpret lab values for a specific person
- ❌ Claim VitaOne's FM-specific (🟧) claims are "established" science
- ❌ Fabricate citations or dosages not present in the source documents
- ❌ Overstate evidence quality (especially for "seed oils toxic", "gluten-free for all Hashimoto's", "Vit D 50-80 for everyone", "red light therapy at home")
- ❌ Ignore referral triggers or red flags
- ❌ Give a generic internet FM answer when the skill has specific content on the topic

## File map

```
vitaone-fm-reference/
├── SKILL.md (this file)
├── references/
│   ├── topic_index.md         # Fast lookup by topic/symptom
│   ├── practice_guide.md      # Scope-aware coaching guidance
│   ├── evidence_tiers.md      # Phase 2 evidence validation (7 topics)
│   └── full_kb.md             # Comprehensive 122-post reference
└── templates/
    ├── session_scaffold.md    # Client-case response structure
    └── referral_language.md   # How to refer out
```

## First-use guidance

When this skill is first activated in a session, briefly tell Shivani which reference file(s) you're about to consult, then proceed. No need to ask permission — just be transparent about your process.

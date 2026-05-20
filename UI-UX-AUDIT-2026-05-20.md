# fm-coach v2 — UI/UX audit (felt)

**Auditor:** Claude (Opus 4.7, 1M ctx)
**Scope:** UI/UX feel only. Correctness audit lived in `AUDIT-FINDINGS-2026-05-19.md`; Wave A–E fixes are excluded from re-flagging.
**Code path:** `/Users/shivani/code/healwithshivanih-ads/fm-database-web/src/app/(v2)/**` + `src/components/fm/**`

---

## 1. Surface-by-surface review

### A. `/dashboard-v2` — `src/app/(v2)/dashboard-v2/page.tsx`

The first thing the coach's eye lands on is the **two stat tiles** at the page header (`Clients` / `Need attention`). That's roughly right. But below it, the page stacks **up to 12 sibling panels** in a single column with the same visual weight: `BroadcastPanel`, `WeeklyPollPanel`, `StartDateReminderPanel`, `CatalogueCommitBanner`, `CancellationAlertBanner`, `UpcomingBookingsPanel`, `ScheduleDuePanel`, `InboundMessagesBanner`, "Needs your eyes" red panel (dormant/plateaued/regressed), Upcoming-this-week purple panel, then the 6 collapsible triage sections, then SOAP (per-client only). All these strips compete for attention and there is no priority order in the layout — only chance of presence.

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| D1 | `dashboard-v2/page.tsx:486-726` | A, B | Up to 11 banner strips stacked at uniform visual weight — no spatial priority. After 4+ they read as wallpaper and the coach scrolls past important alerts. | Group strips into 2 tiers via a header: `Today's actions` (broadcast, schedule-due, cancellations) vs `For your eyes` (dormant/plateau/regression). Surface a single combined-count chip at the top of each tier and collapse the tier by default if zero. | M | 1 |
| D2 | `dashboard-v2/page.tsx:550-671` | A, C | "🔔 Needs your eyes" panel uses 3 different bg/border palettes inside ONE panel — gray dormant chips, amber plateau chips, red regressed chips, each on its own row, each row with its own intro sentence. Looks like 3 banners crammed into one. | Split into 3 sibling banners using the existing `FmInboundMessagesBanner` pattern. Each one gets a single tone. | S | 2 |
| D3 | `dashboard-v2/page.tsx:702-721` | A, E | "Upcoming this week" inline-renders chips with `7d3c98` purple — a one-off color used nowhere else in v2's palette. | Replace with `FmChip tone="secondary"` and an `FmPanel` accent header. Drop the inline `<Link>` chip styles. | S | 3 |
| D4 | `triage-sections.tsx:251-355` | D, F | TriageCard is a `<Link>` wrapping content **including another `<Link>`** (the CTA button at line 333). Invalid HTML, gives browsers a coin-flip on which navigation fires when the CTA is clicked. Coach has reported "wrong page opens sometimes". | Outer wrapper → `<div>` with `onClick` routing OR move CTA outside the card body via card-footer pattern. Most explicit: keep one outer `<Link>` covering the whole card and remove the inner `<Link>` (the CTA chip then doesn't need to be a link). | M | 1 |
| D5 | `dashboard-v2/page.tsx:178-180` | E | TriageSections initialCollapsed compute runs `useMemo` but the only dep is `grouped`. If the coach opens a section and dashboard auto-refreshes (`dynamic = "force-dynamic"`), her collapse state resets. | Persist per-section collapsed state to `sessionStorage` keyed by section id. | S | 2 |
| D6 | `dashboard-v2/page.tsx:425-477` | G | Subtitle says `Welcome back, Shivani. Wednesday, 20 May 2026.` Long-form date here, but most surfaces use `DD Mon` (e.g. "20 May"). Mixed time formats throughout. | Settle on one human format per surface tier: headers use `Wed 20 May`; cards use `20 May`; everything else `relative`. | S | 3 |

### B. `/clients-v2` (roster) — `src/app/(v2)/clients-v2/page.tsx` + `list-client.tsx`

Cards are scannable; filter chips work well. The major problem is **type-size pollution** at the bottom of every card.

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| C1 | `list-client.tsx:300-394` | A, C | Single card uses **6 different font sizes**: 14, 11, 10.5, 9.5 (twice). Eye has to retune on every row. The 9.5 plan-slug chip is borderline unreadable. | Settle on a 3-size scale per card: `14 / 12 / 10.5`. Drop the 9.5 entirely. Move plan slug to a `title=` tooltip; show `· active` in 10.5 muted instead. | S | 1 |
| C2 | `list-client.tsx:319-332` | E | Bio row shows `🎂 39 · ♀ F · 📍 Bengaluru` — emojis mixed with field markers (`♀ F` is "female F" — redundant and weird). | Drop the field marker after the gender glyph. `♀ Bengaluru · 39` reads cleaner. Same emoji-glyph dedup throughout. | S | 3 |
| C3 | `clients-v2/page.tsx:328-332` | G | Page title is `👥 Clients — 47` followed by subtitle `Your roster. Filter by workflow stage…`. The em-dash count duplicates the chip-counts immediately below. | Drop `— 47` from H1. Counts on chips are the source of truth. | S | 3 |
| C4 | `list-client.tsx:268-281` | F | UnreadBadge `position: absolute; top:10; right:10` will be clipped on narrow viewports because the card body has `gap: 10`; on iPad-portrait there isn't enough right-margin and the badge sits over the photo. | Reserve a small right-side column in the card grid using `display: grid` and put the badge inside the avatar row. | M | 2 |
| C5 | `list-client.tsx:380-394` | A | "Last session" + "next contact" share the same 10.5 grey row. Last-session is the most useful info on the card (it's how coach picks who to ping next); demoting it to footer-tertiary makes it competitive with mono-id text. | Promote last-session to its own row at 12px with the stage-tag below it. Move next-contact into the stage tag as `Plan active · next 22 May`. | M | 2 |

### C. `/clients-v2/[id]` (overview) — `src/app/(v2)/clients-v2/[id]/page.tsx`

This is the heart of the app. 1,461 lines, ~11 visible panels at once on the right column alone. The biggest single felt problem.

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| O1 | `page.tsx:991-1377` | B | Right rail has 11+ panels stacked: IntakeProgressCard → IntakeInsightsCard → FmContactPanel → SendIntakeFormButton → UnlockFullIntakeButton → Coach exam disclosure → ClientMemoryPanel → WeightLossCard → Sign-up pill → Active medications → Allergies → FmFivePillars. **Each is full-width and renders even when empty**. Coach scrolls ~2000px to reach Five Pillars. | (a) Auto-collapse panels whose key field is empty (medications panel when no meds; allergies panel when none recorded — currently shows "None recorded" placeholder taking full vertical space). (b) Move IntakeProgressCard + IntakeInsightsCard + SendIntakeFormButton + UnlockFullIntakeButton into a single tabbed `Intake` panel with sub-tabs (`status / insights / actions`). | L | 1 |
| O2 | `page.tsx:1119-1230` | B | Coach physical exam `<details>` was correctly hidden by Wave-A — but the OPEN state expands to 3 stacked panels (NASA Lean / Beighton / Tier-1 suspicions) each with their own internal heading and accent border. When opened, those 600px push everything else off-screen. | When `<details open>`, switch the inner from vertical stack → 3-col grid above 1200px viewport. | S | 2 |
| O3 | `page.tsx:782-806` | C, A | The SubNav (`Overview / Analyse / Plan / Communicate / Sessions / Catalogue / Reference / Handoff / SOAP`) sits **next to** PreSessionBrief on the same row. On narrow viewports the brief button wraps to a second row. Tab-set + page-action button compete for the same width. | Move PreSessionBrief into `quickActions={...}` on FmClientHeader. SubNav gets full width. | S | 2 |
| O4 | `page.tsx:1373-1378` | C | FmFivePillarsWithSendCheckIn lives at the BOTTOM of the right column. Coach asks about pillars first in a session — should be top-3, not bottom. | Promote FmFivePillars above ClientMemoryPanel + ActiveMedications. | S | 1 |
| O5 | `page.tsx:1342-1371` | C, G | "Allergies & flags" panel renders `None recorded` italic placeholder taking 60px of vertical space + a 22px panel title. Same applies to `Active medications` showing "No medications recorded". | When empty, render a single compact line in `FmContactPanel`'s "More details" disclosure ("No allergies. No medications.") rather than two separate empty panels. | M | 1 |
| O6 | `page.tsx:738-781` | E | QuickActionLink helper renders 3 inline-styled `<Link>` chips ("📝 Record session", "💬 Send message", "📊 View plan") + an inline `<ClientIdentityEditor>` — all sitting inside `quickActions` of `FmClientHeader`. They visually conflict with the SubNav 2 rows below which also has these labels. | Drop "📝 Record session", "📊 View plan" from header quick actions — duplicated by SubNav. Keep only `💬 Send message` + the identity editor pencil. | S | 1 |
| O7 | `page.tsx:1310-1340` | A, C | Medications list is dashed-underline rows rendering each med as `<div borderBottom: 1px dashed>` — every row has 5px vertical padding only, no left padding, no separator hierarchy. | Switch to a `FmChip` row layout same as Allergies. Consistent treatment for two adjacent panels with the same data shape. | S | 2 |
| O8 | `page.tsx:1386-1395` | A | SOAPNotePanel at full-width bottom. AnaIysis-class content (synthesises latest session) is below the fold, off the right-side panel rhythm. Coach opens this last but uses it FIRST in client calls. | Move SOAP to a tabbed sticky-right card OR a top-of-page chip ("📋 SOAP from last session — open") that floats it in a slide-over. | L | 2 |
| O9 | `page.tsx:1430-1460` | A, E | SubNav has 7+ tab labels (Overview, Analyse, Plan, Communicate, Sessions, Catalogue, Reference, Handoff, SOAP via subnav arr). Tabs differ in label length 5-15 chars; on iPad the row scroll-wraps. Active-tab indicator is a 2px bottom border — narrow-target visual cue. | Drop subnav to 5 primary tabs (Overview / Analyse / Plan / Communicate / Sessions); promote Catalogue/Reference/Handoff/SOAP into the FAB or "..." overflow. | M | 2 |

### D. `/clients-v2/[id]/analyse` + sub-routes — `analyse/page.tsx`

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| AN1 | `analyse/page.tsx:286-349` | A | Compact client strip is duplicated with the Overview header's identity block. Coach effectively sees the client's name 3 times above the fold (sidebar breadcrumb, top strip header, last-assessment strip). | Replace top strip with a one-line `crumbs={[…]}` only. Identity already in breadcrumb. | S | 2 |
| AN2 | `analyse/page.tsx:355-424` | A, C | "Last discovery call / Last intake" banner uses blue accent + Open button + optional "Send labs" sub-disclosure. Below it, "Next session due" banner uses red/amber. Two adjacent banners with different accent systems. | Settle these two into a single 2-up grid: last-on-left, next-on-right. Same chrome tone (`var(--fm-bg-cool)` border-only). | M | 2 |
| AN3 | `analyse/page.tsx:198-222` | C | Right rail timeline cards have summary text truncated at 220 chars hard. Some sessions break mid-word visually (no ellipsis CSS — just `…` appended in JS, but no `overflow: hidden`). | Use CSS `-webkit-line-clamp: 3` on a fixed-line container instead of JS slice. | S | 3 |

### E. `/clients-v2/[id]/communicate` — `new-communicate-panel.tsx` (1,257 lines)

This is the most visually complex surface in the app.

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| CM1 | `new-communicate-panel.tsx:715-741` | E, G | The whole panel is wrapped with a dashed border + amber "✨ New Communicate layout · preview" eyebrow. The preview-tag has been there for weeks; it's no longer "preview" in any meaningful sense — it's the actual UI. | Drop the dashed border + preview eyebrow once stable. Or convert the eyebrow into a structural `panel-eyebrow` styled like other panels' eyebrows. | S | 2 |
| CM2 | `new-communicate-panel.tsx:743-773` | A, C | Hero CTA uses `.hero hero--{tone}` from `fm-v2-communicate.css` — a completely separate CSS file with its own color tokens. Tone colors (primary/secondary/warning/danger) don't match the FmPanel tone system. | Migrate `.hero` styles to use shared `--fm-tone-*` tokens. One source of truth for tone palette. | M | 2 |
| CM3 | `new-communicate-panel.tsx:808-870` | A | Main 2-col body has a 320px right rail (fixed) — when the page is narrower than ~1080, the right rail jumps below and the wk-track cards spill horizontally. No mobile fallback for the fortnight track. | Wrap wk-track in `overflow-x: auto` with snap-x scroll behavior. Below 900px collapse to 2 fortnights per row vertically. | M | 1 |
| CM4 | `communicate/page.tsx:78` | D | `markWhatsappInboxRead(id)` fires on every load via `void markWhatsappInboxRead(id)`. Even when coach navigates to Communicate to send a letter (not read inbound), unread badge clears silently. | Move side-effect into a button click OR scope to a `viewedAt > inboundLastReceivedAt` check that doesn't auto-clear when there's truly unread inbound. | M | 2 |

### F. `/clients-v2/[id]/plan` + plan editor `/plan/edit/[slug]`

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| PL1 | `plan/edit/[slug]/page.tsx` + `plan-editor.tsx:1224-1228` | A, E | The plan editor (2,401 lines) is wrapped in v2 chrome but its INSIDE uses **shadcn Tabs + Tailwind `<details>` + Card components** — entirely different visual system from the surrounding FmAppShell. The radii, borders, fonts, spacing, even button shapes are different. | This is the biggest consistency violation in the app. Short term: wrap the editor in a `fm-v2-host` div with CSS overrides that match radius/spacing. Long term: Phase 4.5 rebuild was deferred — it's now the single biggest UX cliff and worth scheduling. | L | 1 |
| PL2 | `plan/page.tsx:665-730` | C | "Pending draft" callout (purple `5a3fb0`) + "Plan-diff alert" + recheck panel + active plan card all stack vertically with different accent systems. Coach sees 5+ alert tones in a row. | Co-locate all draft/review banners into a single horizontal "Plan state" strip with chips. The diff/draft/recheck items become FmChip tones inside one row. | M | 2 |
| PL3 | `plan/page.tsx:626-650` | D | "Activate plan" inline row sits in dim green panel — single button + helper text. But it's separated from the FmWorkflowBanner by 12px and visually reads as a sibling to it rather than its action area. | Merge the activate button INTO the FmWorkflowBanner's right slot when stage is "draft". Reduce 2 panels to 1. | S | 1 |

### G. `/sessions` (timeline inspector) — `sessions/page.tsx`, `sessions-browser.tsx`

Layout is a clean 2-pane with the list on left, inspector on right. Mostly good. Two findings:

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| SE1 | `sessions/page.tsx:62-74` | H | Default selection is the newest session. But when arriving via dashboard "Recheck due → record session", coach wants to see the LAST session BEFORE recheck, not the latest. | If URL has `?recheck=1` query, default to penultimate. Otherwise newest. | S | 3 |

### H. `/messages` — `messages/page.tsx`

The new inbox is clean. Two small issues:

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| ME1 | `messages/page.tsx:142-228` | D | Each row is a 3-col grid `180px | 1fr | auto`. Clicking the client name navigates to Communicate; clicking "Reply →" also navigates to Communicate — same destination, different visual targets. Tapping anywhere on the row should reply. | Make the entire `<li>` a click-target (`<Link>` wrapping the whole row content). Drop the separate "Reply →" button. Keep `InboxMarkReadButton` as the only inline action. | S | 2 |
| ME2 | `messages/page.tsx:236-250` | G | Trailing italic helper text at 11px is the only mode information on the page. Coach probably skips it. The 24h-window distinction is critical (template vs free-form) but invisible. | Move that copy into a `FmChip tone="info"` next to the filter chips above. Once-seen-dismissed pattern with localStorage. | M | 3 |

### I. `/calendar` — `calendar/page.tsx`

Calendar is dense by nature; works. One finding:

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| CA1 | `calendar/page.tsx:130-167` | E | Booking labels stripped of "Programme " and "between Shivani Hariharan and X" — but resulting label can be empty string, falling back to `"booking"`. Inconsistent — sometimes "30-min consult", sometimes "booking". | Catalogue of known event-slug → display-name, fall back to a sensible default like "Consultation". | S | 3 |

### J. `/settings` — `settings/page.tsx`

Mostly correct. One spot:

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| ST1 | `settings/page.tsx:159-225` | A | Integrations panel lists each integration with a `StatusDot` + `FmChip`. Two visual indicators for the same boolean. | Drop the StatusDot. The chip alone (Connected / Not configured) is enough. | S | 3 |

### K. `/intake/[token]` (CLIENT-facing form) — `intake-form.tsx` (4,164 lines)

Client-facing. The longest single file in the codebase. Crucial:

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| IN1 | `intake-form.tsx` overall | B, D | 4,164 lines of forms — the client sees this on their phone. Progressive disclosure exists (sections collapse) but EVERY section opens to ~20-50 fields on iPhone. Field-level conditionality is light. | Out-of-scope as a "redesign" but a quick win: ensure every Section has a one-line description of HOW LONG it takes. Add a section-level "skip / I'll come back" affordance. | M | 1 |

### L. `/clients-v2/new` (new client form)

| # | Surface | Category | Finding | Fix | Effort | Impact |
|---|---|---|---|---|---|---|
| NC1 | `new-client-form.tsx` + `clients-v2/new/page.tsx` | A, E | The new-client form uses **shadcn Card / Input / Button + Tailwind** (`text-xs`, `space-y-1`, `bg-indigo-600`). The wrapper page is `FmAppShell`. Inside-vs-outside chrome mismatch in the same view — pillar emojis, indigo colors, different button radii. | Tailwind-to-Fm migration: rebuild the form using FmField / FmPanel primitives. Until then, scope the form in a `<div className="fm-v2-host">` and add CSS overrides for `.fm-v2-host button.bg-indigo-600` etc. | L | 1 |

---

## 2. Themes (clustered patterns)

### Theme 1: Type-scale chaos
**228 inline `fontSize: 11`, 171 of `12`, 167 of `11.5`, 126 of `10.5`, 102 of `10`, 48 of `9.5`, 17 of `9`** across `(v2)/` + `components/fm/`. No design token. Half-pixel sizes exist (`11.5`, `12.5`, `10.5`, `9.5`) which on non-retina displays anti-alias differently per browser. Sub-10px text is borderline accessibility-illegal.
*Closes: C1, O1, O5, S1, multiple.*
**Fix:** Add `--fm-font-xs/sm/md/lg/xl` to CSS tokens. 6 sizes max: 10 / 11 / 12 / 13 / 14 / 16. Strip half-pixels. ESLint rule banning inline `fontSize` (force token use).

### Theme 2: Right-column panel overload on Client Overview
The right rail of `/clients-v2/[id]` stacks 11+ panels at full width including 3 empty/placeholder ones. Coach scrolls 2000px to reach the Five Pillars she actually needs at session start. Empty panels render `None recorded` italic placeholders that take 80px of vertical space each.
*Closes: O1, O4, O5, O7.*
**Fix:** Conditional rendering — empty fact-panels become a single condensed "More" row inside FmContactPanel disclosure. Promote FivePillars + SOAP to above-fold.

### Theme 3: Banner-stacking on dashboard
The dashboard renders up to 11 alert/info banners stacked vertically at uniform visual weight. After 3-4, the coach learns to skip the section entirely. Plus 3 sub-panels combined into the "Needs your eyes" red strip use 3 different palettes inside one panel container.
*Closes: D1, D2, D3.*
**Fix:** Two-tier grouping (Actions Today / FYI) with combined-count chips that collapse to a single summary row when empty.

### Theme 4: Inconsistent chrome — Fm v2 vs Tailwind/shadcn
Three surfaces (plan editor, new-client form, parts of the catalogue) use shadcn `Card` + Tailwind colors (`bg-indigo-600`, `text-xs`) while the rest of v2 uses inline-styled FmPanel. Within one page (plan editor opened inside FmAppShell), border radii, button styles, and palette all change.
*Closes: PL1, NC1.*
**Fix:** Schedule rebuild of plan-editor + new-client-form using FmPanel/FmField. Until then a `.fm-v2-host` namespace override in CSS that forces shadcn buttons to use `--fm-primary` and `--fm-radius-sm`.

### Theme 5: Token drift on radii + padding
`borderRadius` has `var(--fm-radius-sm)` (250 uses) but also 36× `6`, 30× `4`, 29× `8`, 19× `999`, 15× `3`. Padding has no clear scale — `10px 12px / 8px 10px / 10px 14px / 6px 12px / 4px 10px / 8px 12px / 8px 14px / 5px 10px / 6px 10px / 12px 16px` all 19-35 uses each.
**Fix:** Audit token usage; add lint rule. Define `--fm-pad-xs/sm/md/lg` and migrate inline.

### Theme 6: Duplicate navigation in client header
Every client subpage shows the client name in: sidebar breadcrumb + page top strip + (sometimes) tab indicator + last-assessment banner. SubNav labels (Record session, View plan) duplicate the QuickActionLink chips above.
*Closes: O3, O6, AN1.*
**Fix:** Settle on one identity strip per page. Remove duplication.

### Theme 7: Wrap-on-narrow row layouts
SubNav, header quick-actions row, schedule-due rows all use `flexWrap: "wrap"` so they shed gracefully — but the visual order on wrap is unpredictable (CTAs end up at top of next row instead of right edge). On a 1024-1100px viewport (likely iPad-landscape) this happens routinely.
*Closes: O3, C4.*
**Fix:** Use `display: grid` with explicit auto-fit on rows where order matters. Cap action-chip count to what fits on one row.

### Theme 8: Side effects on page load
- `markWhatsappInboxRead(id)` on Communicate page load
- `markCoachTabViewed(id, "sessions")` on Sessions page load
- Subscriptions to dashboard auto-refresh

Coach navigates to Communicate to write a letter; her unread badge clears even though she didn't read inbound. Feels broken.
*Closes: CM4.*
**Fix:** Tie inbox-read to explicit user action (scroll past inbox section OR click "mark read"), not page mount.

### Theme 9: Two visual indicators for one boolean
Status pages use `StatusDot` + `FmChip` for the same boolean. Plan editor uses `<details open=...>` AND a "show/hide" caret AND a label change. Forms duplicate "required" via asterisk + helper text.
*Closes: ST1.*
**Fix:** Pick one indicator per concept.

---

## 3. Prioritised punch-list — top 12

Ranked by `(impact × frequency) / effort`. Each row references findings it closes.

| # | Action | Closes | Effort | Impact |
|---|---|---|---|---|
| 1 | **Conditional render empty-panel placeholders** (medications, allergies, intake when none) — fold to FmContactPanel disclosure | O1, O5, O7 | S | 1 |
| 2 | **Add canonical font-size CSS tokens** (`--fm-font-xs/sm/md`) + replace `fontSize: 9.5/10.5/11.5/12.5` cluster sites first | Theme 1, C1, O5 | M | 1 |
| 3 | **Fix nested `<Link>` in TriageCard** — outer-link-only or button-card | D4 | M | 1 |
| 4 | **Promote FivePillars + SOAP above-fold on Overview**; demote empty panels | O4, O8 | M | 1 |
| 5 | **Merge "Activate plan" button INTO FmWorkflowBanner** right-slot when draft | PL3 | S | 1 |
| 6 | **Tier dashboard banners** into 2 groups (Today / FYI) with collapsible combined chip | D1, D2, D3 | M | 1 |
| 7 | **Drop duplicate QuickActionLink chips** that mirror SubNav labels | O6 | S | 1 |
| 8 | **`.fm-v2-host` CSS overrides** for plan editor + new-client form (Tailwind/shadcn → Fm tokens) | PL1, NC1 | M | 1 |
| 9 | **Drop StatusDot, keep only FmChip** in Settings + everywhere else with dual indicators | ST1, Theme 9 | S | 3 |
| 10 | **Persist triage-section collapsed state** to sessionStorage | D5 | S | 2 |
| 11 | **Drop nested font sizes on Client Card** to 14 / 12 / 10.5 only | C1, C2 | S | 1 |
| 12 | **Make `/messages` row fully click-targetable** (drop separate Reply button) | ME1 | S | 2 |

---

## 4. Quick wins for tonight (≤15 min each)

1. **Drop the `— 47` count from `/clients-v2` H1** (C3). One line edit at `clients-v2/page.tsx:329`.
2. **Drop the StatusDot from Settings integrations panel** (ST1). Remove the component from each row in `settings/page.tsx:160-225`.
3. **Drop `"♀ F"` redundancy on client cards** (C2). One-line fix at `list-client.tsx:330`.
4. **Drop "✨ New Communicate layout · preview" eyebrow** (CM1). Lines 724-741.
5. **Promote FmFivePillars above ClientMemoryPanel** on Client Overview (O4). Reorder JSX blocks at `page.tsx:1239-1377`.
6. **Make `/messages` row click-targetable** (ME1). Wrap the `<li>` body content in one `<Link>`. Drop the inline Reply button.
7. **Persist triage-section collapsed state to sessionStorage** (D5). 5-line addition in `triage-sections.tsx:128-136`.
8. **Hide empty Active medications + Allergies panels** when both lists are empty (O5, O7). Wrap in `{ list.length > 0 && (…) }`.
9. **Drop `📝 Record session` + `📊 View plan` from FmClientHeader.quickActions** (O6). They duplicate the SubNav labels two rows below.

## 5. Bigger investments (>1 hr, high-impact)

1. **Plan editor v2 chrome migration (PL1)** — biggest visual consistency cliff in the app. The 2,401-line editor uses shadcn+Tailwind inside FmAppShell. 1-2 days. Either rebuild with Fm primitives OR write a comprehensive `.fm-v2-host` CSS-override layer. The override is L effort, ~3 hours; the rebuild is multi-day.
2. **Client Overview right-rail re-architecture (O1, Theme 2)** — 11 stacked panels → 3-4 grouped panels with internal tabs. Intake panel takes 4 widgets into one tabbed view; Memory + WeightLoss + Sign-up + Five Pillars become one "Client memory" panel with sub-tabs.
3. **Type-scale tokenisation (Theme 1)** — define 6-step scale, write codemod to map `fontSize: N` → token, ESLint rule to ban inline. ~3 hours plus debugging visual diffs.
4. **Dashboard banner tiering (D1, D2)** — collapsible parent containers ("Today's actions" / "FYI") with combined count chips. New `FmAlertGroup` primitive. ~2 hours.

---

## Top-5 themes (250 words)

**1. Type-scale chaos.** The biggest source of visual mess. Over 1,200 inline `fontSize` declarations spread across 22 distinct sizes including half-pixel ones (9.5, 10.5, 11.5, 12.5). A single client card uses 6 different sizes. There are no font tokens. Adding `--fm-font-xs/sm/md/lg/xl` and migrating clustered sites would close findings on nearly every surface and immediately make the app feel calmer.

**2. Right-rail overload on Client Overview.** The most-used surface in the app stacks 11+ panels in its right column at uniform full-width, including 3 panels rendering "None recorded" placeholders worth 80px each. Coach scrolls ~2000px to reach the Five Pillars panel she uses at the start of every session. Empty-state suppression + above-fold promotion of FivePillars and SOAP would transform the felt experience.

**3. Dashboard banner stacking.** 11 sibling banner strips at uniform visual weight render every page-load on `/dashboard-v2`. After 3-4 they become wallpaper. Tier them into 2 groups (Actions Today / FYI) collapsed by default when empty, with combined-count chips.

**4. Two visual systems coexisting.** The plan editor (2,401 lines) and new-client form use shadcn + Tailwind inside the FmAppShell. Border-radii, button styles, palette, type all change when you click "Edit plan". Largest single consistency cliff. Either a CSS-override layer or scheduled rebuild.

**5. Token drift.** `borderRadius` has 250 token uses competing with 36 hardcoded `6`, 30 hardcoded `4`. Padding has no scale at all — 35 variants in top-15. Easy lint-rule fix; high "felt cleanness" payoff.

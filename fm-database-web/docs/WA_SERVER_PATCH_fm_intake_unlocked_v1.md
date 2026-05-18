# WA server patch — `fm_intake_unlocked_v1` template

**Date:** 2026-05-18
**fm-coach trigger:** v0.75.9 — `sendIntakeUnlockedViaApi()` server action, called by `UnlockFullIntakeButton` after coach clicks 🔓 Unlock full intake on the client Overview.

**Purpose:** "your full intake is now open" notification, sent when the coach unlocks the longer intake form for a client who has already submitted pre-discovery. Distinct from `fm_intake_invite` (first-time invite) — this is a welcome-back nudge.

---

## Patch — add to `whatsapp-server/scripts/submit-templates.js` TEMPLATES array

Append the entry below right after the `fm_intake_invite` block. Already applied on this machine — entry committed to wa-server checkout at `~/healwithshivanih-ads/whatsapp-server/`.

```js
{
  // v0.75.4 — Sent by fm-coach when the coach clicks "🔓 Unlock full
  // intake + mark signed up" on the client Overview. The client returns
  // to the SAME intake URL they used for pre-discovery; their earlier
  // answers are preserved and the form now shows the deeper sections
  // (FM body systems, ACE, timeline, Joints & standing, etc.) below.
  // Different copy from fm_intake_invite — this is a "welcome back, we're
  // working together now" nudge, not a first-time invite.
  // Called from `lib/server-actions/intake.ts → sendIntakeUnlockedViaApi()`
  // (added in fm-coach v0.75.9). Fallback to fm_intake_invite if this
  // template hasn't approved yet — UnlockFullIntakeButton has env-gated
  // template switching.
  name: 'fm_intake_unlocked_v1',
  category: 'UTILITY',
  language: 'en',
  body:
    "Hi {{1}}, now that we're working together I've opened up the longer intake form so I can build your specific plan. Your earlier answers are saved — pick up where you left off:\n\n{{2}}\n\nThe newer sections are the ones I'm most keen to learn. Take your time, no rush.\n\n— Shivani Hari\nYour Functional Health Coach",
  example: [['Priya', 'https://intake.theochretree.com/intake/abc123xyz']],
},
```

## Submit command

```bash
cd ~/healwithshivanih-ads/whatsapp-server
node scripts/submit-templates.js fm_intake_unlocked_v1
```

**Already submitted 2026-05-18 — Meta template ID `1914639249252102`, status PENDING.**

## Check status

```bash
cd ~/healwithshivanih-ads/whatsapp-server
node scripts/submit-templates.js --check | grep fm_intake_unlocked
```

Expected progression: `PENDING` → `APPROVED` (typically within minutes for UTILITY).

## Once APPROVED — flip the env flag on the Mac mini

```bash
echo 'FM_INTAKE_UNLOCKED_TEMPLATE_APPROVED=1' >> ~/code/healwithshivanih-ads/fm-database-web/.env.local
~/code/healwithshivanih-ads/fm-database-web/node_modules/.bin/pm2 restart fm-coach --update-env
```

After this, the 📨 Notify client button in `UnlockFullIntakeButton` will use the unlock-specific template instead of falling back to `fm_intake_invite`.

## Update `project_whatsapp_templates.md` memory

Once approved, add a row:

```
| `fm_intake_unlocked_v1` | ✅ APPROVED (YYYY-MM-DD) | UTILITY | 2: name / intakeUrl | `lib/server-actions/intake.ts → sendIntakeUnlockedViaApi()` (called from `(v2)/clients-v2/[id]/unlock-full-intake-button.tsx`) |
```

And flip the count: "21 templates registered. **21 APPROVED, 0 PENDING.**"

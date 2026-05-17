# WA-server-side patch — register the two plan-publish follow-up templates

**Target repo:** `whatsapp-server-shivani` (the other chat).
**Goal:** add `fm_plan_letter_link_v1` and `fm_supplement_order_v1` to the canonical template registry, then submit to Meta for approval.

## How the registry works

`scripts/submit-templates.js` is the single source of truth for every template fm-coach sends. Adding a new template = appending one entry to the `TEMPLATES` array; the script then either submits everything (`node scripts/submit-templates.js`) or just-named ones (`node scripts/submit-templates.js <name>`). Already-submitted templates are skipped, so re-running is safe.

## Patch: `scripts/submit-templates.js`

Append these two entries to the `TEMPLATES` array (anywhere — they're not order-sensitive, but the existing convention is to group by purpose; "FM coach manual templates" comment seems closest):

```js
  // ── Plan-publish follow-up templates (fired by fm-coach after a plan
  //    is published — see fm-coach commit ab71ac8 plan-publish-followups.ts) ──
  {
    name: 'fm_plan_letter_link_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hey {{1}}, I've just sent you the full plan over email — but here's the same thing as a phone-friendly link so you can flip it open between meals:\n\n{{2}}\n\nTake your time with it. Questions welcome, no rush. — Shivani",
    example: [['Priya', 'https://intake.theochretree.com/letter/abc123']],
  },
  {
    name: 'fm_supplement_order_v1',
    category: 'UTILITY',
    language: 'en',
    body:
      "Hey {{1}}, this is your supplement starter pack for the protocol — tap the link below for the full list with order options for each:\n\n{{2}}\n\nBrand and dosage matter a lot — if you're unsure about any of them, please reach out before ordering. They take 2-3 days to reach you, so earlier the better. — Shivani",
    example: [['Priya', 'https://intake.theochretree.com/supplements/priya-plan-1-2026-05-17']],
  },
```

## Submit to Meta

After committing the patch:

```bash
# From your local checkout of whatsapp-server-shivani:
node scripts/submit-templates.js fm_plan_letter_link_v1 fm_supplement_order_v1

# Or, if running inside the Fly machine (no Fly redeploy needed for
# template submission — the script just POSTs to Meta's Graph API):
flyctl ssh console -a whatsapp-server-shivani -C \
  'cd /app && node scripts/submit-templates.js fm_plan_letter_link_v1 fm_supplement_order_v1'
```

Both should report `submitted ✓`. Meta status: PENDING → APPROVED typically within 1–24h.

## Track approval

```bash
# Pull live status from Meta:
node scripts/submit-templates.js --check
```

Or check the inventory in this repo's memory: `project_whatsapp_templates.md` (manually update the row when status flips).

## Flip the fm-coach feature flag

Once both show `APPROVED` in Meta:

```bash
# On fm-coach machine:
echo 'FM_AUTO_PUBLISH_FOLLOWUPS=1' >> /Users/shivani/code/healwithshivanih-ads/fm-database-web/.env.local
cd /Users/shivani/code/healwithshivanih-ads/fm-database-web && \
  ./node_modules/.bin/pm2 restart fm-coach --update-env
```

After that, every plan publish auto-fires the two follow-ups (template 1 immediately, template 2 at +6h with 9am-IST floor).

## Smoke test (post-approval)

Pick a test client whose phone you control. Publish a plan for them:
- Within seconds: template 1 message arrives with link to `/letter/<token>`.
- ~6 hours later (or next 9am IST, whichever later): template 2 arrives with link to `/supplements/<planSlug>`.

If template 1 doesn't fire, check `~/.pm2/logs/fm-coach-out.log` for `[publish-followups]` warnings.
If template 2 doesn't fire, check `~/fm-plans/_pending_sends.yaml` (should have a row queued) and `~/.pm2/logs/fm-coach-cron-out.log` (cron tick should show `pending-sends ✓`).

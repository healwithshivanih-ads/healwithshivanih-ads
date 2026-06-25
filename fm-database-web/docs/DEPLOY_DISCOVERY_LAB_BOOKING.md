# Deploy runbook — discovery tier + Acumen lab booking

Branch `claude/zen-neumann-e08ccc`, commit `eb2b3681`. Built + verified on
localhost; this runbook takes it live. ~45–60 min end-to-end.

## What this ships, and to which surface

Two surfaces, both must deploy (see [[reference_deploy_surface_routing]]):

| Piece | Runs on | Deploy via |
|---|---|---|
| Coach "Recommend labs" builder + fulfilment, DiscoveryAppCard | coach **localhost** (PM2 `fm-coach`) | `npm run build` + `pm2 restart` |
| Order **projection** (`app-staging-action.py`) | coach localhost (cron + stage actions) → Mutagen → Fly | picked up automatically (python read per-run); restart `fm-coach-cron` to be safe |
| Discovery app shell, client **pay screen**, Lab Vault | **Fly** (`theochretree-coach`) | `flyctl deploy` |
| `/api/lab-order/[id]/pay` + `/api/lab-order/webhook` | **Fly** | `flyctl deploy` |

> Coach routes 404 on Fly (FLY_INTAKE_ONLY) — the coach builder/fulfilment only
> work on localhost. The client pay + webhook only work on Fly. Both deploys
> are required for the end-to-end loop.

## 0. Prerequisites

- A live **Razorpay account** (the one the Wix funnel uses is fine — reseller model).
- Decide: **test mode first** (recommended) or straight to live.
- Lab Vault Phase 2 must be present on the deploy branch (it's the labs surface the
  discovery shell + booking lean on). Confirm `src/lib/fmdb/lab-vault.ts` +
  `ochre-labs.tsx` are on `main` after the merge.

## 1. Pre-deploy verification (already green on this branch)

```
cd fm-database-web
npm run type-check    # 0 errors
npx vitest run        # 106 pass
npm run build         # clean; /api/lab-order/* in the manifest
```

## 2. Razorpay env — the build-time vs runtime split (IMPORTANT)

- `NEXT_PUBLIC_RAZORPAY_KEY_ID` is **inlined at build time** (it's public, baked
  into the client bundle for Razorpay Checkout). It must be set BEFORE `flyctl
  deploy`'s build — put it in `fly.toml [env]` (it's not secret) or pass as a
  build arg. If it's only a runtime secret, the browser Checkout gets `undefined`.
- `RAZORPAY_KEY_SECRET` + `RAZORPAY_WEBHOOK_SECRET` are **runtime only** — set as
  **Fly secrets**, never in the repo / never `NEXT_PUBLIC_`.

```
# public key → build-time env (add to fly.toml [env], NOT a secret):
#   NEXT_PUBLIC_RAZORPAY_KEY_ID = "rzp_test_T5p8oqaWk3IIw7"   (test) / rzp_live_… (live)

# secrets → runtime:
flyctl secrets set \
  RAZORPAY_KEY_SECRET=<key_secret> \
  RAZORPAY_WEBHOOK_SECRET=<your_webhook_secret> \
  -a theochretree-coach
```

(For the coach localhost, the pay/webhook routes don't run there, so coach
`.env.local` doesn't need the Razorpay keys — only Fly does.)

## 3. Merge the branch to the deploy line

```
git checkout main
git merge claude/zen-neumann-e08ccc      # or open a PR and merge
# also confirm fm-database/data/lab_providers/acumen.yaml#profiles_final is on main
# (it was uncommitted in main's working tree — this branch carries it)
```

## 4. Deploy coach localhost (PM2)

```
cd fm-database-web
npm run build
./node_modules/.bin/pm2 restart fm-coach --update-env
./node_modules/.bin/pm2 restart fm-coach-cron --update-env   # picks up the new staging script
```

Smoke: open `/clients-v2/<a discovery client>` → the "🔬 Recommend labs" card
loads with the 4 profiles + correct sex/age suggestion.

## 5. Deploy Fly

```
flyctl deploy -a theochretree-coach --remote-only
# (if auth fails, FLY_API_TOKEN=<token> flyctl deploy … per the mutagen runbook)
```

## 6. Register the Razorpay webhook

Razorpay Dashboard → Settings → Webhooks → Add:
- URL: `https://intake.theochretree.com/api/lab-order/webhook`
- Active events: **`order.paid`** and **`payment.captured`**
- Secret: the same value you set as `RAZORPAY_WEBHOOK_SECRET`

## 7. Post-deploy smoke tests

1. **Discovery app reachable** — issue a discovery app link from the coach card,
   open `/app/<token>` on a phone → read-only shell (Lab Vault + Summary, Plan/
   Progress locked, upgrade CTA).
2. **Recommend → projects to Fly** — recommend a Base panel on the coach side;
   within ~1 min (Mutagen + cron) it appears in the client app's Labs tab as
   "Shivani recommends … Pay ₹12,500".
3. **Pay round-trip (TEST mode)** — tap Pay → Razorpay test Checkout opens → pay
   with a Razorpay test card/UPI → the webhook flips the order to `paid` → the
   coach dashboard shows "Mark booked". THIS is the step that needs live infra.
4. **our_cost_inr not leaked** — view the client app page source; confirm the
   coach's wholesale cost is not present (redacted to 0).

## 8. Go live (after test mode passes)

- Swap `NEXT_PUBLIC_RAZORPAY_KEY_ID` to the `rzp_live_…` key (rebuild + redeploy Fly).
- `flyctl secrets set RAZORPAY_KEY_SECRET=<live_secret> …`.
- Add a **live** webhook (same URL, live mode).
- Confirm UPI + Cards enabled on the account.

## 9. Rollback

- Fly: `flyctl releases -a theochretree-coach` then `flyctl deploy --image <prev>`
  (or redeploy the previous commit).
- Coach: `git revert eb2b3681` (or checkout the prior commit) → rebuild + pm2 restart.
- The order data is forward/back-mirrored YAML — a rollback of code doesn't lose
  recommended/paid orders on disk.

## Known limitations carried into production (P2 follow-ups)

- **Pay endpoint is public + trusts `clientId`** (no token). The bound-check
  prevents amount fraud; worst case a stranger *pays* for someone's order. Harden
  by token-scoping the pay call.
- **No coach notification on `paid`** — the coach sees paid orders on the
  dashboard ("Mark booked") but isn't pushed a WhatsApp/inbox alert. Add a
  `paid` → coach-notify hook in the webhook.
- **Add-on price** is coach-set per recommendation (no global margin policy) and
  is bound-checked-not-recomputed at pay time (`MAX_ADDON_INR` cap).

#!/usr/bin/env python3
"""
run_warm_retarget.py — Warm-Audience Lead Campaign
────────────────────────────────────────────────────
Runs a ₹100/day LEADS campaign using Meta Advantage+ Audience —
Meta's AI targeting that automatically finds your warmest likely leads
(IG/FB engagers, profile visitors, people similar to existing leads).
Every registration naturally builds your Meta retargeting pool.

Reuses existing HNI creatives (promo video + card + story).

Usage:
  python3 run_warm_retarget.py           # create PAUSED (review first)
  python3 run_warm_retarget.py --go-live # create and activate immediately
"""

import os, sys, time, argparse, requests
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
load_dotenv(Path(__file__).parent / "responder.env")

ACCESS_TOKEN = os.environ["META_ACCESS_TOKEN"]
AD_ACCOUNT   = os.environ["META_AD_ACCOUNT_ID"]
GRAPH        = "https://graph.facebook.com/v19.0"

PAGE_ID  = "479044818621032"
IG_ID    = "17841403970279155"
FORM_ID  = os.getenv("LEAD_FORM_ID", "1262832622693917")

# Reuse the best-performing HNI creatives from the main campaign
CREATIVE_VIDEO = "2182614619244192"   # HNI Promo Video
CREATIVE_CARD  = "723725407430333"    # HNI Workshop Card
CREATIVE_STORY = "1863922290986077"   # HNI Story Card

DAILY_BUDGET   = 10000   # ₹100/day in paise
WEBINAR_END_UTC = int(datetime(2026, 4, 26, 14, 30, tzinfo=timezone.utc).timestamp())

def step(msg): print(f"\n▶  {msg}")
def ok(msg):   print(f"   ✅ {msg}")
def info(msg): print(f"   ℹ  {msg}")
def err(msg):  print(f"   ❌ {msg}", file=sys.stderr)

def api_post(path, payload):
    payload["access_token"] = ACCESS_TOKEN
    r = requests.post(f"{GRAPH}/{path}", json=payload, timeout=30)
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"]["message"])
    return data

def api_get(path, params=None):
    p = {"access_token": ACCESS_TOKEN, **(params or {})}
    r = requests.get(f"{GRAPH}/{path}", params=p, timeout=30)
    data = r.json()
    if "error" in data:
        raise RuntimeError(data["error"]["message"])
    return data

# ── 1. Campaign ───────────────────────────────────────────────────────────────
def create_campaign(status):
    step("Creating warm-audience leads campaign")
    data = api_post(f"{AD_ACCOUNT}/campaigns", {
        "name":                            "Heal With Shivanih — Warm Audience Webinar Leads",
        "objective":                       "OUTCOME_LEADS",
        "status":                          status,
        "special_ad_categories":           [],
        "is_adset_budget_sharing_enabled": False,
    })
    ok(f"Campaign ID: {data['id']}")
    return data["id"]

# ── 2. Ad Set ─────────────────────────────────────────────────────────────────
def create_adset(campaign_id, status):
    step("Creating Advantage+ ad set (₹100/day) — Meta AI finds warmest leads")
    data = api_post(f"{AD_ACCOUNT}/adsets", {
        "name":             "Advantage+ Warm Audience — Webinar Leads",
        "campaign_id":      campaign_id,
        "billing_event":    "IMPRESSIONS",
        "optimization_goal":"LEAD_GENERATION",
        "bid_strategy":     "LOWEST_COST_WITHOUT_CAP",
        "daily_budget":     DAILY_BUDGET,
        "end_time":         WEBINAR_END_UTC,
        "status":           status,
        "destination_type": "ON_AD",
        "promoted_object":  {"page_id": PAGE_ID},
        # Advantage+ Audience: Meta AI automatically targets your warmest leads
        # — IG/FB engagers, profile visitors, people similar to past registrants.
        # age_min is a suggestion; age_max must be omitted (Advantage+ requires 65+).
        "targeting": {
            "geo_locations":          {"countries": ["IN"]},
            "age_min":                25,
            "targeting_automation":   {"advantage_audience": 1},
        },
        "lead_gen_form_id": FORM_ID,
    })
    ok(f"Ad Set ID: {data['id']}")
    return data["id"]

# ── 4. Ads ────────────────────────────────────────────────────────────────────
def create_ad(adset_id, name, creative_id, status):
    data = api_post(f"{AD_ACCOUNT}/ads", {
        "name":       name,
        "adset_id":   adset_id,
        "creative":   {"creative_id": creative_id},
        "status":     status,
    })
    ok(f"Ad: {name} → {data['id']}")
    return data["id"]

# ── main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--go-live", action="store_true", help="Activate ads immediately")
    args = parser.parse_args()
    status = "ACTIVE" if args.go_live else "PAUSED"

    print(f"\n{'='*60}")
    print(f"  Warm Audience Retargeting — {'LIVE 🟢' if args.go_live else 'PAUSED (review first)'}")
    print(f"  Budget: ₹100/day | Ends: 26 Apr 2026")
    print(f"{'='*60}")

    try:
        campaign_id = create_campaign(status)
        adset_id    = create_adset(campaign_id, status)

        step("Creating ads (reusing existing creatives)")
        create_ad(adset_id, "Warm — Promo Video",  CREATIVE_VIDEO, status)
        create_ad(adset_id, "Warm — Workshop Card", CREATIVE_CARD,  status)
        create_ad(adset_id, "Warm — Story Card",    CREATIVE_STORY, status)

        print(f"\n{'='*60}")
        print(f"  ✅ Done!")
        print(f"  Campaign: {campaign_id}")
        print(f"  Ad Set:   {adset_id}")
        print(f"  Status:   {status}")
        print(f"\n  👉 Review at:")
        print(f"  https://adsmanager.facebook.com/adsmanager/manage/campaigns?act={AD_ACCOUNT.replace('act_','')}")
        if not args.go_live:
            print(f"\n  When ready to activate:")
            print(f"  python3 run_warm_retarget.py --go-live")
        print(f"{'='*60}\n")

    except Exception as e:
        err(f"Failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

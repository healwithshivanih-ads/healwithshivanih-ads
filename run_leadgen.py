#!/usr/bin/env python3
"""
Meta Lead Gen Campaign — Heal With Shivanih
Webinar: "Balance Your Blood Sugar Naturally" — Free Live Workshop
Date: 26 April 2026, 6:00 PM IST

Creates:
  1. Native Instagram lead gen form (Name, Email, Phone, qualifying question)
  2. Lead generation campaign (OUTCOME_LEADS)
  3. Two ad sets — Broad Wellness + HNI (retargeting reel engagers where possible)
  4. Three ads per set — webinar promo video, static card, story card
All created PAUSED. Use --go-live to activate.

Usage:
  python run_leadgen.py           # create paused
  python run_leadgen.py --go-live # create and activate immediately
"""

import os, sys, time, argparse, json
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

ACCESS_TOKEN = os.environ["META_ACCESS_TOKEN"]
AD_ACCOUNT   = os.environ["META_AD_ACCOUNT_ID"]

from facebook_business.api import FacebookAdsApi
from facebook_business.adobjects.adaccount  import AdAccount
from facebook_business.adobjects.campaign   import Campaign
from facebook_business.adobjects.adset      import AdSet
from facebook_business.adobjects.adcreative import AdCreative
from facebook_business.adobjects.ad         import Ad
from facebook_business.adobjects.advideo    import AdVideo
from facebook_business.adobjects.adimage    import AdImage

# ── constants ─────────────────────────────────────────────────────────────────
PAGE_ID    = "479044818621032"
IG_ID      = "17841403970279155"
BASE_DIR   = Path(__file__).parent

# Webinar end date — one hour after the event starts (campaign pauses itself)
WEBINAR_END_UTC = int(datetime(2026, 4, 26, 14, 0, tzinfo=timezone.utc).timestamp())  # 26 Apr 14:00 UTC = 19:30 IST (buffer)

# Budgets (paise)
DAILY_BUDGET_BROAD = 50000   # ₹500/day broad
DAILY_BUDGET_HNI   = 30000   # ₹300/day HNI

# ── helpers ───────────────────────────────────────────────────────────────────
def step(msg): print(f"\n▶  {msg}")
def ok(msg):   print(f"   ✅ {msg}")
def info(msg): print(f"   ℹ  {msg}")

def upload_video(name, filepath):
    step(f"Uploading video: {name}")
    video = AdVideo(parent_id=AD_ACCOUNT)
    video[AdVideo.Field.filepath] = filepath
    video[AdVideo.Field.name]     = name
    video.remote_create()
    vid = video["id"]
    info(f"Video ID: {vid} — waiting for processing…")
    for _ in range(90):
        time.sleep(5)
        v = AdVideo(vid).api_get(fields=["status"])
        st = v.get("status", {}).get("video_status", "")
        info(f"  status: {st}")
        if st == "ready":
            ok(f"Video ready: {vid}")
            return vid
    raise TimeoutError(f"Video {vid} not ready in time")

def upload_image(filepath):
    step(f"Uploading image: {Path(filepath).name}")
    img = AdImage(parent_id=AD_ACCOUNT)
    img[AdImage.Field.filename] = filepath
    img.remote_create()
    h = img[AdImage.Field.hash]
    ok(f"Image hash: {h}")
    return h

def make_video_creative(name, video_id, thumb_hash, message, headline, form_id):
    params = {
        AdCreative.Field.name: name + " Creative",
        AdCreative.Field.object_story_spec: {
            "page_id": PAGE_ID,
            "video_data": {
                "video_id":   video_id,
                "image_hash": thumb_hash,
                "message":    message,
                "title":      headline,
                "call_to_action": {
                    "type":  "SIGN_UP",
                    "value": {"lead_gen_form_id": form_id},
                },
            },
        },
        AdCreative.Field.instagram_user_id: IG_ID,
    }
    account = AdAccount(AD_ACCOUNT)
    c = account.create_ad_creative(fields=[], params=params)
    ok(f"Creative: {c['id']}")
    return c["id"]

def make_image_creative(name, img_hash, message, headline, form_id):
    params = {
        AdCreative.Field.name: name + " Creative",
        AdCreative.Field.object_story_spec: {
            "page_id": PAGE_ID,
            "link_data": {
                "image_hash": img_hash,
                "link":       f"https://www.facebook.com/ads/lead_gen/test_form/?form_id={form_id}",
                "message":    message,
                "name":       headline,
                "call_to_action": {
                    "type":  "SIGN_UP",
                    "value": {"lead_gen_form_id": form_id},
                },
            },
        },
        AdCreative.Field.instagram_user_id: IG_ID,
    }
    account = AdAccount(AD_ACCOUNT)
    c = account.create_ad_creative(fields=[], params=params)
    ok(f"Creative: {c['id']}")
    return c["id"]

def create_ad(name, adset_id, creative_id, status):
    account = AdAccount(AD_ACCOUNT)
    ad = account.create_ad(fields=[], params={
        Ad.Field.name:     name,
        Ad.Field.adset_id: adset_id,
        Ad.Field.creative: {"creative_id": creative_id},
        Ad.Field.status:   status,
    })
    ok(f"Ad created: {ad['id']} ({'ACTIVE' if status == Ad.Status.active else 'PAUSED'})")
    return ad["id"]

# ── lead gen form ─────────────────────────────────────────────────────────────
def create_lead_form():
    """Create Instagram native lead gen form and return its ID."""
    step("Creating lead gen form")
    import requests

    url = f"https://graph.facebook.com/v19.0/{PAGE_ID}/leadgen_forms"
    payload = {
        "access_token": ACCESS_TOKEN,
        "name": "Balance Blood Sugar Naturally — Webinar Registration",
        "locale": "EN_US",
        "privacy_policy": json.dumps({
            "url":       "https://www.facebook.com/privacy/explanation",
            "link_text": "Privacy Policy",
        }),
        "questions": json.dumps([
            {"type": "FULL_NAME",     "key": "full_name"},
            {"type": "EMAIL",         "key": "email"},
            {"type": "PHONE",         "key": "phone_number"},
            {
                "type":    "CUSTOM",
                "key":     "challenge",
                "label":   "What's your biggest energy or blood sugar challenge right now?",
                "options": [
                    {"value": "energy_crashes",  "key": "energy_crashes",  "label": "I crash after meals"},
                    {"value": "cravings",         "key": "cravings",         "label": "Constant sugar cravings"},
                    {"value": "weight",           "key": "weight",           "label": "Can't lose weight despite eating well"},
                    {"value": "diagnosed",        "key": "diagnosed",        "label": "Pre-diabetic or diabetic"},
                    {"value": "pcos",             "key": "pcos",             "label": "PCOS / hormonal imbalance"},
                ],
            },
        ]),
        "follow_up_action_url": "https://www.instagram.com/healwithshivanih/",
        "thank_you_page": json.dumps({
            "title":       "You're registered!",
            "body":        "Check your email for the webinar link. See you on 26 April at 6:00 PM IST!",
            "button_type": "VIEW_WEBSITE",
            "button_text": "Visit our page",
            "website_url": "https://www.instagram.com/healwithshivanih/",
        }),
        "context_card": json.dumps({
            "title":        "Free Live Workshop — 26 April, 6 PM IST",
            "style":        "LIST_STYLE",
            "content":      [
                "Why blood sugar crashes drain your energy",
                "The 3 foods silently spiking your glucose",
                "Your 7-day reset protocol — no medication",
            ],
        }),
    }

    r = requests.post(url, data=payload)
    data = r.json()
    if "id" in data:
        form_id = data["id"]
        ok(f"Lead form created: {form_id}")
        return form_id
    else:
        raise RuntimeError(f"Lead form creation failed: {data}")

# ── ad sets ───────────────────────────────────────────────────────────────────
BROAD_TARGETING = {
    "age_min": 28,
    "age_max": 55,
    "genders": [2],
    "geo_locations": {
        "countries": ["IN"],
        "cities": [
            {"key": "2295424"},  # Mumbai
            {"key": "2295378"},  # Delhi
            {"key": "2295395"},  # Bangalore
            {"key": "2295414"},  # Hyderabad
            {"key": "2295421"},  # Pune
            {"key": "2295389"},  # Chennai
            {"key": "2295404"},  # Kolkata
        ],
    },
    "locales": [6],  # English
    "flexible_spec": [{
        "interests": [
            {"id": "6003306084421", "name": "Yoga"},
            {"id": "6003258544357", "name": "Health and wellness"},
            {"id": "6003382102565", "name": "Healthy diet"},
            {"id": "6003384248805", "name": "Fitness and wellness"},
            {"id": "6002933862573", "name": "Human nutrition"},
            {"id": "6003745745504", "name": "Healthy eating recipes"},
        ],
    }],
    "publisher_platforms": ["instagram"],
    "instagram_positions": ["reels", "story", "stream"],
    "device_platforms": ["mobile"],
    "targeting_automation": {"advantage_audience": 0},
}

HNI_TARGETING = {
    "age_min": 30,
    "age_max": 55,
    "genders": [2],
    "geo_locations": {
        "countries": ["IN"],
        "cities": [
            {"key": "2295424"},  # Mumbai
            {"key": "2295378"},  # Delhi
            {"key": "2295395"},  # Bangalore
            {"key": "2295421"},  # Pune
        ],
    },
    "locales": [6],
    "flexible_spec": [{
        "interests": [
            {"id": "6007828099136", "name": "Luxury goods"},
            {"id": "6003371567474", "name": "Entrepreneurship"},
            {"id": "6003258544357", "name": "Health and wellness"},
            {"id": "6003382102565", "name": "Healthy diet"},
            {"id": "6003384248805", "name": "Fitness and wellness"},
        ],
    }],
    "publisher_platforms": ["instagram"],
    "instagram_positions": ["reels", "story", "stream"],
    "device_platforms": ["mobile"],
    "targeting_automation": {"advantage_audience": 0},
}

# ── main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--go-live", action="store_true", help="Activate ads immediately")
    parser.add_argument("--skip-form",     metavar="FORM_ID",     help="Reuse existing form ID instead of creating")
    parser.add_argument("--campaign-id",   metavar="CAMPAIGN_ID", help="Reuse existing campaign ID (skip campaign creation)")
    parser.add_argument("--skip-broad",    action="store_true",   help="Skip broad ad set creation (already done)")
    parser.add_argument("--skip-upload", action="store_true", help="Skip video/image upload (for dry-run)")
    parser.add_argument("--video-id",    metavar="ID",   help="Reuse already-uploaded video ID")
    parser.add_argument("--card-hash",   metavar="HASH", help="Reuse already-uploaded card image hash")
    parser.add_argument("--story-hash",  metavar="HASH", help="Reuse already-uploaded story image hash")
    args = parser.parse_args()
    ad_status = Ad.Status.active if args.go_live else Ad.Status.paused

    print("\n" + "═"*58)
    print("  Meta Lead Gen Campaign — Balance Your Blood Sugar")
    print("  Free Webinar · 26 Apr 2026 · 6:00 PM IST")
    print("═"*58)

    FacebookAdsApi.init(access_token=ACCESS_TOKEN)
    account = AdAccount(AD_ACCOUNT)

    # ── 1. Lead gen form ─────────────────────────────────────────────────────
    if args.skip_form:
        form_id = args.skip_form
        ok(f"Reusing form: {form_id}")
    else:
        form_id = create_lead_form()

    # ── 2. Upload assets ──────────────────────────────────────────────────────
    if args.video_id and args.card_hash and args.story_hash:
        promo_vid_id = args.video_id
        card_hash    = args.card_hash
        story_hash   = args.story_hash
        card_thumb   = card_hash
        story_thumb  = story_hash
        ok(f"Reusing video: {promo_vid_id}")
        ok(f"Reusing card hash: {card_hash}")
        ok(f"Reusing story hash: {story_hash}")
    elif not args.skip_upload:
        promo_vid_id  = upload_video("Webinar Promo 15s",   str(BASE_DIR / "../out/webinar_promo_real.mp4"))
        card_hash     = upload_image(str(BASE_DIR / "../out/webinar_card_real.png"))
        story_hash    = upload_image(str(BASE_DIR / "../out/webinar_story_real.png"))
        card_thumb    = card_hash
        story_thumb   = story_hash
    else:
        promo_vid_id = "DRY_RUN_VIDEO_ID"
        card_hash = story_hash = card_thumb = story_thumb = "DRY_RUN_HASH"
        info("Skipping uploads (dry-run)")

    # Copy constants
    MSG_BROAD = (
        "🩺 Tired of energy crashes after meals? Come to my FREE live workshop "
        "and learn how to balance your blood sugar naturally — no medication, no crash diets. "
        "Register free 👇 | 26 Apr · 6 PM IST"
    )
    MSG_HNI = (
        "Most high-performing women I know are unknowingly managing glucose instability. "
        "Join my FREE live workshop to understand why — and what to do about it. "
        "Register free 👇 | 26 Apr · 6 PM IST"
    )
    HEADLINE   = "Balance Your Blood Sugar Naturally"

    # ── 3. Campaign ──────────────────────────────────────────────────────────
    if args.campaign_id:
        campaign_id = args.campaign_id
        ok(f"Reusing campaign: {campaign_id}")
    else:
        step("Creating Lead Gen campaign")
        campaign = account.create_campaign(fields=[], params={
            Campaign.Field.name:      "Heal With Shivanih — Blood Sugar Webinar Lead Gen",
            Campaign.Field.objective: "OUTCOME_LEADS",
            Campaign.Field.status:    Campaign.Status.paused,
            "special_ad_categories":  [],
            "is_adset_budget_sharing_enabled": False,
        })
        campaign_id = campaign["id"]
        ok(f"Campaign: {campaign_id}")

    ad_ids = []

    # ── 4. Broad ad set ───────────────────────────────────────────────────────
    if args.skip_broad:
        info("Skipping broad ad set (already created)")
        broad_id = "SKIPPED"
    else:
        step("Creating Broad Wellness ad set")
        adset_broad = account.create_ad_set(fields=[], params={
            AdSet.Field.name:              "Broad Wellness — Webinar",
            AdSet.Field.campaign_id:       campaign_id,
            AdSet.Field.optimization_goal: AdSet.OptimizationGoal.lead_generation,
            AdSet.Field.billing_event:     AdSet.BillingEvent.impressions,
            AdSet.Field.bid_strategy:      "LOWEST_COST_WITHOUT_CAP",
            AdSet.Field.daily_budget:      DAILY_BUDGET_BROAD,
            AdSet.Field.end_time:          WEBINAR_END_UTC,
            AdSet.Field.targeting:         BROAD_TARGETING,
            AdSet.Field.status:            AdSet.Status.paused,
            "destination_type":            "ON_AD",
            "promoted_object": {
                "page_id": PAGE_ID,
            },
        })
        broad_id = adset_broad["id"]
        ok(f"Broad ad set: {broad_id}")

        # Broad ads
        for name, creative_id_fn in [
            ("Broad — Promo Video",  lambda: make_video_creative("Broad Promo Video", promo_vid_id, card_thumb,  MSG_BROAD, HEADLINE, form_id)),
            ("Broad — Workshop Card",lambda: make_image_creative("Broad Workshop Card", card_hash,               MSG_BROAD, HEADLINE, form_id)),
            ("Broad — Story Card",   lambda: make_image_creative("Broad Story Card",   story_hash,               MSG_BROAD, HEADLINE, form_id)),
        ]:
            step(f"Building: {name}")
            cid = creative_id_fn()
            aid = create_ad(name, broad_id, cid, ad_status)
            ad_ids.append(aid)

    # ── 5. HNI ad set ─────────────────────────────────────────────────────────
    step("Creating HNI ad set")
    adset_hni = account.create_ad_set(fields=[], params={
        AdSet.Field.name:              "HNI Women — Webinar",
        AdSet.Field.campaign_id:       campaign_id,
        AdSet.Field.optimization_goal: AdSet.OptimizationGoal.lead_generation,
        AdSet.Field.billing_event:     AdSet.BillingEvent.impressions,
        AdSet.Field.bid_strategy:      "LOWEST_COST_WITHOUT_CAP",
        AdSet.Field.daily_budget:      DAILY_BUDGET_HNI,
        AdSet.Field.end_time:          WEBINAR_END_UTC,
        AdSet.Field.targeting:         HNI_TARGETING,
        AdSet.Field.status:            AdSet.Status.paused,
        "destination_type":            "ON_AD",
        "promoted_object": {
            "page_id": PAGE_ID,
        },
    })
    hni_id = adset_hni["id"]
    ok(f"HNI ad set: {hni_id}")

    # HNI ads
    for name, creative_id_fn in [
        ("HNI — Promo Video",  lambda: make_video_creative("HNI Promo Video", promo_vid_id, card_thumb,  MSG_HNI, HEADLINE, form_id)),
        ("HNI — Workshop Card",lambda: make_image_creative("HNI Workshop Card", card_hash,               MSG_HNI, HEADLINE, form_id)),
        ("HNI — Story Card",   lambda: make_image_creative("HNI Story Card",   story_hash,               MSG_HNI, HEADLINE, form_id)),
    ]:
        step(f"Building: {name}")
        cid = creative_id_fn()
        aid = create_ad(name, hni_id, cid, ad_status)
        ad_ids.append(aid)

    # ── Summary ───────────────────────────────────────────────────────────────
    acct_num = AD_ACCOUNT.replace("act_", "")
    print("\n" + "═"*58)
    print("  ✅ Lead Gen Campaign Created!")
    print("═"*58)
    print(f"  Lead Gen Form  : {form_id}")
    print(f"  Campaign ID    : {campaign_id}")
    print(f"  Broad Ad Set   : {broad_id}  (₹500/day)")
    print(f"  HNI Ad Set     : {hni_id}   (₹300/day)")
    print(f"  Total budget   : ₹800/day + GST ≈ ₹944/day")
    print(f"  Campaign ends  : 26 Apr 2026 (auto-pauses after webinar)")
    print(f"  Ads            : {', '.join(ad_ids)}")
    print(f"\n  Ads Manager:")
    print(f"  https://business.facebook.com/adsmanager/manage/ads?act={acct_num}")
    print(f"\n  View leads in real-time:")
    print(f"  https://business.facebook.com/latest/ads_manager/leads_download")
    if not args.go_live:
        print("\n  All ads are PAUSED. Review in Ads Manager, then run:")
        print("  python run_leadgen.py --go-live")
    print()

if __name__ == "__main__":
    main()

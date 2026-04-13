#!/usr/bin/env python3
"""
Meta Ads Automation — Heal With Shivanih
Creates a full Instagram follower campaign: campaign → ad set → creatives → ads.
All ads are created PAUSED so you can review before going live.
Run with --go-live flag to activate immediately.
"""

import os, sys, time, argparse
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

APP_ID       = os.environ["META_APP_ID"]
APP_SECRET   = os.environ["META_APP_SECRET"]
ACCESS_TOKEN = os.environ["META_ACCESS_TOKEN"]
AD_ACCOUNT   = os.environ["META_AD_ACCOUNT_ID"]

from facebook_business.api import FacebookAdsApi
from facebook_business.adobjects.adaccount import AdAccount
from facebook_business.adobjects.campaign import Campaign
from facebook_business.adobjects.adset import AdSet
from facebook_business.adobjects.adcreative import AdCreative
from facebook_business.adobjects.ad import Ad
from facebook_business.adobjects.advideo import AdVideo

import config

# ── helpers ───────────────────────────────────────────────────────────────────
def step(msg): print(f"\n▶  {msg}")
def ok(msg):   print(f"   ✅ {msg}")
def info(msg): print(f"   ℹ  {msg}")

def search_interests(account, keywords):
    """Return interest targeting specs for the given keywords."""
    from facebook_business.adobjects.targetingsearch import TargetingSearch
    interests = []
    seen = set()
    for kw in keywords:
        try:
            results = TargetingSearch.search(params={
                "q": kw,
                "type": "adinterest",
                "limit": 3,
            })
            for r in results:
                if r["id"] not in seen:
                    seen.add(r["id"])
                    interests.append({"id": r["id"], "name": r["name"]})
                    info(f"Interest found: {r['name']} ({r['id']})")
                    break
        except Exception as e:
            info(f"Skipping interest '{kw}': {e}")
    return interests

def upload_video(account, filepath, name):
    """Upload a video to Facebook and wait for it to finish processing."""
    step(f"Uploading video: {name}")
    video = AdVideo(parent_id=AD_ACCOUNT)
    video[AdVideo.Field.filepath] = filepath
    video[AdVideo.Field.name]     = name
    video.remote_create()
    video_id = video["id"]
    info(f"Video ID: {video_id} — waiting for processing...")
    # Poll until ready
    for _ in range(60):
        time.sleep(5)
        v = AdVideo(video_id).api_get(fields=["status"])
        status = v.get("status", {}).get("video_status", "")
        info(f"  Status: {status}")
        if status == "ready":
            ok(f"Video ready: {video_id}")
            return video_id
    raise TimeoutError(f"Video {video_id} did not finish processing in time.")

def upload_image(account, filepath):
    """Upload an image and return the image hash."""
    from facebook_business.adobjects.adimage import AdImage
    step(f"Uploading image: {Path(filepath).name}")
    img = AdImage(parent_id=AD_ACCOUNT)
    img[AdImage.Field.filename] = filepath
    img.remote_create()
    h = img[AdImage.Field.hash]
    ok(f"Image hash: {h}")
    return h

def get_page_and_instagram(account):
    """Return hardcoded page + Instagram IDs (detected from Business Manager)."""
    page_id = "479044818621032"        # HealwithshivaniH Facebook Page
    ig_id   = "17841403970279155"      # HealwithshivaniH Instagram Account
    info(f"Page: HealwithshivaniH ({page_id}), Instagram: {ig_id}")
    return page_id, ig_id

# ── main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--go-live", action="store_true", help="Set ads to ACTIVE instead of PAUSED")
    args = parser.parse_args()
    status = Ad.Status.active if args.go_live else Ad.Status.paused

    print("\n" + "═"*55)
    print("  Meta Ads Automation — Heal With Shivanih")
    print("═"*55)

    # Init API — token is from Graph Explorer so we skip app-secret proof
    FacebookAdsApi.init(access_token=ACCESS_TOKEN)
    account = AdAccount(AD_ACCOUNT)
    info(f"Ad account: {AD_ACCOUNT}")

    # ── 1. Campaign + Ad Set (resume existing) ───────────────────────────────
    campaign_id = "120244017478380305"
    adset_id    = "120244017483050305"
    ok(f"Resuming campaign: {campaign_id}")
    ok(f"Resuming ad set:   {adset_id}")

    # ── 2. Interests (skip — already applied to ad set) ───────────────────────
    interests = []

    # ── 3. Get page / Instagram IDs ───────────────────────────────────────────
    step("Fetching linked Page + Instagram account")
    page_id, ig_id = get_page_and_instagram(account)

    ok("Ad set ready")

    # ── 5. Creatives + Ads ────────────────────────────────────────────────────
    ad_ids = []
    base_dir = Path(__file__).parent

    for ad_conf in config.ADS[2:]:  # A and B already created — resume from C
        step(f"Building: {ad_conf['name']}")

        # Upload asset
        if "video_file" in ad_conf:
            filepath = str((base_dir / ad_conf["video_file"]).resolve())
            video_id = upload_video(account, filepath, ad_conf["name"])
            # Upload thumbnail (use paired cover image)
            thumb_file = ad_conf.get("thumb_file", "../out/cover.png")
            thumb_hash = upload_image(account, str((base_dir / thumb_file).resolve()))
            story_spec = {
                "video_data": {
                    "video_id":        video_id,
                    "image_hash":      thumb_hash,
                    "message":         ad_conf["message"],
                    "title":           ad_conf["headline"],
                    "call_to_action": {"type": "VIEW_INSTAGRAM_PROFILE"},
                }
            }
        else:
            filepath = str((base_dir / ad_conf["image_file"]).resolve())
            img_hash = upload_image(account, filepath)
            story_spec = {
                "link_data": {
                    "image_hash":     img_hash,
                    "link":           "https://www.instagram.com/healwithshivanih/",
                    "message":        ad_conf["message"],
                    "name":           ad_conf["headline"],
                    "description":    ad_conf["description"],
                    "call_to_action": {
                        "type":  "VIEW_INSTAGRAM_PROFILE",
                        "value": {"link": "https://www.instagram.com/healwithshivanih/"},
                    },
                }
            }

        # Creative
        creative_params = {
            AdCreative.Field.name:         ad_conf["name"] + " Creative",
            AdCreative.Field.object_story_spec: {
                "page_id": page_id or "me",
                **story_spec,
            },
        }
        if ig_id:
            creative_params[AdCreative.Field.instagram_user_id] = ig_id

        creative = account.create_ad_creative(fields=[], params=creative_params)
        creative_id = creative["id"]
        ok(f"Creative: {creative_id}")

        # Ad
        ad = account.create_ad(fields=[], params={
            Ad.Field.name:        ad_conf["name"],
            Ad.Field.adset_id:    adset_id,
            Ad.Field.creative:    {"creative_id": creative_id},
            Ad.Field.status:      status,
        })
        ad_ids.append(ad["id"])
        ok(f"Ad created: {ad['id']} ({'ACTIVE' if args.go_live else 'PAUSED'})")

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "═"*55)
    print("  ✅ Campaign created successfully!")
    print("═"*55)
    print(f"  Campaign ID : {campaign_id}")
    print(f"  Ad Set ID   : {adset_id}")
    print(f"  Ads         : {', '.join(ad_ids)}")
    print(f"\n  Review here:")
    print(f"  https://business.facebook.com/adsmanager/manage/ads?act={AD_ACCOUNT.replace('act_', '')}")
    if not args.go_live:
        print("\n  All ads are PAUSED. When happy, run:")
        print("  python run_campaign.py --go-live")
    print()

if __name__ == "__main__":
    main()

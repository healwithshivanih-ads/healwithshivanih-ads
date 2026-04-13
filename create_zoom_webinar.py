#!/usr/bin/env python3
"""
create_zoom_webinar.py — Create Zoom Webinar + inject join link
───────────────────────────────────────────────────────────────
Creates the webinar on Zoom via Server-to-Server OAuth,
then automatically writes WEBINAR_LINK to responder.env.

Usage:
  python3 create_zoom_webinar.py           # create webinar + update env
  python3 create_zoom_webinar.py --dry-run # preview without creating
"""

import os, sys, re, argparse, requests
from pathlib import Path
from dotenv import load_dotenv

BASE = Path(__file__).parent
load_dotenv(BASE / ".env")
load_dotenv(BASE / "responder.env")

# ── Zoom credentials ──────────────────────────────────────────────────────────
ZOOM_ACCOUNT_ID    = os.getenv("ZOOM_ACCOUNT_ID",    "9IzDs60iR-uuIWcU0z0gLQ")
ZOOM_CLIENT_ID     = os.getenv("ZOOM_CLIENT_ID",     "4Kn8iY3QSXm0z3_RyJQ_Ig")
ZOOM_CLIENT_SECRET = os.getenv("ZOOM_CLIENT_SECRET", "vogGLRxGfwHlOu0w7FwXomV3K67IjJDF")

# ── Webinar details ───────────────────────────────────────────────────────────
TOPIC     = "Balance Your Blood Sugar Naturally — Free Live Workshop"
AGENDA    = ("In this free 60-min workshop you'll discover:\n"
             "• Why you crash after meals\n"
             "• The 3 everyday foods spiking your glucose\n"
             "• A simple 7-day reset protocol — no medication needed\n\n"
             "Hosted by Shivani Hari (@healwithshivanih)")
START_TIME = "2026-04-26T12:30:00Z"   # 6:00 PM IST = 12:30 UTC
DURATION   = 90                        # minutes (buffer after 60-min session)
TIMEZONE   = "Asia/Kolkata"

def step(msg): print(f"\n▶  {msg}")
def ok(msg):   print(f"   ✅ {msg}")
def info(msg): print(f"   ℹ  {msg}")

# ── 1. Get OAuth token ────────────────────────────────────────────────────────
def get_token():
    step("Getting Zoom OAuth token")
    r = requests.post(
        "https://zoom.us/oauth/token",
        params={"grant_type": "account_credentials", "account_id": ZOOM_ACCOUNT_ID},
        auth=(ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET),
        timeout=15,
    )
    data = r.json()
    if "access_token" not in data:
        raise RuntimeError(f"Token error: {data}")
    ok(f"Token obtained (expires in {data.get('expires_in', '?')}s)")
    return data["access_token"]

# ── 2. Get user ID ────────────────────────────────────────────────────────────
def get_user_id(token):
    step("Getting Zoom user ID")
    r = requests.get(
        "https://api.zoom.us/v2/users/me",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    data = r.json()
    if "id" not in data:
        raise RuntimeError(f"User error: {data}")
    ok(f"User: {data.get('email')} ({data['id']})")
    return data["id"]

# ── 3. Create webinar ─────────────────────────────────────────────────────────
def create_webinar(token, user_id="me", dry_run=False):
    step(f"Creating webinar: '{TOPIC}'")
    info(f"Date/time: 26 April 2026, 6:00 PM IST ({START_TIME})")
    info(f"Duration:  {DURATION} minutes")

    if dry_run:
        ok("[DRY RUN] Would create webinar — skipping API call")
        return {"join_url": "https://zoom.us/j/DRY_RUN_EXAMPLE", "id": "000000000"}

    payload = {
        "topic":      TOPIC,
        "agenda":     AGENDA,
        "type":       2,               # 2 = scheduled meeting (works on all plans)
        "start_time": START_TIME,
        "duration":   DURATION,
        "timezone":   TIMEZONE,
        "settings": {
            "host_video":             True,
            "participant_video":      False,
            "cn_meeting":             False,
            "in_meeting":             False,
            "join_before_host":       False,
            "mute_upon_entry":        True,
            "watermark":              False,
            "use_pmi":                False,
            "approval_type":          2,   # 2 = no registration required
            "audio":                  "both",
            "auto_recording":         "none",
            "waiting_room":           False,
            "allow_multiple_devices": True,
            "registrants_email_notification": False,
        },
    }

    r = requests.post(
        f"https://api.zoom.us/v2/users/{user_id}/meetings",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=15,
    )
    data = r.json()
    if "id" not in data:
        raise RuntimeError(f"Meeting creation failed: {data}")
    return data

# ── 4. Inject join link into responder.env ────────────────────────────────────
def update_env(join_url, dry_run):
    step("Writing join link to responder.env")
    env_path = BASE / "responder.env"
    content  = env_path.read_text()

    if "WEBINAR_LINK=" in content:
        new_content = re.sub(r"WEBINAR_LINK=.*", f"WEBINAR_LINK={join_url}", content)
    else:
        new_content = content + f"\nWEBINAR_LINK={join_url}\n"

    if dry_run:
        ok(f"[DRY RUN] Would write: WEBINAR_LINK={join_url}")
        return

    env_path.write_text(new_content)
    ok(f"responder.env updated with join link")

# ── main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("\n" + "="*60)
    print("  Zoom Webinar Creator — Heal With Shivanih")
    print("="*60)

    try:
        token    = get_token()
        webinar  = create_webinar(token, "me", args.dry_run)

        join_url    = webinar.get("join_url", "")
        webinar_id  = webinar.get("id", "")
        start_url   = webinar.get("start_url", "")

        update_env(join_url, args.dry_run)

        print("\n" + "="*60)
        print("  ✅ Meeting created!")
        print(f"  Meeting ID:  {webinar_id}")
        print(f"  Join URL:    {join_url}")
        print(f"  Start URL:   {start_url[:80]}...")
        print()
        print("  Join URL has been saved to responder.env.")
        print("  All 3 reminders will now include the real link. 🎉")
        print("="*60 + "\n")

        # Save start URL separately for easy access
        start_path = BASE / "zoom_start_url.txt"
        if not args.dry_run:
            start_path.write_text(
                f"Meeting ID:  {webinar_id}\n"
                f"Join URL:    {join_url}\n"
                f"Start URL:   {start_url}\n"
                f"(Use Start URL to begin the meeting as host)\n"
            )
            print(f"  Host start URL saved to: zoom_start_url.txt")

    except Exception as e:
        print(f"\n❌ Failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

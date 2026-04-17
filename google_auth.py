#!/usr/bin/env python3
"""
google_auth.py — One-time Google OAuth setup for Drive + Forms + Sheets
─────────────────────────────────────────────────────────────────────────
Run this ONCE. It opens a browser, you click Allow, and a refresh token
with Drive + Forms + Sheets access is saved to responder.env permanently.

After this, setup_event.py creates Google Forms and Sheets automatically.

Usage:
  cd /Users/shivani/social-video/meta_ads
  python3 google_auth.py
"""

import os, sys, re
from pathlib import Path

BASE = Path(__file__).parent

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/spreadsheets",
]

def main():
    from dotenv import load_dotenv
    load_dotenv(BASE / "responder.env")

    client_id     = os.getenv("GMAIL_CLIENT_ID", "")
    client_secret = os.getenv("GMAIL_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        print("❌  GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in responder.env")
        sys.exit(1)

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        import subprocess
        subprocess.run(
            [sys.executable, "-m", "pip", "install",
             "google-auth-oauthlib", "--break-system-packages"],
            check=True
        )
        from google_auth_oauthlib.flow import InstalledAppFlow

    client_config = {
        "installed": {
            "client_id":     client_id,
            "client_secret": client_secret,
            "auth_uri":      "https://accounts.google.com/o/oauth2/auth",
            "token_uri":     "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }

    print("""
╔══════════════════════════════════════════════════════════════╗
║  Google Authorization — one-time setup                      ║
╚══════════════════════════════════════════════════════════════╝

A browser window will open.
Sign in with:  reachochretree@gmail.com
Click Allow on the permissions screen.
""")

    flow  = InstalledAppFlow.from_client_config(client_config, SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")

    refresh_token = creds.refresh_token
    if not refresh_token:
        print("❌  No refresh token returned. Try running again.")
        sys.exit(1)

    # Save to responder.env
    env_path = BASE / "responder.env"
    content  = env_path.read_text()
    if "GOOGLE_REFRESH_TOKEN=" in content:
        content = re.sub(r"GOOGLE_REFRESH_TOKEN=.*", f"GOOGLE_REFRESH_TOKEN={refresh_token}", content)
    else:
        content += f"\nGOOGLE_REFRESH_TOKEN={refresh_token}\n"
    env_path.write_text(content)

    print("""
✅  Done! GOOGLE_REFRESH_TOKEN saved to responder.env.

setup_event.py will now create Google Forms and Sheets automatically
for every future event. Run it once for blood-sugar-apr26 to catch up:

  cd /Users/shivani/social-video/meta_ads
  python3 setup_event.py blood-sugar-apr26 --no-zoom --no-wix
""")

if __name__ == "__main__":
    main()

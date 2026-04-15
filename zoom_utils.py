#!/usr/bin/env python3
"""
zoom_utils.py — Zoom API helpers for Heal With Shivanih
"""
import os, logging
from pathlib import Path
import requests
from dotenv import load_dotenv

BASE = Path(__file__).parent
load_dotenv(BASE / ".env")
load_dotenv(BASE / "responder.env")

ZOOM_ACCOUNT_ID    = os.getenv("ZOOM_ACCOUNT_ID",    "9IzDs60iR-uuIWcU0z0gLQ")
ZOOM_CLIENT_ID     = os.getenv("ZOOM_CLIENT_ID",     "4Kn8iY3QSXm0z3_RyJQ_Ig")
ZOOM_CLIENT_SECRET = os.getenv("ZOOM_CLIENT_SECRET", "vogGLRxGfwHlOu0w7FwXomV3K67IjJDF")
MEETING_ID         = os.getenv("ZOOM_MEETING_ID",    "86504072416")

log = logging.getLogger("zoom_utils")

_token_cache = {"token": None, "expires_at": 0}

def get_zoom_token():
    import time
    if _token_cache["token"] and time.time() < _token_cache["expires_at"] - 60:
        return _token_cache["token"]
    r = requests.post(
        "https://zoom.us/oauth/token",
        params={"grant_type": "account_credentials", "account_id": ZOOM_ACCOUNT_ID},
        auth=(ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET),
        timeout=15,
    )
    data = r.json()
    _token_cache["token"] = data["access_token"]
    import time as t
    _token_cache["expires_at"] = t.time() + data.get("expires_in", 3600)
    return _token_cache["token"]

def zoom_headers():
    return {"Authorization": f"Bearer {get_zoom_token()}", "Content-Type": "application/json"}

def register_on_zoom(lead):
    """Register a lead as a Zoom meeting registrant.
    Returns their unique join_url, or None on failure."""
    name  = lead.get("name", "") or ""
    parts = name.split(None, 1)
    first = parts[0] if parts else "Guest"
    last  = parts[1] if len(parts) > 1 else ""
    email = lead.get("email", "")

    if not email:
        log.debug(f"  🔗 Zoom: no email for {name} — skipping registration")
        return None

    payload = {
        "first_name": first,
        "last_name":  last,
        "email":      email,
    }
    r = requests.post(
        f"https://api.zoom.us/v2/meetings/{MEETING_ID}/registrants",
        headers=zoom_headers(),
        json=payload,
        timeout=15,
    )
    if r.ok:
        join_url = r.json().get("join_url")
        registrant_id = r.json().get("registrant_id")
        log.info(f"  🔗 Zoom: registered {email} — join URL saved")
        return {"join_url": join_url, "registrant_id": registrant_id}
    elif r.status_code == 409:
        # Already registered — fetch their existing join URL
        log.info(f"  🔗 Zoom: {email} already registered")
        return None
    else:
        log.warning(f"  🔗 Zoom registration failed for {email}: {r.status_code} {r.text[:100]}")
        return None

def get_registrants():
    """Return list of all meeting registrants as dicts keyed by email."""
    registrants = {}
    next_token = None
    while True:
        params = {"page_size": 300, "status": "approved"}
        if next_token:
            params["next_page_token"] = next_token
        r = requests.get(
            f"https://api.zoom.us/v2/meetings/{MEETING_ID}/registrants",
            headers=zoom_headers(),
            params=params,
            timeout=15,
        )
        if not r.ok:
            log.error(f"Failed to get registrants: {r.status_code} {r.text[:100]}")
            break
        data = r.json()
        for reg in data.get("registrants", []):
            registrants[reg["email"].lower()] = reg
        next_token = data.get("next_page_token")
        if not next_token:
            break
    return registrants

def get_attendees():
    """Return list of meeting attendees from the Zoom report (post-event only)."""
    attendees = {}
    next_token = None
    while True:
        params = {"page_size": 300}
        if next_token:
            params["next_page_token"] = next_token
        r = requests.get(
            f"https://api.zoom.us/v2/report/meetings/{MEETING_ID}/participants",
            headers=zoom_headers(),
            params=params,
            timeout=15,
        )
        if not r.ok:
            log.error(f"Failed to get attendees: {r.status_code} {r.text[:100]}")
            break
        data = r.json()
        for p in data.get("participants", []):
            email = (p.get("user_email") or "").lower()
            name  = p.get("name", "")
            key   = email if email else name.lower()
            if key:
                # Keep the record with longest duration if same person joined multiple times
                existing = attendees.get(key)
                if not existing or p.get("duration", 0) > existing.get("duration", 0):
                    attendees[key] = p
        next_token = data.get("next_page_token")
        if not next_token:
            break
    return attendees

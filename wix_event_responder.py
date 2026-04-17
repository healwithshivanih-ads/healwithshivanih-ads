#!/usr/bin/env python3
"""
wix_event_responder.py — Wix Event registrations → leads.db + WhatsApp
────────────────────────────────────────────────────────────────────────
Polls Wix Event guests every 10 min (via GitHub Actions lead-poller.yml).

For each new registration:
  ✅ Saves to leads.db (tagged with event_slug, source=wix_event)
  ✅ Upserts Wix CRM contact with event slug in notes
  ✅ Sends WhatsApp confirmation
  ⚠️  Does NOT send our confirmation email — Wix already sent one automatically.
      Reminder emails (morning, 1hr, final) and post-event follow-up still go out normally.

Requires:
  WIX_EVENT_ID  — in events/{slug}/event.env (written by setup_event.py)
  WIX_API_KEY   — in responder.env (GitHub Secret)

Usage:
  python3 wix_event_responder.py --once --event blood-sugar-apr26
  python3 wix_event_responder.py --list --event blood-sugar-apr26   # show current guests
"""

import os, sys, time, sqlite3, argparse, logging
from pathlib import Path
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

# ── Load event-specific env BEFORE any os.getenv() calls ─────────────────────
BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))
from event_utils import early_load_event, EVENT_SLUG
early_load_event()

# Reuse DB helpers and send functions from lead_responder
from lead_responder import (
    send_whatsapp, add_to_wix, init_db, save_lead, is_new, mark_sent,
)

WIX_API_KEY  = os.getenv("WIX_API_KEY", "")
WIX_SITE_ID  = os.getenv("WIX_SITE_ID", "8cfa772f-403b-473c-b756-4ad1e55e2465")
WIX_EVENT_ID = os.getenv("WIX_EVENT_ID", "")
POLL_SECONDS = 300

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("wix_event_responder")


# ── Wix API helpers ───────────────────────────────────────────────────────────
def _wix_headers():
    return {
        "Authorization": WIX_API_KEY,
        "wix-site-id":   WIX_SITE_ID,
        "Content-Type":  "application/json",
    }


def fetch_wix_event_guests(event_id: str) -> list:
    """Query all guests for a Wix event, paginating until exhausted."""
    if not event_id:
        return []

    guests = []
    offset = 0
    limit  = 100

    while True:
        payload = {
            "query": {
                "filter":    {"eventId": event_id},
                "fieldsets": ["guestDetails"],
                "paging":    {"limit": limit, "offset": offset},
            }
        }
        try:
            r = requests.post(
                "https://www.wixapis.com/events/v2/guests/query",
                headers=_wix_headers(),
                json=payload,
                timeout=30,
            )
        except Exception as e:
            log.error(f"Wix Events API request failed: {e}")
            break

        if not r.ok:
            log.error(f"Wix Events API error {r.status_code}: {r.text[:200]}")
            break

        data  = r.json()
        batch = data.get("guests", [])
        guests.extend(batch)

        total  = data.get("pagingMetadata", {}).get("total", 0)
        offset += len(batch)
        if offset >= total or not batch:
            break

    return guests


def parse_guest(guest: dict) -> dict:
    """Convert a Wix event guest object → our standard lead dict."""
    details = guest.get("guestDetails", {})
    contact = details.get("contactDetails", {})

    first = contact.get("firstName", "").strip()
    last  = contact.get("lastName",  "").strip()
    name  = f"{first} {last}".strip()
    email = contact.get("email", "").strip()
    phone = contact.get("phone", "").strip()

    return {
        "id":           f"wix_event_{guest['id']}",
        "created_time": guest.get("createdDate", ""),
        "name":         name,
        "email":        email,
        "phone":        phone,
        "challenge":    "",
        "source":       "wix_event",
    }


# ── Main processing loop ──────────────────────────────────────────────────────
def process_wix_event_leads(con, event_slug=""):
    # Re-read WIX_EVENT_ID at call time so it picks up event.env correctly
    event_id  = os.getenv("WIX_EVENT_ID", "")
    slug_label = f" [{event_slug}]" if event_slug else ""

    if not event_id:
        log.info(f"WIX_EVENT_ID not set{slug_label} — skipping Wix Event polling")
        return

    if not WIX_API_KEY:
        log.warning("WIX_API_KEY not set — skipping Wix Event polling")
        return

    log.info(f"Checking Wix Event guests{slug_label} (event: {event_id})…")
    guests    = fetch_wix_event_guests(event_id)
    new_count = 0

    for guest in guests:
        lead = parse_guest(guest)

        # Skip guests with no contact info
        if not lead["email"] and not lead["phone"]:
            continue

        # Already processed
        if not is_new(con, lead["id"]):
            continue

        new_count += 1
        log.info(
            f"🆕 New Wix Event registration{slug_label}: "
            f"{lead['name']} | {lead['email']} | {lead['phone']}"
        )

        save_lead(con, lead, event_slug)
        add_to_wix(lead, event_slug)

        # Wix automatically sent the registration confirmation email.
        # We skip our email to prevent duplicates, but still send WhatsApp.
        wa_ok = send_whatsapp(lead)

        # Mark email_sent=True (Wix handled it) so reminder scripts treat this
        # lead normally and don't attempt a retroactive confirmation email.
        mark_sent(con, lead["id"], email_ok=True, wa_ok=wa_ok)

    if new_count == 0:
        log.info(f"   No new Wix registrations (total seen: {len(guests)})")
    else:
        log.info(f"   Processed {new_count} new Wix registration(s)")


# ── List guests ───────────────────────────────────────────────────────────────
def list_guests():
    event_id = os.getenv("WIX_EVENT_ID", "")
    if not event_id:
        print("WIX_EVENT_ID not set in event.env — cannot list guests.")
        return
    guests = fetch_wix_event_guests(event_id)
    if not guests:
        print("No guests found (or WIX_EVENT_ID is invalid).")
        return
    print(f"\n{'NAME':<25} {'EMAIL':<35} {'PHONE':<16} REGISTERED")
    print("─" * 90)
    for g in guests:
        lead = parse_guest(g)
        ts   = g.get("createdDate", "")[:19].replace("T", " ")
        print(f"{lead['name']:<25} {lead['email']:<35} {lead['phone']:<16} {ts}")
    print(f"\nTotal: {len(guests)} guest(s)\n")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once",  action="store_true", help="Poll once and exit")
    parser.add_argument("--list",  action="store_true", help="List current Wix event guests")
    parser.add_argument("--event", default=EVENT_SLUG,  help="Event slug (e.g. blood-sugar-apr26)")
    args = parser.parse_args()

    con = init_db()

    if args.list:
        list_guests()
        return

    if args.once:
        process_wix_event_leads(con, args.event)
        return

    # Continuous loop (used locally; GitHub Actions uses --once)
    slug_label = f" [{args.event}]" if args.event else ""
    log.info(f"Wix Event responder started{slug_label} — polling every {POLL_SECONDS}s")
    if not WIX_EVENT_ID:
        log.warning("WIX_EVENT_ID not set — run setup_event.py first or set it in event.env")
    while True:
        try:
            process_wix_event_leads(con, args.event)
        except Exception as e:
            log.error(f"Unexpected error: {e}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()

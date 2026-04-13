#!/usr/bin/env python3
"""
google_form_responder.py — Google Form → Email + WhatsApp automation
─────────────────────────────────────────────────────────────────────
Polls a Google Sheet (linked to your Google Form) every 5 minutes.
For every NEW response, sends the same email + WhatsApp as the Meta lead flow.

Setup:
  1. Create Google Form (see instructions below)
  2. Link it to a Google Sheet (Form → Responses → Link to Sheets)
  3. Publish the Sheet as CSV (see instructions)
  4. Paste the CSV URL into responder.env as GOOGLE_SHEET_CSV_URL
  5. Run: python3 google_form_responder.py

Usage:
  python3 google_form_responder.py            # poll loop (every 5 min)
  python3 google_form_responder.py --once     # poll once and exit (for cron)
  python3 google_form_responder.py --list     # list all form leads
  python3 google_form_responder.py --add      # manually add a single lead
  python3 google_form_responder.py --import contacts.csv   # bulk import CSV
"""

import os, sys, csv, io, time, sqlite3, argparse, logging
from pathlib import Path
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

BASE = Path(__file__).parent
load_dotenv(BASE / ".env")
load_dotenv(BASE / "responder.env")

# Reuse email + WhatsApp senders from lead_responder
sys.path.insert(0, str(BASE))
from lead_responder import send_email, send_whatsapp, add_to_wix, init_db, save_lead, is_new, mark_sent

SHEET_CSV_URL = os.getenv("GOOGLE_SHEET_CSV_URL", "")
POLL_SECONDS  = 300

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("form_responder")

# ── Google Sheet polling ──────────────────────────────────────────────────────
def fetch_sheet_rows():
    """Download Google Sheet as CSV and return list of lead dicts."""
    if not SHEET_CSV_URL:
        log.error("GOOGLE_SHEET_CSV_URL not set in responder.env")
        return []
    try:
        r = requests.get(SHEET_CSV_URL, timeout=30)
        r.raise_for_status()
        reader = csv.DictReader(io.StringIO(r.text))
        leads = []
        for i, row in enumerate(reader):
            # Map Google Form column names → standard fields
            name  = (row.get("Full Name") or row.get("Name") or "").strip()
            email = (row.get("Email ID:") or row.get("Email") or
                     row.get("Email Address") or "").strip()
            phone = (row.get("Whatsapp Phone Number") or row.get("Phone") or
                     row.get("Phone Number") or row.get("WhatsApp Number") or "").strip()
            challenge = (row.get("What's your biggest energy or blood sugar challenge right now?")
                         or row.get("Challenge") or "").strip()
            ts    = row.get("Timestamp", "")
            # Use row index + timestamp as unique ID
            lead_id = f"gform_{i}_{ts.replace(' ','_').replace('/','').replace(':','')}"
            leads.append({
                "id":           lead_id,
                "created_time": ts,
                "name":         name,
                "email":        email,
                "phone":        phone,
                "challenge":    challenge,
                "source":       "google_form",
            })
        return leads
    except Exception as e:
        log.error(f"Failed to fetch sheet: {e}")
        return []

def process_form_leads(con):
    log.info("Checking Google Form for new responses…")
    leads = fetch_sheet_rows()
    new_count = 0
    for lead in leads:
        if not lead["email"] and not lead["phone"]:
            continue
        if not is_new(con, lead["id"]):
            continue
        new_count += 1
        log.info(f"🆕 New form response: {lead['name']} | {lead['email']} | {lead['phone']}")
        save_lead(con, lead)
        add_to_wix(lead)
        email_ok = send_email(lead)
        wa_ok    = send_whatsapp(lead)
        mark_sent(con, lead["id"], email_ok, wa_ok)
    if new_count == 0:
        log.info(f"   No new responses (total rows: {len(leads)})")
    else:
        log.info(f"   Processed {new_count} new response(s)")

# ── Manual add ────────────────────────────────────────────────────────────────
def manual_add(con):
    print("\nManually add a lead\n" + "─"*30)
    name  = input("Full name  : ").strip()
    email = input("Email      : ").strip()
    phone = input("Phone (+91): ").strip()
    if not phone.startswith("+"):
        phone = "+91" + phone.lstrip("0")
    challenge = input("Challenge  (optional): ").strip()

    lead_id = f"manual_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}_{phone[-4:]}"
    lead = {
        "id":           lead_id,
        "created_time": datetime.now(timezone.utc).isoformat(),
        "name":         name,
        "email":        email,
        "phone":        phone,
        "challenge":    challenge,
        "source":       "manual",
    }

    print(f"\nSending to: {name} | {email} | {phone}")
    save_lead(con, lead)
    add_to_wix(lead)
    email_ok = send_email(lead)
    wa_ok    = send_whatsapp(lead)
    mark_sent(con, lead["id"], email_ok, wa_ok)
    print(f"\n✅ Done — Email: {'sent' if email_ok else 'failed'} | WhatsApp: {'sent' if wa_ok else 'failed'}")

# ── CSV import ────────────────────────────────────────────────────────────────
def import_csv(con, filepath):
    path = Path(filepath)
    if not path.exists():
        print(f"File not found: {filepath}")
        return

    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"\nFound {len(rows)} rows in {path.name}")
    print(f"Columns: {', '.join(rows[0].keys()) if rows else 'none'}")
    print()

    sent = skipped = failed = 0
    for i, row in enumerate(rows):
        # Try common column name variations
        name  = (row.get("Name") or row.get("Full Name") or row.get("full_name") or "").strip()
        email = (row.get("Email") or row.get("email") or row.get("Email Address") or "").strip()
        phone = (row.get("Phone") or row.get("phone") or row.get("Mobile") or
                 row.get("WhatsApp") or row.get("phone_number") or "").strip()

        if not email and not phone:
            skipped += 1
            continue

        if phone and not phone.startswith("+"):
            phone = "+91" + phone.lstrip("0")

        lead_id = f"import_{path.stem}_{i}"
        lead = {
            "id":           lead_id,
            "created_time": datetime.now(timezone.utc).isoformat(),
            "name":         name,
            "email":        email,
            "phone":        phone,
            "challenge":    row.get("challenge", ""),
            "source":       f"csv_import:{path.name}",
        }

        if not is_new(con, lead_id):
            skipped += 1
            continue

        log.info(f"  Sending to: {name} | {email} | {phone}")
        save_lead(con, lead)
        add_to_wix(lead)
        email_ok = send_email(lead)
        wa_ok    = send_whatsapp(lead)
        mark_sent(con, lead["id"], email_ok, wa_ok)

        if email_ok or wa_ok:
            sent += 1
        else:
            failed += 1

        time.sleep(2)  # avoid rate limiting

    print(f"\n✅ Import complete — Sent: {sent} | Skipped: {skipped} | Failed: {failed}")

# ── list all leads ─────────────────────────────────────────────────────────────
def list_all(con):
    rows = con.execute("""
        SELECT name, email, phone, email_sent, wa_sent, processed_at
        FROM leads ORDER BY processed_at DESC
    """).fetchall()
    if not rows:
        print("No leads yet.")
        return
    print(f"\n{'NAME':<22} {'EMAIL':<30} {'PHONE':<16} ✉  📱  {'RECEIVED'}")
    print("─"*105)
    for name, email, phone, esent, wsent, proc in rows:
        print(f"{(name or ''):<22} {(email or ''):<30} {(phone or ''):<16} "
              f"{'✅' if esent else '❌'}  {'✅' if wsent else '❌'}  {proc or ''}")

# ── main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once",   action="store_true", help="Poll once and exit")
    parser.add_argument("--add",    action="store_true", help="Manually add a single lead")
    parser.add_argument("--import", metavar="CSV_FILE",  dest="import_csv", help="Import from CSV")
    parser.add_argument("--list",   action="store_true", help="List all leads")
    args = parser.parse_args()

    con = init_db()

    if args.list:
        list_all(con)
        return

    if args.add:
        manual_add(con)
        return

    if args.import_csv:
        import_csv(con, args.import_csv)
        return

    if args.once:
        process_form_leads(con)
        return

    # Continuous loop
    log.info(f"Google Form responder started — polling every {POLL_SECONDS}s")
    if not SHEET_CSV_URL:
        log.warning("GOOGLE_SHEET_CSV_URL not set — only --add and --import will work")
    while True:
        try:
            process_form_leads(con)
        except Exception as e:
            log.error(f"Error: {e}")
        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    main()

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

# ── Load event-specific env BEFORE any os.getenv() calls ─────────────────────
BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))
from event_utils import early_load_event, EVENT_SLUG
early_load_event()   # loads .env + responder.env + events/{slug}/event.env

# Reuse email + WhatsApp senders from lead_responder
from lead_responder import send_email, send_whatsapp, add_to_wix, init_db, save_lead, is_new, mark_sent, save_zoom_registration

SHEET_CSV_URL = os.getenv("GOOGLE_SHEET_CSV_URL", "")
SHEET_ID      = os.getenv("GOOGLE_SHEET_ID", "")
SA_JSON       = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "google_service_account.json")
POLL_SECONDS  = 300

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("form_responder")

# ── Google Sheet polling ──────────────────────────────────────────────────────
def _rows_to_leads(headers: list, rows: list) -> list:
    """Convert a list of header+value rows into our standard lead dicts."""
    leads = []
    for i, row in enumerate(rows):
        row_dict = dict(zip(headers, row + [""] * max(0, len(headers) - len(row))))
        name  = (row_dict.get("Full Name") or row_dict.get("Name") or "").strip()
        email = (row_dict.get("Email ID:") or row_dict.get("Email") or
                 row_dict.get("Email Address") or "").strip()
        phone = (row_dict.get("Whatsapp Phone Number") or row_dict.get("Phone") or
                 row_dict.get("Phone Number") or row_dict.get("WhatsApp Number") or "").strip()
        challenge = (
            row_dict.get("What's your biggest energy or blood sugar challenge right now?")
            or row_dict.get("Challenge") or ""
        ).strip()
        ts = row_dict.get("Timestamp", "")
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


def fetch_sheet_rows_api(sheet_id: str) -> list:
    """Read Google Sheet via Drive export using the service account.
    Uses Drive API (auth'd export) so no Sheets API or public sharing needed."""
    sa_path = BASE / SA_JSON
    if not sa_path.exists():
        return []
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        import io as _io
        creds = service_account.Credentials.from_service_account_file(
            str(sa_path),
            scopes=["https://www.googleapis.com/auth/drive.readonly"],
        )
        svc    = build("drive", "v3", credentials=creds)
        data   = svc.files().export(
            fileId=sheet_id, mimeType="text/csv"
        ).execute()
        reader  = csv.DictReader(_io.StringIO(data.decode("utf-8")))
        rows    = list(reader)
        if not rows:
            return []
        headers = list(rows[0].keys())
        values  = [[row.get(h, "") for h in headers] for row in rows]
        return _rows_to_leads(headers, values)
    except Exception as e:
        log.error(f"Drive sheet export failed: {e}")
        return []


def fetch_sheet_rows_csv() -> list:
    """Fallback: download Google Sheet as public CSV."""
    if not SHEET_CSV_URL:
        return []
    try:
        r = requests.get(SHEET_CSV_URL, timeout=30)
        r.raise_for_status()
        reader  = csv.DictReader(io.StringIO(r.text))
        rows    = list(reader)
        if not rows:
            return []
        headers = list(rows[0].keys())
        values  = [[row.get(h, "") for h in headers] for row in rows]
        return _rows_to_leads(headers, values)
    except Exception as e:
        log.error(f"Failed to fetch sheet CSV: {e}")
        return []


def fetch_sheet_rows() -> list:
    """Fetch sheet rows — prefers Sheets API (private), falls back to CSV URL."""
    if SHEET_ID:
        leads = fetch_sheet_rows_api(SHEET_ID)
        if leads is not None:   # empty list is fine, None means error
            return leads
    return fetch_sheet_rows_csv()

def process_form_leads(con, event_slug=""):
    slug_label = f" [{event_slug}]" if event_slug else ""
    log.info(f"Checking Google Form for new responses{slug_label}…")
    leads = fetch_sheet_rows()
    new_count = 0
    for lead in leads:
        if not lead["email"] and not lead["phone"]:
            continue
        if not is_new(con, lead["id"]):
            continue
        new_count += 1
        log.info(f"🆕 New form response{slug_label}: {lead['name']} | {lead['email']} | {lead['phone']}")
        save_lead(con, lead, event_slug)
        add_to_wix(lead, event_slug)
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
    add_to_wix(lead, args.event if hasattr(args, "event") else "")
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
        add_to_wix(lead)   # no event_slug context available in bulk import
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
    parser.add_argument("--event",  default=EVENT_SLUG,  help="Event slug (e.g. blood-sugar-apr26)")
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
        process_form_leads(con, args.event)
        return

    # Continuous loop
    slug_label = f" [{args.event}]" if args.event else ""
    log.info(f"Google Form responder started{slug_label} — polling every {POLL_SECONDS}s")
    if not SHEET_CSV_URL:
        log.warning("GOOGLE_SHEET_CSV_URL not set — only --add and --import will work")
    while True:
        try:
            process_form_leads(con, args.event)
        except Exception as e:
            log.error(f"Error: {e}")
        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    main()

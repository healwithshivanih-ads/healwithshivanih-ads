#!/usr/bin/env python3
"""
lead_responder.py — Heal With Shivanih Webinar Lead Automation
──────────────────────────────────────────────────────────────
Polls the Meta Lead Gen form every 5 minutes.
For every NEW lead, sends:
  1. A welcome email (via Gmail SMTP or any SMTP provider)
  2. A WhatsApp message (via Interakt, AiSensy, or Meta Cloud API)

Setup:
  1. Fill in meta_ads/.env (already done)
  2. Fill in meta_ads/responder.env (see below)
  3. Run: python3 lead_responder.py
  4. Keep running (or use cron / launchd):
       cron:  */5 * * * * cd /Users/shivani/social-video/meta_ads && python3 lead_responder.py --once
       loop:  python3 lead_responder.py          # runs forever, polls every 5 min

Usage:
  python3 lead_responder.py            # poll loop (every 5 min)
  python3 lead_responder.py --once     # poll once and exit (for cron)
  python3 lead_responder.py --test     # send test message to yourself
  python3 lead_responder.py --list     # list all leads received so far
"""

import os, sys, time, json, sqlite3, smtplib, argparse, logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

# ── config ────────────────────────────────────────────────────────────────────
BASE = Path(__file__).parent
load_dotenv(BASE / ".env")
load_dotenv(BASE / "responder.env")

FORM_ID      = os.getenv("LEAD_FORM_ID",  "1304691274903048")
ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN")
GRAPH        = "https://graph.facebook.com/v19.0"
POLL_SECONDS = 300   # 5 minutes

# Email (SMTP)
SMTP_HOST    = os.getenv("SMTP_HOST",    "smtp.gmail.com")
SMTP_PORT    = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER    = os.getenv("SMTP_USER")       # your Gmail address
SMTP_PASS    = os.getenv("SMTP_PASS")       # Gmail App Password (16 chars)
FROM_NAME    = os.getenv("FROM_NAME",    "Shivani Hari")
FROM_EMAIL   = os.getenv("FROM_EMAIL",   SMTP_USER or "")

# Wix CRM
WIX_API_KEY  = os.getenv("WIX_API_KEY", "")
WIX_SITE_ID  = os.getenv("WIX_SITE_ID", "8cfa772f-403b-473c-b756-4ad1e55e2465")
WIX_BASE_URL = "https://www.wixapis.com/contacts/v4/contacts"

# WhatsApp provider — set ONE of these in responder.env
WA_PROVIDER  = os.getenv("WA_PROVIDER", "interakt")   # interakt | aisensy | meta
# Interakt
INTERAKT_KEY = os.getenv("INTERAKT_API_KEY", "")
# AiSensy
AISENSY_KEY  = os.getenv("AISENSY_API_KEY", "")
AISENSY_CAMP = os.getenv("AISENSY_CAMPAIGN", "webinar_confirmation")
# Meta Cloud API
META_WA_TOKEN    = os.getenv("META_WA_TOKEN", "")
META_WA_PHONE_ID = os.getenv("META_WA_PHONE_ID", "")
META_WA_TEMPLATE = os.getenv("META_WA_TEMPLATE", "webinar_registration")

# DB to track processed leads
DB_PATH = BASE / "leads.db"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("lead_responder")

# ── database ──────────────────────────────────────────────────────────────────
def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id               TEXT PRIMARY KEY,
            created_time     TEXT,
            name             TEXT,
            email            TEXT,
            phone            TEXT,
            challenge        TEXT,
            email_sent       INTEGER DEFAULT 0,
            wa_sent          INTEGER DEFAULT 0,
            processed_at     TEXT,
            zoom_join_url    TEXT,
            zoom_registrant_id TEXT
        )
    """)
    # Migrate: add zoom columns if upgrading from older schema
    for col, typ in [("zoom_join_url", "TEXT"), ("zoom_registrant_id", "TEXT")]:
        try:
            con.execute(f"ALTER TABLE leads ADD COLUMN {col} {typ}")
        except Exception:
            pass
    con.commit()
    return con

def save_zoom_registration(con, lead_id, join_url, registrant_id):
    con.execute("""
        UPDATE leads SET zoom_join_url=?, zoom_registrant_id=?
        WHERE id=?
    """, (join_url, registrant_id, lead_id))
    con.commit()

def is_new(con, lead_id):
    return con.execute("SELECT 1 FROM leads WHERE id=?", (lead_id,)).fetchone() is None

def save_lead(con, lead):
    con.execute("""
        INSERT OR IGNORE INTO leads
          (id, created_time, name, email, phone, challenge)
        VALUES (?,?,?,?,?,?)
    """, (lead["id"], lead["created_time"], lead.get("name",""),
          lead.get("email",""), lead.get("phone",""), lead.get("challenge","")))
    con.commit()

def mark_sent(con, lead_id, email_ok, wa_ok):
    con.execute("""
        UPDATE leads SET email_sent=?, wa_sent=?, processed_at=?
        WHERE id=?
    """, (int(email_ok), int(wa_ok),
          datetime.now(timezone.utc).isoformat(), lead_id))
    con.commit()

# ── Meta leads API ────────────────────────────────────────────────────────────
def fetch_leads():
    """Return list of lead dicts from the form, newest first."""
    url = f"{GRAPH}/{FORM_ID}/leads"
    params = {
        "access_token": ACCESS_TOKEN,
        "fields":       "id,created_time,field_data",
        "limit":        100,
    }
    leads = []
    while url:
        r = requests.get(url, params=params, timeout=30)
        data = r.json()
        if "error" in data:
            log.error(f"Meta API error: {data['error']['message']}")
            break
        for raw in data.get("data", []):
            lead = {"id": raw["id"], "created_time": raw["created_time"]}
            for f in raw.get("field_data", []):
                key = f["name"]
                val = f["values"][0] if f["values"] else ""
                if key == "full_name":    lead["name"]      = val
                elif key == "email":      lead["email"]     = val
                elif key == "phone_number": lead["phone"]   = val
                elif key == "challenge":  lead["challenge"] = val
            leads.append(lead)
        url    = data.get("paging", {}).get("next")
        params = {}   # next URL already has params
    return leads

# ── email ─────────────────────────────────────────────────────────────────────
EMAIL_SUBJECT = "You're registered for the Free Blood Sugar Workshop 🎉"

def email_body_html(name, phone=""):
    first = name.split()[0] if name else "there"
    return f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
<div style="background:#0d3d22;padding:32px;text-align:center;border-radius:12px 12px 0 0">
  <p style="color:#22c55e;font-size:13px;font-weight:800;letter-spacing:3px;margin:0">FREE LIVE WORKSHOP</p>
  <h1 style="color:#fff;margin:12px 0 0;font-size:26px;line-height:1.3">
    Balance Your Blood Sugar Naturally
  </h1>
  <p style="color:rgba(255,255,255,0.75);margin:10px 0 0;font-size:15px">
    📅 Sunday, 26 April 2026 &nbsp;·&nbsp; ⏰ 6:00 PM IST
  </p>
</div>

<div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px">
  <p style="font-size:17px">Hi {first},</p>
  <p>You're in! Your spot is confirmed for the free live workshop.</p>

  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin:20px 0">
    <p style="margin:0 0 12px;font-weight:700;color:#0d3d22">In this 60-minute workshop you'll discover:</p>
    <p style="margin:6px 0">✅ Why you crash after meals — and it's <em>not</em> the food</p>
    <p style="margin:6px 0">✅ The 3 everyday foods silently spiking your glucose</p>
    <p style="margin:6px 0">✅ A simple 7-day reset protocol — no medication needed</p>
  </div>

  <p style="font-weight:700">📅 Add to your calendar so you don't miss it:</p>
  <p>
    <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=Balance+Your+Blood+Sugar+Workshop&dates=20260426T123000Z/20260426T143000Z&details=Free+live+workshop+with+Shivani+Hari&location=Online" style="background:#0d3d22;color:#fff;padding:12px 24px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Add to Google Calendar</a>
  </p>

  <p>I'll send you a reminder the day before and the morning of the workshop.</p>
  <p>If you have any questions in the meantime, just reply to this email.</p>

  <p style="margin-top:32px">See you on the 26th! 💚<br>
  <strong>Shivani Hari</strong><br>
  <span style="color:#6b7280;font-size:13px">Functional Health Coach · @healwithshivanih</span>
  </p>

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#9ca3af;font-size:12px;text-align:center">
    You're receiving this because you registered for the free workshop.<br>
    <a href="#" style="color:#9ca3af">Unsubscribe</a>
  </p>
</div>
</body></html>
"""

def send_email(lead):
    if not SMTP_USER or not SMTP_PASS:
        log.warning("Email not configured — skipping (set SMTP_USER and SMTP_PASS in responder.env)")
        return False
    if not lead.get("email"):
        log.warning(f"Lead {lead['id']} has no email address")
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = EMAIL_SUBJECT
    msg["From"]    = f"{FROM_NAME} <{FROM_EMAIL}>"
    msg["To"]      = lead["email"]
    msg.attach(MIMEText(email_body_html(lead.get("name",""), lead.get("phone","")), "html"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.ehlo()
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
        log.info(f"  ✉  Email sent to {lead['email']}")
        return True
    except Exception as e:
        log.error(f"  ✉  Email FAILED: {e}")
        return False

# ── WhatsApp ──────────────────────────────────────────────────────────────────
def wa_message(name):
    first = name.split()[0] if name else "there"
    return (
        f"Hi {first}! 🌿 You're registered for *How to Regulate Your Blood Sugar* with Shivani Hari.\n\n"
        f"📅 *Sunday, 26 April · 6:00 PM IST*\n\n"
        f"We'll cover:\n"
        f"→ Why you crash after meals\n"
        f"→ 3 foods spiking your glucose\n"
        f"→ A 7-day reset protocol\n\n"
        f"I'll send your join link 1 hour before we start. See you there! 💚\n"
        f"— Shivani (@healwithshivanih)"
    )

def send_whatsapp_interakt(lead):
    """Send via Interakt (popular in India, free tier available)."""
    if not INTERAKT_KEY:
        log.warning("Interakt not configured — skipping")
        return False
    phone = lead.get("phone", "").strip().lstrip("+")
    if not phone:
        log.warning(f"Lead {lead['id']} has no phone")
        return False

    first = (lead.get("name") or "there").split()[0]
    payload = {
        "countryCode": "+91",
        "phoneNumber": phone,
        "callbackData": f"lead_{lead['id']}",
        "type": "Template",
        "template": {
            "name":         "webinar_registration_confirmation",
            "languageCode": "en",
            "bodyValues":   [first, "26 April", "6:00 PM IST"],
        },
    }
    r = requests.post(
        "https://api.interakt.ai/v1/public/message/",
        headers={"Authorization": f"Basic {INTERAKT_KEY}", "Content-Type": "application/json"},
        json=payload,
        timeout=15,
    )
    if r.ok:
        log.info(f"  📱 WhatsApp (Interakt) sent to {phone}")
        return True
    log.error(f"  📱 WhatsApp (Interakt) FAILED: {r.text}")
    return False

def send_whatsapp_aisensy(lead):
    """Send via AiSensy."""
    if not AISENSY_KEY:
        log.warning("AiSensy not configured — skipping")
        return False
    phone = lead.get("phone", "").strip()
    if not phone.startswith("+"):
        phone = "+91" + phone.lstrip("0")
    first = (lead.get("name") or "there").split()[0]

    payload = {
        "apiKey":       AISENSY_KEY,
        "campaignName": AISENSY_CAMP,
        "destination":  phone,
        "userName":     lead.get("name", ""),
        "templateParams": [first, "26 April · 6:00 PM IST"],
        "source":       "lead-gen-form",
        "media":        {},
    }
    r = requests.post(
        "https://backend.aisensy.com/campaign/t1/api/v2",
        headers={"Content-Type": "application/json"},
        json=payload,
        timeout=15,
    )
    if r.ok:
        log.info(f"  📱 WhatsApp (AiSensy) sent to {phone}")
        return True
    log.error(f"  📱 WhatsApp (AiSensy) FAILED: {r.text}")
    return False

def send_whatsapp_meta(lead):
    """Send via Meta WhatsApp Cloud API (requires approved template)."""
    if not META_WA_TOKEN or not META_WA_PHONE_ID:
        log.warning("Meta WA Cloud API not configured — skipping")
        return False
    phone = lead.get("phone", "").strip().lstrip("+")
    if not phone:
        log.warning(f"Lead {lead['id']} has no phone")
        return False
    first = (lead.get("name") or "there").split()[0]

    payload = {
        "messaging_product": "whatsapp",
        "to":                phone,
        "type":              "template",
        "template": {
            "name":     META_WA_TEMPLATE,
            "language": {"code": "en"},
            "components": [{
                "type":       "body",
                "parameters": [
                    {"type": "text", "text": first},
                    {"type": "text", "text": "26 April · 6:00 PM IST"},
                ],
            }],
        },
    }
    r = requests.post(
        f"https://graph.facebook.com/v19.0/{META_WA_PHONE_ID}/messages",
        headers={
            "Authorization": f"Bearer {META_WA_TOKEN}",
            "Content-Type":  "application/json",
        },
        json=payload,
        timeout=15,
    )
    if r.ok:
        log.info(f"  📱 WhatsApp (Meta Cloud) sent to {phone}")
        return True
    log.error(f"  📱 WhatsApp (Meta Cloud) FAILED: {r.text}")
    return False

def send_whatsapp(lead):
    if   WA_PROVIDER == "interakt": return send_whatsapp_interakt(lead)
    elif WA_PROVIDER == "aisensy":  return send_whatsapp_aisensy(lead)
    elif WA_PROVIDER == "meta":     return send_whatsapp_meta(lead)
    else:
        log.warning(f"Unknown WA_PROVIDER '{WA_PROVIDER}' — skipping WhatsApp")
        return False

# ── Wix CRM ───────────────────────────────────────────────────────────────────
def _wix_headers():
    return {
        "Authorization": WIX_API_KEY,
        "wix-site-id":   WIX_SITE_ID,
        "Content-Type":  "application/json",
    }

def _wix_find_contact(email, phone):
    """Search Wix for an existing contact by email or phone.
    Returns (id, revision) tuple or (None, None)."""
    filters = []
    if email:
        filters.append({"info.emails.email": {"$eq": email}})
    if phone:
        filters.append({"info.phones.phone": {"$eq": phone}})
    if not filters:
        return None, None

    query = {"filter": {"$or": filters} if len(filters) > 1 else filters[0]}
    r = requests.post(
        f"{WIX_BASE_URL}/query",
        headers=_wix_headers(),
        json={"query": query},
        timeout=15,
    )
    if r.ok:
        contacts = r.json().get("contacts", [])
        if contacts:
            c = contacts[0]
            return c["id"], c.get("revision", "1")
    return None, None

def add_to_wix(lead):
    """Upsert a contact in Wix CRM — search first, patch if exists, create if not."""
    if not WIX_API_KEY:
        return False

    name      = lead.get("name", "")
    parts     = name.split(None, 1)
    first     = parts[0] if parts else ""
    last      = parts[1] if len(parts) > 1 else ""
    email     = lead.get("email", "")
    phone     = lead.get("phone", "")
    source    = lead.get("source", "meta_form")
    challenge = lead.get("challenge", "")

    if phone and not phone.startswith("+"):
        phone = "+91" + phone.lstrip("0")

    info = {}
    if first or last:
        info["name"] = {"first": first, "last": last}
    if email:
        info["emails"] = {"items": [{"email": email, "tag": "UNTAGGED"}]}
    if phone:
        info["phones"] = {"items": [{"phone": phone, "tag": "UNTAGGED"}]}
    tag_parts = [f"Webinar Lead [{source}]"]
    if challenge:
        tag_parts.append(challenge[:80])
    info["jobTitle"] = " · ".join(tag_parts)

    try:
        existing_id, revision = _wix_find_contact(email, phone)

        if existing_id:
            # Patch only non-identifier fields (name + jobTitle) — don't re-send
            # email/phone as Wix rejects them as duplicates even on the same contact
            patch_info = {}
            if first or last:
                patch_info["name"] = {"first": first, "last": last}
            patch_info["jobTitle"] = info["jobTitle"]
            r = requests.patch(
                f"{WIX_BASE_URL}/{existing_id}",
                headers=_wix_headers(),
                json={"revision": revision, "info": patch_info},
                timeout=15,
            )
            if r.ok:
                log.info(f"  🏷  Wix CRM: contact updated ({email or phone})")
            else:
                log.info(f"  🏷  Wix CRM: contact already exists ({email or phone})")
            return True

        # No existing contact — create new
        r = requests.post(WIX_BASE_URL, headers=_wix_headers(), json={"info": info}, timeout=15)
        if r.ok:
            log.info(f"  🏷  Wix CRM: contact added ({email or phone})")
            return True
        elif r.status_code == 409:
            # Race condition — another process created it between our search and create
            log.info(f"  🏷  Wix CRM: contact already exists ({email or phone})")
            return True
        else:
            log.error(f"  🏷  Wix CRM FAILED {r.status_code}: {r.text[:200]}")
            return False
    except Exception as e:
        log.error(f"  🏷  Wix CRM error: {e}")
        return False

# ── main loop ─────────────────────────────────────────────────────────────────
def process_new_leads(con):
    log.info("Checking for new leads…")
    leads = fetch_leads()
    new_count = 0
    for lead in leads:
        if not is_new(con, lead["id"]):
            continue
        new_count += 1
        name  = lead.get("name", "")
        email = lead.get("email", "")
        phone = lead.get("phone", "")
        log.info(f"🆕 New lead: {name} | {email} | {phone}")
        save_lead(con, lead)
        add_to_wix(lead)
        email_ok = send_email(lead)
        wa_ok    = send_whatsapp(lead)
        mark_sent(con, lead["id"], email_ok, wa_ok)
    if new_count == 0:
        log.info(f"   No new leads (total checked: {len(leads)})")
    else:
        log.info(f"   Processed {new_count} new lead(s)")

def list_leads(con):
    rows = con.execute("""
        SELECT name, email, phone, challenge, email_sent, wa_sent, processed_at
        FROM leads ORDER BY processed_at DESC
    """).fetchall()
    if not rows:
        print("No leads yet.")
        return
    print(f"\n{'NAME':<20} {'EMAIL':<30} {'PHONE':<15} ✉  📱  {'RECEIVED'}")
    print("─"*100)
    for r in rows:
        name, email, phone, challenge, esent, wsent, proc = r
        print(f"{(name or ''):<20} {(email or ''):<30} {(phone or ''):<15} {'✅' if esent else '❌'}  {'✅' if wsent else '❌'}  {proc or ''}")

def send_test(con):
    """Send test messages to yourself."""
    test_lead = {
        "id":           "TEST_001",
        "created_time": datetime.now(timezone.utc).isoformat(),
        "name":         FROM_NAME or "Shivani Hari",
        "email":        SMTP_USER or "",
        "phone":        os.getenv("TEST_PHONE", ""),
        "challenge":    "energy_crashes",
    }
    log.info("Sending test email…")
    send_email(test_lead)
    log.info("Sending test WhatsApp…")
    send_whatsapp(test_lead)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once",  action="store_true", help="Poll once and exit (for cron)")
    parser.add_argument("--test",  action="store_true", help="Send test message to yourself")
    parser.add_argument("--list",  action="store_true", help="List all leads")
    args = parser.parse_args()

    con = init_db()

    if args.list:
        list_leads(con)
        return

    if args.test:
        send_test(con)
        return

    if args.once:
        process_new_leads(con)
        return

    # Continuous loop
    log.info(f"Lead responder started — polling every {POLL_SECONDS}s")
    log.info(f"Form: {FORM_ID} | Email: {SMTP_USER or 'NOT SET'} | WhatsApp: {WA_PROVIDER}")
    while True:
        try:
            process_new_leads(con)
        except Exception as e:
            log.error(f"Unexpected error: {e}")
        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    main()

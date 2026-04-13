#!/usr/bin/env python3
"""
send_reminders.py — Webinar Reminder Blaster
─────────────────────────────────────────────
Sends WhatsApp + email reminders to ALL leads in the database.

Three reminder types (run via cron on 26 Apr 2026):
  --morning     8:00 AM IST  — "It's today!" reminder
  --hour-before 5:00 PM IST  — Join link + 1 hour warning
  --final       5:59 PM IST  — "Starting in 1 minute!" + join link

Usage:
  python3 send_reminders.py --morning
  python3 send_reminders.py --hour-before
  python3 send_reminders.py --final
  python3 send_reminders.py --morning --dry-run   # preview without sending

Set WEBINAR_LINK in responder.env before running.
"""

import os, sys, sqlite3, smtplib, argparse, logging, time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

BASE = Path(__file__).parent
load_dotenv(BASE / ".env")
load_dotenv(BASE / "responder.env")

# ── config ────────────────────────────────────────────────────────────────────
WEBINAR_LINK = os.getenv("WEBINAR_LINK", "")   # set in responder.env
WEBINAR_DATE = "Sunday, 26 April 2026"
WEBINAR_TIME = "6:00 PM IST"

SMTP_HOST  = os.getenv("SMTP_HOST",  "smtp.gmail.com")
SMTP_PORT  = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER  = os.getenv("SMTP_USER")
SMTP_PASS  = os.getenv("SMTP_PASS")
FROM_NAME  = os.getenv("FROM_NAME",  "Shivani Hari")
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USER or "")

AISENSY_KEY  = os.getenv("AISENSY_API_KEY", "")
AISENSY_CAMP = os.getenv("AISENSY_CAMPAIGN", "webinar_confirmation")

DB_PATH = BASE / "leads.db"

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-7s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("reminders")

# ── fetch all leads from DB ───────────────────────────────────────────────────
def get_all_leads():
    con = sqlite3.connect(DB_PATH)
    rows = con.execute(
        "SELECT name, email, phone FROM leads WHERE name != '' OR email != '' OR phone != ''"
    ).fetchall()
    con.close()
    return [{"name": r[0], "email": r[1], "phone": r[2]} for r in rows]

# ── email templates ───────────────────────────────────────────────────────────
def email_morning(name):
    first = name.split()[0] if name else "there"
    link_block = f'<a href="{WEBINAR_LINK}" style="background:#0d3d22;color:#fff;padding:14px 28px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;font-size:16px">Join the Workshop →</a>' if WEBINAR_LINK else '<p style="color:#6b7280">(Join link will be sent 1 hour before we start)</p>'
    return "It's today! 🎉 Your Blood Sugar Workshop starts at 6 PM IST", f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
<div style="background:#0d3d22;padding:32px;text-align:center;border-radius:12px 12px 0 0">
  <p style="color:#22c55e;font-size:13px;font-weight:800;letter-spacing:3px;margin:0">TODAY — FREE LIVE WORKSHOP</p>
  <h1 style="color:#fff;margin:12px 0 0;font-size:26px">Balance Your Blood Sugar Naturally</h1>
  <p style="color:rgba(255,255,255,0.85);margin:10px 0 0;font-size:18px;font-weight:700">⏰ 6:00 PM IST — Tonight!</p>
</div>
<div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px">
  <p style="font-size:17px">Hi {first},</p>
  <p>Just a reminder — <strong>the free workshop is tonight at 6:00 PM IST</strong>. I can't wait to see you there!</p>
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin:20px 0">
    <p style="margin:0 0 8px;font-weight:700;color:#0d3d22">Here's what we'll cover:</p>
    <p style="margin:6px 0">✅ Why you crash after meals — and it's not the food</p>
    <p style="margin:6px 0">✅ The 3 everyday foods silently spiking your glucose</p>
    <p style="margin:6px 0">✅ A simple 7-day reset protocol — no medication needed</p>
  </div>
  <p>I'll send your <strong>join link at 5:00 PM</strong> — one hour before we start.</p>
  {link_block}
  <p style="margin-top:32px">See you tonight! 💚<br>
  <strong>Shivani Hari</strong><br>
  <span style="color:#6b7280;font-size:13px">@healwithshivanih</span></p>
</div>
</body></html>"""

def email_hour_before(name):
    first = name.split()[0] if name else "there"
    link = WEBINAR_LINK or "#"
    return "Your join link is here — workshop starts in 1 hour 🎯", f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
<div style="background:#0d3d22;padding:32px;text-align:center;border-radius:12px 12px 0 0">
  <p style="color:#22c55e;font-size:13px;font-weight:800;letter-spacing:3px;margin:0">STARTING IN 1 HOUR</p>
  <h1 style="color:#fff;margin:12px 0 0;font-size:26px">Balance Your Blood Sugar Naturally</h1>
  <p style="color:rgba(255,255,255,0.85);margin:10px 0 0;font-size:18px;font-weight:700">📅 Today · ⏰ 6:00 PM IST</p>
</div>
<div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px">
  <p style="font-size:17px">Hi {first},</p>
  <p>Your workshop starts in <strong>1 hour</strong>. Here's your join link:</p>
  <div style="text-align:center;margin:28px 0">
    <a href="{link}" style="background:#0d3d22;color:#fff;padding:16px 36px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block;font-size:17px">🎯 Join the Workshop Now</a>
  </div>
  <p style="color:#6b7280;font-size:14px;text-align:center">Link: <a href="{link}">{link}</a></p>
  <p><strong>Tip:</strong> Join 2–3 minutes early so we can start on time. See you at 6! 💚</p>
  <p style="margin-top:32px"><strong>Shivani Hari</strong><br>
  <span style="color:#6b7280;font-size:13px">@healwithshivanih</span></p>
</div>
</body></html>"""

def email_final(name):
    first = name.split()[0] if name else "there"
    link = WEBINAR_LINK or "#"
    return "🚨 Starting in 1 minute — join now!", f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
<div style="background:#dc2626;padding:32px;text-align:center;border-radius:12px 12px 0 0">
  <p style="color:#fef2f2;font-size:13px;font-weight:800;letter-spacing:3px;margin:0">🚨 STARTING NOW</p>
  <h1 style="color:#fff;margin:12px 0 0;font-size:28px">Join in 1 minute!</h1>
</div>
<div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px;text-align:center">
  <p style="font-size:18px">Hi {first} — we're starting right now!</p>
  <div style="margin:28px 0">
    <a href="{link}" style="background:#dc2626;color:#fff;padding:18px 40px;border-radius:50px;text-decoration:none;font-weight:800;display:inline-block;font-size:18px">👉 Join Now</a>
  </div>
  <p style="color:#6b7280;font-size:13px"><a href="{link}">{link}</a></p>
  <p style="margin-top:24px"><strong>Shivani Hari</strong> · @healwithshivanih</p>
</div>
</body></html>"""

# ── send functions ────────────────────────────────────────────────────────────
def send_email(to_email, subject, html):
    if not SMTP_USER or not SMTP_PASS or not to_email:
        return False
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"{FROM_NAME} <{FROM_EMAIL}>"
    msg["To"]      = to_email
    msg.attach(MIMEText(html, "html"))
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.ehlo(); s.starttls(); s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
        return True
    except Exception as e:
        log.error(f"Email failed to {to_email}: {e}")
        return False

def send_whatsapp(lead, reminder_type):
    """Send WhatsApp reminder. Uses webinar_confirmation template for morning,
    and a text message fallback for hour-before and final (no template needed
    for messages within 24h of a prior template message)."""
    phone = (lead.get("phone") or "").strip()
    if not phone:
        return False
    if not phone.startswith("+"):
        phone = "+91" + phone.lstrip("0")
    if not AISENSY_KEY:
        return False

    first = (lead.get("name") or "there").split()[0]
    link  = WEBINAR_LINK or "Link coming soon"

    if reminder_type == "morning":
        # Use approved template — date is today so params still valid
        params = [first, "26 April · 6:00 PM IST"]
        camp   = AISENSY_CAMP
    elif reminder_type == "hour-before":
        # Need a separate approved template for this
        # Using webinar_confirmation as fallback — update AISENSY_REMINDER_CAMP once template approved
        camp   = os.getenv("AISENSY_REMINDER_CAMP", AISENSY_CAMP)
        params = [first, link]
    else:  # final
        camp   = os.getenv("AISENSY_FINAL_CAMP", AISENSY_CAMP)
        params = [first, link]

    payload = {
        "apiKey":         AISENSY_KEY,
        "campaignName":   camp,
        "destination":    phone,
        "userName":       lead.get("name", ""),
        "templateParams": params,
        "source":         f"reminder-{reminder_type}",
        "media":          {},
    }
    r = requests.post("https://backend.aisensy.com/campaign/t1/api/v2",
        headers={"Content-Type": "application/json"}, json=payload, timeout=15)
    if r.ok:
        return True
    log.error(f"WhatsApp failed to {phone}: {r.text[:100]}")
    return False

# ── main blast ────────────────────────────────────────────────────────────────
def blast(reminder_type, dry_run):
    leads = get_all_leads()
    if not leads:
        log.info("No leads in database yet.")
        return

    log.info(f"Sending {reminder_type} reminder to {len(leads)} leads{' [DRY RUN]' if dry_run else ''}…")

    email_ok = wa_ok = 0
    for i, lead in enumerate(leads):
        name  = lead.get("name", "")
        email = lead.get("email", "")
        phone = lead.get("phone", "")

        if reminder_type == "morning":
            subject, html = email_morning(name)
        elif reminder_type == "hour-before":
            subject, html = email_hour_before(name)
        else:
            subject, html = email_final(name)

        if dry_run:
            log.info(f"  [DRY RUN] Would send to: {name} | {email} | {phone}")
            continue

        if email:
            if send_email(email, subject, html):
                email_ok += 1

        if phone:
            if send_whatsapp(lead, reminder_type):
                wa_ok += 1

        # Small delay to avoid SMTP rate limits
        if i > 0 and i % 50 == 0:
            time.sleep(2)

    if not dry_run:
        log.info(f"Done — ✉ {email_ok} emails sent, 📱 {wa_ok} WhatsApps sent")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--morning",      action="store_true", help="Send morning reminder (8 AM)")
    parser.add_argument("--hour-before",  action="store_true", help="Send 1-hour reminder with join link (5 PM)")
    parser.add_argument("--final",        action="store_true", help="Send 1-minute reminder (5:59 PM)")
    parser.add_argument("--dry-run",      action="store_true", help="Preview without sending")
    args = parser.parse_args()

    if not any([args.morning, args.hour_before, args.final]):
        parser.print_help()
        sys.exit(1)

    if not WEBINAR_LINK and not args.morning and not args.dry_run:
        log.warning("⚠  WEBINAR_LINK not set in responder.env — emails will have no join link!")

    if args.morning:
        blast("morning", args.dry_run)
    if args.hour_before:
        blast("hour-before", args.dry_run)
    if args.final:
        blast("final", args.dry_run)

if __name__ == "__main__":
    main()

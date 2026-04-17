#!/usr/bin/env python3
"""
post_event_followup.py — Post-event attendance follow-up
─────────────────────────────────────────────────────────
Run this AFTER the webinar ends.
Pulls Zoom attendance data, cross-references with leads DB,
and sends personalised follow-up emails + WhatsApp to 3 groups:

  1. Attended   — registered AND showed up
  2. No-show    — registered but didn't show up
  3. Direct     — joined without registering (Zoom-only attendees)

Before running, set in responder.env:
  REPLAY_LINK       — Zoom recording URL (available ~1hr after event ends)
  CONSULTATION_LINK — already set (Discovery Consultation booking)
  PROGRAMME_LINK    — already set (Blood Sugar Balance Programme booking)

Usage:
  python3 post_event_followup.py             # send all follow-ups
  python3 post_event_followup.py --dry-run   # preview without sending
  python3 post_event_followup.py --report    # just print the attendance report
"""

import os, sys, sqlite3, smtplib, argparse, logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path

import requests
from dotenv import load_dotenv

# ── Load event-specific env BEFORE any os.getenv() calls ─────────────────────
BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))
from event_utils import early_load_event, EVENT_SLUG
early_load_event()

SMTP_HOST  = os.getenv("SMTP_HOST",  "smtp.gmail.com")
SMTP_PORT  = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER  = os.getenv("SMTP_USER")
SMTP_PASS  = os.getenv("SMTP_PASS")
FROM_NAME  = os.getenv("FROM_NAME",  "Shivani Hari")
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USER or "")
AISENSY_KEY  = os.getenv("AISENSY_API_KEY", "")
DB_PATH = BASE / "leads.db"

# ── Event + offer config (all from env — set by setup_event.py) ───────────────
WEBINAR_NAME   = os.getenv("WEBINAR_NAME",   "Balance Your Blood Sugar Naturally")
COACH_NAME     = os.getenv("COACH_NAME",     "Shivani Hari")
COACH_TITLE    = os.getenv("COACH_TITLE",    "Functional Health Coach")
IG_HANDLE      = os.getenv("INSTAGRAM_HANDLE", "@healwithshivanih")
IG_URL         = os.getenv("INSTAGRAM_URL",  "https://instagram.com/healwithshivanih")

# Set REPLAY_LINK in responder.env after the event before running this script
REPLAY_LINK    = os.getenv("REPLAY_LINK", "")

# Wix booking links (set by setup_event.py from event.yaml)
CONSULTATION_LINK  = os.getenv("CONSULTATION_LINK",
                                "https://www.theochretree.com/book-online/discovery-call")
PROGRAMME_LINK     = os.getenv("PROGRAMME_LINK",
                                "https://www.theochretree.com/book-online/blood-sugar-balance-programme")

# Offer details
CONSULT_NAME    = os.getenv("CONSULTATION_NAME",    "Discovery Consultation")
CONSULT_PRICE   = os.getenv("CONSULTATION_PRICE",   "₹6,500")
CONSULT_DUR     = os.getenv("CONSULTATION_DURATION", "30 minutes")
CONSULT_DAYS    = os.getenv("CONSULTATION_CREDIT_DAYS", "7")

PROG_NAME       = os.getenv("PROGRAMME_NAME",                 "Blood Sugar Balance Programme")
PROG_PRICE      = os.getenv("PROGRAMME_PRICE",                "₹31,000")
PROG_PRICE_PC   = os.getenv("PROGRAMME_PRICE_POST_CONSULT",   "₹24,500")
PROG_DUR        = os.getenv("PROGRAMME_DURATION",             "12 weeks")

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-7s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("post_event")

# ── Shared HTML helpers ───────────────────────────────────────────────────────
def _btn(url, label, color="#0d3d22"):
    return (f'<a href="{url}" style="background:{color};color:#fff;padding:14px 32px;'
            f'border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">'
            f'{label}</a>')

def _offer_block():
    """Two-offer CTA block: Discovery Consultation + Blood Sugar Balance Programme."""
    consult_btn   = _btn(CONSULTATION_LINK, f"Book {CONSULT_NAME} →")
    programme_btn = _btn(PROGRAMME_LINK,    f"Enrol in {PROG_NAME} →", "#166534")
    return f"""
<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin:20px 0">
  <p style="margin:0 0 4px;font-weight:800;color:#0d3d22;font-size:15px">🩺 {CONSULT_NAME}</p>
  <p style="margin:0 0 12px;color:#374151;font-weight:600">{CONSULT_PRICE} · {CONSULT_DUR} · Zoom</p>
  <p style="margin:0 0 16px;color:#6b7280;font-size:14px">Not sure where to start? In 30 focused minutes we'll go through your symptoms and I'll give you a personalised list of blood markers to test. Your {CONSULT_PRICE} is fully credited toward the programme if you enrol within {CONSULT_DAYS} days.</p>
  <div style="text-align:center">{consult_btn}</div>
</div>
<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin:20px 0">
  <p style="margin:0 0 4px;font-weight:800;color:#166534;font-size:15px">🌿 {PROG_NAME}</p>
  <p style="margin:0 0 4px;color:#374151;font-weight:600">{PROG_PRICE} · {PROG_DUR} · 1:1 with me</p>
  <p style="margin:0 0 12px;color:#6b7280;font-size:13px">({PROG_PRICE_PC} if you've done the {CONSULT_NAME})</p>
  <p style="margin:0 0 16px;color:#6b7280;font-size:14px">The full programme built around your body and your Indian lifestyle — meal framework, supplements, WhatsApp support, and a long-term maintenance plan. Payment in 2 instalments available on request.</p>
  <div style="text-align:center">{programme_btn}</div>
</div>"""

def _signature():
    return (f'<p style="margin-top:32px">With warmth,<br>'
            f'<strong>{COACH_NAME}</strong><br>'
            f'<span style="color:#6b7280;font-size:13px">{COACH_TITLE} · '
            f'<a href="{IG_URL}" style="color:#6b7280">{IG_HANDLE}</a></span></p>')

# ── Email templates ───────────────────────────────────────────────────────────
def email_attended(name):
    first = name.split()[0] if name else "there"
    replay_section = (
        f'<p style="margin:20px 0"><strong>Want to watch it again?</strong> '
        f'<a href="{REPLAY_LINK}" style="color:#0d3d22;font-weight:600">Click here for the replay →</a></p>'
        if REPLAY_LINK else ""
    )
    subject = f"Thank you for joining today, {first}! 💚"
    html = f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
<div style="background:#0d3d22;padding:32px;text-align:center;border-radius:12px 12px 0 0">
  <p style="color:#22c55e;font-size:13px;font-weight:800;letter-spacing:3px;margin:0">THANK YOU FOR ATTENDING</p>
  <h1 style="color:#fff;margin:12px 0 0;font-size:24px">You showed up — and that matters 💚</h1>
</div>
<div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px">
  <p style="font-size:17px">Hi {first},</p>
  <p>Thank you so much for joining today's workshop on <strong>{WEBINAR_NAME}</strong>. I loved having you there!</p>
  <p>Here's a quick recap of what we covered:</p>
  <ul>
    <li>Why you crash after meals — the root cause most doctors miss</li>
    <li>The 3 everyday foods silently spiking your glucose</li>
    <li>The 7-day reset protocol to stabilise your energy naturally</li>
  </ul>
  {replay_section}
  <p style="font-size:16px;font-weight:700;margin-top:28px">Ready to take this further?</p>
  <p>Everything we covered today is a real foundation. But applying it to your specific body, your blood reports, and your Indian lifestyle — that's where the real transformation happens.</p>
  <p>Here are two ways to work with me directly:</p>
  {_offer_block()}
  <p style="color:#6b7280;font-size:13px;text-align:center;margin-top:8px">📌 Post-workshop rate is open for 48 hours. After that, standard pricing applies.</p>
  <p>If you have any questions, just reply to this email — I read every one.</p>
  {_signature()}
</div>
</body></html>"""
    return subject, html


def email_noshow(name):
    first = name.split()[0] if name else "there"
    replay_btn = (
        f'<div style="text-align:center;margin:24px 0">'
        f'{_btn(REPLAY_LINK, "Watch the Replay →", "#166534")}'
        f'</div>'
        if REPLAY_LINK else
        '<p style="color:#6b7280">(Recording will be available shortly — watch your inbox)</p>'
    )
    subject = f"We missed you today, {first} 💚"
    html = f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
<div style="background:#0d3d22;padding:32px;text-align:center;border-radius:12px 12px 0 0">
  <p style="color:#22c55e;font-size:13px;font-weight:800;letter-spacing:3px;margin:0">WE MISSED YOU</p>
  <h1 style="color:#fff;margin:12px 0 0;font-size:24px">Life happens — your health journey doesn't have to wait 💚</h1>
</div>
<div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px">
  <p style="font-size:17px">Hi {first},</p>
  <p>We missed you at today's <strong>{WEBINAR_NAME}</strong> workshop — I hope everything is okay!</p>
  <p>The good news: I've recorded the full session for you. Everything we covered — what blood glucose actually is, how insulin works, your blood markers, and the complete 7-day kickstart plan — is all in the recording.</p>
  {replay_btn}
  <p>In the workshop we covered:</p>
  <ul>
    <li>Why you crash after meals — the root cause most doctors miss</li>
    <li>The 3 everyday foods silently spiking your glucose</li>
    <li>A simple 7-day reset protocol — no medication needed</li>
  </ul>
  <p style="font-size:16px;font-weight:700;margin-top:28px">Once you've watched, here are two ways to take it further:</p>
  {_offer_block()}
  <p>Don't let this moment pass — your body is asking for attention. 🌿</p>
  {_signature()}
</div>
</body></html>"""
    return subject, html


def email_direct(name, email):
    first = name.split()[0] if name else "there"
    subject = f"Great to have you today, {first}! 💚"
    html = f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
<div style="background:#0d3d22;padding:32px;text-align:center;border-radius:12px 12px 0 0">
  <p style="color:#22c55e;font-size:13px;font-weight:800;letter-spacing:3px;margin:0">GREAT TO MEET YOU</p>
  <h1 style="color:#fff;margin:12px 0 0;font-size:24px">Thanks for joining today's workshop 💚</h1>
</div>
<div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px">
  <p style="font-size:17px">Hi {first},</p>
  <p>It was so lovely to have you in today's <strong>{WEBINAR_NAME}</strong> workshop!</p>
  <p>Since you joined directly, I wanted to make sure you're on my list for future sessions, resources, and tips.</p>
  <p>If you'd like to go deeper, here are two ways to work with me:</p>
  {_offer_block()}
  <p>Follow me on Instagram <a href="{IG_URL}" style="color:#0d3d22">{IG_HANDLE}</a> so you never miss a live session. 🌿</p>
  {_signature()}
</div>
</body></html>"""
    return subject, html


# ── WhatsApp templates ────────────────────────────────────────────────────────
def send_whatsapp_followup(phone, name, group):
    """Send post-event WhatsApp. group: attended | noshow | direct"""
    if not AISENSY_KEY or not phone:
        return False
    if not phone.startswith("+"):
        phone = "+91" + phone.lstrip("0")
    first = (name or "there").split()[0]
    link  = CONSULTATION_LINK or IG_URL

    camp_map = {
        "attended": os.getenv("AISENSY_ATTENDED_CAMP",  "webinar_attended"),
        "noshow":   os.getenv("AISENSY_NOSHOW_CAMP",    "webinar_noshow"),
        "direct":   os.getenv("AISENSY_ATTENDED_CAMP",  "webinar_attended"),
    }
    camp = camp_map.get(group, "webinar_attended")
    payload = {
        "apiKey":         AISENSY_KEY,
        "campaignName":   camp,
        "destination":    phone,
        "userName":       name or "",
        "templateParams": [first, link],
        "source":         f"post-event-{group}",
        "media":          {},
    }
    r = requests.post("https://backend.aisensy.com/campaign/t1/api/v2",
                      headers={"Content-Type": "application/json"},
                      json=payload, timeout=15)
    return r.ok

def send_email_followup(to_email, subject, html):
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

# ── Attendance categorisation ─────────────────────────────────────────────────
def categorise(dry_run=False, event_slug=""):
    from zoom_utils import get_registrants, get_attendees

    log.info("Fetching Zoom registrants…")
    registrants = get_registrants()
    log.info(f"  {len(registrants)} registrants found")

    log.info("Fetching Zoom attendance report…")
    attendees = get_attendees()
    log.info(f"  {len(attendees)} attendees found")

    con = sqlite3.connect(DB_PATH)
    try:
        if event_slug:
            db_leads = con.execute(
                "SELECT name, email, phone FROM leads WHERE event_slug=?", (event_slug,)
            ).fetchall()
        else:
            db_leads = con.execute("SELECT name, email, phone FROM leads").fetchall()
    finally:
        con.close()
    db_by_email = {r[1].lower(): {"name": r[0], "email": r[1], "phone": r[2]}
                   for r in db_leads if r[1]}

    attended_leads = []
    noshow_leads   = []
    direct_joiners = []

    for email_lower, lead in db_by_email.items():
        if email_lower in attendees or lead["name"].lower() in attendees:
            attended_leads.append(lead)
        else:
            noshow_leads.append(lead)

    for key, att in attendees.items():
        att_email = (att.get("user_email") or "").lower()
        att_name  = att.get("name", "")
        if att_email and att_email not in db_by_email:
            direct_joiners.append({
                "name":  att_name,
                "email": att.get("user_email", ""),
                "phone": "",
                "duration_min": att.get("duration", 0) // 60,
            })
        elif not att_email:
            log.info(f"  Guest joiner (no email): {att_name} — {att.get('duration',0)//60} min")

    return attended_leads, noshow_leads, direct_joiners

def report_only(event_slug=""):
    attended, noshow, direct = categorise(dry_run=True, event_slug=event_slug)
    print(f"\n{'='*55}")
    print(f"  POST-EVENT ATTENDANCE REPORT")
    print(f"  {WEBINAR_NAME}")
    print(f"{'='*55}")
    print(f"\n✅ ATTENDED ({len(attended)})")
    for l in attended:
        print(f"   {l['name']:<25} {l['email']}")
    print(f"\n❌ NO-SHOW ({len(noshow)})")
    for l in noshow:
        print(f"   {l['name']:<25} {l['email']}")
    print(f"\n👋 DIRECT JOINERS ({len(direct)})")
    for l in direct:
        print(f"   {l['name']:<25} {l['email'] or '(no email)'} — {l.get('duration_min',0)} min")
    print()
    if not REPLAY_LINK:
        print("⚠  REPLAY_LINK not set in responder.env — no-show emails will have no recording link")
    print()

def blast(dry_run=False, event_slug=""):
    attended, noshow, direct = categorise(dry_run, event_slug)
    total = len(attended) + len(noshow) + len(direct)
    log.info(f"\nSending follow-ups to {total} people"
             f" ({len(attended)} attended, {len(noshow)} no-show, {len(direct)} direct)"
             f"{' [DRY RUN]' if dry_run else ''}")

    for lead in attended:
        subject, html = email_attended(lead["name"])
        if dry_run:
            log.info(f"  [DRY RUN] ATTENDED: {lead['name']} | {lead['email']} | {lead['phone']}")
            continue
        if lead["email"]:
            send_email_followup(lead["email"], subject, html)
            log.info(f"  ✉  Attended email → {lead['email']}")
        if lead["phone"]:
            send_whatsapp_followup(lead["phone"], lead["name"], "attended")
            log.info(f"  📱 Attended WA → {lead['phone']}")

    for lead in noshow:
        subject, html = email_noshow(lead["name"])
        if dry_run:
            log.info(f"  [DRY RUN] NO-SHOW:  {lead['name']} | {lead['email']} | {lead['phone']}")
            continue
        if lead["email"]:
            send_email_followup(lead["email"], subject, html)
            log.info(f"  ✉  No-show email → {lead['email']}")
        if lead["phone"]:
            send_whatsapp_followup(lead["phone"], lead["name"], "noshow")
            log.info(f"  📱 No-show WA → {lead['phone']}")

    for lead in direct:
        subject, html = email_direct(lead["name"], lead["email"])
        if dry_run:
            log.info(f"  [DRY RUN] DIRECT:   {lead['name']} | {lead['email']}")
            continue
        if lead["email"]:
            send_email_followup(lead["email"], subject, html)
            log.info(f"  ✉  Direct email → {lead['email']}")

    if not dry_run:
        log.info("Done! Post-event follow-ups sent.")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Preview without sending")
    parser.add_argument("--report",  action="store_true", help="Print attendance report only")
    parser.add_argument("--event",   default=EVENT_SLUG,  help="Event slug (e.g. blood-sugar-apr26)")
    args = parser.parse_args()

    if args.report:
        report_only(args.event)
    else:
        blast(dry_run=args.dry_run, event_slug=args.event)

if __name__ == "__main__":
    main()

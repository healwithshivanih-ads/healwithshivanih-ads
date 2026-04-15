#!/usr/bin/env python3
"""
post_event_followup.py — Post-event attendance follow-up
─────────────────────────────────────────────────────────
Run this AFTER the 26 April webinar ends.
Pulls Zoom attendance data, cross-references with leads DB,
and sends personalised follow-up emails + WhatsApp to 3 groups:

  1. Attended   — registered AND showed up
  2. No-show    — registered but didn't show up
  3. Direct     — joined without registering (Zoom-only attendees)

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

BASE = Path(__file__).parent
load_dotenv(BASE / ".env")
load_dotenv(BASE / "responder.env")

SMTP_HOST  = os.getenv("SMTP_HOST",  "smtp.gmail.com")
SMTP_PORT  = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER  = os.getenv("SMTP_USER")
SMTP_PASS  = os.getenv("SMTP_PASS")
FROM_NAME  = os.getenv("FROM_NAME",  "Shivani Hari")
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USER or "")
AISENSY_KEY  = os.getenv("AISENSY_API_KEY", "")
DB_PATH = BASE / "leads.db"

# Update these before sending
REPLAY_LINK       = os.getenv("REPLAY_LINK", "")          # set after uploading replay
CONSULTATION_LINK = os.getenv("CONSULTATION_LINK", "")    # booking link e.g. Calendly

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s  %(levelname)-7s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("post_event")

# ── email templates ───────────────────────────────────────────────────────────

def email_attended(name):
    first = name.split()[0] if name else "there"
    consult = f'<a href="{CONSULTATION_LINK}" style="background:#0d3d22;color:#fff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Book Your Free Consultation →</a>' if CONSULTATION_LINK else '<p>(Consultation booking link coming soon)</p>'
    return f"Thank you for joining today, {first}! 💚", f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
<div style="background:#0d3d22;padding:32px;text-align:center;border-radius:12px 12px 0 0">
  <p style="color:#22c55e;font-size:13px;font-weight:800;letter-spacing:3px;margin:0">THANK YOU FOR ATTENDING</p>
  <h1 style="color:#fff;margin:12px 0 0;font-size:24px">You showed up — and that matters 💚</h1>
</div>
<div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px">
  <p style="font-size:17px">Hi {first},</p>
  <p>Thank you so much for joining today's workshop on <strong>Balancing Your Blood Sugar Naturally</strong>. I loved having you there!</p>
  <p>Here's a quick recap of what we covered:</p>
  <ul>
    <li>Why you crash after meals — the root cause most doctors miss</li>
    <li>The 3 everyday foods silently spiking your glucose</li>
    <li>The 7-day reset protocol to stabilise your energy naturally</li>
  </ul>
  {'<p><strong>Want to watch it again?</strong> <a href="' + REPLAY_LINK + '" style="color:#0d3d22">Click here for the replay →</a></p>' if REPLAY_LINK else ''}
  <div style="text-align:center;margin:32px 0">
    <p style="font-weight:700;font-size:16px">Ready to take this further?</p>
    <p>Book a free 30-minute consultation with me and let's look at your specific situation:</p>
    {consult}
  </div>
  <p>Thank you again for being part of this. You're already taking the right steps. 🌿</p>
  <p style="margin-top:32px">With love,<br>
  <strong>Shivani Hari</strong><br>
  <span style="color:#6b7280;font-size:13px">Functional Health Coach · @healwithshivanih</span></p>
</div>
</body></html>
"""

def email_noshow(name):
    first = name.split()[0] if name else "there"
    consult = f'<a href="{CONSULTATION_LINK}" style="background:#0d3d22;color:#fff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Book Your Free Consultation →</a>' if CONSULTATION_LINK else ''
    replay  = f'<a href="{REPLAY_LINK}" style="background:#166534;color:#fff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Watch the Replay →</a>' if REPLAY_LINK else ''
    return f"We missed you today, {first} 💚", f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
<div style="background:#0d3d22;padding:32px;text-align:center;border-radius:12px 12px 0 0">
  <p style="color:#22c55e;font-size:13px;font-weight:800;letter-spacing:3px;margin:0">WE MISSED YOU</p>
  <h1 style="color:#fff;margin:12px 0 0;font-size:24px">Life happens — your health journey doesn't have to wait 💚</h1>
</div>
<div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px">
  <p style="font-size:17px">Hi {first},</p>
  <p>We missed you at today's <strong>Balance Your Blood Sugar Naturally</strong> workshop — I hope everything is okay!</p>
  <p>The good news: you can still get everything we covered.</p>
  {'<div style="text-align:center;margin:24px 0">' + replay + '</div>' if replay else ''}
  <p>In the workshop we covered:</p>
  <ul>
    <li>Why you crash after meals — the root cause most doctors miss</li>
    <li>The 3 everyday foods silently spiking your glucose</li>
    <li>A simple 7-day reset protocol — no medication needed</li>
  </ul>
  {'<div style="text-align:center;margin:32px 0"><p style="font-weight:700">Or book a free consultation and we can go through it together:</p>' + consult + '</div>' if CONSULTATION_LINK else ''}
  <p>Don't let this moment pass — your body is asking for attention. 🌿</p>
  <p style="margin-top:32px">With care,<br>
  <strong>Shivani Hari</strong><br>
  <span style="color:#6b7280;font-size:13px">Functional Health Coach · @healwithshivanih</span></p>
</div>
</body></html>
"""

def email_direct(name, email):
    first = name.split()[0] if name else "there"
    consult = f'<a href="{CONSULTATION_LINK}" style="background:#0d3d22;color:#fff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;display:inline-block">Book a Free Consultation →</a>' if CONSULTATION_LINK else ''
    return f"Great to have you today, {first}! 💚", f"""
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;color:#1a1a1a">
<div style="background:#0d3d22;padding:32px;text-align:center;border-radius:12px 12px 0 0">
  <p style="color:#22c55e;font-size:13px;font-weight:800;letter-spacing:3px;margin:0">GREAT TO MEET YOU</p>
  <h1 style="color:#fff;margin:12px 0 0;font-size:24px">Thanks for joining today's workshop 💚</h1>
</div>
<div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px">
  <p style="font-size:17px">Hi {first},</p>
  <p>It was so lovely to have you in today's <strong>Balance Your Blood Sugar Naturally</strong> workshop!</p>
  <p>Since you joined directly, I wanted to make sure you're on my list for future sessions, resources, and tips.</p>
  {'<div style="text-align:center;margin:32px 0"><p style="font-weight:700">Want to go deeper? Let\'s chat:</p>' + consult + '</div>' if CONSULTATION_LINK else ''}
  <p>Follow me on Instagram <a href="https://instagram.com/healwithshivanih" style="color:#0d3d22">@healwithshivanih</a> so you never miss a live session. 🌿</p>
  <p style="margin-top:32px">With love,<br>
  <strong>Shivani Hari</strong><br>
  <span style="color:#6b7280;font-size:13px">Functional Health Coach · @healwithshivanih</span></p>
</div>
</body></html>
"""

# ── WhatsApp templates ────────────────────────────────────────────────────────
def send_whatsapp_followup(phone, name, group):
    """Send post-event WhatsApp. group: attended | noshow | direct"""
    if not AISENSY_KEY or not phone:
        return False
    if not phone.startswith("+"):
        phone = "+91" + phone.lstrip("0")
    first = (name or "there").split()[0]
    link  = CONSULTATION_LINK or REPLAY_LINK or "https://instagram.com/healwithshivanih"

    camp_map = {
        "attended": os.getenv("AISENSY_ATTENDED_CAMP",  "webinar_attended"),
        "noshow":   os.getenv("AISENSY_NOSHOW_CAMP",    "webinar_noshow"),
        "direct":   os.getenv("AISENSY_DIRECT_CAMP",    "webinar_attended"),  # reuse attended
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

# ── attendance categorisation ─────────────────────────────────────────────────
def categorise(dry_run=False):
    from zoom_utils import get_registrants, get_attendees

    log.info("Fetching Zoom registrants…")
    registrants = get_registrants()   # {email: data}
    log.info(f"  {len(registrants)} registrants found")

    log.info("Fetching Zoom attendance report…")
    attendees = get_attendees()       # {email_or_name: data}
    log.info(f"  {len(attendees)} attendees found")

    # Load our leads DB
    con = sqlite3.connect(DB_PATH)
    try:
        db_leads = con.execute(
            "SELECT name, email, phone FROM leads"
        ).fetchall()
    finally:
        con.close()
    db_by_email = {r[1].lower(): {"name": r[0], "email": r[1], "phone": r[2]}
                   for r in db_leads if r[1]}

    attended_leads  = []
    noshow_leads    = []
    direct_joiners  = []

    # Check our registered leads
    for email_lower, lead in db_by_email.items():
        if email_lower in attendees or lead["name"].lower() in attendees:
            attended_leads.append(lead)
        else:
            noshow_leads.append(lead)

    # Direct joiners — in Zoom attendance but NOT in our DB
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
            # Guest with no email — can't reach them
            log.info(f"  Guest joiner (no email): {att_name} — {att.get('duration',0)//60} min")

    return attended_leads, noshow_leads, direct_joiners

def report_only():
    attended, noshow, direct = categorise(dry_run=True)
    print(f"\n{'='*55}")
    print(f"  POST-EVENT ATTENDANCE REPORT — 26 April 2026")
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

def blast(dry_run=False):
    attended, noshow, direct = categorise(dry_run)

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
        # No WhatsApp for direct joiners — no phone number available

    if not dry_run:
        log.info("Done! Post-event follow-ups sent.")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Preview without sending")
    parser.add_argument("--report",  action="store_true", help="Print attendance report only")
    args = parser.parse_args()

    if args.report:
        report_only()
    else:
        blast(dry_run=args.dry_run)

if __name__ == "__main__":
    main()

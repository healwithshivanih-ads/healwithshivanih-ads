#!/usr/bin/env python3
"""
setup_event.py — Set up a new event or update an existing one
──────────────────────────────────────────────────────────────
Usage:
  python3 setup_event.py blood-sugar-apr26          # full setup
  python3 setup_event.py blood-sugar-apr26 --dry-run
  python3 setup_event.py blood-sugar-apr26 --no-zoom
  python3 setup_event.py blood-sugar-apr26 --checklist
  python3 setup_event.py --list                      # list all events

What it does:
  1. Reads events/{slug}/event.yaml
  2. Writes events/{slug}/event.env   (committed to repo — no secrets)
  3. Generates .github/workflows/reminders-{slug}.yml
  4. Creates a new Zoom meeting and writes WEBINAR_LINK to event.env
  5. Prints a setup checklist
"""

import os, sys, re, argparse, logging
from pathlib import Path
from datetime import datetime, timedelta

try:
    import yaml
except ImportError:
    print("Missing: pip install pyyaml")
    sys.exit(1)

BASE = Path(__file__).parent
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("setup")


# ── Config loading ────────────────────────────────────────────────────────────
def load_event(slug: str) -> dict:
    path = BASE / "events" / slug / "event.yaml"
    if not path.exists():
        log.error(f"events/{slug}/event.yaml not found.")
        log.error(f"Create the folder and file first:\n  mkdir -p events/{slug}\n  cp event.yaml events/{slug}/event.yaml")
        sys.exit(1)
    with open(path) as f:
        cfg = yaml.safe_load(f)
    cfg["_slug"] = slug
    required = ["event_name", "event_date_iso", "event_time_ist",
                "event_time_utc_hour", "event_time_utc_minute"]
    missing = [k for k in required if cfg.get(k) is None]
    if missing:
        log.error(f"event.yaml is missing: {', '.join(missing)}")
        sys.exit(1)
    return cfg


# ── Write event.env ───────────────────────────────────────────────────────────
def write_event_env(cfg: dict, dry_run=False) -> dict:
    """Write events/{slug}/event.env — event-specific vars only, no credentials."""
    slug     = cfg["_slug"]
    env_path = BASE / "events" / slug / "event.env"

    vars_ = {
        "EVENT_SLUG":                   slug,
        "WEBINAR_NAME":                 cfg["event_name"],
        "WEBINAR_TAGLINE":              cfg.get("event_tagline", "Free Live Workshop"),
        "WEBINAR_DATE":                 cfg["event_date_display"],
        "WEBINAR_TIME":                 cfg["event_time_ist"],
        "WEBINAR_DATE_ISO":             cfg["event_date_iso"],
        "WEBINAR_BULLET_1":             cfg.get("bullet_1", ""),
        "WEBINAR_BULLET_2":             cfg.get("bullet_2", ""),
        "WEBINAR_BULLET_3":             cfg.get("bullet_3", ""),
        "CONSULTATION_NAME":            cfg.get("consultation_name",    "Discovery Consultation"),
        "CONSULTATION_PRICE":           cfg.get("consultation_price",   "₹6,500"),
        "CONSULTATION_DURATION":        cfg.get("consultation_duration","30 minutes"),
        "CONSULTATION_LINK":            cfg.get("consultation_booking_url", ""),
        "CONSULTATION_CREDIT_DAYS":     str(cfg.get("consultation_credit_days", 7)),
        "PROGRAMME_NAME":               cfg.get("programme_name",       "Blood Sugar Balance Programme"),
        "PROGRAMME_PRICE":              cfg.get("programme_price",      "₹31,000"),
        "PROGRAMME_PRICE_POST_CONSULT": cfg.get("programme_price_post_consult", "₹24,500"),
        "PROGRAMME_DURATION":           cfg.get("programme_duration",   "12 weeks"),
        "PROGRAMME_LINK":               cfg.get("programme_booking_url", ""),
        "COACH_NAME":                   cfg.get("coach_name",    "Shivani Hari"),
        "COACH_TITLE":                  cfg.get("coach_title",   "Functional Health Coach"),
        "BRAND_NAME":                   cfg.get("brand_name",    ""),
        "INSTAGRAM_HANDLE":             cfg.get("instagram_handle", "@healwithshivanih"),
        "INSTAGRAM_URL":                cfg.get("instagram_url",    "https://instagram.com/healwithshivanih"),
        "AISENSY_CAMPAIGN":             cfg.get("aisensy_campaign_confirmation", "webinar_confirmation"),
        "AISENSY_REMINDER_CAMP":        cfg.get("aisensy_campaign_reminder",     "webinar_reminder"),
        "AISENSY_FINAL_CAMP":           cfg.get("aisensy_campaign_final",        "webinar_starting_now"),
        "AISENSY_ATTENDED_CAMP":        cfg.get("aisensy_campaign_attended",     "webinar_attended"),
        "AISENSY_NOSHOW_CAMP":          cfg.get("aisensy_campaign_noshow",       "webinar_noshow"),
        "LEAD_FORM_ID":                 str(cfg.get("meta_lead_form_id", "")),
        "GOOGLE_SHEET_CSV_URL":         cfg.get("google_sheet_csv_url", ""),
        "GOOGLE_FORM_ID":               cfg.get("google_form_template_id", ""),
        "GOOGLE_SHEET_ID":              cfg.get("google_sheet_id", ""),
        "REPLAY_LINK":                  cfg.get("replay_link", ""),
        # WEBINAR_LINK, WIX_EVENT_ID, GOOGLE_FORM_ID, GOOGLE_SHEET_ID
        # are overwritten after external service creation steps run
    }

    if dry_run:
        log.info(f"[DRY RUN] Would write events/{slug}/event.env ({len(vars_)} vars)")
        return vars_

    lines = [f"# Auto-generated by setup_event.py — do not edit directly",
             f"# Source: events/{slug}/event.yaml", ""]
    for k, v in vars_.items():
        lines.append(f"{k}={v}")

    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.write_text("\n".join(lines) + "\n")
    log.info(f"✅ events/{slug}/event.env written ({len(vars_)} vars)")
    return vars_


# ── Generate per-event reminder workflow ──────────────────────────────────────
def generate_reminder_workflow(cfg: dict, dry_run=False):
    slug     = cfg["_slug"]
    name     = cfg["event_name"]
    date_iso = cfg["event_date_iso"]

    try:
        dt = datetime.fromisoformat(date_iso)
    except ValueError:
        log.error(f"Invalid event_date_iso: {date_iso}")
        return

    day, month = dt.day, dt.month
    utc_h = int(cfg["event_time_utc_hour"])
    utc_m = int(cfg["event_time_utc_minute"])

    cron_morning     = f"30 2 {day} {month} *"        # 8 AM IST = 2:30 UTC
    cron_hour_before = f"{utc_m} {(utc_h-1)%24} {day} {month} *"
    cron_final       = f"{(utc_m-1)%60} {utc_h if utc_m > 0 else (utc_h-1)%24} {day} {month} *"

    # Credentials block — same across all events
    creds_block = """\
      - name: Write .env
        run: |
          cat > .env << 'ENVEOF'
          META_APP_ID=${{ secrets.META_APP_ID }}
          META_APP_SECRET=${{ secrets.META_APP_SECRET }}
          META_ACCESS_TOKEN=${{ secrets.META_ACCESS_TOKEN }}
          META_AD_ACCOUNT_ID=${{ secrets.META_AD_ACCOUNT_ID }}
          ENVEOF

      - name: Write responder.env
        run: |
          cat > responder.env << 'ENVEOF'
          META_ACCESS_TOKEN=${{ secrets.META_ACCESS_TOKEN }}
          SMTP_HOST=${{ secrets.SMTP_HOST }}
          SMTP_PORT=${{ secrets.SMTP_PORT }}
          SMTP_USER=${{ secrets.SMTP_USER }}
          SMTP_PASS=${{ secrets.SMTP_PASS }}
          FROM_EMAIL=${{ secrets.FROM_EMAIL }}
          FROM_NAME=${{ secrets.FROM_NAME }}
          WA_PROVIDER=${{ secrets.WA_PROVIDER }}
          AISENSY_API_KEY=${{ secrets.AISENSY_API_KEY }}
          WIX_API_KEY=${{ secrets.WIX_API_KEY }}
          WIX_SITE_ID=${{ secrets.WIX_SITE_ID }}
          META_WA_PHONE_ID=${{ secrets.META_WA_PHONE_ID }}
          META_WA_TEMPLATE=${{ secrets.META_WA_TEMPLATE }}
          ENVEOF"""

    content = f"""\
name: Reminders — {slug}

on:
  schedule:
    # Morning reminder — 8:00 AM IST = 2:30 UTC
    - cron: '{cron_morning}'
    # 1 hour before
    - cron: '{cron_hour_before}'
    # Starting now
    - cron: '{cron_final}'
  workflow_dispatch:
    inputs:
      reminder_type:
        description: 'Reminder type'
        required: true
        type: choice
        options: [morning, hour-before, final]
        default: morning
      dry_run:
        description: 'Dry run (no messages sent)'
        type: boolean
        default: false

jobs:
  send:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Restore leads.db
        uses: actions/cache@v4
        with:
          path: leads.db
          key: leads-db-${{{{ github.run_id }}}}
          restore-keys: leads-db-

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'

      - run: pip install -r requirements.txt

{creds_block}

      - name: Determine reminder type
        id: type
        run: |
          HOUR=$(date -u +%-H)
          if [ "${{{{ github.event_name }}}}" = "workflow_dispatch" ]; then
            echo "mode=${{{{ inputs.reminder_type }}}}" >> $GITHUB_OUTPUT
            echo "dry=${{{{ inputs.dry_run }}}}" >> $GITHUB_OUTPUT
          elif [ "$HOUR" = "2" ]; then
            echo "mode=morning" >> $GITHUB_OUTPUT && echo "dry=false" >> $GITHUB_OUTPUT
          elif [ "$HOUR" = "{(utc_h-1)%24}" ]; then
            echo "mode=hour-before" >> $GITHUB_OUTPUT && echo "dry=false" >> $GITHUB_OUTPUT
          else
            echo "mode=final" >> $GITHUB_OUTPUT && echo "dry=false" >> $GITHUB_OUTPUT
          fi

      - name: Send reminders
        run: |
          FLAGS="--${{{{ steps.type.outputs.mode }}}}"
          [ "${{{{ steps.type.outputs.dry }}}}" = "true" ] && FLAGS="$FLAGS --dry-run"
          python send_reminders.py $FLAGS --event {slug}
"""

    out_path = BASE / ".github" / "workflows" / f"reminders-{slug}.yml"
    if dry_run:
        log.info(f"[DRY RUN] Would write {out_path.name}")
        return

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content)
    log.info(f"✅ .github/workflows/reminders-{slug}.yml generated")


# ── Zoom meeting creation ─────────────────────────────────────────────────────
def create_zoom(cfg: dict, dry_run=False):
    slug      = cfg["_slug"]
    date_iso  = cfg["event_date_iso"]
    utc_h     = int(cfg["event_time_utc_hour"])
    utc_m     = int(cfg["event_time_utc_minute"])
    start_time = f"{date_iso}T{utc_h:02d}:{utc_m:02d}:00Z"

    log.info(f"Creating Zoom meeting: {cfg['event_name']} at {start_time}")
    if dry_run:
        log.info("[DRY RUN] Would create Zoom meeting")
        return

    try:
        # Load base creds for Zoom (they're in responder.env, not event.env)
        from dotenv import load_dotenv
        load_dotenv(BASE / "responder.env")
        from create_zoom_webinar import create_meeting
        join_url = create_meeting(cfg["event_name"], start_time)
        if join_url:
            log.info(f"✅ Zoom meeting created: {join_url}")
            # Append WEBINAR_LINK to event.env
            env_path = BASE / "events" / slug / "event.env"
            content  = env_path.read_text() if env_path.exists() else ""
            if "WEBINAR_LINK=" in content:
                content = re.sub(r"WEBINAR_LINK=.*", f"WEBINAR_LINK={join_url}", content)
            else:
                content += f"\nWEBINAR_LINK={join_url}\n"
            env_path.write_text(content)
        else:
            log.warning("Zoom returned no URL — set WEBINAR_LINK manually in event.env")
    except Exception as e:
        log.error(f"Zoom creation failed: {e}")
        log.warning(f"Set WEBINAR_LINK manually in events/{slug}/event.env")


# ── Service pricing prompt ────────────────────────────────────────────────────
def ask_service_preference(cfg: dict) -> dict:
    """Interactively confirm whether to reuse existing services or create new ones.
    Returns cfg, potentially updated with new prices/URLs."""
    consult_price  = cfg.get("consultation_price",        "₹6,500")
    consult_url    = cfg.get("consultation_booking_url",  "https://www.theochretree.com/book-online/discovery-call")
    prog_price     = cfg.get("programme_price",           "₹31,000")
    prog_url       = cfg.get("programme_booking_url",     "https://www.theochretree.com/book-online/blood-sugar-balance-programme")
    slug           = cfg["_slug"]

    print(f"""
┌──────────────────────────────────────────────────────────────┐
│  SERVICES & PRICING — {slug:<39}│
└──────────────────────────────────────────────────────────────┘

Current follow-up offer links for this event:

  Discovery Consultation : {consult_price} · 30 min
    {consult_url}?ref={slug}

  Blood Sugar Balance Programme : {prog_price}  (₹{_strip_price(prog_price) - 6500:,} post-consult)
    {prog_url}?ref={slug}

Options:
  [1] Keep existing services + tag with ?ref={slug}  (recommended)
  [2] Use different pricing for this event
  [3] Skip — I'll update event.yaml manually
""")

    choice = input("Your choice [1/2/3]: ").strip() or "1"

    if choice == "2":
        print("\nEnter new values (press Enter to keep existing):\n")

        new_cp = input(f"  Discovery Consultation price [{consult_price}]: ").strip()
        if new_cp:
            cfg["consultation_price"] = new_cp

        new_cu = input(f"  Discovery Consultation booking URL [{consult_url}]: ").strip()
        if new_cu:
            cfg["consultation_booking_url"] = new_cu

        new_pp = input(f"  Programme price [{prog_price}]: ").strip()
        if new_pp:
            cfg["programme_price"] = new_pp

        new_pc = input(f"  Programme price post-consult [auto]: ").strip()
        if new_pc:
            cfg["programme_price_post_consult"] = new_pc

        new_pu = input(f"  Programme booking URL [{prog_url}]: ").strip()
        if new_pu:
            cfg["programme_booking_url"] = new_pu

        print("\n✅ Updated pricing noted — will be written to event.env")

    elif choice == "3":
        log.info("Skipping service check — update event.yaml and re-run to regenerate event.env")

    # Always append ?ref={slug} to booking URLs so Wix analytics can track per-event
    for key in ("consultation_booking_url", "programme_booking_url"):
        url = cfg.get(key, "")
        if url and "?" not in url:
            cfg[key] = f"{url}?ref={slug}"
        elif url and f"ref={slug}" not in url:
            cfg[key] = f"{url}&ref={slug}"

    return cfg


def _strip_price(price_str: str) -> int:
    """Extract integer from price string like '₹31,000' → 31000."""
    import re
    digits = re.sub(r"[^\d]", "", price_str)
    return int(digits) if digits else 0


# ── Wix Event creation ────────────────────────────────────────────────────────
def create_wix_event(cfg: dict, dry_run=False):
    """Create a Wix Event listing on theochretree.com for this event.
    Stores WIX_EVENT_ID in events/{slug}/event.env."""
    slug      = cfg["_slug"]
    date_iso  = cfg["event_date_iso"]
    utc_h     = int(cfg["event_time_utc_hour"])
    utc_m     = int(cfg["event_time_utc_minute"])
    name      = cfg["event_name"]
    tagline   = cfg.get("event_tagline", "Free Live Workshop")
    ist_time  = cfg.get("event_time_ist", "6:00 PM IST")

    start_dt  = f"{date_iso}T{utc_h:02d}:{utc_m:02d}:00Z"
    # Default 90 min duration
    from datetime import datetime as _dt, timezone as _tz
    start     = _dt.fromisoformat(start_dt.replace("Z", "+00:00"))
    end_dt    = (start + timedelta(minutes=90)).strftime("%Y-%m-%dT%H:%M:%SZ")

    log.info(f"Creating Wix Event: {name}")
    if dry_run:
        log.info("[DRY RUN] Would create Wix Event")
        return

    try:
        from dotenv import load_dotenv
        load_dotenv(BASE / "responder.env")
        wix_key     = os.getenv("WIX_API_KEY", "")
        wix_site_id = os.getenv("WIX_SITE_ID", "8cfa772f-403b-473c-b756-4ad1e55e2465")

        if not wix_key:
            log.warning("WIX_API_KEY not set in responder.env — skipping Wix Event creation")
            log.warning(f"Set WIX_EVENT_ID manually in events/{slug}/event.env after creating via Wix dashboard")
            return

        headers = {
            "Authorization": wix_key,
            "wix-site-id":   wix_site_id,
            "Content-Type":  "application/json",
        }

        payload = {
            "event": {
                "title":            name,
                "shortDescription": tagline,
                "location": {
                    "name": "Online — Zoom",
                    "type": "ONLINE",
                },
                "dateAndTimeSettings": {
                    "startDate":  start_dt,
                    "endDate":    end_dt,
                    "timeZoneId": "Asia/Kolkata",
                },
                "registration": {
                    "initialType": "RSVP",
                    "rsvp": {"responseType": "YES_ONLY"},
                },
                "onlineConferencing": {
                    "enabled": True,
                    "type":    "WEBINAR",
                },
            },
            "fields": ["DETAILS", "TEXTS", "REGISTRATION", "URLS"],
        }

        import requests as _req
        r = _req.post(
            "https://www.wixapis.com/events/v3/events",
            headers=headers,
            json=payload,
            timeout=30,
        )

        if not r.ok:
            log.error(f"Wix Event creation failed {r.status_code}: {r.text[:300]}")
            log.warning(f"Create the event manually in Wix dashboard and add WIX_EVENT_ID to events/{slug}/event.env")
            return

        event_data = r.json().get("event", {})
        event_id   = event_data.get("id", "")
        event_url  = event_data.get("eventPageUrl", {}).get("base", "") + event_data.get("eventPageUrl", {}).get("path", "")

        if event_id:
            log.info(f"✅ Wix Event created: {event_id}")
            if event_url:
                log.info(f"   Event page: {event_url}")

            env_path = BASE / "events" / slug / "event.env"
            content  = env_path.read_text() if env_path.exists() else ""
            if "WIX_EVENT_ID=" in content:
                content = re.sub(r"WIX_EVENT_ID=.*", f"WIX_EVENT_ID={event_id}", content)
            else:
                content += f"\nWIX_EVENT_ID={event_id}\n"
            if event_url and "WIX_EVENT_URL=" not in content:
                content += f"WIX_EVENT_URL={event_url}\n"
            env_path.write_text(content)
            log.info(f"   WIX_EVENT_ID written to events/{slug}/event.env")
        else:
            log.warning("Wix returned no event ID — check Wix dashboard and set WIX_EVENT_ID manually")

    except Exception as e:
        log.error(f"Wix Event creation failed: {e}")
        log.warning(f"Create manually in Wix dashboard and add WIX_EVENT_ID to events/{slug}/event.env")


# ── Google Form + Sheet creation ──────────────────────────────────────────────
def _sa_email(sa_path: Path) -> str:
    """Extract the service account email from the JSON key file."""
    import json
    try:
        return json.loads(sa_path.read_text()).get("client_email", "")
    except Exception:
        return ""


def create_google_form(cfg: dict, dry_run=False):
    """Print setup instructions for the Google Form + Sheet for this event.

    Service accounts can READ sheets shared with them but cannot CREATE Drive
    files (no storage quota). So form/sheet creation stays with the user's
    Google account, and our poller reads the sheet via the service account.

    If google_form_template_id is set in event.yaml, the template can be
    duplicated manually (File → Make a copy) to reuse questions instantly.
    """
    slug        = cfg["_slug"]
    name        = cfg["event_name"]
    date_str    = cfg.get("event_date_display", cfg.get("event_date_iso", ""))
    time_str    = cfg.get("event_time_ist", "")
    template_id = cfg.get("google_form_template_id", "").strip()

    from dotenv import load_dotenv
    load_dotenv(BASE / "responder.env")
    sa_file   = BASE / os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "google_service_account.json")
    sa_email  = _sa_email(sa_file) if sa_file.exists() else "meta-ads-bot@...iam.gserviceaccount.com"

    form_title  = f"Register: {name} — {date_str}"
    sheet_title = f"Responses — {name} ({date_str})"
    new_form_url = f"https://docs.google.com/forms/create?title={form_title.replace(' ', '+')}"

    if dry_run:
        log.info("[DRY RUN] Would print Google Form setup instructions")
        return

    if template_id:
        form_step = (
            f"  a. Open your template form:\n"
            f"       https://docs.google.com/forms/d/{template_id}/edit\n"
            f"  b. Click ⋮ (top right) → Make a copy\n"
            f"  c. Name it:  {form_title}\n"
            f"  d. Update the title/date in the form header if needed"
        )
    else:
        form_step = (
            f"  a. Create a new form: {new_form_url}\n"
            f"  b. Add these 4 questions (Short answer; all required except last):\n"
            f"       1. Full Name\n"
            f"       2. Email ID:\n"
            f"       3. Whatsapp Phone Number\n"
            f"       4. What's your biggest energy or blood sugar challenge right now?\n"
            f"  c. Save this form ID in event.yaml as  google_form_template_id\n"
            f"     so future events can auto-copy it"
        )

    print(f"""
╔══════════════════════════════════════════════════════════════════════╗
║  GOOGLE FORM SETUP — 4 steps, ~3 minutes                            ║
╚══════════════════════════════════════════════════════════════════════╝

  STEP 1 — Create the Form in your Google account
{form_step}

  STEP 2 — Create the response Sheet
  a. Go to sheets.google.com → Blank spreadsheet
  b. Name it:  {sheet_title}

  STEP 3 — Link form → sheet
  a. In the Form → click  Responses  tab
  b. Click the green Sheets icon → Select existing spreadsheet
  c. Pick:  {sheet_title}

  STEP 4 — Share the Sheet with the automation bot (so our poller can read it)
  a. In the Sheet → click Share
  b. Add:  {sa_email}  (Viewer is enough)
  c. Copy the Sheet ID from the URL:
       docs.google.com/spreadsheets/d/{{SHEET_ID}}/edit
  d. Add to events/{slug}/event.yaml:
       google_sheet_id: "{{SHEET_ID}}"
  e. Re-run:  python3 setup_event.py {slug} --no-zoom --no-wix --no-gform

  Once done, our poller reads new sign-ups every 10 min via the service account.
""")


# ── Checklist ─────────────────────────────────────────────────────────────────
def print_checklist(cfg: dict):
    slug  = cfg["_slug"]
    name  = cfg["event_name"]
    date  = cfg.get("event_date_display", cfg.get("event_date_iso", ""))
    time_ = cfg.get("event_time_ist", "")

    print(f"""
╔══════════════════════════════════════════════════════════════╗
║  SETUP CHECKLIST — {slug:<42} ║
╚══════════════════════════════════════════════════════════════╝

EVENT:  {name}
SLUG:   {slug}
DATE:   {date} at {time_}

AUTOMATED ✅ (done by setup_event.py)
──────────────────────────────────────────────────────────────
  ✅  events/{slug}/event.env — {cfg.get("_var_count", "all")} event vars written
  ✅  .github/workflows/reminders-{slug}.yml — cron schedules set
  ✅  Zoom meeting created (WEBINAR_LINK in event.env)
  ✅  Wix Event created (WIX_EVENT_ID in event.env)
  ✅  Google Form + Sheet created (GOOGLE_FORM_ID + GOOGLE_SHEET_ID in event.env)

MANUAL STEPS (do these before the event)
──────────────────────────────────────────────────────────────

  1. WIX EVENT PAGE
     □  Open WIX_EVENT_URL (printed above) and review the event page
     □  Add cover image, full description, and any event details
     □  Note: Wix sends its own RSVP confirmation email — our system sends WhatsApp only for Wix registrants

  2. META ADS
     □  Update ad creatives and copy for this event's topic
     □  Set campaign spend cap in Meta Ads Manager

  2. WHATSAPP TEMPLATES (AiSensy dashboard)
     □  Confirm these campaigns exist and are approved:
          - {cfg.get("aisensy_campaign_confirmation", "webinar_confirmation")}
          - {cfg.get("aisensy_campaign_reminder", "webinar_reminder")}
          - {cfg.get("aisensy_campaign_final", "webinar_starting_now")}
          - {cfg.get("aisensy_campaign_attended", "webinar_attended")}
          - {cfg.get("aisensy_campaign_noshow", "webinar_noshow")}

  3. GOOGLE FORM  (see instructions printed above ↑)
     □  Open the form link and link it to the sheet (1 click, Responses tab)
     □  Optionally customise the form banner image / colour in Google Forms

  4. GITHUB
     □  git add events/{slug}/ .github/workflows/reminders-{slug}.yml
     □  git commit -m "Add event: {slug}"
     □  git push
     □  Confirm reminders-{slug} workflow is enabled in GitHub Actions

  5. TEST (day before the event)
     □  Run: EVENT_SLUG={slug} python3 send_reminders.py --morning --dry-run
     □  Run: EVENT_SLUG={slug} python3 send_reminders.py --hour-before --dry-run

  6. AFTER THE EVENT
     □  Get Zoom recording URL (Zoom → Recordings)
     □  Update replay_link in events/{slug}/event.yaml
     □  Re-run: python3 setup_event.py {slug} --no-zoom
     □  Run: python3 post_event_followup.py --event {slug} --report
     □  Run: python3 post_event_followup.py --event {slug}

──────────────────────────────────────────────────────────────
""")


# ── List all events ───────────────────────────────────────────────────────────
def list_events():
    events_dir = BASE / "events"
    if not events_dir.exists():
        print("No events/ directory found.")
        return
    slugs = sorted(d.name for d in events_dir.iterdir() if d.is_dir())
    if not slugs:
        print("No events found. Create one with: mkdir events/my-event-slug")
        return
    print(f"\n{'SLUG':<30} {'YAML':<6} {'ENV':<6} {'WORKFLOW'}")
    print("─" * 65)
    for slug in slugs:
        has_yaml = (events_dir / slug / "event.yaml").exists()
        has_env  = (events_dir / slug / "event.env").exists()
        has_wf   = (BASE / ".github" / "workflows" / f"reminders-{slug}.yml").exists()
        print(f"{slug:<30} {'✅' if has_yaml else '❌':<8} {'✅' if has_env else '❌':<8} {'✅' if has_wf else '❌'}")
    print()


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Set up a new event")
    parser.add_argument("slug",         nargs="?",          help="Event slug (e.g. blood-sugar-apr26)")
    parser.add_argument("--dry-run",    action="store_true")
    parser.add_argument("--no-zoom",    action="store_true", help="Skip Zoom meeting creation")
    parser.add_argument("--no-wix",     action="store_true", help="Skip Wix Event creation")
    parser.add_argument("--no-gform",   action="store_true", help="Skip Google Form creation")
    parser.add_argument("--checklist",  action="store_true", help="Print checklist only")
    parser.add_argument("--list",       action="store_true", help="List all events and their status")
    args = parser.parse_args()

    if args.list:
        list_events()
        return

    if not args.slug:
        parser.print_help()
        print("\nTip: python3 setup_event.py --list   (see all events)")
        sys.exit(1)

    cfg = load_event(args.slug)
    log.info(f"Setting up: {cfg['event_name']} [{args.slug}]")

    if args.checklist:
        print_checklist(cfg)
        return

    # Ask about services/pricing before writing env (may update cfg)
    if not args.dry_run:
        cfg = ask_service_preference(cfg)

    vars_ = write_event_env(cfg, dry_run=args.dry_run)
    cfg["_var_count"] = len(vars_)
    generate_reminder_workflow(cfg, dry_run=args.dry_run)

    if not args.no_zoom:
        create_zoom(cfg, dry_run=args.dry_run)

    if not args.no_wix:
        create_wix_event(cfg, dry_run=args.dry_run)

    if not args.no_gform:
        create_google_form(cfg, dry_run=args.dry_run)

    print_checklist(cfg)


if __name__ == "__main__":
    main()

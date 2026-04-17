#!/usr/bin/env python3
"""
report.py — Campaign efficiency report
───────────────────────────────────────
Usage:
  python3 report.py blood-sugar-apr26           # live CLI dashboard
  python3 report.py blood-sugar-apr26 --pdf     # generate PDF report
  python3 report.py blood-sugar-apr26 --email   # generate PDF + email it to yourself
  python3 report.py blood-sugar-apr26 --post-event  # full post-event PDF (after blast)

The live dashboard reads Meta API spend + leads.db registrations in real time.
The post-event PDF adds attendance breakdown and is auto-emailed after post_event_followup.py runs.
"""

import os, sys, sqlite3, argparse, logging
from pathlib import Path
from datetime import datetime, timezone

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))
from event_utils import early_load_event, EVENT_SLUG
early_load_event()

import requests
from dotenv import load_dotenv
load_dotenv(BASE / "responder.env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("report")

# ── Helpers ───────────────────────────────────────────────────────────────────
def inr(val):
    """Format a number as ₹X,XXX"""
    try:
        return f"₹{int(float(val)):,}"
    except Exception:
        return "₹0"

def pct(a, b):
    try:
        return f"{a/b*100:.0f}%"
    except Exception:
        return "—"

def bar(spent, cap, width=20):
    """Simple ASCII progress bar."""
    try:
        filled = int(float(spent) / float(cap) * width)
        filled = min(filled, width)
        return "█" * filled + "░" * (width - filled)
    except Exception:
        return "░" * width


# ── Meta API ──────────────────────────────────────────────────────────────────
META_TOKEN   = os.getenv("META_ACCESS_TOKEN", "")
META_VERSION = "v19.0"
META_BASE    = f"https://graph.facebook.com/{META_VERSION}"

def _meta_get(path, params=None):
    params = params or {}
    params["access_token"] = META_TOKEN
    r = requests.get(f"{META_BASE}/{path}", params=params, timeout=30)
    r.raise_for_status()
    return r.json()

def fetch_campaign_insights(campaign_id: str) -> dict:
    """Lifetime insights for a campaign: spend, impressions, clicks, leads."""
    try:
        data = _meta_get(f"{campaign_id}/insights", {
            "fields": "spend,impressions,clicks,actions,ctr",
            "date_preset": "lifetime",
        })
        row = data.get("data", [{}])[0] if data.get("data") else {}
        leads = next(
            (int(a["value"]) for a in row.get("actions", []) if a["action_type"] == "lead"),
            0,
        )
        return {
            "spend":       float(row.get("spend", 0)),
            "impressions": int(row.get("impressions", 0)),
            "clicks":      int(row.get("clicks", 0)),
            "leads":       leads,
            "ctr":         float(row.get("ctr", 0)),
        }
    except Exception as e:
        log.warning(f"Meta campaign insights failed: {e}")
        return {"spend": 0, "impressions": 0, "clicks": 0, "leads": 0, "ctr": 0}

def fetch_adset_insights(ad_account: str, campaign_id: str) -> list:
    """Per-ad-set breakdown for a campaign."""
    try:
        data = _meta_get(f"{ad_account}/adsets", {
            "fields": "name,status,insights.date_preset(lifetime){spend,impressions,clicks,actions,ctr}",
            "filtering": f'[{{"field":"campaign.id","operator":"EQUAL","value":"{campaign_id}"}}]',
        })
        rows = []
        for adset in data.get("data", []):
            insights = adset.get("insights", {}).get("data", [{}])[0] if adset.get("insights") else {}
            leads = next(
                (int(a["value"]) for a in insights.get("actions", []) if a["action_type"] == "lead"),
                0,
            )
            rows.append({
                "name":        adset.get("name", "Unknown"),
                "status":      adset.get("status", ""),
                "spend":       float(insights.get("spend", 0)),
                "impressions": int(insights.get("impressions", 0)),
                "clicks":      int(insights.get("clicks", 0)),
                "leads":       leads,
                "ctr":         float(insights.get("ctr", 0)),
            })
        return rows
    except Exception as e:
        log.warning(f"Meta ad set insights failed: {e}")
        return []


# ── Database ──────────────────────────────────────────────────────────────────
def fetch_db_leads(event_slug: str) -> dict:
    """Count leads by source from leads.db."""
    db_path = BASE / "leads.db"
    if not db_path.exists():
        return {"total": 0, "by_source": {}, "post_event": {}}

    con = sqlite3.connect(db_path)
    try:
        # By source
        rows = con.execute("""
            SELECT source, COUNT(*) FROM leads
            WHERE event_slug = ?
            GROUP BY source
        """, (event_slug,)).fetchall()
        by_source = {r[0]: r[1] for r in rows}

        # Post-event groups (if stored)
        try:
            rows2 = con.execute("""
                SELECT post_event_group, COUNT(*) FROM leads
                WHERE event_slug = ?  AND post_event_group IS NOT NULL
                GROUP BY post_event_group
            """, (event_slug,)).fetchall()
            post_event = {r[0]: r[1] for r in rows2}
        except Exception:
            post_event = {}

        total = sum(by_source.values())
        return {"total": total, "by_source": by_source, "post_event": post_event}
    finally:
        con.close()


# ── CLI Dashboard ─────────────────────────────────────────────────────────────
def print_dashboard(cfg: dict, campaign_id: str, event_slug: str):
    ad_account  = cfg.get("meta_ad_account", "")
    budget_cap  = cfg.get("meta_daily_budget_inr", 0) * 9   # rough 9-day estimate

    # Try to get spend cap from event config or use budget estimate
    spend_cap_inr = float(cfg.get("meta_spend_cap_inr", budget_cap or 5000))

    print(f"\n{'═'*62}")
    print(f"  📊  CAMPAIGN REPORT — {cfg.get('event_name','')}")
    print(f"  {cfg.get('event_date_display','')} · as of {datetime.now().strftime('%d %b %Y, %I:%M %p')}")
    print(f"{'═'*62}")

    # ── Meta data ────────────────────────────────────────────────────────────
    if campaign_id:
        print("\n  Fetching Meta data…", end="\r")
        camp  = fetch_campaign_insights(campaign_id)
        adsets = fetch_adset_insights(ad_account, campaign_id) if ad_account else []
        print("                     ", end="\r")
    else:
        camp  = {"spend": 0, "impressions": 0, "clicks": 0, "leads": 0, "ctr": 0}
        adsets = []
        print("\n  ⚠️  No META_CAMPAIGN_ID set — Meta data unavailable")

    # ── DB leads ─────────────────────────────────────────────────────────────
    db = fetch_db_leads(event_slug)

    # ── SPEND & PACING ────────────────────────────────────────────────────────
    spend     = camp["spend"]
    remaining = max(0, spend_cap_inr - spend)
    progress  = bar(spend, spend_cap_inr)

    print(f"\n  SPEND & PACING")
    print(f"  {'─'*58}")
    print(f"  {progress}  {inr(spend)} of {inr(spend_cap_inr)} cap")
    print(f"  Spent: {inr(spend)}   Remaining: {inr(remaining)}   "
          f"({pct(spend, spend_cap_inr)} used)")
    if camp["impressions"]:
        print(f"  Impressions: {camp['impressions']:,}   Clicks: {camp['clicks']:,}   "
              f"CTR: {camp['ctr']:.2f}%")

    # ── LEAD ACQUISITION ─────────────────────────────────────────────────────
    total_leads  = db["total"]
    meta_leads   = db["by_source"].get("meta_form", 0)
    gform_leads  = db["by_source"].get("google_form", 0)
    wix_leads    = db["by_source"].get("wix_event", 0)
    manual_leads = db["by_source"].get("manual", 0)
    other_leads  = total_leads - meta_leads - gform_leads - wix_leads - manual_leads

    meta_cpl = inr(spend / meta_leads) if meta_leads else "—"
    blended_cpl = inr(spend / total_leads) if total_leads else "—"

    print(f"\n  LEAD ACQUISITION")
    print(f"  {'─'*58}")
    print(f"  {'Source':<22} {'Leads':>7}  {'Share':>7}  {'Cost/Lead':>10}")
    print(f"  {'─'*58}")
    print(f"  {'Meta Ads Form':<22} {meta_leads:>7}  {pct(meta_leads,total_leads):>7}  {meta_cpl:>10}")
    print(f"  {'Google Form':<22} {gform_leads:>7}  {pct(gform_leads,total_leads):>7}  {'—':>10}")
    print(f"  {'Wix Event':<22} {wix_leads:>7}  {pct(wix_leads,total_leads):>7}  {'—':>10}")
    if manual_leads:
        print(f"  {'Manual':<22} {manual_leads:>7}  {pct(manual_leads,total_leads):>7}  {'—':>10}")
    if other_leads > 0:
        print(f"  {'Other':<22} {other_leads:>7}  {pct(other_leads,total_leads):>7}  {'—':>10}")
    print(f"  {'─'*58}")
    print(f"  {'TOTAL':<22} {total_leads:>7}  {'100%':>7}  {blended_cpl:>10}  blended CPL")

    # ── META AD SETS ─────────────────────────────────────────────────────────
    if adsets:
        print(f"\n  META AD SETS")
        print(f"  {'─'*58}")
        print(f"  {'Ad Set':<28} {'Spend':>8}  {'Leads':>6}  {'CPL':>8}  {'CTR':>6}")
        print(f"  {'─'*58}")
        for a in adsets:
            cpl = inr(a["spend"] / a["leads"]) if a["leads"] else "—"
            ctr = f"{a['ctr']:.2f}%" if a["ctr"] else "—"
            name = a["name"][:27]
            print(f"  {name:<28} {inr(a['spend']):>8}  {a['leads']:>6}  {cpl:>8}  {ctr:>6}")
        print(f"  {'─'*58}")

    # ── POST-EVENT (if available) ─────────────────────────────────────────────
    pe = db["post_event"]
    if pe:
        attended = pe.get("attended", 0)
        noshow   = pe.get("noshow", 0)
        direct   = pe.get("direct", 0)
        total_pe = attended + noshow + direct
        print(f"\n  EVENT OUTCOME")
        print(f"  {'─'*58}")
        print(f"  Attended:      {attended:>4}  ({pct(attended, total_pe)})")
        print(f"  No-show:       {noshow:>4}  ({pct(noshow, total_pe)})")
        if direct:
            print(f"  Direct joiner: {direct:>4}")
        if camp["leads"] and attended:
            print(f"  Ad lead → show rate: {pct(attended, camp['leads'])}")

    print(f"\n{'═'*62}\n")


# ── PDF Report ────────────────────────────────────────────────────────────────
def generate_pdf(cfg: dict, campaign_id: str, event_slug: str, output_path: Path):
    try:
        from fpdf import FPDF
    except ImportError:
        import subprocess
        subprocess.run([sys.executable, "-m", "pip", "install", "fpdf2", "--break-system-packages"],
                       check=True)
        from fpdf import FPDF

    ad_account    = cfg.get("meta_ad_account", "")
    spend_cap_inr = float(cfg.get("meta_spend_cap_inr",
                          cfg.get("meta_daily_budget_inr", 0) * 9 or 5000))

    camp   = fetch_campaign_insights(campaign_id) if campaign_id else \
             {"spend": 0, "impressions": 0, "clicks": 0, "leads": 0, "ctr": 0}
    adsets = fetch_adset_insights(ad_account, campaign_id) if campaign_id and ad_account else []
    db     = fetch_db_leads(event_slug)

    total_leads = db["total"]
    spend       = camp["spend"]

    # ── PDF setup ─────────────────────────────────────────────────────────────
    pdf = FPDF()
    pdf.set_margins(18, 18, 18)
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=18)

    # Colours
    DARK   = (15,  25,  40)
    GREEN  = (34, 197, 94)
    BLUE   = (59, 130, 246)
    AMBER  = (245, 158, 11)
    WHITE  = (255, 255, 255)
    LIGHT  = (241, 245, 249)
    MID    = (100, 116, 139)
    BLACK  = (15,  23,  42)

    def set_col(r, g, b):
        pdf.set_text_color(r, g, b)

    def h_rule(r=200, g=200, b=210):
        pdf.set_draw_color(r, g, b)
        pdf.line(18, pdf.get_y(), 192, pdf.get_y())
        pdf.ln(3)

    # ── Header ─────────────────────────────────────────────────────────────────
    pdf.set_fill_color(*DARK)
    pdf.rect(0, 0, 210, 38, "F")
    pdf.set_xy(18, 9)
    pdf.set_font("Helvetica", "B", 15)
    set_col(*WHITE)
    pdf.cell(0, 8, cfg.get("event_name", "Event Report"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(18)
    pdf.set_font("Helvetica", "", 9)
    set_col(160, 180, 200)
    date_str = cfg.get("event_date_display", "")
    pdf.cell(0, 6,
             f"{cfg.get('brand_name','')}  ·  {date_str}  ·  "
             f"Generated {datetime.now().strftime('%d %b %Y %H:%M')}",
             new_x="LMARGIN", new_y="NEXT")
    pdf.set_y(44)

    # ── KPI cards row ──────────────────────────────────────────────────────────
    meta_leads  = db["by_source"].get("meta_form", 0)
    blended_cpl = spend / total_leads if total_leads else 0
    meta_cpl    = spend / meta_leads  if meta_leads  else 0

    cards = [
        ("TOTAL SPEND",   inr(spend),          f"of {inr(spend_cap_inr)} cap", GREEN),
        ("TOTAL LEADS",   str(total_leads),     "all sources",                   BLUE),
        ("META CPL",      inr(meta_cpl),        "cost per Meta lead",             AMBER),
        ("BLENDED CPL",   inr(blended_cpl),     "spend ÷ all leads",              BLUE),
    ]
    card_w = (210 - 36 - 9) / 4   # 4 cards, 9px gaps, 36px margins
    x_start = 18
    for i, (label, value, sub, colour) in enumerate(cards):
        cx = x_start + i * (card_w + 3)
        pdf.set_fill_color(*LIGHT)
        pdf.rect(cx, pdf.get_y(), card_w, 22, "F")
        pdf.set_xy(cx + 3, pdf.get_y() + 2)
        pdf.set_font("Helvetica", "", 6.5)
        set_col(*MID)
        pdf.cell(card_w - 6, 4, label)
        pdf.set_xy(cx + 3, pdf.get_y() + 4)
        pdf.set_font("Helvetica", "B", 13)
        set_col(*colour)
        pdf.cell(card_w - 6, 6, value)
        pdf.set_xy(cx + 3, pdf.get_y() + 6)
        pdf.set_font("Helvetica", "", 6)
        set_col(*MID)
        pdf.cell(card_w - 6, 4, sub)

    pdf.set_y(pdf.get_y() + 28)

    def section_title(title):
        pdf.set_font("Helvetica", "B", 9)
        set_col(*DARK)
        pdf.cell(0, 7, title, new_x="LMARGIN", new_y="NEXT")
        h_rule()

    def table_header(cols, widths):
        pdf.set_fill_color(*DARK)
        pdf.set_font("Helvetica", "B", 7.5)
        set_col(*WHITE)
        for col, w in zip(cols, widths):
            pdf.cell(w, 6, col, fill=True)
        pdf.ln()

    def table_row(vals, widths, shade=False):
        if shade:
            pdf.set_fill_color(*LIGHT)
        else:
            pdf.set_fill_color(*WHITE)
        pdf.set_font("Helvetica", "", 8)
        set_col(*BLACK)
        for v, w in zip(vals, widths):
            pdf.cell(w, 6, str(v), fill=True)
        pdf.ln()

    # ── Spend & pacing ─────────────────────────────────────────────────────────
    section_title("SPEND & PACING")
    remaining  = max(0, spend_cap_inr - spend)
    bar_w      = 174
    filled_w   = int(bar_w * min(spend / spend_cap_inr, 1.0)) if spend_cap_inr else 0
    by = pdf.get_y()
    pdf.set_fill_color(34, 197, 94)
    pdf.rect(18, by, filled_w, 5, "F")
    pdf.set_fill_color(220, 230, 240)
    pdf.rect(18 + filled_w, by, bar_w - filled_w, 5, "F")
    pdf.set_y(by + 8)
    pdf.set_font("Helvetica", "", 8)
    set_col(*MID)
    pct_used = f"{spend/spend_cap_inr*100:.0f}%" if spend_cap_inr else "—"
    pdf.cell(0, 5,
             f"Spent: {inr(spend)}   Remaining: {inr(remaining)}   "
             f"{pct_used} of cap used",
             new_x="LMARGIN", new_y="NEXT")
    if camp["impressions"]:
        pdf.cell(0, 5,
                 f"Impressions: {camp['impressions']:,}   "
                 f"Clicks: {camp['clicks']:,}   "
                 f"CTR: {camp['ctr']:.2f}%",
                 new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    # ── Lead acquisition ──────────────────────────────────────────────────────
    section_title("LEAD ACQUISITION")
    cols   = ["Source", "Leads", "Share", "Cost / Lead"]
    widths = [80, 25, 30, 39]
    table_header(cols, widths)

    sources = [
        ("Meta Ads Form",  db["by_source"].get("meta_form",    0), inr(meta_cpl) if meta_leads else "—"),
        ("Google Form",    db["by_source"].get("google_form",  0), "—"),
        ("Wix Event",      db["by_source"].get("wix_event",    0), "—"),
        ("Manual",         db["by_source"].get("manual",       0), "—"),
    ]
    for i, (src, count, cpl) in enumerate(sources):
        if count == 0:
            continue
        table_row([src, count, pct(count, total_leads), cpl], widths, shade=i % 2 == 0)
    pdf.set_fill_color(*DARK)
    pdf.set_font("Helvetica", "B", 8)
    set_col(*WHITE)
    for v, w in zip(["TOTAL", total_leads, "100%", inr(blended_cpl) + " blended"], widths):
        pdf.cell(w, 6, str(v), fill=True)
    pdf.ln(8)

    # ── Meta ad sets ──────────────────────────────────────────────────────────
    if adsets:
        section_title("META AD SETS")
        cols   = ["Ad Set", "Spend", "Leads", "CPL", "CTR", "Impressions"]
        widths = [58, 25, 18, 25, 18, 30]
        table_header(cols, widths)
        for i, a in enumerate(adsets):
            cpl_val = inr(a["spend"] / a["leads"]) if a["leads"] else "—"
            ctr_val = f"{a['ctr']:.2f}%" if a["ctr"] else "—"
            table_row(
                [a["name"][:32], inr(a["spend"]), a["leads"], cpl_val, ctr_val, f"{a['impressions']:,}"],
                widths, shade=i % 2 == 0,
            )
        pdf.ln(4)

    # ── Post-event outcome ─────────────────────────────────────────────────────
    pe = db["post_event"]
    if pe:
        section_title("EVENT OUTCOME")
        attended = pe.get("attended", 0)
        noshow   = pe.get("noshow",   0)
        direct   = pe.get("direct",   0)
        total_pe = attended + noshow + direct

        cols   = ["", "Count", "Share", "Note"]
        widths = [55, 20, 25, 74]
        table_header(cols, widths)
        rows_pe = [
            ("✅  Attended",      attended, pct(attended, total_pe), "Received consultation + programme offer"),
            ("❌  No-show",       noshow,   pct(noshow,   total_pe), "Received replay + consultation offer"),
            ("👋  Direct joiner", direct,   pct(direct,   total_pe), "Received email offer"),
        ]
        for i, (label, count, share, note) in enumerate(rows_pe):
            table_row([label, count, share, note], widths, shade=i % 2 == 0)

        # Show rate vs ad leads
        if camp["leads"] and attended:
            pdf.set_font("Helvetica", "I", 7.5)
            set_col(*MID)
            pdf.cell(0, 6,
                     f"Ad lead → show rate: {pct(attended, camp['leads'])}  "
                     f"({attended} attended of {camp['leads']} Meta leads)",
                     new_x="LMARGIN", new_y="NEXT")
        pdf.ln(4)

    # ── Footer ─────────────────────────────────────────────────────────────────
    pdf.set_fill_color(*DARK)
    pdf.rect(0, 280, 210, 17, "F")
    pdf.set_xy(18, 283)
    pdf.set_font("Helvetica", "", 7)
    set_col(120, 140, 160)
    pdf.cell(0, 5,
             f"The Ochre Tree · {cfg.get('coach_name','')} · "
             f"Report generated {datetime.now().strftime('%d %b %Y %H:%M')}")

    pdf.output(str(output_path))
    log.info(f"PDF saved → {output_path}")
    return output_path


# ── Email the PDF ─────────────────────────────────────────────────────────────
def email_report(pdf_path: Path, cfg: dict):
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.base import MIMEBase
    from email.mime.text import MIMEText
    from email import encoders

    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_port = int(os.getenv("SMTP_PORT", 587))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_pass = os.getenv("SMTP_PASS", "")
    from_email = os.getenv("FROM_EMAIL", smtp_user)
    to_email   = smtp_user   # send to yourself

    if not smtp_host or not smtp_pass:
        log.warning("SMTP not configured — skipping email")
        return

    event_name = cfg.get("event_name", "")
    subject    = f"Campaign Report — {event_name}"

    msg = MIMEMultipart()
    msg["From"]    = from_email
    msg["To"]      = to_email
    msg["Subject"] = subject

    body = (
        f"Hi Shivani,\n\n"
        f"Your campaign efficiency report for \"{event_name}\" is attached.\n\n"
        f"— The Ochre Tree Automation"
    )
    msg.attach(MIMEText(body, "plain"))

    with open(pdf_path, "rb") as f:
        part = MIMEBase("application", "octet-stream")
        part.set_payload(f.read())
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f'attachment; filename="{pdf_path.name}"')
    msg.attach(part)

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(from_email, to_email, msg.as_string())
        log.info(f"Report emailed to {to_email}")
    except Exception as e:
        log.error(f"Email failed: {e}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("event",     nargs="?", default=EVENT_SLUG, help="Event slug")
    parser.add_argument("--pdf",     action="store_true", help="Generate PDF report")
    parser.add_argument("--email",   action="store_true", help="Generate PDF + email it")
    parser.add_argument("--post-event", action="store_true",
                        help="Post-event report (includes attendance breakdown)")
    args = parser.parse_args()

    event_slug = args.event or EVENT_SLUG
    if not event_slug:
        print("Usage: python3 report.py <event-slug>")
        sys.exit(1)

    # Load event config
    import yaml
    yaml_path = BASE / "events" / event_slug / "event.yaml"
    if not yaml_path.exists():
        log.error(f"events/{event_slug}/event.yaml not found")
        sys.exit(1)
    with open(yaml_path) as f:
        cfg = yaml.safe_load(f)
    cfg["_slug"] = event_slug

    # Also load event.env for campaign ID
    from dotenv import dotenv_values
    event_env = dotenv_values(BASE / "events" / event_slug / "event.env")
    campaign_id = event_env.get("META_CAMPAIGN_ID", os.getenv("META_CAMPAIGN_ID", ""))

    if args.pdf or args.email or args.post_event:
        slug_safe  = event_slug.replace("/", "-")
        ts         = datetime.now().strftime("%Y%m%d-%H%M")
        pdf_name   = f"report-{slug_safe}-{ts}.pdf"
        output_dir = BASE / "reports"
        output_dir.mkdir(exist_ok=True)
        pdf_path   = output_dir / pdf_name

        generate_pdf(cfg, campaign_id, event_slug, pdf_path)
        print(f"\n  ✅  PDF saved → {pdf_path}\n")

        if args.email or args.post_event:
            email_report(pdf_path, cfg)
    else:
        print_dashboard(cfg, campaign_id, event_slug)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Make one person's body age report: the PDF and the email it arrives in, as a DRAFT. $0, no API, no sends.

A report buyer is stored like a prospect (clients/<id>/ or prospects/<id>/, no sign-up, no plan), with their
results in health_snapshots like everyone's. This script reads that record, builds the report with
fmdb/report, and writes the files next to the record. It never emails anyone.

Reads JSON from stdin (or the same keys as arguments: `body-age-report.py cl-900 deeper --record`):
{
  "client_id": str,
  "kind": "standard" | "deeper",
  "sample_date": "YYYY-MM-DD",   # optional: the draw to report; default = the latest draw with lab values
  "report_date": "YYYY-MM-DD",   # optional: default = today in India. The 14-day Foundation credit counts from it.
  "name": str,                   # optional: how the letter addresses them; default = first word of display_name
  "record": bool,                # also write the result to client.yaml (report entry, credit fields, segment)
  "out_dir": str,                # optional: where the files go; default = <person>/files/body-age/<report no>/
  "html_only": bool              # skip Chrome: no PDF and no email images (for a quick wording check)
}

Writes JSON to stdout:
{
  "ok": bool, "error": str | null,
  "ready": bool,                 # false = do NOT send; `blockers` says why
  "blockers": [str], "drafts": [str], "warnings": [str], "urgent": [str],
  "report": {...},               # kind, dates, body age, outcome, segment, tags, credit_until
  "files": {"pdf", "email_html", "email_preview", "ring", "mark", "html", "json"},
  "pages": int | null
}
Warnings go to stderr only.

The Foundation link behind "Book your session" is the person's own pay page (/foundation/<app_token>). It exists
once the coach has opened the Foundation pay link for them (startFoundationSession, which also stages the record
to Fly). Run with "record" first so the credit is on the record before that staging.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
FMDB_ROOT = HERE.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))
sys.path.insert(0, str(HERE))

TEST_PROFILE = "cl-900"      # the app's test account: the only record a provisional cut-off table may be used for
# The report prints the brand name ("from Sequoya by Shivani Hari"), which is embargoed until the launch. No real
# buyer's report may exist before this moment; the test profile's may, because it never leaves the coach.
EMBARGO_UNTIL = datetime(2027, 1, 2, 20, 0, tzinfo=ZoneInfo("Asia/Kolkata"))


def now_ist() -> datetime:
    return datetime.now(ZoneInfo("Asia/Kolkata"))


def plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    return Path(env).expanduser().resolve() if env else Path.home() / "fm-plans"


def public_base() -> str:
    return (os.environ.get("NEXT_PUBLIC_APP_URL") or "https://intake.theochretree.com").rstrip("/")


def person_dir(root: Path, client_id: str) -> Path | None:
    for bucket in ("clients", "prospects"):
        d = root / bucket / client_id
        if (d / "client.yaml").is_file():
            return d
    return None


def _ymd(v) -> str:
    return v.isoformat()[:10] if isinstance(v, (date, datetime)) else str(v or "")[:10]


def draws(person: dict) -> dict[str, list[dict]]:
    """{date: lab values} for every draw on the record (two reports from one morning are one draw)."""
    out: dict[str, list[dict]] = {}
    for s in person.get("health_snapshots") or []:
        if isinstance(s, dict) and s.get("lab_values"):
            out.setdefault(_ymd(s.get("date")), []).extend(l for l in s["lab_values"] if isinstance(l, dict))
    return out


def parse_args(argv: list[str]) -> dict:
    if not argv:
        raw = sys.stdin.read().strip()
        return json.loads(raw) if raw else {}
    req: dict = {}
    pos = [a for a in argv if not a.startswith("--")]
    flags = [a for a in argv if a.startswith("--")]
    if pos:
        req["client_id"] = pos[0]
    if len(pos) > 1:
        req["kind"] = pos[1]
    for f in flags:
        k, _, v = f[2:].partition("=")
        req[k.replace("-", "_")] = v if v else True
    return req


def write_record(cdir: Path, person: dict, rp, files_dir: Path) -> None:
    """The report entry, the Foundation credit and the segment, onto client.yaml."""
    import yaml
    from atomic_write import write_text_atomic
    entry = dict(rp.record(), files_dir=str(files_dir))
    reports = [r for r in (person.get("body_age_reports") or []) if isinstance(r, dict) and r.get("report_no") != rp.report_no]
    person["body_age_reports"] = reports + [entry]
    person["body_age_report_kind"] = rp.kind
    person["body_age_report_date"] = rp.report_date.isoformat()
    if rp.decision.segment:
        person["segment"] = rp.decision.segment
    elif person.get("segment") == "longevity_customer":
        person.pop("segment")            # this report offers a session: no longer the steady group
    write_text_atomic(cdir / "client.yaml", yaml.dump(person, allow_unicode=True, default_flow_style=False, sort_keys=False))


def main(argv: list[str]) -> int:
    def fail(msg: str) -> int:
        json.dump({"ok": False, "error": msg, "ready": False}, sys.stdout)
        return 0

    try:
        req = parse_args(argv)
    except json.JSONDecodeError as e:
        return fail(f"bad JSON on stdin: {e}")
    cid, kind = str(req.get("client_id") or "").strip(), str(req.get("kind") or "").strip()
    if not cid or kind not in ("standard", "deeper"):
        return fail("client_id and kind ('standard' or 'deeper') are required")

    import yaml
    from fmdb.report.build import ReportError, make_report
    from fmdb.report.levels import cutoffs_approved

    root = plans_root()
    cdir = person_dir(root, cid)
    if cdir is None:
        return fail(f"{cid}: no record in clients/ or prospects/")
    person = yaml.safe_load((cdir / "client.yaml").read_text()) or {}
    is_test = cid == TEST_PROFILE
    if not is_test and now_ist() < EMBARGO_UNTIL:
        return fail("the report carries the brand name, which is embargoed until Sat 2 Jan 2027, 20:00 IST. "
                    f"Before then a report can be built for the test profile ({TEST_PROFILE}) only.")
    if not is_test and not cutoffs_approved():
        return fail("the result-level cut-offs are still provisional (fm-database/fmdb/report/cutoffs.yaml). "
                    f"Until Shivani approves them a report can be built for the test profile ({TEST_PROFILE}) only.")

    by_date = draws(person)
    sample_date = _ymd(req.get("sample_date")) or (max(by_date) if by_date else "")
    if sample_date not in by_date:
        return fail(f"{cid}: no lab values on file for {sample_date or 'any date'}")
    report_date = _ymd(req.get("report_date")) or now_ist().date().isoformat()
    token = str(person.get("app_token") or "").strip()
    book_url = f"{public_base()}/foundation/{token}" if len(token) >= 16 else None

    try:
        rp = make_report(person, by_date[sample_date], kind=kind, sample_date=sample_date, report_date=report_date,
                         name=(str(req["name"]).strip() if req.get("name") else None), book_url=book_url, sample=is_test)
    except ReportError as e:
        return fail(f"{cid}: {e}")

    blockers = [f"needs wording: {m}" for m in rp.missing]
    blockers += [f"URGENT, phone them today, do not wait for the report: {u}" for u in rp.decision.urgent]
    if rp.decision.outcome == "foundation" and not book_url:
        blockers.append("no personal Foundation link yet: open the Foundation pay link on their page, then build again")
    if rp.drafts:
        blockers.append(f"{len(rp.drafts)} sentence group(s) are drafts Shivani has not approved (see drafts)")

    out_dir = Path(str(req["out_dir"])).expanduser() if req.get("out_dir") else cdir / "files" / "body-age" / rp.report_no
    out_dir.mkdir(parents=True, exist_ok=True)
    from fmdb.report import mail
    from fmdb.report.page import report_html
    files: dict[str, str] = {}
    pages = None
    (out_dir / "report.html").write_text(report_html(rp))
    files["html"] = str(out_dir / "report.html")
    (out_dir / "email.html").write_text(mail.email_html(rp))
    files["email_html"] = str(out_dir / "email.html")
    if not req.get("html_only"):
        from fmdb.report.pdf import build_pdf
        try:
            pdf = out_dir / mail.attachment_name(rp)
            res = build_pdf(rp, pdf)
            pages = res["pages"]
            files["pdf"] = str(pdf)
            broken = [l for l in res["links"] if l[1] == "BROKEN"]
            if broken:
                blockers.append(f"{len(broken)} link(s) inside the PDF point nowhere")
            imgs = mail.write_images(rp, out_dir)
            files["ring"], files["mark"] = str(imgs["ring"]), str(imgs["mark"])
            (out_dir / "email-preview.html").write_text(mail.preview_html(rp, imgs))
            files["email_preview"] = str(out_dir / "email-preview.html")
        except Exception as e:  # noqa: BLE001 - Chrome missing or a render failure: say so, keep the HTML
            blockers.append(f"the PDF could not be made: {e}")
    summary = dict(rp.record(), name=rp.name, subject=mail.SUBJECT, attachment=mail.attachment_name(rp), book_url=book_url,
                   statuses={s.id: s.status for s in rp.sections}, drafts=rp.drafts, warnings=rp.warnings)
    (out_dir / "report.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False))
    files["json"] = str(out_dir / "report.json")

    if req.get("record"):
        write_record(cdir, person, rp, out_dir)
    for w in rp.warnings:
        print(f"warning: {w}", file=sys.stderr)
    json.dump({"ok": True, "error": None, "ready": not blockers, "blockers": blockers, "drafts": rp.drafts,
               "warnings": rp.warnings, "urgent": rp.decision.urgent, "report": rp.record(), "files": files, "pages": pages,
               "recorded": bool(req.get("record"))}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

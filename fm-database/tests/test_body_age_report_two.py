"""Body age report for two (fmdb/report/two.py): the page two people share, the email for two and the command.

The approved sample's text is tests/fixtures/body_age/approved_two_sample.txt (the PDF Shivani approved on
19 Nov 2026, as text). R. is the test profile; the second person is always invented here.
"""
from __future__ import annotations

import itertools
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_body_age_report import BRAND, FIX, FORBIDDEN, FX, STEADY, labs, report, run, shim, text, write_person  # noqa: E402

from fmdb.report import mail, two as T  # noqa: E402
from fmdb.report import wording as W  # noqa: E402
from fmdb.report.build import ReportError, make_report  # noqa: E402

APPROVED = (FIX / "approved_two_sample.txt").read_text()
LINK = "https://example.test/foundation/t"
# the second person, invented: a woman of 50
M_PERSON = dict(FX["person"], display_name="M.", sex="F", date_of_birth="1976-03-02", measurements={"height_cm": 162.0, "weight_kg": 60.0})
SHARED_SUGAR = dict(STEADY, **{"HbA1c": 5.8, "Cholesterol - LDL": 118, "Cholesterol - Total": 205, "Non-HDL Cholesterol": 140})
# one set of results per outcome decide.py can reach
OUTCOMES = {
    "foundation": None,                                                    # the test profile as it is: two results need a deeper look
    "foundation_work": dict(STEADY, **{"HbA1c": 5.8, "TSH (Ultrasensitive)": 4.9, "hsCRP": 2.0}),      # three small things
    "self": SHARED_SUGAR,
    "nothing": STEADY,
    "doctor_only": dict(STEADY, **{"Lipoprotein (a) [Lp(a)]": 96}),
    "doctor_soon": dict(STEADY, **{"Potassium": 6.2}),
}
WANT = {"foundation_work": "foundation"}


def first(over=None, kind="standard", **kw):
    return report(kind, over, book_url=LINK, **kw)


def second(over=None, kind="standard", **kw):
    kw.setdefault("report_date", FX["report_date"])
    return make_report(M_PERSON, labs(over, metals=kind == "deeper"), kind=kind, sample=True, sample_date=FX["sample_date"],
                       book_url=LINK + "2", **kw)


def pair(a="foundation", b="self", kind="standard"):
    ra, rb = first(OUTCOMES[a], kind), second(OUTCOMES[b], kind)
    assert (ra.decision.outcome, rb.decision.outcome) == (WANT.get(a, a), WANT.get(b, b))
    return T.make_two(ra, rb)


def page(t) -> str:
    return text(T.two_html(t))


# ── a: the approved sample, word for word ────────────────────────────────────
def test_every_sample_sentence_in_the_code_is_in_the_approved_sample():
    for key, sentence in T.SAMPLE.items():
        for part in re.split(r"\{\w+\}", sentence):
            part = part.strip()
            ok = part in APPROVED or (key == "after.title" and part.upper() in APPROVED)      # that heading prints in capitals
            assert ok, (key, part)


def test_the_samples_own_case_prints_the_approved_sentences():
    """R. needs a session and shares a slightly high sugar average with M.: every sentence the page takes from the
    sample reads exactly as she approved it, names, dates and prices included."""
    t = pair("foundation", "self")
    assert t.drafts == [] and t.ready
    used = {key: sentence for kind, key, sentence in t.sources if kind == "sample"}
    for key, sentence in used.items():
        assert sentence in APPROVED, (key, sentence)
        assert sentence in page(t), key
    assert {"letter.younger", "letter.kitchen", "letter.differ", "letter.steadier", "alike.sugar", "alike.change", "differ.detail",
            "page.share", "page.none", "step.deep", "step.why", "offer.title", "offer.price", "offer.join", "offer.before",
            "offer.in", "offer.tests", "offer.leave", "fresh", "after"} <= set(used)
    p = page(t)
    for fixed in ("Body age report for two", "The page you share, alongside your own two reports", "4 July 2026, at home, same morning",
                  "One each, attached to the same email", "4 November 2026, together", "Dear R. and M.,",
                  "You share a kitchen, and it shows: the one thing on watch for both of you is sugar. Where you differ is R.'s arteries and thyroid. M., yours is the steadier report.",
                  "One home visit, one morning, both of you.", T.SAMPLE["own"],
                  "A Foundation session for R., online ₹7,000 ₹7,000 if you book by 21 July 2026, ₹12,000 after that. M. is welcome to join."):
        assert fixed in p and fixed in APPROVED, fixed
    heads = [T.SAMPLE[f"h{n}"] for n in range(1, 9)]
    assert [p.index(f"0{n} {h}") for n, h in enumerate(heads, 1)] == sorted(p.index(f"0{n} {h}") for n, h in enumerate(heads, 1))


def test_a_steady_partner_gets_the_samples_line_and_no_paragraph():
    t = pair("foundation", "nothing")
    p = page(t)
    assert "R.: two results in your report need a deeper look. M.: you do not need anything more from me." in p
    assert "R.: two results in your report need a deeper look. M.: you do not need anything more from me." in APPROVED
    assert "Test again in about a year" not in p              # her own later date is not printed beside the shared one


# ── b: reused from each person's own report ──────────────────────────────────
def test_every_sentence_says_where_it_came_from_and_is_on_the_page():
    for a, b in (("foundation", "self"), ("nothing", "nothing"), ("doctor_soon", "foundation_work"), ("self", "doctor_only")):
        t = pair(a, b)
        p = page(t) + " " + text(mail.two_email_html(t))
        assert t.sources and {k for k, _w, _s in t.sources} <= {"sample", "own", "draft"}
        for kind, where, sentence in t.sources:
            assert text(sentence) in p, (kind, where, sentence)
        assert [w for k, w, _s in t.sources if k == "draft" and not w.startswith("two.")] == []
        assert set(t.drafts) == {w for k, w, _s in t.sources if k == "draft" and w not in W.APPROVED_DRAFTS}


def test_doctor_wording_is_each_persons_own_approved_sentence():
    t = pair("foundation", "self")
    p = page(t)
    assert t.a.step["paras"][1] in p                          # R.'s own next-step paragraph, as his report prints it
    assert "attention as well" not in p and "See yours." not in p      # the sample's older doctor words are not printed
    assert "about 42" in p and "41.9" not in p                # body age as a whole number, as in the single report


def test_outside_the_samples_case_the_letter_is_each_persons_own():
    t = pair("foundation", "nothing")
    assert t.letter == [" ".join(t.a.letter), " ".join(t.b.letter)]
    assert all(k == "own" for k, w, _s in t.sources if w.endswith("letter"))


# ── c: drafts keep the page back ─────────────────────────────────────────────
@pytest.mark.parametrize("a,b,draft", [("nothing", "nothing", "two.step.neither"), ("nothing", "nothing", "two.alike.none"),
                                       ("foundation", "nothing", "two.next.one_steady"), ("foundation_work", "foundation_work", "two.alike.other")])
def test_a_new_sentence_is_a_draft_until_she_approves_it(a, b, draft, monkeypatch):
    t = pair(a, b)
    assert draft in t.drafts and not t.ready
    assert W.DRAFT[draft][1].split("{")[0] in page(t)
    monkeypatch.setattr(W, "APPROVED_DRAFTS", W.APPROVED_DRAFTS | {k for k in W.DRAFT if k.startswith("two.")})
    t = pair(a, b)
    assert t.drafts == [] and t.ready


def test_the_drafts_are_the_only_new_sentences_and_none_is_approved_yet():
    new = {k for k in W.DRAFT if k.startswith("two.")}
    assert new == {"two.alike.other", "two.alike.none", "two.next.one_steady", "two.step.neither"}
    assert not new & W.APPROVED_DRAFTS                        # only Shivani's own yes moves one across


# ── her rules, across every pair of outcomes ─────────────────────────────────
PAIRS = list(itertools.product(OUTCOMES, OUTCOMES))


@pytest.mark.parametrize("a,b", PAIRS)
def test_nothing_on_the_page_for_two_breaks_her_rules(a, b):
    t = pair(a, b)
    p = page(t)
    assert p.count("Sequoya") == 2 == p.count(BRAND)          # "from" and "Prepared by", as on the single report
    for h in (p.replace(BRAND, ""), mail.two_email_html(t), " ".join(mail.two_attachments(t)), mail.SUBJECT, T.title(t)):
        s = text(h)
        assert not FORBIDDEN.search(s), FORBIDDEN.search(s).group(0)
        assert not re.search(r"urgent|not a doctor|read by|reviewed by|\bfree\b", s, re.I), s
    assert T.head_right(t) == "Body age report for two · R. and M. · sample collected 4 July 2026"
    assert "{" not in p and "needs wording" not in p and "<a href=\"#" not in T.two_html(t)


@pytest.mark.parametrize("a,b", PAIRS)
def test_a_session_is_offered_by_name_to_the_person_who_needs_it_and_to_nobody_else(a, b):
    t = pair(a, b)
    p, mail_text = page(t), text(mail.two_email_html(t))
    needs = [rp for rp in t.people if rp.decision.outcome == "foundation"]
    assert t.offered == needs
    for s in (p, mail_text):
        assert s.count("A Foundation session for") == len(needs)
        for rp in t.people:
            assert (f"A Foundation session for {rp.name}, online" in s) == (rp in needs)
        if not needs:                                         # a page that offers no session quotes no price
            assert "₹" not in s and "Foundation" not in s and "Book your session" not in s and "lower price" not in s
    for rp, partner in ((t.a, t.b), (t.b, t.a)):
        if rp in needs and partner not in needs:              # the price sits in the needy person's block only
            block = p[p.index(f"A Foundation session for {rp.name}"):]
            assert f"{partner.name} is welcome to join." in block
            assert not re.search(rf"{re.escape(partner.name)}[^.]*₹", p)


def test_each_person_pays_their_own_price_by_their_own_date():
    t = pair("foundation", "foundation_work", kind="deeper")
    p = page(t)
    assert "A Foundation session for R., online ₹2,000 ₹2,000 if you book by 21 July 2026, ₹12,000 after that. M. is welcome to join." in p
    assert "A Foundation session for M., online ₹2,000 ₹2,000 if you book by 21 July 2026, ₹12,000 after that. R. is welcome to join." in p
    assert "She gets the short list worth doing" in p and "M. fills in her full history in her own time" in p
    assert "R. and M. leave with the order to work in" in p
    html_ = T.two_html(t)
    assert LINK + '"' in html_ and LINK + '2"' in html_       # each button opens that person's own pay page


def test_a_doctor_soon_result_prints_her_words_first_and_offers_that_person_nothing():
    t = pair("doctor_soon", "foundation")
    p = page(t)
    assert "Please see your doctor in the next day or two, and take this report with you." in p
    assert p.index("needs a doctor's attention soon") < p.index("Your own report has the detail.")
    assert t.offered == [t.b] and any("Send it today" in w for w in t.warnings)


def test_the_shared_date_is_the_earlier_one():
    assert pair("foundation", "nothing").next_test.isoformat() == "2026-11-04"
    both_steady = pair("nothing", "nothing")
    assert both_steady.next_test.isoformat() == "2027-07-04" and "About a year after this test" in page(both_steady)


def test_two_reports_that_do_not_belong_together_are_refused():
    a = first()
    with pytest.raises(ReportError, match="same kind"):
        T.make_two(a, second(kind="deeper"))
    with pytest.raises(ReportError, match="report date"):
        T.make_two(a, second(report_date="2026-07-08"))
    with pytest.raises(ReportError, match="different names"):
        T.make_two(a, first())


# ── the email for two ────────────────────────────────────────────────────────
def test_one_email_carries_both_reports_and_the_page_for_two():
    t = pair("foundation", "self")
    h = mail.two_email_html(t)
    s = text(h)
    assert mail.two_attachments(t) == ["Body age report, R., 4 July 2026.pdf", "Body age report, M., 4 July 2026.pdf",
                                       "Body age report for two, R. and M., 4 July 2026.pdf"]
    assert 'src="cid:ring1"' in h and 'src="cid:ring2"' in h and 'src="cid:mark"' in h
    assert "Dear R. and M.," in s and T.SAMPLE["own"] in s and "4 November 2026, together" in s
    assert "A Foundation session for R., online: ₹7,000." in s and LINK in h and LINK + "2" not in h
    assert t.a.step["email_how"] in s                         # the approved single email's own lines
    assert "Sequoya" not in h                                 # as with the single email: no brand name


# ── the command ──────────────────────────────────────────────────────────────
IST = ZoneInfo("Asia/Kolkata")
INVENTED = [None, {"values": SHARED_SUGAR, "sex": "F", "date_of_birth": "1976-03-02"}]


def test_command_builds_the_pair_for_the_test_profile(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    d = write_person(tmp_path, "cl-900", bucket="clients")
    out = run(shim(), capsys, client_ids=["cl-900", "cl-900"], kind="standard", names=["R.", "M."], invented=INVENTED,
              report_date=FX["report_date"], html_only=True)
    assert out["ok"] and {"ready", "blockers", "drafts", "warnings", "files", "report", "reports"} <= set(out)
    assert out["report"]["names"] == "R. and M." and out["report"]["session_offered_to"] == ["R."]
    assert [r["outcome"] for r in out["reports"]] == ["foundation", "self"]
    # no app token on this record yet, so there is no personal link: not ready to send
    assert out["ready"] is False and any("R.: no personal session link" in b for b in out["blockers"])
    folder = d / "files" / "body-age" / out["report"]["report_no"]
    for name in ("page-for-two.html", "report-1.html", "report-2.html", "email.html", "report.json", "sources.txt"):
        assert (folder / name).is_file(), name
    assert "body_age_reports" not in (d / "client.yaml").read_text()      # nothing recorded unless asked


def test_the_launch_lock_holds_for_both_people(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("fmdb.report.levels.cutoffs_approved", lambda path=None: True)
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    write_person(tmp_path, "cl-900", bucket="clients")
    write_person(tmp_path, "cl-950")
    write_person(tmp_path, "cl-951")
    mod = shim()
    mod.now_ist = lambda: datetime(2027, 1, 2, 19, 59, tzinfo=IST)
    for ids in (["cl-900", "cl-950"], ["cl-950", "cl-900"], ["cl-950", "cl-951"]):
        out = run(mod, capsys, client_ids=ids, kind="standard", names=["R.", "M."], html_only=True)
        assert out["ok"] is False and "embargoed" in out["error"], ids
    assert not list(tmp_path.rglob("body-age"))               # refused before a single file is written
    mod.now_ist = lambda: datetime(2027, 1, 2, 20, 0, tzinfo=IST)
    out = run(mod, capsys, client_ids=["cl-950", "cl-951"], kind="standard", names=["R.", "M."], report_date="2027-01-02", html_only=True)
    assert out["ok"] is True
    assert "Sample report" not in Path(out["files"]["html"]).read_text()


def test_invented_values_are_for_the_test_profile_only_and_never_recorded(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("fmdb.report.levels.cutoffs_approved", lambda path=None: True)
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    write_person(tmp_path, "cl-900", bucket="clients")
    write_person(tmp_path, "cl-950")
    mod = shim()
    mod.now_ist = lambda: datetime(2027, 1, 5, 10, 0, tzinfo=IST)
    out = run(mod, capsys, client_ids=["cl-900", "cl-950"], kind="standard", names=["R.", "M."], invented=INVENTED, html_only=True)
    assert out["ok"] is False and "test profile" in out["error"]
    out = run(mod, capsys, client_ids=["cl-900", "cl-900"], kind="standard", names=["R.", "M."], invented=INVENTED, record=True, html_only=True)
    assert out["ok"] is False and "never written to a record" in out["error"]
    out = run(mod, capsys, client_ids=["cl-950", "cl-950"], kind="standard", names=["R.", "M."], html_only=True)
    assert out["ok"] is False and "two different people" in out["error"]


def test_the_single_command_still_refuses_a_real_buyer_before_the_launch(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("fmdb.report.levels.cutoffs_approved", lambda path=None: True)
    monkeypatch.setenv("FMDB_PLANS_DIR", str(tmp_path))
    write_person(tmp_path, "cl-950")
    mod = shim()
    mod.now_ist = lambda: datetime(2027, 1, 2, 19, 59, tzinfo=IST)
    assert "embargoed" in run(mod, capsys, client_id="cl-950", kind="standard", html_only=True)["error"]


@pytest.mark.skipif(os.environ.get("FMDB_PDF_TESTS") != "1", reason="prints with Chrome; run locally with FMDB_PDF_TESTS=1")
def test_the_pdf_for_two_is_four_pages_with_working_links(tmp_path):
    from fmdb.report.pdf import build_two_pdf
    from pypdf import PdfReader
    t = pair("foundation", "self")
    pdf = tmp_path / T.attachment_name(t)
    res = build_two_pdf(t, pdf)
    assert res["pages"] == 4                                  # as the approved sample
    assert [l for l in res["links"] if l[1] == "BROKEN"] == [] and (1, "web", LINK) not in res["links"]
    assert any(l[2] == LINK for l in res["links"])
    r = PdfReader(str(pdf))
    assert r.metadata.title == "Body age report for two, R. and M., 4 July 2026" and "Sequoya" not in (r.metadata.title or "")

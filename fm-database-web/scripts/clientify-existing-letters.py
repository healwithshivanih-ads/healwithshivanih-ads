#!/usr/bin/env python3
"""
clientify-existing-letters.py — F23 2026-05-23, no-API edition.

Walks every existing letter HTML on disk (~/fm-plans/clients/*/meal-plans/*.html)
and post-processes the static HTML to:
  1. Strip titrate / back-off / landing-dose language from dose text
     (clients can't titrate in mg, only step pill→pill).
  2. Bump the <title> brand from "— Shivani Hari" to "— The Ochre Tree"
     so old letters match new ones. Coach signatures elsewhere in the
     letter body stay as-is.

Backs up every file to .bak before writing. Idempotent — re-running on
already-cleaned files is a no-op.

Run:  ../fm-database/.venv/bin/python scripts/clientify-existing-letters.py
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path


# Same patterns as render-client-letter.py::_clientify_dose, but applied
# to HTML — so we anchor on the SAME punctuation + word boundaries that
# survived the markdown→HTML conversion. The patterns don't cross HTML
# tag boundaries (the "<" stop class on each), so they only touch the
# inline text inside dose cells.
TITRATE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # "; titrate up/down by N mg every M nights to <whatever>"
    (re.compile(r"[;,]\s*titrat\w*[^.;<]*(?:[.;]|(?=<))", re.IGNORECASE), ". "),
    # "(typical landing dose 300-400 mg)" / "(target …)" / "(aim for …)"
    (
        re.compile(
            r"\((?:typical|target|aim for|usually|landing|usual)[^)<]*\)",
            re.IGNORECASE,
        ),
        "",
    ),
    # "back off one step if stool turns loose."
    (re.compile(r"\bback off[^.;<]*(?:[.;]|(?=<))", re.IGNORECASE), ""),
    # "reassess at week N via …"
    (
        re.compile(r"\breassess at week \d+[^.;<]*(?:[.;]|(?=<))", re.IGNORECASE),
        "",
    ),
    # "re-test 25-OH vitamin D at week 12"
    (
        re.compile(
            r"\bre-?test[^.;<]*\b(?:week|month)\b[^.;<]*(?:[.;]|(?=<))",
            re.IGNORECASE,
        ),
        "",
    ),
]


def _clientify_html(html: str) -> tuple[str, int]:
    """Apply all titrate-stripping patterns. Returns (new_html, n_subs)."""
    n = 0
    s = html
    for pat, repl in TITRATE_PATTERNS:
        s, k = pat.subn(repl, s)
        n += k
    # Tidy doubled whitespace + trailing punctuation in dose cells.
    # Limit to whitespace between text characters (don't crush HTML).
    s = re.sub(r"(>[^<]*?)\s{2,}([^<]*<)", r"\1 \2", s)
    s = re.sub(r"\s+\.", ".", s)
    return s, n


def _update_brand_title(html: str) -> tuple[str, bool]:
    """Bump <title>… — Shivani Hari</title> → <title>… — The Ochre Tree</title>.
    Returns (new_html, changed). Idempotent."""
    new = re.sub(
        r"(<title>[^<]*?— )Shivani Hari(</title>)",
        r"\1The Ochre Tree\2",
        html,
        flags=re.IGNORECASE,
    )
    return new, new != html


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / "fm-plans"


def main() -> int:
    root = _plans_root()
    clients_root = root / "clients"
    if not clients_root.exists():
        print(f"[fatal] {clients_root} does not exist", file=sys.stderr)
        return 2

    total_files = 0
    total_subs = 0
    titles_updated = 0
    skipped = 0

    for client_dir in sorted(clients_root.iterdir()):
        meal_plans = client_dir / "meal-plans"
        if not meal_plans.exists():
            continue
        for html_path in sorted(meal_plans.glob("*.html")):
            total_files += 1
            original = html_path.read_text(encoding="utf-8")
            new, n = _clientify_html(original)
            new, title_changed = _update_brand_title(new)
            if n == 0 and not title_changed:
                skipped += 1
                continue
            # Back up original (only if no .bak yet — preserve first state).
            bak = html_path.with_suffix(".html.bak")
            if not bak.exists():
                bak.write_text(original, encoding="utf-8")
            html_path.write_text(new, encoding="utf-8")
            total_subs += n
            if title_changed:
                titles_updated += 1
            rel = html_path.relative_to(root)
            print(
                f"[ok] {rel} — {n} titrate subs"
                + (" + brand title" if title_changed else "")
            )

    print()
    print(f"=== summary ===")
    print(f"  files scanned:    {total_files}")
    print(f"  files unchanged:  {skipped}")
    print(f"  titrate subs:     {total_subs}")
    print(f"  titles updated:   {titles_updated}")
    print(f"  backups written:  .html.bak alongside each modified file")
    return 0


if __name__ == "__main__":
    sys.exit(main())

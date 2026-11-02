#!/usr/bin/env python3
"""Who is in care today. Start every roster sweep here.

    fm-database/.venv/bin/python fm-database-web/scripts/in-care.py          # id, state, name
    fm-database/.venv/bin/python fm-database-web/scripts/in-care.py --ids    # ids only

Having a file in published/ does not mean a client is in care: a lapsed client's
plan stays there forever. This uses the one lifecycle resolver and costs nothing.
"""

from __future__ import annotations

import datetime as dt
import os
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "fm-database"))

from fmdb.plan.lifecycle import IN_CARE, resolve_all  # noqa: E402


def main() -> int:
    root = Path(os.environ.get("FMDB_PLANS_DIR") or Path.home() / "fm-plans").expanduser()
    ids_only = "--ids" in sys.argv
    for cid, lc in sorted(resolve_all(root, dt.date.today()).items()):
        if lc["state"] not in IN_CARE:
            continue
        if ids_only:
            print(cid)
            continue
        client = yaml.safe_load((root / "clients" / cid / "client.yaml").read_text(encoding="utf-8")) or {}
        print(f"{cid}\t{lc['state']}\t{client.get('display_name') or ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

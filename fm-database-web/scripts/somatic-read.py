#!/usr/bin/env python
"""Chief-complaint somatic read for one client → JSON on stdout.

Deterministic: no API call, no cost. Reads the client's active_conditions,
resolves each alias-aware against the catalogue, and returns what the somatic
map says about it.

stdin:  {"client_id": "cl-005"}
stdout: {"ok": true, "reads": [...]}  |  {"ok": false, "error": "..."}
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parents[2] / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))

import yaml  # noqa: E402

from fmdb.assess.somatic_read import read_chief_complaints  # noqa: E402
from fmdb.validator import _resolve_index, load_all  # noqa: E402


def _plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    return Path(env) if env else Path.home() / "fm-plans"


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        client_id = str(payload.get("client_id") or "").strip()
        if not client_id or "/" in client_id or ".." in client_id:
            raise ValueError("valid client_id required")

        cf = _plans_root() / "clients" / client_id / "client.yaml"
        if not cf.exists():
            raise FileNotFoundError(f"no client {client_id}")
        client = yaml.safe_load(cf.read_text()) or {}

        data = FMDB_ROOT / "data"
        loaded = load_all(data)
        sym = _resolve_index(loaded.symptoms)
        top = _resolve_index(loaded.topics)

        def resolve(s: str) -> str:
            return sym.get(s) or top.get(s) or s

        maps = []
        for p in sorted((data / "somatic_maps").glob("*.yaml")):
            try:
                maps.append(yaml.safe_load(p.read_text()))
            except Exception:
                continue

        reads = read_chief_complaints(client, maps, resolve)
        print(json.dumps({
            "ok": True,
            "reads": [
                {
                    "condition": r.condition,
                    "target_slug": r.target_slug,
                    "display_name": r.display_name,
                    "sensitivity": r.sensitivity,
                    "gated": r.gated,
                    "client_safe": r.client_safe,
                    "themes": r.theme_labels,
                    "roots": [{"pattern": p, "note": n} for p, n in r.roots],
                    "reframe": r.reframe,
                    "inquiry_question": r.inquiry_question,
                    "somatic_practice": r.somatic_practice,
                    "differential_note": r.differential_note,
                }
                for r in reads
            ],
        }))
    except Exception as e:  # noqa: BLE001 — the shim contract is a JSON error
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(0)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Detect (and optionally repair) duplicate-key corruption in client.yaml files.

Why this exists — the cl-021 incident (2026-07-07):
  A client.yaml ended up with the SAME top-level keys twice — `null` placeholders
  in their canonical position (app_token / intake_token / *_created_at /
  *_expires_at, ~line 85) AND real values appended at the end of the file. PyYAML
  (yaml.safe_load, last-wins) tolerates duplicate mapping keys, so every Python
  shim kept working and never noticed. js-yaml (the coach-UI + client-app loader)
  REJECTS them — `YAMLException: duplicated mapping key` — which 500'd
  /dashboard-v2 for the whole coach.

  No app write path can produce this: every writer (TS dumpYaml, Python safe_dump)
  loads the whole doc, mutates the in-memory object, and re-dumps — a dict can't
  hold a key twice. The corruption came from an OUT-OF-BAND edit (a hand / AI edit
  of the raw YAML, or a one-off migration that appended text rather than
  load→mutate→dump). loader.ts was hardened to skip an unparseable file instead of
  crashing the listing — but a skipped client silently VANISHES from the dashboard
  and their app goes dark, so we still want to find + fix the file, not just
  survive it. This tool is that safety net: run it on a cron or by hand.

What it does:
  * SCAN (default): parse every clients/<id>/client.yaml with a strict loader that
    raises on duplicate mapping keys (faithful proxy for js-yaml's rejection) and,
    parser-independently, count column-0 keys. Reports every file js-yaml would
    reject and which key(s) are duplicated.
  * REPAIR (--repair): for each corrupt file, load with PyYAML (tolerant, last-wins
    — the same value js-yaml's coach hand-repair kept AND the value every Python
    shim already reads), then re-dump with yaml.safe_dump (the projct's write
    convention — cannot emit a key twice). Backs up the original to
    client.yaml.dupbak-<ts>, writes atomically, and VERIFIES the result is
    dup-free (strict PyYAML + js-yaml when node is available) before keeping it.

Usage:
  python scan-client-yaml-dupes.py [--repair] [--json] [--plans-dir PATH]
Exit: 0 = clean (or all repaired); 1 = corruption found (scan) / repair failed.

Last-wins is the correct repair semantics: the appended real values come after the
null placeholders, so PyYAML's later-key-overrides-earlier keeps the real values —
exactly how cl-021 was hand-repaired, and consistent with what the shims already see.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml  # PyYAML

try:
    from atomic_write import write_text_atomic
except ImportError:  # allow running from anywhere
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from atomic_write import write_text_atomic


class _DupKey(Exception):
    """A duplicate mapping key was found while parsing (what js-yaml rejects)."""


class _StrictLoader(yaml.SafeLoader):
    """SafeLoader that raises on duplicate mapping keys at ANY nesting level,
    mirroring js-yaml's default `duplicated mapping key` rejection."""


def _no_dup_construct(loader: _StrictLoader, node, deep: bool = False):
    mapping: dict = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            line = key_node.start_mark.line + 1  # 1-indexed for humans
            raise _DupKey(f"duplicate key {key!r} at line {line}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_dup_construct
)


def _plans_root(cli: "str | None") -> Path:
    if cli:
        return Path(cli).expanduser().resolve()
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


def _top_level_dupes(raw: str) -> list[tuple[str, int]]:
    """Parser-independent: column-0 `key:` occurrences appearing more than once.
    Directly targets the cl-021 failure mode and needs no YAML library."""
    import re

    counts: dict[str, int] = {}
    for line in raw.split("\n"):
        m = re.match(r"^([A-Za-z0-9_]+):", line)
        if m:
            counts[m.group(1)] = counts.get(m.group(1), 0) + 1
    return sorted([(k, n) for k, n in counts.items() if n > 1])


def _strict_error(raw: str) -> "str | None":
    """None if the strict loader accepts it; else a one-line reason."""
    try:
        yaml.load(raw, Loader=_StrictLoader)
        return None
    except _DupKey as e:
        return str(e)
    except yaml.YAMLError as e:
        return f"YAML parse error: {str(e).splitlines()[0]}"


# ---- optional js-yaml cross-check (authoritative loader parser) --------------

_JS_YAML_CANDIDATES = [
    # main checkout (worktrees share .git but not node_modules)
    Path(__file__).resolve().parents[2] / "fm-database-web" / "node_modules" / "js-yaml",
    Path(__file__).resolve().parents[1] / "node_modules" / "js-yaml",
    Path.home() / "code" / "healwithshivanih-ads" / "fm-database-web" / "node_modules" / "js-yaml",
]


def _js_yaml_dir() -> "Path | None":
    for c in _JS_YAML_CANDIDATES:
        if c.exists():
            return c
    return None


def _js_yaml_ok(text: str) -> "bool | None":
    """True/False if js-yaml (the real loader) accepts `text`; None if unavailable
    (no node / no js-yaml) — caller then relies on the strict-PyYAML check."""
    js = _js_yaml_dir()
    if js is None or shutil.which("node") is None:
        return None
    script = (
        f"const y=require({json.dumps(str(js))});"
        "let s='';process.stdin.on('data',d=>s+=d);"
        "process.stdin.on('end',()=>{try{y.load(s);process.exit(0)}"
        "catch(e){process.stderr.write(String(e.message||e));process.exit(3)}});"
    )
    try:
        p = subprocess.run(
            ["node", "-e", script], input=text, text=True, capture_output=True, timeout=30
        )
        return p.returncode == 0
    except Exception:
        return None


def _iter_client_yamls(root: Path):
    cdir = root / "clients"
    if not cdir.exists():
        return
    for entry in sorted(cdir.iterdir()):
        if entry.is_dir():
            f = entry / "client.yaml"
            if f.exists():
                yield entry.name, f
        elif entry.suffix in (".yaml", ".yml"):  # legacy flat layout
            yield entry.stem, entry


def _repair(cid: str, f: Path) -> dict:
    raw = f.read_text(encoding="utf-8")
    # tolerant load: PyYAML applies last-key-wins, keeping the appended real values
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as e:
        return {"client": cid, "repaired": False, "error": f"unrecoverable: {str(e).splitlines()[0]}"}
    if not isinstance(data, dict):
        return {"client": cid, "repaired": False, "error": "top level is not a mapping"}

    fixed = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)

    # verify the repair is genuinely dup-free before we touch disk
    strict_err = _strict_error(fixed)
    if strict_err:
        return {"client": cid, "repaired": False, "error": f"post-repair still bad: {strict_err}"}
    js_ok = _js_yaml_ok(fixed)
    if js_ok is False:
        return {"client": cid, "repaired": False, "error": "post-repair rejected by js-yaml"}

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = f.with_name(f.name + f".dupbak-{ts}")
    shutil.copy2(f, backup)
    write_text_atomic(f, fixed)
    return {
        "client": cid,
        "repaired": True,
        "backup": str(backup),
        "js_yaml_verified": bool(js_ok),  # False here means "unavailable", not "failed"
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repair", action="store_true", help="rewrite corrupt files (last-wins re-dump)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--plans-dir", default=None, help="override FMDB_PLANS_DIR / ~/fm-plans")
    args = ap.parse_args()

    root = _plans_root(args.plans_dir)
    findings: list[dict] = []
    scanned = 0
    for cid, f in _iter_client_yamls(root):
        scanned += 1
        raw = f.read_text(encoding="utf-8")
        # `err` (a real strict parse) is the authority — it catches duplicate
        # keys at any depth AND other syntax the loader would reject. The column-0
        # counter is only richer human detail (which top-level keys, how many);
        # gating on it alone could false-flag a block scalar whose line resembles
        # `key:`, so it never decides corruption on its own.
        err = _strict_error(raw)
        dupes = _top_level_dupes(raw)
        if err:
            rec = {
                "client": cid,
                "file": str(f),
                "strict_error": err,
                "top_level_dup_keys": {k: n for k, n in dupes},
            }
            if args.repair:
                rec.update(_repair(cid, f))
            findings.append(rec)

    corrupt = len(findings)
    repaired = sum(1 for r in findings if r.get("repaired"))
    failed = sum(1 for r in findings if args.repair and not r.get("repaired"))

    if args.json:
        json.dump(
            {"scanned": scanned, "corrupt": corrupt, "repaired": repaired, "failed": failed, "findings": findings},
            sys.stdout,
            indent=2,
        )
        print()
    else:
        js = _js_yaml_dir()
        print(f"Scanned {scanned} client.yaml under {root}")
        print(f"js-yaml cross-check: {'available' if (js and shutil.which('node')) else 'UNAVAILABLE (strict-PyYAML only)'}")
        if not findings:
            print("✓ No duplicate-key corruption found.")
        for r in findings:
            print(f"\n✗ {r['client']}  ({r['file']})")
            if r.get("strict_error"):
                print(f"    parse: {r['strict_error']}")
            if r.get("top_level_dup_keys"):
                pretty = ", ".join(f"{k}×{n}" for k, n in r["top_level_dup_keys"].items())
                print(f"    duplicate top-level keys: {pretty}")
            if args.repair:
                if r.get("repaired"):
                    print(f"    → REPAIRED (backup: {r['backup']})")
                else:
                    print(f"    → REPAIR FAILED: {r.get('error')}")
        if findings and not args.repair:
            print("\nRe-run with --repair to fix (each original is backed up to .dupbak-<ts>).")

    # exit 1 if anything is still broken (scan found issues, or a repair failed)
    return 1 if (corrupt and not args.repair) or failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Thin shim wrapping the fmdb ingest pipeline for the Next.js UI.

Reads JSON from stdin for all actions.

Action: "ingest"
{
  "action": "ingest",
  "file_path": str,          # absolute path to the uploaded file (or omit if url given)
  "url": str | null,         # alternative to file_path — fetch this URL
  "source_id": str,
  "source_title": str,
  "source_type": str,        # peer_reviewed_paper | book | internal_skill | ...
  "source_quality": str,     # high | moderate | low
  "instructions": str | null
}

Action: "review"
{ "action": "review", "batch_id": str | null }  # null = list all

Action: "approve"
{ "action": "approve", "batch_id": str, "update": bool }

Action: "reject"
{ "action": "reject", "batch_id": str }

Writes JSON to stdout:
{ "ok": bool, "data": any, "error": str | null }
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))
PYTHON = str(FMDB_ROOT / ".venv" / "bin" / "python")


def run_cli(*args: str) -> tuple[str, str, int]:
    env = os.environ.copy()
    env.setdefault("FMDB_EXTRACTOR", "anthropic")
    result = subprocess.run(
        [PYTHON, "-m", "fmdb.cli"] + list(args),
        capture_output=True, text=True, cwd=str(FMDB_ROOT), env=env
    )
    return result.stdout, result.stderr, result.returncode


def emit(payload: dict) -> int:
    json.dump(payload, sys.stdout, default=str)
    return 0 if payload.get("ok") else 1


def fetch_url_to_tempfile(url: str) -> tuple[str, str]:
    """Fetch a URL and save to a temp .md file. Returns (file_path, detected_title)."""
    import requests  # already in venv

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()

    content_type = resp.headers.get("content-type", "")
    parsed = urlparse(url)
    suffix = Path(parsed.path).suffix.lower()

    # Binary file types — save as-is
    if suffix in (".pdf", ".png", ".jpg", ".jpeg", ".webp") or "pdf" in content_type:
        ext = ".pdf" if "pdf" in content_type else (suffix or ".bin")
        tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        tmp.write(resp.content)
        tmp.close()
        # Derive title from URL path
        title = Path(parsed.path).stem.replace("-", " ").replace("_", " ").title()
        return tmp.name, title

    # HTML — convert to markdown text
    try:
        import html2text
        h = html2text.HTML2Text()
        h.ignore_links = False
        h.ignore_images = True
        h.body_width = 0
        text = h.handle(resp.text)
    except ImportError:
        # Fallback: crude strip
        text = re.sub(r"<[^>]+>", " ", resp.text)
        text = re.sub(r"\s+", " ", text).strip()

    # Try to extract title from <title> tag
    title_match = re.search(r"<title[^>]*>([^<]+)</title>", resp.text, re.I)
    title = title_match.group(1).strip() if title_match else parsed.netloc + parsed.path

    tmp = tempfile.NamedTemporaryFile(suffix=".md", delete=False, mode="w", encoding="utf-8")
    tmp.write(f"# {title}\n\nSource URL: {url}\n\n{text}")
    tmp.close()
    return tmp.name, title


def main() -> int:
    raw = sys.stdin.read().strip()
    try:
        inp = json.loads(raw) if raw else {}
    except json.JSONDecodeError as e:
        return emit({"ok": False, "error": f"JSON parse: {e}"})

    action = inp.get("action", "")

    if action == "ingest":
        file_path = inp.get("file_path", "") or ""
        url = inp.get("url", "") or ""
        source_id = inp.get("source_id", "")
        source_title = inp.get("source_title", "") or source_id
        source_type = inp.get("source_type", "book")
        source_quality = inp.get("source_quality", "moderate")
        instructions = inp.get("instructions") or ""
        _tmp_path = None  # track URL-fetched temp file for cleanup

        if not source_id:
            return emit({"ok": False, "error": "source_id is required"})
        if not file_path and not url:
            return emit({"ok": False, "error": "Either file_path or url is required"})

        # Fetch URL to temp file if needed
        if url and not file_path:
            try:
                file_path, detected_title = fetch_url_to_tempfile(url)
                _tmp_path = file_path
                if not source_title or source_title == source_id:
                    source_title = detected_title
            except Exception as e:
                return emit({"ok": False, "error": f"Failed to fetch URL: {e}"})

        cli_args = [
            "ingest", file_path,
            "--source-id", source_id,
            "--source-title", source_title,
            "--source-type", source_type,
            "--source-quality", source_quality,
        ]
        if instructions:
            cli_args += ["--instructions", instructions]

        stdout, stderr, code = run_cli(*cli_args)

        # Clean up URL temp file
        if _tmp_path:
            try:
                Path(_tmp_path).unlink(missing_ok=True)
            except Exception:
                pass

        # Parse batch_id from stdout (format: "Staged batch <id>\n...")
        batch_id = None
        for line in stdout.splitlines():
            if "batch" in line.lower():
                parts = line.split()
                if parts:
                    batch_id = parts[-1]
                    break

        return emit({
            "ok": code == 0,
            "batch_id": batch_id,
            "stdout": stdout,
            "stderr": stderr,
            "error": stderr if code != 0 else None,
        })

    elif action == "review":
        batch_id = inp.get("batch_id")
        if batch_id:
            stdout, stderr, code = run_cli("review", batch_id)
            # Try to parse YAML/JSON output from review
            data = {"raw": stdout, "stderr": stderr}
            # Try to extract entity counts from the stdout
            return emit({"ok": True, "data": data, "stdout": stdout})
        else:
            # List all batches
            stdout, stderr, code = run_cli("review")
            return emit({"ok": True, "data": {"raw": stdout}, "stdout": stdout})

    elif action == "approve":
        batch_id = inp.get("batch_id", "")
        update = inp.get("update", False)
        args = ["approve", batch_id]
        if update:
            args.append("--update")
        stdout, stderr, code = run_cli(*args)
        return emit({
            "ok": code == 0,
            "stdout": stdout,
            "stderr": stderr,
            "error": stderr if code != 0 else None,
        })

    elif action == "reject":
        batch_id = inp.get("batch_id", "")
        stdout, stderr, code = run_cli("reject", batch_id)
        return emit({
            "ok": code == 0,
            "stdout": stdout,
            "error": stderr if code != 0 else None,
        })

    elif action == "list_staged_entities":
        batch_id = inp.get("batch_id", "")
        batch_dir = FMDB_ROOT / "data" / "staging" / batch_id
        meta_path = batch_dir / "_meta.json"
        if not meta_path.exists():
            return emit({"ok": False, "error": "batch not found"})
        try:
            import yaml as _yaml
            meta = json.loads(meta_path.read_text())
            entries = meta.get("entries", [])
            result = []
            for entry in entries:
                entity = entry.get("entity", "")
                slug = entry.get("slug", "")
                status = entry.get("status", "")
                if entity == "sources":
                    continue  # source entity is metadata, not user-editable here
                rel_path = entry.get("path", "")
                yaml_path = FMDB_ROOT / "data" / rel_path if rel_path else batch_dir / entity / f"{slug}.yaml"
                if not yaml_path.exists():
                    continue
                try:
                    data = _yaml.safe_load(yaml_path.read_text()) or {}
                except Exception:
                    data = {}
                result.append({
                    "entity": entity,
                    "slug": slug,
                    "status": status,
                    "display_name": data.get("display_name") or slug,
                    "linked_to_topics": data.get("linked_to_topics") or [],
                    "linked_to_mechanisms": data.get("linked_to_mechanisms") or [],
                    "linked_to_supplements": data.get("linked_to_supplements") or [],
                    "linked_to_claims": data.get("linked_to_claims") or [],
                    "notes_for_coach": data.get("notes_for_coach") or "",
                })
            return emit({"ok": True, "entities": result})
        except Exception as e:
            return emit({"ok": False, "error": str(e)})

    elif action == "patch_staged_entity":
        batch_id = inp.get("batch_id", "")
        entity_kind = inp.get("entity_kind", "")
        slug = inp.get("slug", "")
        patch = inp.get("patch", {})
        yaml_path = FMDB_ROOT / "data" / "staging" / batch_id / entity_kind / f"{slug}.yaml"
        if not yaml_path.exists():
            return emit({"ok": False, "error": f"staged file not found: {entity_kind}/{slug}.yaml"})
        try:
            import yaml as _yaml
            data = _yaml.safe_load(yaml_path.read_text()) or {}
            # Union-merge list fields
            for lf in ["linked_to_topics", "linked_to_mechanisms", "linked_to_supplements", "linked_to_claims"]:
                if lf in patch and patch[lf]:
                    existing = data.get(lf) or []
                    merged = list(dict.fromkeys(existing + [s.strip() for s in patch[lf] if s.strip()]))
                    data[lf] = merged
            # Overwrite string fields
            for sf in ["notes_for_coach", "coaching_translation"]:
                if sf in patch and patch[sf]:
                    data[sf] = patch[sf]
            yaml_path.write_text(_yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False))
            return emit({"ok": True})
        except Exception as e:
            return emit({"ok": False, "error": str(e)})

    elif action == "batch_status":
        batch_id = inp.get("batch_id", "")
        meta_path = FMDB_ROOT / "data" / "staging" / batch_id / "_meta.json"
        if not meta_path.exists():
            return emit({"ok": False, "status": None, "error": "batch not found"})
        try:
            meta = json.loads(meta_path.read_text())
            status = meta.get("status")  # None | "approved" | "rejected"
            entry_count = len(meta.get("entries") or [])
            return emit({"ok": True, "status": status, "entry_count": entry_count})
        except Exception as e:
            return emit({"ok": False, "status": None, "error": str(e)})

    elif action == "count_pending":
        staging_dir = FMDB_ROOT / "data" / "staging"
        count = 0
        if staging_dir.exists():
            for batch_dir in staging_dir.iterdir():
                if not batch_dir.is_dir():
                    continue
                meta_path = batch_dir / "_meta.json"
                if not meta_path.exists():
                    continue
                try:
                    meta = json.loads(meta_path.read_text())
                    if meta.get("status") is None and meta.get("entries"):
                        count += 1
                except Exception:
                    pass
        return emit({"ok": True, "count": count})

    elif action == "approve_all":
        staging_dir = FMDB_ROOT / "data" / "staging"
        pending = []
        if staging_dir.exists():
            for batch_dir in sorted(staging_dir.iterdir()):
                if not batch_dir.is_dir():
                    continue
                meta_path = batch_dir / "_meta.json"
                if not meta_path.exists():
                    continue
                try:
                    meta = json.loads(meta_path.read_text())
                    if meta.get("status") is None and meta.get("entries"):
                        pending.append(batch_dir.name)
                except Exception:
                    pass

        approved, failed, skipped = 0, 0, 0
        errors: list[str] = []
        log: list[str] = []

        for batch_id in pending:
            stdout, stderr, code = run_cli("approve", batch_id, "--update")
            combined = (stdout + stderr).lower()
            if code == 0:
                approved += 1
                log.append(f"✓ {batch_id}")
            elif "staged file missing" in combined or "no staged files" in combined or "already approved" in combined:
                # Batch was previously approved but _meta.json status was never updated.
                # Mark it as skipped (already done) rather than a failure.
                skipped += 1
                # Mark the meta.json so we don't try again next time
                try:
                    meta_path = staging_dir / batch_id / "_meta.json"
                    if meta_path.exists():
                        meta = json.loads(meta_path.read_text())
                        meta["status"] = "approved"
                        meta_path.write_text(json.dumps(meta, indent=2, default=str))
                except Exception:
                    pass
                log.append(f"↷ {batch_id} (already approved — marked done)")
            else:
                # Some failures are soft (alias conflicts) — check if partially ok
                if "error" in combined or "traceback" in combined:
                    failed += 1
                    err_msg = stderr.strip().splitlines()[-1] if stderr.strip() else "unknown error"
                    errors.append(f"{batch_id}: {err_msg}")
                    log.append(f"✗ {batch_id}: {err_msg}")
                else:
                    # Non-zero but no hard error (e.g. warnings only) — count as ok
                    approved += 1
                    log.append(f"~ {batch_id} (warnings)")

        return emit({
            "ok": True,
            "approved": approved,
            "failed": failed,
            "skipped": skipped,
            "total": len(pending),
            "errors": errors,
            "log": log,
        })

    else:
        return emit({"ok": False, "error": f"Unknown action: {action!r}"})


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Shim: update notes_for_coach on a catalogue entity (topic/supplement/mechanism/symptom/claim).
Reads JSON from stdin: { kind, slug, notes }
Writes the notes_for_coach field directly to the YAML file on disk.
Returns { ok, error? }
"""
import json
import sys
import os
from datetime import date
from pathlib import Path

import yaml

FMDB_ROOT = Path(os.environ.get("FMDB_CATALOGUE_DIR", Path(__file__).parents[2] / "fm-database" / "data"))

# Map from Next.js kind names → data directory names
KIND_TO_DIR = {
    "topics": "topics",
    "topic": "topics",
    "supplements": "supplements",
    "supplement": "supplements",
    "mechanisms": "mechanisms",
    "mechanism": "mechanisms",
    "symptoms": "symptoms",
    "symptom": "symptoms",
    "claims": "claims",
    "claim": "claims",
    "sources": "sources",
    "source": "sources",
}

def main():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Invalid JSON input: {e}"}))
        return

    kind = payload.get("kind", "")
    slug = payload.get("slug", "")
    notes = payload.get("notes", "")

    if not kind or not slug:
        print(json.dumps({"ok": False, "error": "kind and slug are required"}))
        return

    dir_name = KIND_TO_DIR.get(kind)
    if not dir_name:
        print(json.dumps({"ok": False, "error": f"Unsupported kind: {kind!r}"}))
        return

    entity_dir = FMDB_ROOT / dir_name
    yaml_path = entity_dir / f"{slug}.yaml"

    if not yaml_path.exists():
        print(json.dumps({"ok": False, "error": f"File not found: {yaml_path}"}))
        return

    try:
        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        data["notes_for_coach"] = notes.strip()
        data["updated_at"] = date.today().isoformat()
        data["updated_by"] = "shivani"

        with open(yaml_path, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, sort_keys=False, default_flow_style=False)

        print(json.dumps({"ok": True}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))

if __name__ == "__main__":
    main()

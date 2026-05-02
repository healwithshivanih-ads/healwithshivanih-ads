"""Filesystem storage for Resources. Default root: ~/fm-resources/

Layout:
    <root>/
      resources/<slug>.yaml      # one record per resource
      files/                     # uploaded copies (optional — file_path can also point outside)
      _audit.jsonl
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import yaml

from .models import Resource


def resources_root(override: str | Path | None = None) -> Path:
    if override is not None:
        return Path(override).expanduser().resolve()
    env = os.environ.get("FMDB_RESOURCES_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return (Path.home() / "fm-resources").resolve()


def ensure_layout(root: Path) -> None:
    (root / "resources").mkdir(parents=True, exist_ok=True)
    (root / "files").mkdir(parents=True, exist_ok=True)


def resource_path(root: Path, slug: str) -> Path:
    return root / "resources" / f"{slug}.yaml"


def write_resource(root: Path, r: Resource) -> Path:
    ensure_layout(root)
    p = resource_path(root, r.slug)
    p.write_text(yaml.safe_dump(r.model_dump(mode="json"), sort_keys=False, allow_unicode=True))
    return p


def load_resource(root: Path, slug: str) -> Resource:
    p = resource_path(root, slug)
    if not p.exists():
        raise FileNotFoundError(f"resource not found: {slug} (looked in {p})")
    return Resource(**yaml.safe_load(p.read_text()))


def list_resources(root: Path) -> list[Resource]:
    ensure_layout(root)
    out: list[Resource] = []
    d = root / "resources"
    for path in sorted(d.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        try:
            out.append(Resource(**yaml.safe_load(path.read_text())))
        except Exception as e:
            print(f"WARN: skipping {path}: {e}")
    return out


def delete_resource(root: Path, slug: str) -> bool:
    p = resource_path(root, slug)
    if p.exists():
        p.unlink()
        return True
    return False

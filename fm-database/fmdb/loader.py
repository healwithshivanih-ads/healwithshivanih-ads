from pathlib import Path

import yaml

from .models import Supplement


def load_supplements(data_dir: Path) -> list[Supplement]:
    supplements_dir = data_dir / "supplements"
    if not supplements_dir.exists():
        return []
    out = []
    for path in sorted(supplements_dir.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        with path.open() as f:
            raw = yaml.safe_load(f)
        out.append(Supplement(**raw))
    return out


def load_supplement(data_dir: Path, slug: str) -> Supplement:
    path = data_dir / "supplements" / f"{slug}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"supplement not found: {slug}")
    with path.open() as f:
        raw = yaml.safe_load(f)
    return Supplement(**raw)

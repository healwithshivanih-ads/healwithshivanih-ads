from pathlib import Path

import yaml

from .models import Claim, CookingAdjustment, HomeRemedy, Mechanism, MindMap, Source, Supplement, Symptom, Topic


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


def load_sources(data_dir: Path) -> list[Source]:
    sources_dir = data_dir / "sources"
    if not sources_dir.exists():
        return []
    out = []
    for path in sorted(sources_dir.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        with path.open() as f:
            raw = yaml.safe_load(f)
        out.append(Source(**raw))
    return out


def load_cooking_adjustments(data_dir: Path) -> list[CookingAdjustment]:
    d = data_dir / "cooking_adjustments"
    if not d.exists():
        return []
    out = []
    for path in sorted(d.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        with path.open() as f:
            raw = yaml.safe_load(f)
        out.append(CookingAdjustment(**raw))
    return out


def load_cooking_adjustment(data_dir: Path, slug: str) -> CookingAdjustment:
    path = data_dir / "cooking_adjustments" / f"{slug}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"cooking_adjustment not found: {slug}")
    with path.open() as f:
        raw = yaml.safe_load(f)
    return CookingAdjustment(**raw)


def load_home_remedies(data_dir: Path) -> list[HomeRemedy]:
    d = data_dir / "home_remedies"
    if not d.exists():
        return []
    out = []
    for path in sorted(d.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        with path.open() as f:
            raw = yaml.safe_load(f)
        out.append(HomeRemedy(**raw))
    return out


def load_home_remedy(data_dir: Path, slug: str) -> HomeRemedy:
    path = data_dir / "home_remedies" / f"{slug}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"home_remedy not found: {slug}")
    with path.open() as f:
        raw = yaml.safe_load(f)
    return HomeRemedy(**raw)


def load_symptoms(data_dir: Path) -> list[Symptom]:
    syms_dir = data_dir / "symptoms"
    if not syms_dir.exists():
        return []
    out = []
    for path in sorted(syms_dir.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        with path.open() as f:
            raw = yaml.safe_load(f)
        out.append(Symptom(**raw))
    return out


def load_symptom(data_dir: Path, slug: str) -> Symptom:
    path = data_dir / "symptoms" / f"{slug}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"symptom not found: {slug}")
    with path.open() as f:
        raw = yaml.safe_load(f)
    return Symptom(**raw)


def load_mindmaps(data_dir: Path) -> list[MindMap]:
    d = data_dir / "mindmaps"
    if not d.exists():
        return []
    out = []
    for path in sorted(d.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        with path.open() as f:
            raw = yaml.safe_load(f)
        out.append(MindMap(**raw))
    return out


def load_mindmap(data_dir: Path, slug: str) -> MindMap:
    path = data_dir / "mindmaps" / f"{slug}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"mindmap not found: {slug}")
    with path.open() as f:
        raw = yaml.safe_load(f)
    return MindMap(**raw)


def load_mechanisms(data_dir: Path) -> list[Mechanism]:
    mechs_dir = data_dir / "mechanisms"
    if not mechs_dir.exists():
        return []
    out = []
    for path in sorted(mechs_dir.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        with path.open() as f:
            raw = yaml.safe_load(f)
        out.append(Mechanism(**raw))
    return out


def load_mechanism(data_dir: Path, slug: str) -> Mechanism:
    path = data_dir / "mechanisms" / f"{slug}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"mechanism not found: {slug}")
    with path.open() as f:
        raw = yaml.safe_load(f)
    return Mechanism(**raw)


def load_claims(data_dir: Path) -> list[Claim]:
    claims_dir = data_dir / "claims"
    if not claims_dir.exists():
        return []
    out = []
    for path in sorted(claims_dir.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        with path.open() as f:
            raw = yaml.safe_load(f)
        out.append(Claim(**raw))
    return out


def load_claim(data_dir: Path, slug: str) -> Claim:
    path = data_dir / "claims" / f"{slug}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"claim not found: {slug}")
    with path.open() as f:
        raw = yaml.safe_load(f)
    return Claim(**raw)


def load_topics(data_dir: Path) -> list[Topic]:
    topics_dir = data_dir / "topics"
    if not topics_dir.exists():
        return []
    out = []
    for path in sorted(topics_dir.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        with path.open() as f:
            raw = yaml.safe_load(f)
        out.append(Topic(**raw))
    return out


def load_topic(data_dir: Path, slug: str) -> Topic:
    path = data_dir / "topics" / f"{slug}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"topic not found: {slug}")
    with path.open() as f:
        raw = yaml.safe_load(f)
    return Topic(**raw)


def load_source(data_dir: Path, source_id: str) -> Source:
    path = data_dir / "sources" / f"{source_id}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"source not found: {source_id}")
    with path.open() as f:
        raw = yaml.safe_load(f)
    return Source(**raw)

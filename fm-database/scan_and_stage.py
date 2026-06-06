#!/usr/bin/env python3
"""Collision pre-scan + stage for an in-chat ATE extraction.

1. Loads the entities JSON and the live catalogue.
2. Flags collisions: a new canonical slug that already exists as an ALIAS of a
   different entity (the approve-time error), or a new alias that equals an
   existing canonical of the same kind.
3. If clean, stages via the real staging.stage(). If not, prints collisions and
   exits non-zero WITHOUT staging so they can be fixed first.

Usage: same args as ingest_from_json.py (--doc --json --source-id --source-title
       --source-type --source-quality --author --year)
"""
import argparse, glob, json, os, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import yaml
from fmdb.ingest.types import ExtractionResult, IngestRequest
from fmdb.ingest import staging
try:
    from fmdb.ingest import audit
except Exception:
    audit = None

DATA = HERE / "data"
KINDS = {"topics": "topics", "mechanisms": "mechanisms", "symptoms": "symptoms", "claims": "claims", "supplements": "supplements"}


REQUIRED = {
    "topics": ["slug", "display_name", "summary", "evidence_tier"],
    "mechanisms": ["slug", "display_name", "category", "summary", "evidence_tier"],
    "symptoms": ["slug", "display_name", "category", "description"],
    "claims": ["slug", "statement", "evidence_tier", "rationale"],
    "supplements": ["slug", "display_name", "category", "evidence_tier"],
}


def scan(payload):
    problems = []
    # required-field check (catches e.g. a claim missing 'rationale' before staging rejects it)
    for jkey, req in REQUIRED.items():
        for e in payload.get(jkey, []):
            miss = [f for f in req if not e.get(f)]
            if miss:
                problems.append(f"{jkey}/{e.get('slug','?')}  missing required field(s): {', '.join(miss)}")
    for jkey, folder in KINDS.items():
        alias_owner, canon = {}, set()
        for f in glob.glob(str(DATA / folder / "*.yaml")):
            try:
                d = yaml.safe_load(open(f))
            except Exception:
                continue
            if not isinstance(d, dict):
                continue
            s = d.get("slug") or os.path.basename(f)[:-5]
            canon.add(s)
            for a in (d.get("aliases") or []):
                alias_owner[str(a).strip().lower()] = s
        for e in payload.get(jkey, []):
            sl = (e.get("slug") or "").strip().lower()
            if sl in alias_owner and alias_owner[sl] != sl:
                problems.append(f"{folder}/{sl}  is an ALIAS of existing '{alias_owner[sl]}'  (rename/drop)")
            for a in (e.get("aliases") or []):
                al = str(a).strip().lower()
                if al in canon and al != sl:
                    problems.append(f"{folder}/{sl}  alias '{al}' == existing canonical (drop that alias)")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--doc", required=True); ap.add_argument("--json", required=True)
    ap.add_argument("--source-id", required=True); ap.add_argument("--source-title", required=True)
    ap.add_argument("--source-type", default="expert_consensus"); ap.add_argument("--source-quality", default="moderate")
    ap.add_argument("--author", action="append", default=[]); ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--updated-by", default="shivani")
    a = ap.parse_args()

    payload = json.loads(Path(a.json).read_text())
    problems = scan(payload)
    if problems:
        print("COLLISIONS — not staged. Fix these first:")
        for p in problems:
            print("  ✗ " + p)
        sys.exit(1)

    doc_text = Path(a.doc).read_text(encoding="utf-8")
    result = ExtractionResult(
        topics=payload.get("topics", []), mechanisms=payload.get("mechanisms", []),
        symptoms=payload.get("symptoms", []), claims=payload.get("claims", []),
        supplements=payload.get("supplements", []), usage={"backend": "in_chat"},
    )
    extra = {}
    if a.author: extra["authors"] = list(a.author)
    if a.year: extra["year"] = a.year
    req = IngestRequest(document_text=doc_text, source_id=a.source_id, source_title=a.source_title,
                        source_type=a.source_type, source_quality=a.source_quality, source_extra=extra)
    batch_id = staging.make_batch_id(req, doc_text)
    manifest = staging.stage(req, result, data_dir=DATA, batch_id=batch_id, updated_by=a.updated_by, doc_text=doc_text)
    counts = {}
    for e in manifest["entries"]:
        counts[(e["entity"], e["status"])] = counts.get((e["entity"], e["status"]), 0) + 1
    print(f"Batch: {batch_id}")
    for (ent, st), n in sorted(counts.items()):
        print(f"  {ent:12s} {st:10s} {n}")


if __name__ == "__main__":
    main()

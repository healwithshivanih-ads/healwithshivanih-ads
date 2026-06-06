#!/usr/bin/env python3
"""Stage an in-chat-extracted ExtractionResult into FM Coach (no API extractor).

Claude does the extraction in chat and writes a JSON of entities matching the
AnthropicExtractor's tool schema. This script feeds that JSON straight into the
real staging.stage() so it goes through the normal validation + review/approve
flow — exactly as `fmdb ingest --extractor anthropic` would, minus the API call.

Usage:
  python ingest_from_json.py --doc <transcript.md> --json <entities.json> \
      --source-id ask-expert-<slug> --source-title "Ask the Expert: ..." \
      --source-type expert_consensus --source-quality moderate \
      --author "Dr. X" --year 2026
"""
import argparse, json, os, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fmdb.ingest.types import ExtractionResult, IngestRequest  # noqa: E402
from fmdb.ingest import staging  # noqa: E402
try:
    from fmdb.ingest import audit  # noqa: E402
except Exception:
    audit = None

DATA_DIR = HERE / "data"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--doc", required=True)
    ap.add_argument("--json", required=True)
    ap.add_argument("--source-id", required=True)
    ap.add_argument("--source-title", required=True)
    ap.add_argument("--source-type", default="expert_consensus")
    ap.add_argument("--source-quality", default="moderate")
    ap.add_argument("--author", action="append", default=[])
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--updated-by", default="shivani")
    a = ap.parse_args()

    doc_text = Path(a.doc).read_text(encoding="utf-8")
    payload = json.loads(Path(a.json).read_text(encoding="utf-8"))
    result = ExtractionResult(
        sources=payload.get("sources", []),
        topics=payload.get("topics", []),
        mechanisms=payload.get("mechanisms", []),
        symptoms=payload.get("symptoms", []),
        claims=payload.get("claims", []),
        supplements=payload.get("supplements", []),
        usage={"backend": "in_chat", "model": "manual-extraction"},
    )
    extra = {}
    if a.author:
        extra["authors"] = list(a.author)
    if a.year:
        extra["year"] = a.year
    req = IngestRequest(
        document_text=doc_text, source_id=a.source_id,
        source_title=a.source_title, source_type=a.source_type,
        source_quality=a.source_quality, source_extra=extra,
    )
    batch_id = staging.make_batch_id(req, doc_text)
    manifest = staging.stage(
        req, result, data_dir=DATA_DIR, batch_id=batch_id,
        updated_by=a.updated_by, doc_text=doc_text,
    )
    if audit:
        try:
            audit.append(DATA_DIR, "ingest", batch_id=batch_id, source_id=req.source_id,
                         backend="in_chat", doc_path=a.doc,
                         n_entries=len(manifest["entries"]), usage=result.usage)
        except Exception:
            pass

    counts = {}
    for e in manifest["entries"]:
        counts[(e["entity"], e["status"])] = counts.get((e["entity"], e["status"]), 0) + 1
    print(f"Batch: {batch_id}")
    for (ent, st), n in sorted(counts.items()):
        print(f"  {ent:12s} {st:10s} {n}")
    print(f"Review with:  fmdb review {batch_id}")


if __name__ == "__main__":
    main()

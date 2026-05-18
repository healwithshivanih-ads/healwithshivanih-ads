#!/bin/bash
# run-pizzorno-queue.sh — fire all queued Pizzorno chapter ingests in sequence.
#
# Anthropic API limit hit 2026-05-18, resets 2026-06-01. PDFs are
# pre-extracted at ~/fm-plans/_pizzorno_queue/. Run this script any time
# from 2026-06-01 onward:
#
#   cd ~/code/healwithshivanih-ads/fm-database
#   bash scripts/run-pizzorno-queue.sh
#
# For each entry: ingest → run bidirectional alias-collision fix →
# approve --update. Stops on first failure so you can inspect manually.
#
# Cost estimate: ~$0.40-0.60 total at the current Sonnet rate
# (mostly cache hits on the second batch onward, ~$0.10-0.15 each cold).

set -e
cd "$(dirname "$0")/.."
QUEUE_DIR="$HOME/fm-plans/_pizzorno_queue"

declare -a BATCHES=(
  "pizzorno-ai-thyroid-autoimm.pdf|pizzorno-autoimmune-thyroid|Pizzorno & Murray — Graves' disease + Hashimoto's (pp 434-490)|Topics for Hashimoto's thyroiditis and Graves' disease. Mechanisms: TPO autoantibodies, TSI antibodies, molecular mimicry, T-cell mediated destruction, TR-ab signalling, iodine load, selenium GPx activity, T4-to-T3 conversion impairment."
  "pizzorno-ai-ms.pdf|pizzorno-autoimmune-ms|Pizzorno & Murray — Multiple sclerosis (pp 691-705)|Topic for multiple sclerosis. Mechanisms: blood-brain-barrier permeability, demyelination, vitamin D status, EBV reactivation, molecular mimicry, autoimmune-flare drivers, gut-brain axis."
  "pizzorno-ai-ra.pdf|pizzorno-autoimmune-ra|Pizzorno & Murray — Rheumatoid arthritis (pp 888-906)|Topic for rheumatoid arthritis. Mechanisms: synovial inflammation, citrullinated-protein autoimmunity, joint destruction cascade, intestinal permeability link, autoimmune-flares, RF + anti-CCP serology context."
  "pizzorno-women.pdf|pizzorno-womens-health|Pizzorno & Murray — Women's Health (pp 637-661)|Topics for perimenopause / menopause / PCOS / fibroids / endometriosis as covered. Mechanisms: estrogen-driven-cell-proliferation, hormonal-imbalance, ovulatory dysfunction, anovulation, estrobolome influence, progesterone deficiency."
  "pizzorno-oxalate.pdf|pizzorno-oxalate-stones|Pizzorno & Murray — Calcium Oxalate Stones (pp 601-612)|Topic for oxalate kidney stones. Mechanisms: oxalate-accumulation, oxalate-renal-accumulation, calcium-binding-deficit, gut oxalate absorption + Oxalobacter formigenes."
  "pizzorno-sleep.pdf|pizzorno-sleep-hpa|Pizzorno & Murray — Sleep + HPA (pp 578-586)|Topic for insomnia + sleep disorders. Mechanisms: circadian-rhythm-disruption, cortisol awakening response, melatonin onset shift, sleep architecture loss, HPA reactivity."
  "pizzorno-mood.pdf|pizzorno-affective|Pizzorno & Murray — Affective Disorders (pp 983-992)|Topics for depression / mood-disturbances / maternal-mental-health. Mechanisms: serotonin/dopamine/norepinephrine, HPA dysregulation, gut-brain axis, neuroinflammation, methylation contributions."
)

PYTHON=".venv/bin/python"

for entry in "${BATCHES[@]}"; do
  IFS='|' read -r pdf sid title focus <<< "$entry"
  PATH_PDF="$QUEUE_DIR/$pdf"
  if [[ ! -f "$PATH_PDF" ]]; then
    echo "SKIP: $pdf not found at $PATH_PDF"
    continue
  fi
  echo
  echo "=============================================================="
  echo "$sid"
  echo "=============================================================="
  $PYTHON -m fmdb.cli ingest "$PATH_PDF" \
    --source-id "$sid" \
    --source-title "$title" \
    --source-type textbook --source-quality high \
    --instructions "Structured catalogue extraction. $focus Claims ≤2 sentences each, evidence_tier, source citation. Reuse existing canonical slugs. Short structured YAML only." 2>&1 | tail -12

  # Apply the bidirectional alias-collision fix to the latest staged batch.
  LATEST=$(ls -t data/staging | grep "^[0-9]" | grep -i "$sid" | head -1)
  if [[ -z "$LATEST" ]]; then
    echo "ERROR: couldn't find newly-staged batch for $sid — stopping"
    exit 1
  fi
  echo "[fix] applying alias-collision sweep to $LATEST"
  BATCH="$LATEST" $PYTHON <<'PY'
import yaml, pathlib, re, os
DATA = pathlib.Path("data"); STAGED = DATA / "staging" / os.environ["BATCH"]
def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
for kind in ("symptoms","topics","mechanisms","supplements"):
    if not (STAGED/kind).exists(): continue
    slugs, staged = set(), set()
    for p in (DATA/kind).glob("*.yaml"):
        d=yaml.safe_load(p.read_text()) or {}
        if d.get("slug"): slugs.add(d["slug"])
    for p in (STAGED/kind).glob("*.yaml"):
        d=yaml.safe_load(p.read_text()) or {}
        if d.get("slug"): slugs.add(d["slug"]); staged.add(d["slug"])
    for p in (STAGED/kind).glob("*.yaml"):
        d=yaml.safe_load(p.read_text()) or {}
        own,al=d.get("slug"),d.get("aliases") or []
        keep=[a for a in al if not (isinstance(a,str) and slug(a)!=own and (slug(a) in slugs or a in slugs))]
        if len(keep)!=len(al): d["aliases"]=keep; p.write_text(yaml.safe_dump(d, sort_keys=False, allow_unicode=True))
    for p in (DATA/kind).glob("*.yaml"):
        d=yaml.safe_load(p.read_text()) or {}
        if d.get("slug") in staged: continue
        al=d.get("aliases") or []
        keep=[a for a in al if not (isinstance(a,str) and (slug(a) in staged or a in staged))]
        if len(keep)!=len(al): d["aliases"]=keep; p.write_text(yaml.safe_dump(d, sort_keys=False, allow_unicode=True))
PY

  echo "[approve] $LATEST"
  $PYTHON -m fmdb.cli approve "$LATEST" --update 2>&1 | tail -4
done

echo
echo "=============================================================="
echo "QUEUE COMPLETE. Review with: git status fm-database/data | head"
echo "Then commit + push as usual."
echo "=============================================================="

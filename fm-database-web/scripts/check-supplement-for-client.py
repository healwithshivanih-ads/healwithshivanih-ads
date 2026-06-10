#!/usr/bin/env python3
"""Check a single supplement / home-remedy for ONE client — one-click suitability.

Deterministic (no API). Resolves the query (alias-aware) against the catalogue
supplements + home_remedies, then scores it against the client's:
  - active conditions + medical history  (catalogue contraindications)
  - current medications                  (interactions + contraindicated meds)
  - dosha — BOTH vikruti (current imbalance, from ayurveda_assessment) AND
    prakruti (lifelong constitution, parsed from ayurveda_constitution)

Returns a structured verdict the coach reads in the "🔍 Check supplement" widget.

Input (argv[1] = JSON): {"client_id": "cl-005", "query": "guggul"}
Output (stdout JSON):   {"ok": true, "result": {...}} | {"ok": false, "error": "..."}
"""
import json
import os
import sys
from pathlib import Path

FMDB_ROOT = Path(os.environ.get("FMDB_CATALOGUE_DIR") or "../fm-database/data").resolve()
# When invoked from fm-database-web, the catalogue lives at ../fm-database/data;
# add the package root so `import fmdb` works.
sys.path.insert(0, str(FMDB_ROOT.parent))


def _doshas_in(text: str) -> list[str]:
    t = (text or "").lower()
    return [d for d in ("vata", "pitta", "kapha") if d in t]


def _hits(needles: list[str], haystack_items: list[str]) -> list[str]:
    """Case-insensitive bidirectional substring match. Returns the client-side
    items that matched any needle."""
    out = []
    lows = [(h, h.lower()) for h in haystack_items if h]
    for n in needles:
        nl = (n or "").strip().lower()
        if not nl:
            continue
        for orig, hl in lows:
            if nl in hl or hl in nl:
                if orig not in out:
                    out.append(orig)
    return out


def main() -> int:
    try:
        payload = json.loads(sys.argv[1]) if len(sys.argv) > 1 else json.load(sys.stdin)
    except Exception as e:
        json.dump({"ok": False, "error": f"bad input: {e}"}, sys.stdout)
        return 1

    client_id = payload.get("client_id")
    query = (payload.get("query") or "").strip()
    if not client_id or not query:
        json.dump({"ok": False, "error": "client_id and query required"}, sys.stdout)
        return 1

    from fmdb.validator import load_all, overlay, _resolve_index
    from fmdb.plan import storage as ps

    cat = overlay(load_all(FMDB_ROOT))
    supp_idx = _resolve_index(cat.supplements)
    hr_idx = _resolve_index(cat.home_remedies)
    supp_by_slug = {s.slug: s for s in cat.supplements}
    hr_by_slug = {h.slug: h for h in cat.home_remedies}

    # Resolve query → entry. Try supplement first, then home_remedy.
    # Accept exact slug, alias, or slugified free text.
    q_slug = query.lower().replace(" ", "-")
    entry = None
    kind = None
    for cand in (query.lower(), q_slug):
        if cand in supp_idx:
            entry = supp_by_slug[supp_idx[cand]]; kind = "supplement"; break
        if cand in hr_idx:
            entry = hr_by_slug[hr_idx[cand]]; kind = "home_remedy"; break
    # Loose fallback: substring against display names / slugs.
    if entry is None:
        ql = query.lower()
        for s in cat.supplements:
            if ql in s.slug or ql in (s.display_name or "").lower():
                entry = s; kind = "supplement"; break
        if entry is None:
            for h in cat.home_remedies:
                if ql in h.slug or ql in (h.display_name or "").lower():
                    entry = h; kind = "home_remedy"; break

    if entry is None:
        # Offer a few suggestions
        ql = query.lower()
        sugg = [s.slug for s in cat.supplements if any(w in s.slug for w in ql.split())][:5]
        sugg += [h.slug for h in cat.home_remedies if any(w in h.slug for w in ql.split())][:5]
        json.dump({"ok": True, "result": {"found": False, "query": query, "suggestions": sugg[:8]}}, sys.stdout)
        return 0

    try:
        client = ps.load_client(ps.plans_root(), client_id)
    except Exception as e:
        json.dump({"ok": False, "error": f"client load failed: {e}"}, sys.stdout)
        return 1

    conditions = list(client.active_conditions or []) + list(client.medical_history or [])
    meds = list(client.current_medications or [])

    cautions: list[dict] = []   # {severity, kind, detail}
    supports: list[str] = []

    # ---- contraindications + interactions ----
    if kind == "supplement":
        cond_hits = _hits(list(entry.contraindications.conditions or []), conditions)
        for c in cond_hits:
            cautions.append({"severity": "avoid", "kind": "contraindication",
                             "detail": f"Contraindicated with the client's condition: {c}"})
        med_hits = _hits(list(entry.contraindications.medications or []), meds)
        for m in med_hits:
            cautions.append({"severity": "avoid", "kind": "contraindication",
                             "detail": f"Contraindicated with the client's medication: {m}"})
        for mi in (entry.interactions.with_medications or []):
            if _hits([mi.medication], meds):
                sev = "avoid" if mi.type.value == "avoid_together" else "caution"
                cautions.append({"severity": sev, "kind": "med_interaction",
                                 "detail": f"Interacts with {mi.medication}: {mi.reason or mi.type.value}"})
        bal = [d.value for d in entry.balances_dosha]
        agg = [d.value for d in entry.aggravates_dosha]
        evidence_tier = entry.evidence_tier.value
        contraindication_list = list(entry.contraindications.conditions or []) + list(entry.contraindications.medications or [])
        virya = getattr(entry, "virya", None)
        virya = virya.value if virya else ""
    else:  # home_remedy — contraindications are free-text
        contra = list(entry.contraindications or [])
        ch = _hits(contra, conditions + meds)
        for c in ch:
            cautions.append({"severity": "caution", "kind": "contraindication",
                             "detail": f"Listed contraindication may apply (matches client's {c})"})
        bal = [d.value for d in entry.balances_dosha]
        agg = [d.value for d in entry.aggravates_dosha]
        evidence_tier = entry.evidence_tier.value
        contraindication_list = contra
        virya = ""

    # ---- dosha match (vikruti + prakruti) ----
    assess = client.ayurveda_assessment if isinstance(client.ayurveda_assessment, dict) else {}
    vikruti = [str(d).lower() for d in (assess.get("vikruti_doshas") or [])]
    prakruti = _doshas_in(getattr(client, "ayurveda_constitution", "") or "")

    agg_set = set(agg)
    vik_agg = sorted(agg_set & set(vikruti))
    pra_agg = sorted(agg_set & set(prakruti))
    bal_set = set(bal)
    relevant = set(vikruti) | set(prakruti)
    bal_hits = sorted(bal_set & relevant)

    if vik_agg:
        cautions.append({"severity": "caution", "kind": "dosha_vikruti",
                         "detail": f"Aggravates {'/'.join(vik_agg)} — the client is currently {'/'.join(vikruti)}-aggravated (vikruti)."})
    if pra_agg:
        cautions.append({"severity": "caution", "kind": "dosha_prakruti",
                         "detail": f"Aggravates {'/'.join(pra_agg)} — part of the client's constitution ({getattr(client, 'ayurveda_constitution', '') or 'prakruti'})."})
    if bal_hits:
        supports.append(f"Balances {'/'.join(bal_hits)} — fits the client's dosha picture.")

    # evidence-tier honesty
    if evidence_tier in ("confirm_with_clinician",):
        cautions.append({"severity": "caution", "kind": "evidence",
                         "detail": "Catalogue evidence tier is 'confirm_with_clinician' — coordinate with the prescriber."})

    # ---- verdict ----
    has_avoid = any(c["severity"] == "avoid" for c in cautions)
    has_caution = any(c["severity"] == "caution" for c in cautions)
    if has_avoid:
        verdict = "avoid"
    elif has_caution:
        verdict = "caution"
    elif supports:
        verdict = "good_fit"
    else:
        verdict = "neutral"

    result = {
        "found": True,
        "kind": kind,
        "slug": entry.slug,
        "display_name": entry.display_name,
        "verdict": verdict,
        "evidence_tier": evidence_tier,
        "virya": virya,
        "balances_dosha": bal,
        "aggravates_dosha": agg,
        "client_vikruti": vikruti,
        "client_prakruti": prakruti,
        "cautions": cautions,
        "supports": supports,
        "catalogue_contraindications": contraindication_list,
        "indications": list(getattr(entry, "indications", []) or [])[:6] if kind == "home_remedy" else [],
    }
    json.dump({"ok": True, "result": result}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

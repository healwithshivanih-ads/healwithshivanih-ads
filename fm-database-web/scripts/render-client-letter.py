#!/usr/bin/env python3
"""AI-powered client-facing wellness letter generator.

Reads JSON from stdin:
{
  "plan_slug": str,
  "client_id": str
}

Writes JSON to stdout:
{
  "ok": bool,
  "markdown": str,   # the full letter as Markdown
  "error": str | null
}

The output is a warm, personalised, practical document:
  - Day-by-day meal plan with specific Indian recipes (respects dietary prefs)
  - Supplement guide with VitaOne referral links first, iHerb affiliate as fallback
  - Lifestyle / exercise / sleep / stress practices in plain English
  - Recipes appendix (how-to for every dish mentioned)
  - Approved Indian brand list for food products
  - Non-negotiables incorporated, not ignored
  - NO clinical jargon — written for the client, not the coach
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
PLANS_ROOT = Path.home() / "fm-plans"
sys.path.insert(0, str(FMDB_ROOT))


# ---------------------------------------------------------------------------
# VitaOne supplement catalog
#
# Source of truth for product URLs: scripts/vitaone-catalog.json, refreshed by
# scripts/vitaone-scrape.py against vitaone.in/shop. The hand-curated keyword
# aliases below (158 entries) map client-facing names to product slugs; URLs
# resolve through the JSON when available.
#
# Coverage note: the scraper's sitemap walk currently misses ~40% of the
# slugs the keyword map references (long tail / affiliate-only products
# behind a different fetch path). For those, _v() synthesises a URL from
# the slug — re-running the scraper after coverage improves picks them up
# without code changes.
# ---------------------------------------------------------------------------
_V = "https://vitaone.in/shop/"
_R = "?pr=vita13720sh"
IHERB_AFFILIATE = "https://in.iherb.com/?rcode=LWG566"

_VITAONE_JSON_PATH = Path(__file__).resolve().parent / "vitaone-catalog.json"


def _load_vitaone_json() -> dict[str, dict]:
    """Load scraped catalog as `{slug: {name, url, image, odoo_id}}`. Empty on miss."""
    if not _VITAONE_JSON_PATH.exists():
        return {}
    try:
        data = json.loads(_VITAONE_JSON_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    out: dict[str, dict] = {}
    for p in data.get("products", []):
        slug = p.get("slug")
        if not slug:
            continue
        out[slug] = {
            "name": p.get("name", ""),
            "url": p.get("url") or f"{_V}{slug}{_R}",
            "image": p.get("image", ""),
            "odoo_id": p.get("odoo_id"),
        }
    return out


_VITAONE_BY_SLUG: dict[str, dict] = _load_vitaone_json()


def _is_non_product(name: str, slug: str) -> bool:
    """True if a scraped 'product' is a category page or non-supplement entry."""
    n = (name or "").strip().lower()
    if n.endswith("| vitaone") or " | vitaone" in n:
        return True
    if slug.startswith("supplements-"):
        return True
    if slug in {
        "education-23", "functional-food-1", "lab-tests-26", "pharmacy-24",
        "199-per-order-on-event-registration-291", "50-on-specific-products-32",
        "functional-medicine-foundation-2",
        "functional-medicine-foundation-global-497",
        "functional-medicine-in-clinical-nutrition-29",
        "standard-practitioner-membership-334",
    }:
        return True
    return False


def _v(slug: str, name: str) -> tuple[str, str]:
    """Build (display_name, url) for a VitaOne product.

    Curated `name` wins (scraped names carry SEO suffixes / HTML entities).
    URL resolves against the JSON when present, else synthesises from slug.
    """
    p = _VITAONE_BY_SLUG.get(slug)
    url = p["url"] if p else f"{_V}{slug}{_R}"
    return (name, url)


def vitaone_inventory() -> list[dict]:
    """Clean product list for AI prompt injection: `[{slug, name, url}]`.

    Filters out category pages, lab-test bundles, memberships, and event
    registrations — leaves only purchasable supplements / functional foods.
    Sorted alphabetically by name for deterministic prompt caching.
    """
    import html as _html
    out: list[dict] = []
    for slug, p in _VITAONE_BY_SLUG.items():
        name = _html.unescape(p["name"]).strip()
        if _is_non_product(name, slug):
            continue
        out.append({"slug": slug, "name": name, "url": p["url"]})
    out.sort(key=lambda x: x["name"].lower())
    return out

VITAONE_CATALOG = {
    # keyword (lowercase) → (display name, full URL with referral)
    # All slugs verified against vitaone.in/shop pages 1–4 (scraped 2026-05-05).
    # Referral appended via _v() helper: ?pr=vita13720sh

    # ── Magnesium (4 forms) ──
    "magnesium glycinate":       _v("ionic-140-ionic-magnesium-bisglycinate-115",           "Ionic Magnesium Bisglycinate"),
    "magnesium bisglycinate":    _v("ionic-140-ionic-magnesium-bisglycinate-115",           "Ionic Magnesium Bisglycinate"),
    "magnesium l-threonate":     _v("trexgenics-magnesium-l-threonate-139",                 "Magnesium L-Threonate"),
    "magnesium threonate":       _v("trexgenics-magnesium-l-threonate-139",                 "Magnesium L-Threonate"),
    "magnesium oil":             _v("vitaone-magnesium-oil-505",                            "VitaOne Magnesium Oil"),
    "liquid magnesium":          _v("1z-yinv-0l5m-liquid-angstrom-magnesium-24",           "Liquid Angstrom Magnesium"),
    "angstrom magnesium":        _v("1z-yinv-0l5m-liquid-angstrom-magnesium-24",           "Liquid Angstrom Magnesium"),
    "magnesium sachet":          _v("ionic-magnesium-sachet-345",                           "Ionic Magnesium Sachet"),
    "magnesium":                 _v("ionic-magnesium-ionic-magnesium-13",                   "Ionic Magnesium"),

    # ── Vitamin D ──
    "vitamin d3 k2":             _v("vitamin-d3-k2-7-12",                                  "Vitamin D3 + K2-7"),
    "vitamin d3":                _v("vitamin-d3-k2-7-12",                                  "Vitamin D3 + K2-7"),
    "vitamin d":                 _v("vitamin-d3-k2-7-12",                                  "Vitamin D3 + K2-7"),
    "liquid d3":                 _v("liquid-vitamin-d3-k2-117",                            "Liquid Vitamin D3 + K2"),
    "liquid vitamin d":          _v("liquid-vitamin-d3-k2-117",                            "Liquid Vitamin D3 + K2"),
    "cholecalciferol":           _v("vitamin-d3-k2-7-12",                                  "Vitamin D3 + K2-7"),

    # ── B-vitamins / methylation ──
    "active folate":             _v("active-folate-b12-30",                                "Active Folate B12"),
    "methylfolate":              _v("active-folate-b12-30",                                "Active Folate B12"),
    "methylcobalamin":           _v("active-folate-b12-30",                                "Active Folate B12"),
    "folate":                    _v("active-folate-b12-30",                                "Active Folate B12"),
    "b12":                       _v("active-folate-b12-30",                                "Active Folate B12"),
    "homocysteine":              _v("homocysteine-defence-b-complex-6",                    "Homocysteine Defence B Complex"),
    "b complex":                 _v("homocysteine-defence-b-complex-6",                    "Homocysteine Defence B Complex"),
    "b-complex":                 _v("homocysteine-defence-b-complex-6",                    "Homocysteine Defence B Complex"),
    "methyl b":                  _v("homocysteine-defence-b-complex-6",                    "Homocysteine Defence B Complex"),

    # ── Vitamin C ──
    "vitamin c":                 _v("vit-c-vitamin-c-ultra-potent-buffered-formula-439",   "Vitamin C – Ultra Potent Buffered Formula"),
    "ascorbic acid":             _v("vit-c-vitamin-c-ultra-potent-buffered-formula-439",   "Vitamin C – Ultra Potent Buffered Formula"),
    "buffered vitamin c":        _v("vit-c-vitamin-c-ultra-potent-buffered-formula-439",   "Vitamin C – Ultra Potent Buffered Formula"),

    # ── Iron ──
    "iron bisglycinate":         _v("iron-complex-iron-complex-iron-bisglycinate-11",      "Iron Complex (Iron Bisglycinate)"),
    "iron complex":              _v("iron-complex-iron-complex-iron-bisglycinate-11",      "Iron Complex (Iron Bisglycinate)"),
    "iron":                      _v("iron-complex-iron-complex-iron-bisglycinate-11",      "Iron Complex (Iron Bisglycinate)"),

    # ── Zinc ──
    "zinc carnosine":            _v("gastro-zinc-carnosine-gastro-zinc-carnosine-23",      "Gastro Zinc Carnosine"),
    "gastro zinc":               _v("gastro-zinc-carnosine-gastro-zinc-carnosine-23",      "Gastro Zinc Carnosine"),
    "zinc":                      _v("gastro-zinc-carnosine-gastro-zinc-carnosine-23",      "Gastro Zinc Carnosine"),

    # ── Omega-3 / essential fatty acids ──
    "triple strength omega":     _v("triple-strength-omega-3-triple-strength-omega-3-20", "Triple Strength Omega 3"),
    "omega 3":                   _v("triple-strength-omega-3-triple-strength-omega-3-20", "Triple Strength Omega 3"),
    "omega-3":                   _v("triple-strength-omega-3-triple-strength-omega-3-20", "Triple Strength Omega 3"),
    "fish oil":                  _v("triple-strength-omega-3-triple-strength-omega-3-20", "Triple Strength Omega 3"),
    "epa dha":                   _v("triple-strength-omega-3-triple-strength-omega-3-20", "Triple Strength Omega 3"),
    "dha":                       _v("triple-strength-omega-3-triple-strength-omega-3-20", "Triple Strength Omega 3"),
    "epa":                       _v("triple-strength-omega-3-triple-strength-omega-3-20", "Triple Strength Omega 3"),
    "flaxseed oil":              _v("new-fs-organic-cold-pressed-flax-oil-26",            "Organic Cold Pressed Flax Oil"),
    "flax oil":                  _v("new-fs-organic-cold-pressed-flax-oil-26",            "Organic Cold Pressed Flax Oil"),
    "cold pressed flax":         _v("new-fs-organic-cold-pressed-flax-oil-26",            "Organic Cold Pressed Flax Oil"),

    # ── Collagen ──
    "marine collagen":           _v("premium-marine-collagen-peptides-bioactive-marine-collagen-27", "Bioactive Marine Collagen"),
    "collagen peptides":         _v("premium-marine-collagen-peptides-bioactive-marine-collagen-27", "Bioactive Marine Collagen"),
    "collagen":                  _v("premium-marine-collagen-peptides-bioactive-marine-collagen-27", "Bioactive Marine Collagen"),

    # ── Ashwagandha / adaptogens ──
    "ashwagandha ksm":           _v("ashwagandha-ksm-66-600mg-strength-517",              "Ashwagandha KSM-66® 600mg"),
    "ksm-66":                    _v("ashwagandha-ksm-66-600mg-strength-517",              "Ashwagandha KSM-66® 600mg"),
    "ashwagandha":               _v("ashwagandha-ksm-66-600mg-strength-517",              "Ashwagandha KSM-66® 600mg"),
    "withania":                  _v("ashwagandha-ksm-66-600mg-strength-517",              "Ashwagandha KSM-66® 600mg"),

    # ── Probiotics / gut flora ──
    "vitaspore":                 _v("vitaspore-probiotic-vitaspore-probiotic-173",        "VitaSpore Probiotic"),
    "spore probiotic":           _v("vitaspore-probiotic-vitaspore-probiotic-173",        "VitaSpore Probiotic"),
    "probiotics":                _v("vitaspore-probiotic-vitaspore-probiotic-173",        "VitaSpore Probiotic"),
    "probiotic":                 _v("vitaspore-probiotic-vitaspore-probiotic-173",        "VitaSpore Probiotic"),
    "microbiome fiber":          _v("microbiome-fiber-microbiome-fiber-16",               "Microbiome Fiber"),
    "prebiotic fiber":           _v("microbiome-fiber-microbiome-fiber-16",               "Microbiome Fiber"),
    "prebiotic":                 _v("microbiome-fiber-microbiome-fiber-16",               "Microbiome Fiber"),

    # ── Digestive support ──
    "digestive enzymes":         _v("digestive-enzyme-digestive-enzyme-9",                "Digestive Enzyme"),
    "digestive enzyme":          _v("digestive-enzyme-digestive-enzyme-9",                "Digestive Enzyme"),
    "betaine hcl":               _v("betaine-hcl-pepsin-betaine-hcl-pepsin-116",         "Betaine HCL + Pepsin"),
    "betaine":                   _v("betaine-hcl-pepsin-betaine-hcl-pepsin-116",         "Betaine HCL + Pepsin"),
    "hcl pepsin":                _v("betaine-hcl-pepsin-betaine-hcl-pepsin-116",         "Betaine HCL + Pepsin"),
    "stomach acid":              _v("betaine-hcl-pepsin-betaine-hcl-pepsin-116",         "Betaine HCL + Pepsin"),
    "opti-bile":                 _v("opti-bile-161",                                      "Opti-Bile"),
    "bile support":              _v("opti-bile-161",                                      "Opti-Bile"),
    "bile acid":                 _v("opti-bile-161",                                      "Opti-Bile"),
    "gallbladder":               _v("opti-bile-161",                                      "Opti-Bile"),
    "l-glutamine":               _v("h3-q5m6-imc5-l-glutamine-18",                       "L-Glutamine"),
    "glutamine":                 _v("h3-q5m6-imc5-l-glutamine-18",                       "L-Glutamine"),
    "gut lining":                _v("h3-q5m6-imc5-l-glutamine-18",                       "L-Glutamine"),
    "biofilm":                   _v("biofilm-care-68",                                    "BIOFILM CARE"),
    "sibo":                      _v("biofilm-care-68",                                    "BIOFILM CARE"),
    "parasitic":                 _v("parasitic-care-100",                                 "Parasitic Care"),
    "antiparasitic":             _v("parasitic-care-100",                                 "Parasitic Care"),

    # ── Anti-inflammatory ──
    "curcumin":                  _v("c3-curcumin-complex-c3-curcumin-complex-19",         "C3 Curcumin Complex"),
    "turmeric extract":          _v("c3-curcumin-complex-c3-curcumin-complex-19",         "C3 Curcumin Complex"),
    "c3 curcumin":               _v("c3-curcumin-complex-c3-curcumin-complex-19",         "C3 Curcumin Complex"),
    "pain care":                 _v("pain-care-184",                                      "Pain Care"),

    # ── Metabolic / blood sugar ──
    "berberine chromium":        _v("lbc-c-liposomal-berberine-complex-cinnamon-chromium-458", "Liposomal Berberine Complex"),
    "liposomal berberine":       _v("lbc-c-liposomal-berberine-complex-cinnamon-chromium-458", "Liposomal Berberine Complex"),
    "berberine":                 _v("lbc-c-liposomal-berberine-complex-cinnamon-chromium-458", "Liposomal Berberine Complex"),
    "alpha lipoic acid":         _v("alpha-r-lipoic-acid-alpha-r-lipoic-acid-25",         "Alpha R Lipoic Acid"),
    "r-lipoic acid":             _v("alpha-r-lipoic-acid-alpha-r-lipoic-acid-25",         "Alpha R Lipoic Acid"),
    "ala":                       _v("alpha-r-lipoic-acid-alpha-r-lipoic-acid-25",         "Alpha R Lipoic Acid"),
    "dialor plus":               _v("liv-bios-dialor-plus-124",                            "Dialor Plus"),
    "dialor":                    _v("liv-bios-dialor-plus-124",                            "Dialor Plus"),

    # ── MCT / ketogenic ──
    "mct oil":                   _v("3z-inby-uz48-mct-oil-8",                            "MCT Oil"),
    "medium chain triglyceride": _v("3z-inby-uz48-mct-oil-8",                            "MCT Oil"),
    "mct":                       _v("3z-inby-uz48-mct-oil-8",                            "MCT Oil"),
    "keto coffee":               _v("instant-keto-coffee-instant-keto-coffee-22",         "Instant Keto Coffee"),

    # ── Antioxidants / detox ──
    "nac":                       _v("nac-n-acetylcysteine-nac-n-acetylcysteine-17",       "NAC (N-Acetylcysteine)"),
    "n-acetylcysteine":          _v("nac-n-acetylcysteine-nac-n-acetylcysteine-17",       "NAC (N-Acetylcysteine)"),
    "acetyl cysteine":           _v("nac-n-acetylcysteine-nac-n-acetylcysteine-17",       "NAC (N-Acetylcysteine)"),
    "lipo-glutathione":          _v("lipo-glutathione-52",                                "Lipo-Glutathione"),
    "liposomal glutathione":     _v("lipo-glutathione-52",                                "Lipo-Glutathione"),
    "glutathione":               _v("lipo-glutathione-52",                                "Lipo-Glutathione"),
    "heavy metal":               _v("heavy-metal-detox-83",                              "Heavy Metal Detox"),
    "metal detox":               _v("heavy-metal-detox-83",                              "Heavy Metal Detox"),
    "chlorella":                 _v("fm-nutrition-chlorella-powder-74",                   "FM Nutrition Chlorella Powder"),
    "activated charcoal":        _v("fm-nutrition-activated-charcoal-70",                 "FM Nutrition Activated Charcoal"),
    "toxin cleanse":             _v("toxin-cleanse-care-91",                              "TOXIN CLEANSE CARE"),
    "opti-liver":                _v("fm-nutrition-opti-liver-76",                         "FM Nutrition Opti-Liver"),
    "liver support":             _v("fm-nutrition-opti-liver-76",                         "FM Nutrition Opti-Liver"),
    "milk thistle":              _v("fm-nutrition-opti-liver-76",                         "FM Nutrition Opti-Liver"),

    # ── CoQ10 / mitochondria / energy ──
    "liposomal coq10":           _v("fmn-liposomal-coq10-82",                            "FMN Liposomal CoQ10"),
    "coq10":                     _v("fmn-liposomal-coq10-82",                            "FMN Liposomal CoQ10"),
    "ubiquinol":                 _v("fmn-liposomal-coq10-82",                            "FMN Liposomal CoQ10"),
    "ubiquinone":                _v("fmn-liposomal-coq10-82",                            "FMN Liposomal CoQ10"),
    "mito support":              _v("mito-support-157",                                   "Mito Support"),
    "mitochondria":              _v("mito-support-157",                                   "Mito Support"),
    "mitochondrial":             _v("mito-support-157",                                   "Mito Support"),

    # ── Protein / amino acids ──
    "plant protein":             _v("rebuild-plant-protein-and-lipid-rebuild-plant-protein-and-lipid-15", "Rebuild Plant Protein And Lipid"),
    "rebuild protein":           _v("rebuild-plant-protein-and-lipid-rebuild-plant-protein-and-lipid-15", "Rebuild Plant Protein And Lipid"),
    "protein powder":            _v("rebuild-plant-protein-and-lipid-rebuild-plant-protein-and-lipid-15", "Rebuild Plant Protein And Lipid"),

    # ── Hormonal / condition-specific blends ──
    "thyroid support":           _v("thyroid-support-10",                                 "Thyroid Support"),
    "thyroid blend":             _v("thyroid-support-10",                                 "Thyroid Support"),
    "pcos support":              _v("pcos-w-pcos-support-complete-hormonal-metabolic-restoration-for-women-390", "PCOS Support"),
    "pcos":                      _v("pcos-w-pcos-support-complete-hormonal-metabolic-restoration-for-women-390", "PCOS Support"),
    "hormonal balance":          _v("pcos-w-pcos-support-complete-hormonal-metabolic-restoration-for-women-390", "PCOS Support"),

    # ── Sleep ──
    "sleep support":             _v("sleep-support-advanced-sleep-support-more-than-just-melatonin-344", "Advanced Sleep Support"),
    "advanced sleep":            _v("sleep-support-advanced-sleep-support-more-than-just-melatonin-344", "Advanced Sleep Support"),
    "melatonin":                 _v("sleep-support-advanced-sleep-support-more-than-just-melatonin-344", "Advanced Sleep Support"),
    "sleep":                     _v("sleep-support-advanced-sleep-support-more-than-just-melatonin-344", "Advanced Sleep Support"),

    # ── Immune ──
    "advanced immune":           _v("advanced-immune-care-183",                           "Advanced Immune Care"),
    "immune support":            _v("advanced-immune-care-183",                           "Advanced Immune Care"),
    "immunity":                  _v("advanced-immune-care-183",                           "Advanced Immune Care"),
    "allergy shield":            _v("opti-allergy-shield-159",                            "Opti-Allergy Shield"),
    "histamine":                 _v("fmn-opti-histamine-i-200gm-72",                      "FMN Opti-Histamine"),
    "dao enzyme":                _v("fmn-opti-histamine-i-200gm-72",                      "FMN Opti-Histamine"),
    "mast cell":                 _v("fmn-opti-histamine-i-200gm-72",                      "FMN Opti-Histamine"),

    # ── Nerve / pain ──
    "nerve pain":                _v("advance-nerve-pain-support-548",                     "Advance Nerve Pain Support"),
    "neuropathy":                _v("advance-nerve-pain-support-548",                     "Advance Nerve Pain Support"),
    "nerve support":             _v("advance-nerve-pain-support-548",                     "Advance Nerve Pain Support"),

    # ── Brain / cognitive ──
    "brain heart":               _v("brain-heart-care-90",                                "Brain + Heart Care"),
    "brain support":             _v("brain-heart-care-90",                                "Brain + Heart Care"),
    "cognitive support":         _v("brain-heart-care-90",                                "Brain + Heart Care"),
    "methylene blue":            _v("methylene-blue-423",                                 "Methylene Blue"),
    "nmn":                       _v("nmn-uthever-500mg-54",                               "NMN Uthever 500mg"),
    "nad+":                      _v("nmn-uthever-500mg-54",                               "NMN Uthever 500mg"),
    "nicotinamide mononucleotide": _v("nmn-uthever-500mg-54",                             "NMN Uthever 500mg"),

    # ── Greens / superfoods ──
    "opti-green":                _v("opti-green-47",                                      "Opti-Green"),
    "greens powder":             _v("opti-green-47",                                      "Opti-Green"),
    "spirulina":                 _v("opti-green-47",                                      "Opti-Green"),
    "chlorophyll":               _v("opti-green-47",                                      "Opti-Green"),
    "active garlic":             _v("fmn-active-garlic-71",                               "FMN Active Garlic"),
    "allicin":                   _v("fmn-active-garlic-71",                               "FMN Active Garlic"),
    "garlic":                    _v("fmn-active-garlic-71",                               "FMN Active Garlic"),

    # ── Anti-ageing / longevity ──
    "opti-age":                  _v("fmn-opti-age-77",                                    "FMN Opti-Age"),
    "anti-aging":                _v("fmn-opti-age-77",                                    "FMN Opti-Age"),
    "longevity":                 _v("nmn-uthever-500mg-54",                               "NMN Uthever 500mg"),
    "ca-akg":                    _v("ca-akg-437",                                         "Ca-AKG"),
    "calcium akg":               _v("ca-akg-437",                                         "Ca-AKG"),
    "alpha ketoglutarate":       _v("ca-akg-437",                                         "Ca-AKG"),

    # ── Electrolytes / hydration ──
    "electrolytes":              _v("dr-gold-lytes-electrolytes-powder-538",              "Dr.Gold LYTEs – Electrolytes Powder"),
    "electrolyte powder":        _v("dr-gold-lytes-electrolytes-powder-538",              "Dr.Gold LYTEs – Electrolytes Powder"),
    "hydration minerals":        _v("dr-gold-lytes-electrolytes-powder-538",              "Dr.Gold LYTEs – Electrolytes Powder"),

    # ── Fertility / women's health ──
    "ovoright":                  _v("liv-bio-s-ovoright-tab-158",                         "Liv Bio's OVORIGHT Tab"),
    "egg quality":               _v("liv-bio-s-ovoright-tab-158",                         "Liv Bio's OVORIGHT Tab"),
    "fertility":                 _v("liv-bio-s-ovoright-tab-158",                         "Liv Bio's OVORIGHT Tab"),
}

# Items not on VitaOne — Amazon affiliate links (add keyword → (display_name, url))
AMAZON_CATALOG: dict[str, tuple[str, str]] = {
    "selenium":  ("Selenium (Amazon)", "https://amzn.to/3PjIhpW"),
}

# ---------------------------------------------------------------------------
# Custom affiliate links — managed via the /backlog "Supplement Links" tab in
# the web UI. Stored at ~/fm-plans/supplement_links.yaml.
# Format:  supplement_name (lowercase key) → {display_name, url, source}
# Takes priority over VitaOne/Amazon catalogs when a match is found.
# ---------------------------------------------------------------------------
_CUSTOM_LINKS_PATH = PLANS_ROOT / "supplement_links.yaml"

def _load_custom_links() -> dict[str, tuple[str, str]]:
    """Load coach-managed affiliate links from supplement_links.yaml."""
    if not _CUSTOM_LINKS_PATH.exists():
        return {}
    try:
        import yaml
        data = yaml.safe_load(_CUSTOM_LINKS_PATH.read_text()) or {}
        out: dict[str, tuple[str, str]] = {}
        for key, val in data.items():
            if isinstance(val, dict) and val.get("url"):
                name = val.get("display_name") or key.replace("_", " ").title()
                out[key.lower().replace("_", " ")] = (name, val["url"])
        return out
    except Exception:
        return {}

# Only specify brands for items clients genuinely need guidance on.
# Everything else (oats, ghee, oils etc.) clients can use their own preferred brands.
INDIAN_BRANDS = """
**Recommended brands — only where it matters:**

*For everything else (oats, ghee, coconut oil, yogurt, nut butters etc.) use any brand you trust from your local store or online.*

| Category | What to look for | Recommended options |
|---|---|---|
| **Protein bars / healthy snacks** | No refined sugar, 10g+ protein, minimal ingredients | RiteBite Max Protein bars, Yoga Bar protein bars, True Elements bars, Monsoon Harvest millet bars, Saffola Oats & Quinoa bars |
| **Sleep support (herbal)** | Standardised extract, no fillers | Organic India Ashwagandha, Himalaya Ashwagandha, Kerala Ayurveda Ashwagandha; for sleep specifically: Organic India Sleep formula, Himalaya Tagara |
| **Gut / digestive support (herbal)** | Certified organic where possible | Organic India Triphala, Himalaya Triphala, Charak Pharma; for probiotics: Yakult, Epigamia probiotic curd |
| **Anti-inflammatory / adaptogens** | GMP certified, third-party tested | Organic India Tulsi, Himalaya Turmeric, Upakarma Ayurveda Shilajit |
""".strip()


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv(FMDB_ROOT / ".env", override=True)
    except Exception:
        envp = FMDB_ROOT / ".env"
        if envp.exists():
            for line in envp.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _load_plan(slug: str) -> dict | None:
    """Load plan YAML from any bucket."""
    import yaml
    for bucket in ["drafts", "ready", "published", "superseded", "revoked"]:
        bucket_dir = PLANS_ROOT / bucket
        if not bucket_dir.exists():
            continue
        # Try versioned and unversioned names
        for candidate in bucket_dir.glob(f"{slug}*.yaml"):
            try:
                return yaml.safe_load(candidate.read_text())
            except Exception:
                pass
        p = bucket_dir / f"{slug}.yaml"
        if p.exists():
            try:
                return yaml.safe_load(p.read_text())
            except Exception:
                pass
    return None


def _load_client(client_id: str) -> dict | None:
    import yaml
    p = PLANS_ROOT / "clients" / client_id / "client.yaml"
    if not p.exists():
        return None
    try:
        client_dict = yaml.safe_load(p.read_text()) or {}
    except Exception:
        return None

    # Compute today's cycle phase from cycle_status + LMP + cycle length.
    # Sidecar field `_computed_cycle_phase` is read by `_top_of_mind_block`
    # and any prompt that includes cycle-aware nutrition / movement rules.
    try:
        from fmdb.plan.models import Client as _ClientModel
        cm = _ClientModel.model_validate(client_dict)
        cyc = cm.cycle_context()
        if cyc:
            phase = cyc.get("phase") or cyc.get("status")
            day = cyc.get("cycle_day")
            length = cyc.get("cycle_length")
            human = phase or ""
            if day and length:
                human = f"{phase} (day {day} of {length})"
            client_dict["_computed_cycle_phase"] = human
            client_dict["_cycle_context"] = cyc
    except Exception:
        # Best-effort; if the model load fails (e.g. older YAML), skip.
        pass

    return client_dict


def _load_protocol_yaml(slug: str) -> dict | None:
    """Load a Protocol YAML from fm-database/data/protocols/<slug>.yaml.
    Returns the raw dict (NOT a Pydantic instance) — letter prompts only need
    a few fields and benefit from forward compatibility if the schema evolves.
    """
    import yaml as _yaml
    p = FMDB_ROOT / "data" / "protocols" / f"{slug}.yaml"
    if not p.exists():
        return None
    try:
        return _yaml.safe_load(p.read_text()) or None
    except Exception:
        return None


def _attached_protocol_block(plan: dict) -> str:
    """Format `plan.attached_protocols` as a binding-protocol prompt block.

    The coach picked these protocols in /assess via radio. They become the
    SPINE of every letter:
      - meal plan: foods_to_emphasise are scaffolded daily; foods_to_remove
        are HARD exclusions
      - supplement plan: supplements_typically_used are the protocol's
        standard set (AI may adjust dose / timing per client)
      - exercise plan: protocol cautions are obeyed (e.g. mito → no HIIT)
      - lifestyle / consolidated: phases + key_steps + cautions shape the
        weekly arc

    Returns empty string if no attached protocols (so prompts that don't
    use protocols don't get a stray "ATTACHED PROTOCOL" header).
    """
    slugs = plan.get("attached_protocols") or []
    if not slugs:
        return ""

    protocols = []
    for slug in slugs:
        pr = _load_protocol_yaml(slug)
        if pr:
            protocols.append(pr)
    if not protocols:
        return ""

    lines = ["", "🧭 ATTACHED PROTOCOL — THIS IS THE SPINE OF THE PLAN."]
    lines.append(
        "The coach has committed to the following FM protocol(s) as the structured "
        "playbook for this client. Use the protocol's PHASES as the weekly arc, "
        "obey its FOODS_TO_REMOVE as binding exclusions, scaffold meals around "
        "FOODS_TO_EMPHASISE, and surface SUPPLEMENTS_TYPICALLY_USED as the "
        "default supplement set."
    )
    lines.append("")
    lines.append("⚠ FINAL FILTERS — client-specific rules ALWAYS WIN over the protocol:")
    lines.append("  1. DIETARY PREFERENCE (vegetarian / Jain / vegan / pescatarian, "
                 "etc.) is non-negotiable. If the protocol's foods_to_emphasise "
                 "include meat / fish / eggs for a vegetarian client, SUBSTITUTE "
                 "with plant-based equivalents (paneer, tofu, dal, hemp, sprouted "
                 "legumes). For a Jain client, ALSO exclude onion / garlic / "
                 "potato / carrot / beetroot from the protocol foods.")
    lines.append("  2. CLIENT LOCATION + SEASON drives produce availability — "
                 "use the season + city rules already established in the prompt.")
    lines.append("  3. CYCLE PHASE (women) — cycle-aware modifications (menstrual "
                 "iron focus, follicular fresh+light, ovulatory peak intensity, "
                 "luteal warming+grounding) ALWAYS apply on top of the protocol "
                 "schedule. Seed cycling continues.")
    lines.append("  4. WILL-NOT-EAT list (foods_to_avoid + reported_triggers + "
                 "non_negotiables) — these are HARD rules. Drop any protocol "
                 "food that's on the client's no-go list and substitute.")
    lines.append("  5. NEVER ship a meal plan that conflicts with these filters "
                 "even if the protocol's textbook version would. The protocol "
                 "is the SPINE; the filters are the SHAPE.")
    lines.append("")
    for pr in protocols:
        lines.append(f"\n--- {pr.get('display_name', pr.get('slug'))} ({pr.get('slug')}) ---")
        if pr.get("summary"):
            lines.append(f"Summary: {pr['summary'].strip()}")
        if pr.get("typical_duration_weeks"):
            lines.append(f"Duration: {pr['typical_duration_weeks']} weeks")
        if pr.get("foods_to_emphasise"):
            foods = ", ".join(pr["foods_to_emphasise"][:20])
            lines.append(f"Foods to emphasise (scaffold meals around these): {foods}")
        if pr.get("foods_to_remove"):
            foods = ", ".join(pr["foods_to_remove"][:20])
            lines.append(f"Foods to REMOVE (binding exclusion — never include in meal plans): {foods}")
        if pr.get("supplements_typically_used"):
            supps = ", ".join(pr["supplements_typically_used"])
            lines.append(f"Standard supplements for this protocol: {supps}")
        if pr.get("phases"):
            lines.append("Phases (use as the weekly arc):")
            for ph in pr["phases"]:
                wk = f" ({ph.get('weeks', '?')}w)" if ph.get("weeks") else ""
                lines.append(f"  • {ph.get('name', '?')}{wk}: {ph.get('summary', '').strip()[:200]}")
                for a in (ph.get("key_actions") or [])[:5]:
                    lines.append(f"      - {a}")
        if pr.get("key_steps"):
            lines.append("Key steps:")
            for k in pr["key_steps"][:8]:
                lines.append(f"  - {k}")
        if pr.get("cautions"):
            lines.append("Cautions:")
            for c in pr["cautions"][:6]:
                lines.append(f"  ⚠ {c}")
        if pr.get("notes_for_coach"):
            lines.append(f"Coach notes on this protocol: {pr['notes_for_coach'].strip()[:400]}")
    lines.append("")
    return "\n".join(lines)


def _load_catalogue_notes(plan: dict) -> str:
    """Collect notes_for_coach from catalogue YAMLs for all entities referenced in the plan.

    Returns a combined multi-line string of coach notes from topics, supplements,
    and mechanisms that are referenced in the plan. These are "persistent" notes the
    coach has added to catalogue entries — they auto-include in every letter for that plan.
    """
    import yaml as _yaml

    catalogue_root = FMDB_ROOT / "data"
    collected: list[str] = []

    def _read_notes(kind_dir: str, slugs: list[str]) -> None:
        for slug in slugs:
            p = catalogue_root / kind_dir / f"{slug}.yaml"
            if not p.exists():
                continue
            try:
                data = _yaml.safe_load(p.read_text()) or {}
                note = (data.get("notes_for_coach") or "").strip()
                if note:
                    display = data.get("display_name") or slug
                    collected.append(f"[{display}] {note}")
            except Exception:
                pass

    assessment = plan.get("assessment") or {}
    topics = assessment.get("focus_topics") or []
    mechanisms = assessment.get("hypothesized_drivers") or []
    if isinstance(mechanisms, list):
        # mechanisms may be list of dicts with mechanism_slug field
        mech_slugs = []
        for m in mechanisms:
            if isinstance(m, dict):
                mech_slugs.append(m.get("mechanism_slug", ""))
            elif isinstance(m, str):
                mech_slugs.append(m)
        mechanisms = [s for s in mech_slugs if s]

    supplements = plan.get("supplement_protocol") or []
    supp_slugs = []
    for s in supplements:
        if isinstance(s, dict):
            supp_slugs.append(s.get("supplement_slug", ""))
        elif isinstance(s, str):
            supp_slugs.append(s)
    supp_slugs = [s for s in supp_slugs if s]

    _read_notes("topics", topics)
    _read_notes("mechanisms", mechanisms)
    _read_notes("supplements", supp_slugs)

    return "\n".join(collected)


_KW_BOUNDARY_CACHE: dict[str, "re.Pattern"] = {}


def _kw_matches(kw: str, name_lower: str) -> bool:
    """Word-boundary match — `dha` does not match `ashwagandha`.

    Substring matching (the previous behaviour) caused short keywords like
    `dha` / `ala` / `b12` to incorrectly resolve longer supplement names
    (`vitaone ashwagandha` → omega-3). Compiled regexes are cached on first
    use; the keyword set is small + stable, so cache growth is bounded.
    """
    import re
    pat = _KW_BOUNDARY_CACHE.get(kw)
    if pat is None:
        pat = re.compile(r"(?<![\w-])" + re.escape(kw) + r"(?![\w-])", re.IGNORECASE)
        _KW_BOUNDARY_CACHE[kw] = pat
    return pat.search(name_lower) is not None


def _vitaone_link(supplement_name: str, slug: str | None = None) -> str | None:
    """Try to find a match for a supplement name across custom, VitaOne, Amazon catalogs.
    Returns a markdown link string, or None if not found anywhere.

    `slug` (optional) lets callers resolve catalogue stub slugs whose derived
    display name (`Vitaone D3`) doesn't share a keyword with the catalog.
    """
    info = _vitaone_url_only(supplement_name, slug=slug)
    if not info:
        return None
    product, url = info
    if "vitaone.in" in url:
        return f"[{product}]({url}) *(VitaOne — referral link)*"
    if "iherb" in url or "amzn" in url:
        return f"[{product}]({url}) *(Amazon affiliate link)*"
    return f"[{product}]({url}) *(affiliate link)*"


def _vitaone_url_only(supplement_name: str, slug: str | None = None) -> tuple[str, str] | None:
    """Returns (product_name, url) for a supplement, or None.

    Resolution order: stub-slug override (when `slug` provided and recognised)
    → custom links by name → VitaOne keyword match → Amazon keyword match.
    Stub overrides handle catalogue slugs like `vitaone-d3` / `opti-liver`
    whose derived display name (`Vitaone D3`, `Opti Liver`) doesn't share a
    keyword with any product entry.
    """
    if slug:
        sl = slug.strip().lower()
        if sl in _STUB_SLUG_TO_VITAONE_SLUG:
            target = _STUB_SLUG_TO_VITAONE_SLUG[sl]
            p = _VITAONE_BY_SLUG.get(target)
            url = p["url"] if p else f"{_V}{target}{_R}"
            # Use the curated catalogue display name for this product.
            for _kw, (canonical_name, kw_url) in VITAONE_CATALOG.items():
                if kw_url == url or kw_url.endswith(f"{target}{_R}"):
                    return (canonical_name, url)
            # Fallback: use the scraped name if no keyword maps to it.
            import html as _html
            name = _html.unescape(p["name"]).strip() if p else target.replace("-", " ").title()
            return (name, url)
    nl = supplement_name.lower()
    for kw, (product, url) in _load_custom_links().items():
        if _kw_matches(kw, nl) or _kw_matches(nl, kw):
            return (product, url)
    for kw, (product, url) in VITAONE_CATALOG.items():
        if _kw_matches(kw, nl):
            return (product, url)
    for kw, (product, url) in AMAZON_CATALOG.items():
        if _kw_matches(kw, nl):
            return (product, url)
    return None


# Catalogue stub supplements (PR #15) → VitaOne product slug. Without these
# the slug-to-URL resolver can't map e.g. `vitaone-d3` (stub) to the real
# `vitamin-d3-k2-7-12` product page, because `vitaone-d3` doesn't share a
# keyword with the catalog's "vitamin d3" entry.
_STUB_SLUG_TO_VITAONE_SLUG: dict[str, str] = {
    "vitaone-d3": "vitamin-d3-k2-7-12",
    "vitaone-omega-3": "triple-strength-omega-3-triple-strength-omega-3-20",
    "vitaone-b12": "active-folate-b12-30",
    "vitaone-magnesium-glycinate": "ionic-140-ionic-magnesium-bisglycinate-115",
    "vitaone-ashwagandha": "ashwagandha-ksm-66-600mg-strength-517",
    "opti-liver": "fm-nutrition-opti-liver-76",
    "dialor-plus": "liv-bios-dialor-plus-124",  # VitaOne / Liv Bio's Dialor Plus
}


def vitaone_url_for_supplement(supplement_name_or_slug: str) -> str | None:
    """Public lookup: resolves a supplement display name OR slug to a VitaOne URL.

    Returns None when no VitaOne match exists (Amazon / custom fallbacks are
    intentionally NOT considered — only VitaOne URLs go in `vitaone_url`).

    Resolution order: stub-slug override → keyword match on lowercased,
    hyphen-normalised input.
    """
    s = supplement_name_or_slug.strip().lower()
    if s in _STUB_SLUG_TO_VITAONE_SLUG:
        target_slug = _STUB_SLUG_TO_VITAONE_SLUG[s]
        p = _VITAONE_BY_SLUG.get(target_slug)
        return p["url"] if p else f"{_V}{target_slug}{_R}"
    nl = s.replace("-", " ").replace("_", " ")
    for kw, (_product, url) in VITAONE_CATALOG.items():
        if _kw_matches(kw, nl):
            return url
    return None


# ── Supplement timing slots ──────────────────────────────────────────────────
_TIMING_SLOTS: list[tuple[int, str, str, list[str]]] = [
    # (sort_index, label, emoji, keywords_in_timing_field)
    (0, "Early Morning", "🌅", ["early morning", "empty stomach", "fasting", "before breakfast", "wake"]),
    (1, "With Breakfast", "☀️", ["breakfast", "morning", "with food", "am", "8 am", "7 am", "9 am"]),
    (2, "Mid-Morning",   "🕙", ["mid-morning", "mid morning", "10 am", "between meals", "snack"]),
    (3, "With Lunch",    "🥗", ["lunch", "midday", "noon", "1 pm", "12 pm"]),
    (4, "Afternoon",     "🌤", ["afternoon", "2 pm", "3 pm", "4 pm"]),
    (5, "With Dinner",   "🌆", ["dinner", "evening meal", "supper", "6 pm", "7 pm", "5 pm", "with evening"]),
    (6, "Before Bed",    "🌙", ["bedtime", "before bed", "night", "sleep", "9 pm", "10 pm", "before sleep"]),
]

def _timing_slot(timing_str: str) -> tuple[int, str, str]:
    """Return (sort_index, slot_label, slot_emoji) for a supplement timing string."""
    tl = (timing_str or "").lower()
    for idx, label, emoji, keywords in _TIMING_SLOTS:
        if any(kw in tl for kw in keywords):
            return (idx, label, emoji)
    # Default: with breakfast
    return (1, "With Breakfast", "☀️")


_PHASE_RE = re.compile(r"(?:week|wk)\s*(\d+)|after\s*(?:the\s*)?(\d+)\s*weeks?|from\s*week\s*(\d+)|introduced?\s*(?:in|at)\s*week\s*(\d+)", re.IGNORECASE)


def _detect_start_week(titration: str, coach_rationale: str) -> int:
    """Infer when a supplement starts based on free-text titration / rationale.

    Looks for "week N", "after N weeks", "from week N", "introduced in
    week N" patterns. Returns the smallest integer found, or 1 (start
    immediately) if no phase wording is present.
    """
    candidates: list[int] = []
    for blob in (titration or "", coach_rationale or ""):
        if not blob:
            continue
        for m in _PHASE_RE.finditer(blob):
            for g in m.groups():
                if g:
                    try:
                        n = int(g)
                        if 1 <= n <= 52:
                            candidates.append(n)
                    except ValueError:
                        continue
    if not candidates:
        return 1
    return min(candidates)


def _build_complete_shopping_list_html(supplements: list[dict], plan_weeks: int) -> str:
    """Render the upfront shopping list — the "buy everything now" section
    that goes ABOVE the detailed dose schedule.

    Many supplements in a 12-week FM protocol are phased in (e.g. adrenal
    support first, gut healing weeks 4-8, mitochondrial support weeks
    8-12). In India the shipping friction makes per-phase ordering
    impractical — coach asks the client to order everything upfront so
    they don't have to deal with multiple deliveries.

    This list shows every supplement in the plan with: number, name,
    dose, "X-week course" duration, when it starts (now / week N), and
    a buy link. Sorted by start_week then name so the upcoming-order
    is clear.
    """
    if not supplements:
        return ""

    items: list[dict] = []
    for s in supplements:
        slug = s.get("supplement_slug", "")
        name = s.get("display_name") or slug.replace("-", " ").title()
        dose = s.get("dose") or s.get("dose_display") or ""
        titration = s.get("titration") or ""
        rationale = (s.get("coach_rationale") or "").strip()
        dur = s.get("duration_weeks")
        try:
            dur = int(dur) if dur else plan_weeks
        except (ValueError, TypeError):
            dur = plan_weeks
        start_week = _detect_start_week(titration, rationale)

        # Reuse the same buy-link logic as the detailed schedule.
        buy_link_override = s.get("buy_link") or ""
        link_info = _vitaone_url_only(name, slug=slug) if not buy_link_override else None
        if buy_link_override:
            buy_html = f'<a href="{buy_link_override}" target="_blank" rel="noopener noreferrer">Buy ↗</a>'
            badge = "Custom"
        elif link_info:
            _, url = link_info
            is_vitaone = "vitaone.in" in url
            badge = "VitaOne" if is_vitaone else "Amazon"
            cls = "vitaone" if is_vitaone else "amazon"
            buy_html = f'<a href="{url}" target="_blank" rel="noopener noreferrer">Buy ↗</a> <span class="buy-badge buy-badge-{cls}">{badge}</span>'
        else:
            buy_html = f'<a href="{IHERB_AFFILIATE}" target="_blank" rel="noopener noreferrer">Search iHerb ↗</a> <span class="buy-badge buy-badge-iherb">iHerb</span>'
            badge = "iHerb"

        # Phase label: "Start now" if start_week == 1, else "Starts week N".
        phase_label = "Start now" if start_week == 1 else f"Starts week {start_week}"
        phase_class = "phase-now" if start_week == 1 else "phase-later"

        items.append({
            "name": name,
            "dose": dose,
            "duration_label": f"{dur}-week course" if dur != plan_weeks else f"Full {plan_weeks} weeks",
            "phase_label": phase_label,
            "phase_class": phase_class,
            "start_week": start_week,
            "buy_html": buy_html,
        })

    items.sort(key=lambda it: (it["start_week"], it["name"]))

    later_count = sum(1 for it in items if it["start_week"] > 1)

    rows_html = ""
    for i, it in enumerate(items, start=1):
        rows_html += (
            f"<tr>"
            f"<td class='shop-num'>{i}</td>"
            f"<td><strong>{it['name']}</strong></td>"
            f"<td>{it['dose']}</td>"
            f"<td>{it['duration_label']}</td>"
            f"<td><span class='phase-chip {it['phase_class']}'>{it['phase_label']}</span></td>"
            f"<td class='buy-cell'>{it['buy_html']}</td>"
            f"</tr>"
        )

    later_note = ""
    if later_count > 0:
        plural = later_count != 1
        noun = "supplements" if plural else "supplement"
        verb = "are" if plural else "is"
        pronoun = "them" if plural else "it"
        later_note = (
            f"<p class='shop-note-later'>"
            f"⏰ <strong>{later_count} {noun}</strong> in this list {verb} introduced "
            f"in a later phase of your protocol — check the <em>Starts week</em> column. "
            f"For convenience, order {pronoun} upfront so you don't have to wait for shipping when the time comes."
            f"</p>"
        )

    return f"""
<!-- ════════════════ COMPLETE SHOPPING LIST ════════════════ -->
<section id="supplement-shopping-list">
  <div class="shop-header">
    <h2 class="shop-title">📦 Your Complete Supplement Shopping List</h2>
    <p class="shop-subtitle">
      Everything you'll need for your full {plan_weeks}-week journey, listed upfront so you can order in one go.
      Each link below is hand-picked — VitaOne (where Shivani's affiliate is set up so quality + prices are vouched for),
      Amazon, or iHerb depending on what's available in India.
    </p>
    {later_note}
  </div>
  <div class="shop-table-wrap">
    <table class="shop-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Supplement</th>
          <th>Dose</th>
          <th>Duration</th>
          <th>When to start</th>
          <th>Where to buy</th>
        </tr>
      </thead>
      <tbody>{rows_html}</tbody>
    </table>
  </div>
  <p class="shop-disclaimer">
    💬 <em>Please check with your doctor before starting any new supplement, especially if you're on medication.
    Your detailed dose schedule (further down this letter) shows exactly when each one comes into your daily routine.</em>
  </p>
</section>
"""


def _build_supplement_schedule_html(supplements: list[dict]) -> str:
    """
    Build a self-contained HTML section: visual timeline + sortable table.
    Generated purely from structured plan data — not from AI output — so
    every supplement in the plan is guaranteed to appear.
    """
    if not supplements:
        return ""

    # Enrich each supplement with slot info and buy link
    rows: list[dict] = []
    for s in supplements:
        slug = s.get("supplement_slug", "")
        name = s.get("display_name") or slug.replace("-", " ").title()
        dose = s.get("dose") or s.get("dose_display") or ""
        timing_raw = s.get("timing") or ""
        rationale = (s.get("coach_rationale") or "").split("\n")[0].strip()
        # Strip evidence-tier note suffix if present
        if "[evidence-tier note]" in rationale:
            rationale = rationale.split("[evidence-tier note]")[0].strip()
        # Buy link: prefer explicit buy_link on item, then catalog lookup
        buy_link_override = s.get("buy_link") or ""
        link_info = _vitaone_url_only(name, slug=slug) if not buy_link_override else None
        if buy_link_override:
            buy_html = f'<a href="{buy_link_override}" target="_blank" rel="noopener noreferrer">Buy ↗</a>'
            buy_badge = "Custom link"
        elif link_info:
            product_name, url = link_info
            is_vitaone = "vitaone.in" in url
            badge = "VitaOne" if is_vitaone else "Amazon"
            buy_html = f'<a href="{url}" target="_blank" rel="noopener noreferrer">{product_name} ↗</a> <span class="buy-badge buy-badge-{"vitaone" if is_vitaone else "amazon"}">{badge}</span>'
            buy_badge = badge
        else:
            buy_html = f'<a href="{IHERB_AFFILIATE}" target="_blank" rel="noopener noreferrer">Search on iHerb ↗</a> <span class="buy-badge buy-badge-iherb">iHerb</span>'
            buy_badge = "iHerb"

        slot_idx, slot_label, slot_emoji = _timing_slot(timing_raw)
        rows.append({
            "name": name,
            "dose": dose,
            "timing_raw": timing_raw or slot_label,
            "slot_idx": slot_idx,
            "slot_label": slot_label,
            "slot_emoji": slot_emoji,
            "rationale": rationale,
            "buy_html": buy_html,
        })

    rows.sort(key=lambda r: (r["slot_idx"], r["name"]))

    # Group by slot for the visual timeline
    from collections import defaultdict
    by_slot: dict[tuple, list] = defaultdict(list)
    for r in rows:
        key = (r["slot_idx"], r["slot_label"], r["slot_emoji"])
        by_slot[key].append(r)

    # Build timeline cards
    timeline_cards = ""
    for (idx, label, emoji), slot_rows in sorted(by_slot.items()):
        pills = "".join(
            f'<div class="supp-pill">'
            f'<span class="supp-pill-name">{r["name"]}</span>'
            f'{"<span class=supp-pill-dose>" + r["dose"] + "</span>" if r["dose"] else ""}'
            f'</div>'
            for r in slot_rows
        )
        timeline_cards += f"""
        <div class="timeline-slot">
          <div class="timeline-slot-label">{emoji} {label}</div>
          <div class="supp-pills">{pills}</div>
        </div>"""

    # Build table rows
    table_rows = ""
    for r in rows:
        table_rows += (
            f"<tr>"
            f"<td><span class='slot-chip'>{r['slot_emoji']} {r['slot_label']}</span></td>"
            f"<td><strong>{r['name']}</strong></td>"
            f"<td>{r['dose']}</td>"
            f"<td class='rationale-cell'>{r['rationale']}</td>"
            f"<td class='buy-cell'>{r['buy_html']}</td>"
            f"</tr>"
        )

    return f"""
<!-- ════════════════ SUPPLEMENT SCHEDULE ════════════════ -->
<section id="supplement-schedule">
  <div class="schedule-header">
    <div>
      <h2 class="schedule-title">💊 Your Supplement Schedule</h2>
      <p class="schedule-subtitle">
        These are Shivani's <em>suggested</em> supplements for your healing journey —
        chosen to support your specific health goals. Please check with your doctor
        before starting any new supplement, especially if you're on medication.
      </p>
    </div>
    <button class="print-btn no-print" onclick="printSchedule()">🖨 Print Schedule</button>
  </div>

  <div class="timeline-track">
    {timeline_cards}
  </div>

  <div class="schedule-table-wrap">
    <table class="schedule-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Supplement</th>
          <th>Dose</th>
          <th>Why</th>
          <th class="no-print">Where to buy</th>
        </tr>
      </thead>
      <tbody>
        {table_rows}
      </tbody>
    </table>
  </div>
</section>

<script>
function printSchedule() {{
  // Use data-attribute approach so the page is not destroyed:
  // CSS body[data-print-supplement] hides everything except #supplement-schedule.
  document.body.setAttribute('data-print-supplement', '1');
  window.print();
  // afterprint listener in the main page script clears the attribute.
}}
</script>
<!-- ════════════════════════════════════════════════════ -->
"""


def _stringify_habit(h) -> str:
    """Tracking habits / education modules / etc. may be stored as dicts
    ({name, cadence} for habits; {module_title, ...} for education) or as
    plain strings on older plan YAMLs. Coerce to a presentable string so
    `', '.join(...)` doesn't choke."""
    if h is None:
        return ""
    if isinstance(h, str):
        return h.strip()
    if isinstance(h, dict):
        # Try common name keys in priority order
        for k in ("name", "habit", "title", "module_title", "label", "description"):
            v = h.get(k)
            if isinstance(v, str) and v.strip():
                cad = h.get("cadence") or h.get("frequency")
                if isinstance(cad, str) and cad.strip():
                    return f"{v.strip()} ({cad.strip()})"
                return v.strip()
        # Fallback: serialise the dict
        return ", ".join(f"{k}={v}" for k, v in h.items() if v)
    return str(h)


def _stringify_list(items) -> list[str]:
    """Normalise an arbitrary list-of-mixed-shapes into clean strings."""
    if not items:
        return []
    out: list[str] = []
    for it in items:
        s = _stringify_habit(it)
        if s:
            out.append(s)
    return out


def _calc_calorie_targets(client: dict, wl: dict) -> dict | None:
    """
    Given client profile + weight_loss params, return phase-by-phase calorie targets.
    Returns None if weight loss is not enabled or data is insufficient.

    Activity multipliers (TDEE = BMR × multiplier):
      sedentary = 1.20  |  light = 1.375  |  moderate = 1.55  |  active = 1.725

    Deficit per day for target weekly loss:
      slow     = 250 kcal/day → ~0.25 kg/wk
      moderate = 500 kcal/day → ~0.5  kg/wk
      faster   = 750 kcal/day → ~0.75 kg/wk

    Gradual build across 12 weeks (% of full deficit):
      Wks 1-2: 40%  Wks 3-4: 70%  Wks 5-8: 100%  Wks 9-10: 80%  Wks 11-12: 60%
    """
    if not wl or not wl.get("enabled"):
        return None

    from datetime import date as _date

    # Pull measurements from client profile
    m = client.get("measurements") or {}
    weight_kg = float(m.get("weight_kg") or client.get("weight_kg") or 0)
    height_cm = float(m.get("height_cm") or client.get("height_cm") or 0)
    sex = (client.get("sex") or "").upper()

    age = None
    dob = client.get("date_of_birth")
    if dob:
        try:
            age = (_date.today() - _date.fromisoformat(str(dob))).days // 365
        except Exception:
            pass
    if age is None and client.get("age_band"):
        # Fall back to midpoint of age band e.g. "35-40" → 37
        try:
            parts = str(client["age_band"]).split("-")
            age = (int(parts[0]) + int(parts[1])) // 2
        except Exception:
            age = 35

    if not (weight_kg and height_cm and age):
        return None   # insufficient data — skip calorie section

    # Mifflin-St Jeor BMR
    if sex == "M":
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
    else:
        bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161

    activity = (wl.get("activity_level") or "sedentary").lower()
    multipliers = {"sedentary": 1.20, "light": 1.375, "moderate": 1.55, "active": 1.725}
    tdee = round(bmr * multipliers.get(activity, 1.2))

    pace = (wl.get("pace") or "moderate").lower()
    daily_deficits = {"slow": 250, "moderate": 500, "faster": 750}
    full_deficit = daily_deficits.get(pace, 500)

    goal_kg = float(wl.get("goal_kg") or 0)
    goal_weeks = int(wl.get("goal_weeks") or 0)

    # If coach specified goal weeks, back-calculate the required daily deficit
    # (7700 kcal ≈ 1 kg of fat; weekly loss = goal_kg / goal_weeks)
    if goal_kg and goal_weeks:
        weekly_loss_kg = goal_kg / goal_weeks
        required_daily_deficit = round((weekly_loss_kg * 7700) / 7)
        # Cap at 750 kcal/day for safety; never below 200
        full_deficit = max(200, min(750, required_daily_deficit))
        # Compute implied pace label for narrative
        if weekly_loss_kg <= 0.3:
            pace_label = f"~{weekly_loss_kg:.2f} kg/week (slow & sustainable)"
        elif weekly_loss_kg <= 0.55:
            pace_label = f"~{weekly_loss_kg:.2f} kg/week (moderate)"
        else:
            pace_label = f"~{weekly_loss_kg:.2f} kg/week (faster pace — requires discipline)"
    else:
        # Fall back to pace-based deficit
        weekly_loss_kg = {"slow": 0.25, "moderate": 0.5, "faster": 0.75}.get(pace, 0.5)
        required_daily_deficit = None
        pace_label = {"slow": "~0.25 kg/week", "moderate": "~0.5 kg/week", "faster": "~0.75 kg/week"}.get(pace, "")

    # Estimated weeks to goal (use coach-specified if given, else calculate)
    if goal_weeks:
        weeks_to_goal = goal_weeks
    elif goal_kg and full_deficit:
        weeks_to_goal = round(goal_kg / (full_deficit * 7 / 7700))
    else:
        weeks_to_goal = None

    # Phase calorie targets — 5-phase gradual deficit build
    # Phases are proportional to goal_weeks: 2-2-4-2-2 for 12 weeks; scale for others
    phases = {
        "wk1_2":  max(1200, round(tdee - full_deficit * 0.40)),
        "wk3_4":  max(1200, round(tdee - full_deficit * 0.70)),
        "wk5_8":  max(1200, round(tdee - full_deficit * 1.00)),
        "wk9_10": max(1200, round(tdee - full_deficit * 0.80)),
        "wk11_12":max(1200, round(tdee - full_deficit * 0.60)),
    }

    return {
        "bmr": round(bmr),
        "tdee": tdee,
        "full_deficit": full_deficit,
        "goal_kg": goal_kg,
        "goal_weeks": goal_weeks or weeks_to_goal,
        "weeks_to_goal": weeks_to_goal,
        "weight_kg": weight_kg,
        "phases": phases,
        "pace_label": pace_label,
        "weekly_loss_kg": round(weekly_loss_kg, 2),
    }


def _top_of_mind_block(client: dict, plan: dict) -> str:
    """Return a TOP-OF-MIND context block for prompts — the client's specific
    intake context rendered prominently so the AI references it in EVERY tip.

    This is the antidote to generic FM advice. The AI is told later (via the
    BANNED-GENERIC rule) that every tip must reference at least one fact
    from this block — chief complaint, trigger, non-negotiable, life event,
    specific lab, or named driver.
    """
    first_name = (client.get("display_name") or "the client").split()[0]

    bullets: list[str] = []

    # Chief complaint — coach's intake notes are the best source we have here.
    notes = (client.get("notes") or "").strip()
    if notes:
        # Take the first 280 chars of the intake notes — usually contains the
        # client's "in their own words" chief concern.
        chief = notes[:280] + ("…" if len(notes) > 280 else "")
        bullets.append(f"- Chief complaint (intake notes): \"{chief}\"")

    goals = client.get("goals") or []
    if goals:
        bullets.append(f"- Stated goals: {', '.join(goals)}")

    triggers = (client.get("reported_triggers") or "").strip()
    if triggers and triggers.lower() != "none reported":
        bullets.append(f"- ⚠ Reported triggers (NEVER suggest these): {triggers}")

    non_neg = (client.get("non_negotiables") or "").strip()
    if non_neg and non_neg.lower() != "none mentioned":
        bullets.append(f"- 💎 Non-negotiables (work AROUND these, don't fight them): {non_neg}")

    worked = (client.get("what_has_worked") or "").strip()
    if worked:
        bullets.append(f"- ✅ What has worked for them before: {worked}")

    not_worked = (client.get("what_hasnt_worked") or "").strip()
    if not_worked:
        bullets.append(f"- ❌ What has NOT worked (don't re-prescribe): {not_worked}")

    foods_avoid = (client.get("foods_to_avoid") or "").strip()
    if foods_avoid:
        bullets.append(f"- Foods to avoid (preferences / intolerances): {foods_avoid}")

    conditions = client.get("active_conditions") or []
    if conditions:
        bullets.append(f"- Active conditions: {', '.join(conditions)}")

    meds = client.get("current_medications") or []
    if meds:
        bullets.append(f"- Medications (check interactions): {', '.join(meds)}")

    # IFM Timeline highlights — last 3 events of any kind, with year.
    timeline = client.get("timeline_events") or []
    if timeline:
        # Sort by year descending, fall back to original order for items with no year
        sorted_t = sorted(
            [t for t in timeline if isinstance(t, dict) and t.get("event")],
            key=lambda t: -(t.get("year") or 0),
        )[:3]
        if sorted_t:
            tl_lines = []
            for t in sorted_t:
                yr = t.get("year") or "—"
                ev = (t.get("event") or "").strip()
                cat = (t.get("category") or "").replace("_", " ")
                tl_lines.append(f"  · [{yr}] {ev}{f' ({cat})' if cat and cat != 'life event' else ''}")
            bullets.append("- Recent timeline events (refer to these by name when relevant):\n" + "\n".join(tl_lines))

    # Top driver from the AI-derived plan.hypothesized_drivers.
    drivers = plan.get("hypothesized_drivers") or []
    if drivers:
        top = drivers[0] if isinstance(drivers, list) else None
        if isinstance(top, dict):
            mech = (top.get("mechanism") or top.get("mechanism_slug") or "").strip()
            reasoning = (top.get("reasoning") or "").strip()
            if mech:
                line = f"- 🎯 Primary driver from the assessment: {mech}"
                if reasoning:
                    line += f" — {reasoning[:200]}"
                bullets.append(line)

    # Cycle context placeholder (filled by future PR — kept here so prompts
    # already reference it when present).
    cycle_phase = client.get("_computed_cycle_phase")
    if cycle_phase:
        bullets.append(f"- 🌙 Cycle phase today: {cycle_phase}")

    if not bullets:
        return ""

    body = "\n".join(bullets)
    return f"""
═══════════════════════════════════════════════════════════
THIS CLIENT — TOP-OF-MIND ({first_name}'s specifics):
═══════════════════════════════════════════════════════════
{body}
═══════════════════════════════════════════════════════════

Every recommendation, tip, and meal suggestion you write MUST reference
at least one specific item from the block above. See the
BANNED-GENERIC rule below.
"""


def _cycle_block(client: dict) -> str:
    """Return cycle-aware nutrition + movement rules for the prompt, or empty
    string if cycle context isn't applicable (men, not_applicable, missing LMP).

    Reads `client['_cycle_context']` set by `_load_client()`.
    """
    cyc = client.get("_cycle_context") or {}
    if not cyc:
        return ""
    phase = cyc.get("phase")
    status = cyc.get("status")
    day = cyc.get("cycle_day")
    length = cyc.get("cycle_length") or 28
    days_until = cyc.get("days_until_next_period")
    confidence = cyc.get("confidence", "high")
    note = cyc.get("note", "")

    if status == "postmenopausal":
        return f"""
🌙 CYCLE STATUS — POSTMENOPAUSAL:
This client is postmenopausal. Use a STABLE protocol — no phase-syncing.
- Phytoestrogen support DAILY: 1–2 tbsp ground flaxseed; phytoestrogenic
  greens; soy if tolerated; red clover.
- Optional lunar seed cycling (offer if client is open to ritual):
  - Days 1–14 of the calendar month (or new moon → full moon): 1 tbsp
    ground flaxseed + 1 tbsp pumpkin seeds daily.
  - Days 15–end (or full moon → new moon): 1 tbsp ground sesame + 1 tbsp
    sunflower daily.
  Even without an active cycle, the seed rotation provides rhythmic
  micronutrient + lignan support (zinc, selenium, vitamin E, omega-3 ALA).
  CALORIE BUDGET: ~85–100 kcal/day from the 2 tbsp must fit INTO the
  daily target — pick one meal to host them and trim an equivalent
  amount from another component of that same meal (e.g. less ghee /
  one less chapati / smaller portion of nuts). Never add as free food.
- Strength training MINIMUM 3×/week — bone density is now the main risk.
- Blood-sugar stability is paramount (oestrogen no longer cushions glucose
  swings): protein at every meal, no fasting after dinner, walks after
  meals.
- Gut health for oestrogen recycling: cruciferous vegetables, fibre 25–35g.
- Reference '{first_name}'s postmenopausal status' explicitly when giving
  food / movement advice — this is the lens the whole plan uses.
""".replace("{first_name}", client.get("display_name", "the client").split()[0])

    if not phase or status == "perimenopausal" and not day:
        return ""

    # Build the phase-specific rules text.
    phase_rules = {
        "menstrual": (
            "MENSTRUAL PHASE (day 1–5):\n"
            "- Iron-rich foods FRONT-AND-CENTRE: red meat or lentils + dates + "
            "blackstrap molasses + spinach. Pair with vitamin C (lemon, amla) "
            "for absorption.\n"
            "- Seed cycling — FOLLICULAR seeds: 1 tbsp ground flaxseed + "
            "1 tbsp pumpkin seeds daily (supports oestrogen production via "
            "lignans + zinc). Add to porridge, smoothie, dal, or sprinkle on "
            "salad. Grind flax fresh — pre-ground oxidises.\n"
            "- Movement: walks, restorative yoga, gentle stretching ONLY. "
            "No HIIT, no heavy strength training this week.\n"
            "- Sleep priority: magnesium glycinate 400mg at night, earlier "
            "bedtime (9-10pm).\n"
            "- Warming foods: bone broth, cooked roots, ghee. Avoid raw "
            "salads + cold smoothies this week."
        ),
        "follicular": (
            "FOLLICULAR PHASE (day 6–13, rising oestrogen):\n"
            "- Lighter, fresher meals — sprouts, salads, fermented foods "
            "(if tolerated). Energy is rising; capitalise.\n"
            "- Seed cycling — FOLLICULAR seeds CONTINUE: 1 tbsp ground "
            "flaxseed + 1 tbsp pumpkin seeds daily. Lignans in flax help "
            "modulate oestrogen; zinc in pumpkin supports follicle "
            "development.\n"
            "- Movement: HIIT, strength training, longer cardio all welcome. "
            "Body recovers fastest in this phase.\n"
            "- Protein for steady energy + muscle-building: eggs, fish, "
            "paneer, dal at lunch.\n"
            "- Cruciferous veg daily for healthy oestrogen metabolism."
        ),
        "ovulatory": (
            "OVULATORY PHASE (day ~14, oestrogen peak):\n"
            "- Anti-inflammatory bias: leafy greens, berries (in season), "
            "turmeric, omega-3s. Skin tends to look the best this phase.\n"
            "- Seed cycling — TRANSITION DAY: switch from flax+pumpkin to "
            "sesame+sunflower today (or tomorrow if cycle is short). Body "
            "shifts from oestrogen-dominant to progesterone-supportive.\n"
            "- Movement: high-intensity is fine; group classes / social "
            "movement leverages the energy + mood high.\n"
            "- Light + bright meals; minimise heavy oils + fried foods this "
            "week.\n"
            "- Cruciferous veg continue for E2 clearance."
        ),
        "early_luteal": (
            "EARLY LUTEAL (day 15–~21, rising progesterone):\n"
            "- Seed cycling — LUTEAL seeds: 1 tbsp ground sesame + 1 tbsp "
            "sunflower seeds daily (vitamin E + selenium support "
            "progesterone; lignans in sesame help oestrogen clearance). "
            "Tahini-based dressing, til chikki without sugar, or sprinkled "
            "on roasted veg all work.\n"
            "- Complex carbs return — sweet potato, ragi, quinoa, dal+rice. "
            "Progesterone increases insulin needs.\n"
            "- B6 (chickpeas, sunflower seeds — already added via seed "
            "cycling, banana) + magnesium (pumpkin seeds in moderation, "
            "dark chocolate) for PMS prevention.\n"
            "- Movement: moderate intensity — yoga flow, brisk walks, "
            "moderate strength. Avoid pushing PRs.\n"
            "- Protein still high; introduce evening snack if blood sugar "
            "drops."
        ),
        "late_luteal": (
            "LATE LUTEAL / PMS WINDOW (day ~22–28, progesterone falling):\n"
            "- Seed cycling — LUTEAL seeds CONTINUE: 1 tbsp ground sesame + "
            "1 tbsp sunflower daily until day 1 of next cycle. Vitamin E "
            "in sunflower may reduce PMS symptom severity (research-supported).\n"
            "- BLOOD SUGAR STABILITY IS PARAMOUNT: protein at EVERY meal, "
            "no fasting, no skipping breakfast. PMS symptoms 90% blood-sugar "
            "driven.\n"
            "- Reduce refined carbs aggressively this week — they amplify "
            "PMS mood/cravings.\n"
            "- Movement: restorative ONLY — yoga, walks, swimming. No HIIT.\n"
            "- Magnesium 400mg + B6 100mg evenings. Dark chocolate (>70%) "
            "as a PMS-friendly treat.\n"
            "- Sleep priority — pre-bed routine non-negotiable; cortisol "
            "is high this week."
        ),
    }

    rule = phase_rules.get(phase, "")
    if not rule:
        return ""

    confidence_note = ""
    if confidence == "low":
        confidence_note = (
            "\nNote: this client's cycle is irregular (perimenopause / "
            "stress / PCOS), so phase is best-effort. Apply rules loosely "
            "and note the variability in the plan."
        )

    return f"""
🌙 CYCLE-SYNCED NUTRITION & MOVEMENT (phase-specific rules — must be applied):
{rule}{confidence_note}

Today this client is on day {day} of {length} (~{days_until} days until next period).
The meal plan and movement recommendations MUST reflect this phase.
{note}

SEED CYCLING — CALORIE BUDGET RULES (very important):
The 2 tbsp of cycling seeds (~85–100 kcal total) MUST fit INTO the daily
calorie target — not on top of it.
  - 1 tbsp ground flaxseed ≈ 37 kcal
  - 1 tbsp pumpkin seeds   ≈ 47 kcal
  - 1 tbsp ground sesame   ≈ 51 kcal
  - 1 tbsp sunflower seeds ≈ 51 kcal

Integration rules:
  1. Pick ONE meal or snack where the seeds belong (e.g. breakfast
     porridge, the morning smoothie, mid-afternoon snack, or lunch
     dal/salad). Don't sprinkle 1 tbsp across two different meals.
  2. ADD the seed kcal to that meal's calorie line in the meal plan
     table, then REDUCE another component of the same meal by the
     equivalent kcal (e.g. swap 2 tsp ghee for 2 tsp ghee + 2 tbsp
     seeds → trim ghee to 1 tsp; or replace 1 chapati with seeds-on-
     dal-bowl).
  3. The total daily calories MUST still hit the target the calorie
     planner set. Do NOT add the seeds as 'free' food.
  4. State the swap explicitly in the meal plan table: e.g.
     'Breakfast (380 kcal) — porridge 1 cup oats + 2 tbsp seeds
     (replaces yesterday's almonds). Adjusted from 380 kcal target.'
  5. If the daily calorie target is NOT set (no weight-loss flag),
     just integrate seeds into a meal naturally without budget edits.

This applies whether the client is in a weight-loss phase or
maintenance. Calorie discipline matters either way.
"""


# Generic-tip banlist — same wording across all 4 builders so behaviour is
# consistent. Insert near the writing rules in each prompt.
_BANNED_GENERIC_RULE = """
BANNED-GENERIC RULE — READ TWICE:
Every coaching tip and meal suggestion in this document MUST reference at
least one specific thing this client told us about themselves — their
chief complaint in their words, a lab value, a food they actually eat or
avoid, a stress pattern, a life event from their timeline, a non-negotiable,
or a named driver from the assessment.

Generic FM advice is BANNED unless tied to this specific client. Examples
of BANNED phrasing (do not use as standalone tips):
  - "Eat more whole foods"
  - "Manage your stress"
  - "Sleep 7–9 hours"
  - "Stay hydrated"
  - "Exercise regularly"
  - "Reduce processed sugar"

GOOD phrasing (specific to this client):
  - Instead of "Manage stress" → "Your evening conflicts with your mum
    have been keeping you up — try a 5-min breath reset BEFORE the call,
    not after, so the cortisol spike doesn't carry into bedtime."
  - Instead of "Eat whole foods" → "Your morning chai + biscuits is the
    usual blood-sugar trigger. Swap to chai + 1 boiled egg + 1 banana for
    the next two weeks and notice the 11am energy."
  - Instead of "Sleep 8 hours" → "You wake at 3am — that's a cortisol
    pattern, not a sleep-hygiene problem. Magnesium glycinate at bedtime
    + your bedroom under 22°C is what we're targeting."

If a tip would apply equally to ANY client, REWRITE it to apply uniquely
to this client OR REMOVE it entirely. We'd rather a shorter document
that reads like it was written FOR this person than a long one of FM
boilerplate.
"""


def _build_prompt_meal_plan(plan: dict, client: dict, weight_loss: dict | None, coach_notes: str) -> str:
    """Meal plan only — nutrition journey, no supplements, no lifestyle."""
    plan_weeks = int(plan.get("plan_period_weeks") or 12)
    client_name = client.get("display_name") or "the client"
    first_name = client_name.split()[0] if client_name else "there"
    diet_pref = client.get("dietary_preference") or "Not specified"
    _foods_to_avoid_raw = client.get("foods_to_avoid") or ""
    _reported_triggers_raw = client.get("reported_triggers") or ""
    # Merge preferences + reported triggers into a single exclusion string
    _exclusion_parts = [p.strip() for p in [_foods_to_avoid_raw, _reported_triggers_raw] if p.strip()]
    foods_to_avoid = ", ".join(_exclusion_parts) if _exclusion_parts else "None mentioned"
    reported_triggers = _reported_triggers_raw or "None reported"
    non_negotiables = client.get("non_negotiables") or "None mentioned"
    city = client.get("city") or ""
    country = client.get("country") or "India"
    location_str = ", ".join(filter(None, [city, country])) or "India"
    import datetime as _dt
    _month = _dt.date.today().month
    if country.lower() in ("india", ""):
        if _month in (3, 4, 5):
            season = "Summer (Grishma) — hot, dry; prioritise cooling foods"
        elif _month in (6, 7, 8, 9):
            season = "Monsoon (Varsha) — humid; lighter meals, easy-to-digest foods"
        elif _month in (10, 11):
            season = "Autumn/Post-monsoon (Sharad) — transitional; moderate foods"
        else:
            season = "Winter (Hemanta/Shishira) — cold; warming, nourishing foods"
    else:
        if _month in (3, 4, 5):
            season = "Spring"
        elif _month in (6, 7, 8):
            season = "Summer"
        elif _month in (9, 10, 11):
            season = "Autumn/Fall"
        else:
            season = "Winter"
    age = None
    if client.get("date_of_birth"):
        from datetime import date
        try:
            dob = date.fromisoformat(client["date_of_birth"])
            age = (date.today() - dob).days // 365
        except Exception:
            pass
    sex = client.get("sex", "")
    conditions = client.get("active_conditions") or []
    allergies = (client.get("known_allergies") or client.get("allergies") or [])

    topics = plan.get("assessment", {}).get("focus_topics", [])
    symptoms = plan.get("assessment", {}).get("presenting_symptoms", [])
    nutrition = plan.get("nutrition") or {}
    nutrition_pattern = nutrition.get("pattern") or ""
    nutrition_add = nutrition.get("add") or []
    nutrition_reduce = nutrition.get("reduce") or []
    cooking = nutrition.get("cooking_adjustments") or []
    remedies = nutrition.get("home_remedies") or []
    meal_timing = nutrition.get("meal_timing") or ""

    cal = _calc_calorie_targets(client, weight_loss or {})
    if cal:
        def _split(daily: int) -> str:
            return (f"Breakfast ~{round(daily*0.25)} kcal · "
                    f"Snack ~{round(daily*0.10)} kcal · "
                    f"Lunch ~{round(daily*0.35)} kcal · "
                    f"Snack ~{round(daily*0.10)} kcal · "
                    f"Dinner ~{round(daily*0.30)} kcal")

        calorie_section = f"""
WEIGHT LOSS PLAN — HARD CALORIE CONSTRAINTS
Client data:  {cal['weight_kg']} kg · BMR {cal['bmr']} kcal · TDEE {cal['tdee']} kcal
Goal:         Lose {cal['goal_kg']} kg in {cal['goal_weeks']} weeks ({cal['pace_label']})
Daily deficit required: {cal['full_deficit']} kcal/day

PHASE TARGETS (MUST match):
  • Weeks 1–2  (Foundation):   {cal['phases']['wk1_2']} kcal/day  → {_split(cal['phases']['wk1_2'])}
  • Weeks 3–4  (Repair):       {cal['phases']['wk3_4']} kcal/day  → {_split(cal['phases']['wk3_4'])}
  • Weeks 5–8  (Full deficit): {cal['phases']['wk5_8']} kcal/day  → {_split(cal['phases']['wk5_8'])}
  • Weeks 9–10 (Ease back):    {cal['phases']['wk9_10']} kcal/day → {_split(cal['phases']['wk9_10'])}
  • Weeks 11–12 (Sustain):     {cal['phases']['wk11_12']} kcal/day→ {_split(cal['phases']['wk11_12'])}

EXERCISE — include a dedicated "Movement & Exercise" section:
- Current movement: {weight_loss.get('exercise_current') or 'not specified'}
- Open to adding: {weight_loss.get('exercise_open_to') or 'flexible — coach to suggest'}
- Available days/week: {weight_loss.get('exercise_days_per_week') or 3}
- Physical limitations: {weight_loss.get('exercise_limitations') or 'none mentioned'}
"""
    else:
        calorie_section = """
MOVEMENT & WELLNESS:
- Include a "Movement & Exercise" section with gentle, sustainable activity.
- Suggest daily walks, yoga, or strength training appropriate to a healing protocol.
- Frame movement as supportive of hormonal balance, energy, and mood.
"""

    coach_notes_block = ""
    if coach_notes:
        coach_notes_block = f"""
COACH'S CUSTOM KNOWLEDGE (weave these naturally into the nutrition plan):
{coach_notes}
Use these tips in relevant meal sections — don't dump them all in one place. Make them feel like natural advice.
"""

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)

    prompt = f"""You are writing a warm, friendly {plan_weeks}-week MEAL PLAN document for a client.
The coach (Shivani Hariharan) has prepared a structured plan. Turn the nutrition data into a beautiful, practical meal plan the client can actually USE.

{top_of_mind}
{cycle}
{attached_protocol}
{_BANNED_GENERIC_RULE}

CLIENT PROFILE:
- Name: {client_name} (address them as {first_name})
- Age: {age or 'not specified'}, Sex: {sex}
- Location: {location_str}
- Current season: {season}
- Dietary preference: {diet_pref}
- Foods they will NOT eat: {foods_to_avoid}
- ⚠ REPORTED TRIGGERS (client experienced reactions — EXCLUDE from ALL meals): {reported_triggers}
- Non-negotiables (won't give up): {non_negotiables}
- Allergies: {', '.join(allergies) if allergies else 'none known'}
- Active conditions: {', '.join(conditions) if conditions else 'none listed'}
{calorie_section}

PLAN DATA (nutrition focus):
Focus areas: {', '.join(topics) if topics else 'general wellness'}
Key symptoms addressed: {', '.join(symptoms) if symptoms else 'not listed'}
Nutrition pattern: {nutrition_pattern}
Meal timing guidance: {meal_timing}
Foods to ADD: {', '.join(nutrition_add) if nutrition_add else 'see meal plan'}
Foods to REDUCE: {', '.join(nutrition_reduce) if nutrition_reduce else 'none specified'}
Cooking adjustments: {', '.join(cooking) if cooking else 'none'}
Home remedies: {', '.join(remedies) if remedies else 'none'}
{coach_notes_block}

DOCUMENT STRUCTURE:

1. **Warm greeting** — 2–3 sentences welcoming {first_name}, naming this as a {plan_weeks}-week nutrition journey.

2. **Your {plan_weeks}-Week Nutrition Overview** — brief half-page map of the phases, nutrition lens only.

3. **WEEKS 1 & 2 — Full Detail**
   3a. Theme & goals for weeks 1–2 (1 short paragraph)
   > 🎯 **Weeks 1–2 daily calorie target: ~{cal['phases']['wk1_2'] if cal else 'N/A'} kcal/day**
   3b. TWO full 7-day meal plan tables (same format as below)
   3c. Movement & Exercise (brief bullet list)
   3d. What to notice in Weeks 1–2 (4–5 curiosity prompts)

   TABLE FORMAT (use exactly):
   ## 🗓 Week 1 Meal Plan {"— Target: " + str(cal['phases']['wk1_2']) + " kcal/day" if cal else ""}
   | Meal | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
   |------|-----|-----|-----|-----|-----|-----|-----|
   | **Breakfast** | ... | ... | ... | ... | ... | ... | ... |
   | **Mid-morning snack** | ... |
   | **Lunch** | ... |
   | **Evening snack** | ... |
   | **Dinner** | ... |
   | **Bedtime** | ... |
   {"| *~kcal* | *" + str(cal['phases']['wk1_2']) + "* | ... |" if cal else ""}

4. **Coming Up: Weeks 3 & 4** — SHORT PARAGRAPH ONLY (3–5 sentences, teaser only, no meal tables)

5. **Your {plan_weeks}-Week Roadmap** — one short paragraph per phase, nutrition focus only, no meal tables

6. **Home Remedies & Daily Teas** — `## 🌿 Home Remedies & Daily Teas`

7. **Recipe Appendix** — `## ✦ Recipe Appendix` — full recipes for every ✦ dish

8. **A note from your coach** — warm closing, Shivani's name

RULES:
- NO supplement tables or lists (see separate supplement document)
- SEASONAL produce for {location_str}, current season: {season}
- Respect dietary preference ({diet_pref}), avoid ({foods_to_avoid})
- CRITICAL: NEVER suggest foods listed as reported triggers: {reported_triggers}
- No clinical jargon — write like a knowledgeable friend
- If Vegetarian Jain: NO root vegetables (onion, garlic, potato, carrot, beetroot, radish, turnip)

{INDIAN_BRANDS}
"""
    return prompt


def _build_prompt_supplement_plan(plan: dict, client: dict, coach_notes: str) -> str:
    """Supplement plan intro — short Claude call. Main body is the Python-generated schedule."""
    client_name = client.get("display_name") or "the client"
    first_name = client_name.split()[0] if client_name else "there"
    conditions = client.get("active_conditions") or []
    goals = client.get("goals") or []
    supplements = plan.get("supplement_protocol") or []

    supp_list = []
    for s in supplements:
        name = s.get("display_name") or s.get("supplement_slug", "").replace("-", " ").title()
        dose = s.get("dose") or s.get("dose_display") or ""
        timing = s.get("timing") or ""
        rationale = (s.get("coach_rationale") or "").split("[evidence-tier note]")[0].strip()
        entry = f"- {name}"
        if dose:
            entry += f" ({dose})"
        if timing:
            entry += f" — {timing}"
        if rationale:
            entry += f": {rationale}"
        supp_list.append(entry)

    supp_text = "\n".join(supp_list) if supp_list else "No supplements specified."

    coach_notes_block = ""
    if coach_notes:
        coach_notes_block = f"""
COACH'S CUSTOM KNOWLEDGE (weave naturally into the intro and tips):
{coach_notes}
"""

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)

    prompt = f"""You are writing a short supplement protocol introduction letter for a client.

{top_of_mind}
{cycle}
{attached_protocol}
{_BANNED_GENERIC_RULE}


CLIENT: {client_name} (address as {first_name})
Conditions: {', '.join(conditions) if conditions else 'not specified'}
Goals: {', '.join(goals) if goals else 'not specified'}

THE PRESCRIBED SUPPLEMENTS:
{supp_text}
{coach_notes_block}
Write a SHORT, WARM, PRACTICAL introduction with these four sections (use these exact headings):

## Why These Supplements?
A warm 3–4 sentence paragraph explaining the overall protocol goal — what body systems are being supported and why. Link it to her specific conditions/goals. No clinical jargon.

## How to Use This Guide
4–5 bullet practical tips: timing with food, spacing between supplements, what to do if she forgets a dose, storing supplements, etc.

## What to Expect Week by Week
4–6 bullet timeline of what she might notice:
- Week 1–2: settling in period, possibly some digestive adjustment
- Week 3–4: first signs of improvement (energy, digestion, sleep)
- Week 6+: more sustained changes
- Week 10–12: reassess and adjust

## Your Full Schedule Is Below
One warm sentence: "Your full supplement schedule — with exact timings, doses, and where to get each one — is printed just below."

RULES:
- NO tables, NO supplement lists (the schedule is generated separately)
- Keep it SHORT — this is an introduction, not a guide
- Warm, encouraging tone — the client should feel confident, not overwhelmed
- Output ONLY the Markdown, nothing else
"""
    return prompt


def _build_prompt_lifestyle_guide(plan: dict, client: dict, coach_notes: str) -> str:
    """Lifestyle guide — habits, education, labs, tracking. No meal plan."""
    plan_weeks = int(plan.get("plan_period_weeks") or 12)
    client_name = client.get("display_name") or "the client"
    first_name = client_name.split()[0] if client_name else "there"
    diet_pref = client.get("dietary_preference") or "Not specified"
    conditions = client.get("active_conditions") or []
    goals = client.get("goals") or []
    allergies = (client.get("known_allergies") or client.get("allergies") or [])

    age = None
    if client.get("date_of_birth"):
        from datetime import date
        try:
            dob = date.fromisoformat(client["date_of_birth"])
            age = (date.today() - dob).days // 365
        except Exception:
            pass
    sex = client.get("sex", "")

    topics = plan.get("assessment", {}).get("focus_topics", [])
    symptoms = plan.get("assessment", {}).get("presenting_symptoms", [])
    lifestyle = _stringify_list(plan.get("lifestyle_practices"))
    education = plan.get("education") or []
    labs = plan.get("lab_orders") or []
    tracking = plan.get("tracking") or {}
    tracking_habits = _stringify_list(tracking.get("habits"))
    # Pydantic field is `symptoms_to_monitor`; older code read `monitor_symptoms`
    # which silently returned []. Read both for compat.
    tracking_symptoms = _stringify_list(
        tracking.get("symptoms_to_monitor") or tracking.get("monitor_symptoms")
    )
    recheck_questions = _stringify_list(tracking.get("recheck_questions"))

    lifestyle_block = "\n".join(f"- {p}" for p in lifestyle) if lifestyle else "None specified."

    education_block = ""
    if education:
        edu_items = []
        for e in education:
            title = e.get("module_title") or e.get("topic") or ""
            desc = e.get("description") or e.get("why") or ""
            if title:
                edu_items.append(f"- **{title}**: {desc}" if desc else f"- {title}")
        education_block = "\n".join(edu_items)
    else:
        education_block = "None specified."

    labs_block = ""
    if labs:
        lab_items = []
        for lab in labs:
            name = lab.get("test_name") or lab.get("name") or str(lab)
            reason = lab.get("reason") or lab.get("rationale") or ""
            if name:
                lab_items.append(f"- {name}" + (f" — {reason}" if reason else ""))
        labs_block = "\n".join(lab_items)
    else:
        labs_block = "None specified."

    coach_notes_block = ""
    if coach_notes:
        coach_notes_block = f"""
COACH'S CUSTOM KNOWLEDGE (weave naturally into relevant sections):
{coach_notes}
"""

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)

    prompt = f"""You are writing a warm, practical {plan_weeks}-week COACHING PLAN for a client — covering lifestyle, learning, labs, and tracking.
This document is the companion to the meal plan and supplement plan. It covers everything EXCEPT food and supplements.
The coach (Shivani Hariharan) has prepared the structured data below.

{top_of_mind}
{cycle}
{attached_protocol}
{_BANNED_GENERIC_RULE}

CLIENT PROFILE:
- Name: {client_name} (address as {first_name})
- Age: {age or 'not specified'}, Sex: {sex}
- Dietary preference: {diet_pref}
- Allergies: {', '.join(allergies) if allergies else 'none known'}
- Active conditions: {', '.join(conditions) if conditions else 'none listed'}
- Goals: {', '.join(goals) if goals else 'not listed'}

PLAN FOCUS:
Topics: {', '.join(topics) if topics else 'general wellness'}
Symptoms addressed: {', '.join(symptoms) if symptoms else 'not listed'}

LIFESTYLE PRACTICES:
{lifestyle_block}

EDUCATION MODULES:
{education_block}

LABS TO ORDER:
{labs_block}

TRACKING:
Habits to track: {', '.join(tracking_habits) if tracking_habits else 'none'}
Symptoms to watch: {', '.join(tracking_symptoms) if tracking_symptoms else 'none'}
Recheck questions: {', '.join(recheck_questions) if recheck_questions else 'none'}
{coach_notes_block}

DOCUMENT STRUCTURE:

1. **Warm greeting** — 2–3 sentences: you are {first_name}'s guide for the next {plan_weeks} weeks, this plan covers your lifestyle, learning, and health monitoring.

2. **Your Healing Framework** — brief {plan_weeks}-week arc from a lifestyle and wellness lens. What each phase focuses on (not food-focused — mindset, stress, sleep, habits, learning).

3. **Movement & Exercise** — `## 🏃 Movement & Exercise`
   A SIMPLE weekly schedule (not a detailed phased programme — that's the
   optional exercise_plan letter for clients who want depth).
   Produce:
     a. A 7-day table for a typical week (Mon-Sun), with Day | Type | Duration |
        Notes columns. Mark at least 1 explicit REST day. Match each day to
        {first_name}'s baseline movement_days_per_week and movement_type.
     b. For women in menstruating/perimenopausal phases: add a 2-line
        cycle-aware modification block — what to swap during menstrual phase
        (gentle walks, yoga, no HIIT) and during late-luteal/PMS week
        (restorative only). Refer to the cycle block above; do NOT repeat
        all the phase rules — just the swap guidance for movement.
     c. For postmenopausal women: emphasise strength training 3×/week
        (bone density priority).
   Frame as energy-building, not calorie-burning. 8-10 lines total — keep
   it scannable. If the coach has generated a separate detailed
   exercise_plan, tell {first_name}: 'See your detailed exercise plan for
   the full weekly progression and exercises.'

4. **Daily Lifestyle Practices** — `## 🌙 Daily Lifestyle Practices`
   Expand the lifestyle practices into actionable daily routines. Group by theme (morning routine, sleep practices, stress techniques, breathwork). Use bullet lists.

5. **What to Learn** — `## 📚 What to Learn`
   Present the education modules as a phased reading/learning plan. Group by phase. For each module explain WHY it matters in plain language (no jargon).

6. **Labs to Order** — `## 🔬 Labs to Order`
   Present the lab orders in plain English ("Ask your doctor for..."). Explain what each test reveals in simple terms. Group by when to order (baseline / mid-plan / end-of-plan).

7. **What to Track** — `## 📊 What to Track`
   Present tracking habits and symptoms as a simple daily/weekly check-in framework. Use bullet lists. Frame as curiosity, not pressure.

8. **Your Check-In Questions** — `## 💬 Your Check-In Questions`
   Questions {first_name} should reflect on before each coaching session. Include both provided recheck questions and 3–4 general wellbeing prompts.

9. **A note from your coach** — warm closing, remind {first_name} that this is a journey. Shivani's name.

RULES:
- NO meal plan content (see separate meal plan document)
- NO supplement lists (see separate supplement document) — may mention "as per your supplement plan"
- No clinical jargon — write like a knowledgeable friend
- Keep each section practical and doable
- Output ONLY the Markdown document
"""
    return prompt


def _build_prompt_exercise_plan(plan: dict, client: dict, coach_notes: str) -> str:
    """Standalone detailed 12-week exercise plan. Phase-by-phase, day-by-day,
    cycle-aware for women. Sent ONLY to clients who have asked for movement
    depth — coach decides per-client.

    Design parity with the meal_plan letter:
      - Weeks 1–2 get full Mon-Sun schedules with specific exercises
      - Weeks 3–{plan_weeks} get phase roadmaps (paragraphs, not full schedules)
      - Cycle-sync block flows in via _cycle_block() when applicable
    """
    plan_weeks = int(plan.get("plan_period_weeks") or 12)
    client_name = client.get("display_name") or "the client"
    first_name = client_name.split()[0] if client_name else "there"
    age = client.get("estimated_age") or client.get("age_band") or ""
    sex = (client.get("sex") or "").upper()
    conditions = client.get("active_conditions") or []
    medications = client.get("current_medications") or []
    goals = client.get("goals") or []
    five_pillars = client.get("five_pillars") or {}
    movement_days = five_pillars.get("movement_days_per_week")
    movement_type = five_pillars.get("movement_type") or ""
    movement_intensity = five_pillars.get("movement_intensity") or ""
    notes = client.get("notes") or ""

    coach_notes_block = ""
    if coach_notes:
        coach_notes_block = f"""
COACH'S CUSTOM KNOWLEDGE (weave naturally into the plan):
{coach_notes}
"""

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)

    prompt = f"""You are writing a warm, practical {plan_weeks}-week DETAILED EXERCISE PLAN
for a client who has explicitly asked for the depth. Most clients get a simple
weekly schedule inside their wellness letter; this document is for those who
want a real, progressive movement programme.

{top_of_mind}
{cycle}
{attached_protocol}
{_BANNED_GENERIC_RULE}

CLIENT PROFILE:
- Name: {client_name} (address as {first_name})
- Age: {age or 'not specified'}, Sex: {sex}
- Active conditions: {", ".join(conditions) if conditions else "none flagged"}
- Medications: {", ".join(medications) if medications else "none flagged"}
- Goals: {", ".join(goals) if goals else "(not stated)"}
- Current activity level (Five Pillars baseline):
  - {movement_days if movement_days is not None else 'unknown'} days/week
  - Type: {movement_type or 'unspecified'}
  - Intensity (self-reported): {movement_intensity or 'unspecified'}
- Free-text intake notes (read for limitations / preferences):
  {notes[:400] if notes else "(none)"}

WHAT TO PRODUCE — markdown document with these sections (in order):

1. **Warm greeting** (2–3 sentences) — name {first_name}, tie movement to
   their goals in their words. NO generic 'movement is good' platitudes.

2. **Your {plan_weeks}-week movement journey** — short prose paragraph
   explaining the arc. Phase 1 (weeks 1-4): build foundation. Phase 2
   (weeks 5-8): add load + intensity. Phase 3 (weeks 9-{plan_weeks}):
   sustainability + autonomy.

3. **Weeks 1–2 schedule** — full Mon-Sun for both weeks as Markdown tables.
   Per day include: workout type, duration, RPE (1-10), 3-5 specific
   exercises with sets × reps, equipment needed, optional cool-down.
   Mark REST days clearly. Examples:

   | Day | Type | Duration | RPE | Workout |
   |---|---|---|---|---|
   | Mon | Lower-body strength | 30 min | 6 | Goblet squat 3×10 (10kg DB), Glute bridge 3×12 (BW), Step-up 2×10/leg, Deadbug 3×8 |
   | Tue | Walk + mobility | 25 min | 3 | 20-min brisk walk + 5-min hip openers |
   | Wed | REST | — | — | Active recovery: 10-min stretch only |
   ...

   - At least 2 strength sessions/week
   - At least 1 dedicated mobility / yoga session
   - At least 1 full REST day per week
   - Cardio (zone 2) at least 2 sessions
   - For women: respect the cycle phase block above. If the cycle phase
     is menstrual or late luteal, replace HIIT with restorative options.

4. **Weeks 3–4 — building consistency** (paragraph, ~5 lines) — the focus
   for those weeks, not a full schedule. Reference 1-2 specific exercises
   they'll graduate to.

5. **Weeks 5–8 — phase 2: add load** (paragraph) — what changes.
   Progressive overload markers (e.g. add 10% volume per week, longer
   intervals, harder regressions).

6. **Weeks 9–{plan_weeks} — phase 3: making it yours** (paragraph) —
   shift from prescribed to self-directed. The client should be able to
   build their own week by week 12.

7. **Cycle-aware modifications** (only for women clients) — bullet list
   of how to swap days during menstrual / late-luteal weeks. Refer to the
   cycle block above. If client is postmenopausal, replace with a
   post-meno bone-and-strength priority box.

8. **Recovery + injury prevention** — 4-6 bullets covering: sleep as
   training (specific to {first_name}'s sleep pattern), warning signs
   to back off, mobility work cadence, hydration during sessions,
   condition-specific cautions if any.

9. **What to track** — 4-6 simple metrics: strength PRs (e.g. squat
   weight), session RPE drift over weeks, resting HR, sleep impact,
   mood/energy on training vs rest days. Frame as 'notice', not 'log'.

10. **A note from your coach** — warm closing. Short. Shivani's name.

WRITING RULES:
- Indian-context exercise vocabulary where it fits: surya namaskar,
  pranayama, walking after meals as 'shatpavali'. Don't force these —
  use only when natural.
- Equipment: assume bodyweight + a pair of dumbbells (or 1L water bottles
  as substitute) UNLESS the client explicitly mentions gym access in the
  intake notes. Default to home-friendly options.
- Time budget: assume 30 minutes per session unless coach notes say
  otherwise. Some sessions can be 20 min (active recovery), some 45
  (strength + mobility combined).
- Active conditions filter: respect every condition listed. E.g. if
  hypothyroid + low energy → reduce HIIT, lean into walking + yoga.
  If postpartum < 1 year → no jumping, no heavy core, focus pelvic floor.
  If known knee/back issue → no deep squats / heavy deadlifts; use
  regressions.
- BANNED-GENERIC applies to every tip: every exercise + duration + RPE
  must reference something specific about {first_name}. 'Walk daily' is
  banned. 'A 25-min walk after lunch — your usual blood-sugar dip time —
  with podcast or call to make it social' is what we want.

{coach_notes_block}

Output ONLY the Markdown document — no preamble, no postamble.
"""
    return prompt


def _build_prompt_meal_plan_phase(
    plan: dict,
    client: dict,
    weight_loss: dict | None,
    coach_notes: str,
    phase_start: int,
    phase_end: int,
) -> str:
    """Phase / continuation meal plan — used mid-cycle for weeks 3–4, 5–6,
    7–8, etc. when the coach wants to send a fresh meal plan letter
    WITHOUT creating a new plan (supplements + protocol stay locked).

    Different shape from the full meal plan:
      - Only the requested week range (max 2 weeks) renders with full
        7-day tables. No 12-week overview, no roadmap, no teaser sections.
      - Acknowledges the client is mid-cycle ("Building on weeks 1–2…").
      - Pulls calorie phase from the existing weight-loss config IF SET
        and selects the right phase target for the requested week range.
      - References ATTACHED supplements + protocol as "your current
        routine continues" — does NOT re-list them.
    """
    plan_weeks = int(plan.get("plan_period_weeks") or 12)
    client_name = client.get("display_name") or "the client"
    first_name = client_name.split()[0] if client_name else "there"
    diet_pref = client.get("dietary_preference") or "Not specified"
    _foods_to_avoid_raw = client.get("foods_to_avoid") or ""
    _reported_triggers_raw = client.get("reported_triggers") or ""
    _exclusion_parts = [
        p.strip() for p in [_foods_to_avoid_raw, _reported_triggers_raw] if p.strip()
    ]
    foods_to_avoid = ", ".join(_exclusion_parts) if _exclusion_parts else "None mentioned"
    reported_triggers = _reported_triggers_raw or "None reported"
    non_negotiables = client.get("non_negotiables") or "None mentioned"
    city = client.get("city") or ""
    country = client.get("country") or "India"
    location_str = ", ".join(filter(None, [city, country])) or "India"

    import datetime as _dt
    _month = _dt.date.today().month
    if country.lower() in ("india", ""):
        if _month in (3, 4, 5):
            season = "Summer (Grishma) — hot, dry; prioritise cooling foods"
        elif _month in (6, 7, 8, 9):
            season = "Monsoon (Varsha) — humid; lighter meals, easy-to-digest foods"
        elif _month in (10, 11):
            season = "Autumn/Post-monsoon (Sharad) — transitional; moderate foods"
        else:
            season = "Winter (Hemanta/Shishira) — cold; warming, nourishing foods"
    else:
        if _month in (3, 4, 5):
            season = "Spring"
        elif _month in (6, 7, 8):
            season = "Summer"
        elif _month in (9, 10, 11):
            season = "Autumn/Fall"
        else:
            season = "Winter"

    age = None
    if client.get("date_of_birth"):
        from datetime import date as _date
        try:
            dob = _date.fromisoformat(client["date_of_birth"])
            age = (_date.today() - dob).days // 365
        except Exception:
            pass
    sex = client.get("sex", "")
    conditions = client.get("active_conditions") or []
    allergies = client.get("known_allergies") or client.get("allergies") or []
    nutrition = plan.get("nutrition") or {}
    nutrition_pattern = nutrition.get("pattern") or ""
    nutrition_add = nutrition.get("add") or []
    nutrition_reduce = nutrition.get("reduce") or []

    # Active supplements — referenced as "your routine continues", NOT re-listed in detail.
    supplements = plan.get("supplement_protocol") or []
    supp_names = []
    for s in supplements:
        if isinstance(s, dict):
            name = s.get("display_name") or (s.get("supplement_slug") or "").replace("-", " ").title()
            if name:
                supp_names.append(name)
    supp_summary = ", ".join(supp_names) if supp_names else "your current supplement routine"

    # Phase calorie target (if weight loss config). Select the bucket
    # that maps to the requested week range — phases are weeks 1–2,
    # 3–4, 5–8, 9–10, 11–12.
    cal = _calc_calorie_targets(client, weight_loss or {})
    calorie_block = ""
    if cal:
        if phase_start <= 2:
            kcal = cal["phases"]["wk1_2"]
            phase_label = "Foundation (wks 1–2)"
        elif phase_start <= 4:
            kcal = cal["phases"]["wk3_4"]
            phase_label = "Repair (wks 3–4)"
        elif phase_start <= 8:
            kcal = cal["phases"]["wk5_8"]
            phase_label = "Full deficit (wks 5–8)"
        elif phase_start <= 10:
            kcal = cal["phases"]["wk9_10"]
            phase_label = "Ease back (wks 9–10)"
        else:
            kcal = cal["phases"]["wk11_12"]
            phase_label = "Sustain (wks 11–12)"

        bk = round(kcal * 0.25)
        sn1 = round(kcal * 0.10)
        lu = round(kcal * 0.35)
        sn2 = round(kcal * 0.10)
        di = round(kcal * 0.30)
        calorie_block = f"""
WEIGHT-LOSS CALORIE TARGET — {phase_label}: {kcal} kcal/day
Per meal split (MUST roughly match):
  Breakfast ~{bk} · Mid-morning ~{sn1} · Lunch ~{lu} · Evening snack ~{sn2} · Dinner ~{di}
"""

    coach_notes_block = ""
    if coach_notes:
        coach_notes_block = f"""
COACH'S CUSTOM KNOWLEDGE (weave naturally into the meals):
{coach_notes}
"""

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)

    phase_label_short = (
        f"Week {phase_start}"
        if phase_start == phase_end
        else f"Weeks {phase_start}–{phase_end}"
    )
    span_weeks = phase_end - phase_start + 1

    prompt = f"""You are writing a CONTINUATION meal plan letter for {first_name}.
This is a MID-CYCLE update — {first_name} is currently in week {phase_start} of her
{plan_weeks}-week protocol. She already has her supplements + lifestyle plan from
the initial letter. This letter ONLY covers meals for {phase_label_short}.

Tone: warm, encouraging, acknowledges momentum. Reference what she's been doing
the past weeks. Don't re-prescribe — continue + evolve.

{top_of_mind}
{cycle}
{attached_protocol}
{_BANNED_GENERIC_RULE}

CLIENT PROFILE:
- Name: {client_name} (address as {first_name})
- Age: {age or 'not specified'}, Sex: {sex}
- Location: {location_str}
- Current season: {season}
- Dietary preference: {diet_pref}
- Foods they will NOT eat: {foods_to_avoid}
- ⚠ REPORTED TRIGGERS (EXCLUDE from ALL meals): {reported_triggers}
- Non-negotiables: {non_negotiables}
- Allergies: {', '.join(allergies) if allergies else 'none known'}
- Active conditions: {', '.join(conditions) if conditions else 'none listed'}
{calorie_block}

CURRENT ROUTINE (already prescribed — DO NOT re-list, just reference):
- Supplements continuing: {supp_summary}
- Nutrition pattern: {nutrition_pattern or 'see initial letter'}
- Foods to emphasise from initial plan: {', '.join(nutrition_add[:8]) if nutrition_add else 'see initial letter'}
- Foods to reduce from initial plan: {', '.join(nutrition_reduce[:8]) if nutrition_reduce else 'see initial letter'}
{coach_notes_block}

DOCUMENT STRUCTURE — keep TIGHT, no extra sections:

1. **Warm 2-sentence opener** — name the week range, acknowledge momentum
   (e.g. "Hi {first_name} — you've made it through the first couple of weeks,
   and your gut is starting to settle into a new rhythm. Here's what
   {phase_label_short} look like.")

2. **What's evolving this phase** — 1 short paragraph (3-5 sentences).
   Reference the protocol stage. E.g. for weeks 3–4 of 5R: "Now that you've
   removed the main triggers and started replacing digestive support, we're
   layering in more reinoculation foods…" — concrete, specific, NOT generic.

3. **{span_weeks} × 7-day meal plan tables** — one per week in the range
   {phase_label_short}. Use this exact format:

   ## 🗓 Week {phase_start} Meal Plan{(' — Target: ' + str(kcal) + ' kcal/day') if cal else ''}
   | Meal | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
   |------|-----|-----|-----|-----|-----|-----|-----|
   | **Breakfast** | ... |
   | **Mid-morning snack** | ... |
   | **Lunch** | ... |
   | **Evening snack** | ... |
   | **Dinner** | ... |
   | **Bedtime** | ... |
   {"| *~kcal* | ... |" if cal else ""}

   {(
       "Repeat the table for each week in range (Week " + str(phase_start) + " through Week " + str(phase_end) + ")."
       if span_weeks > 1 else ""
   )}

4. **A few new dishes to try** — list 3–5 NEW recipes/dishes introduced
   this phase (different from initial-letter weeks). Tag each with ✦
   and add full recipes in the Appendix.

5. **What to notice in {phase_label_short}** — 3–4 curiosity prompts
   tied to phase outcomes (e.g. "Notice if your post-meal bloating
   has reduced", "Track energy at 4pm — should be steadier than week 1").

6. **Recipe Appendix** — `## ✦ Recipe Appendix` — full ingredient
   lists + steps for every ✦ dish.

7. **A note from your coach** — 2–3 sentence warm close, Shivani's name.

RULES:
- NO supplement tables — {first_name}'s supplement routine continues from
  the initial letter. Just reference it ("alongside your magnesium and
  ashwagandha as before").
- NO 12-week overview, NO roadmap — this letter is laser-focused on
  {phase_label_short}.
- SEASONAL produce for {location_str}, current season: {season}.
- Respect dietary preference ({diet_pref}), avoid ({foods_to_avoid}).
- CRITICAL: NEVER suggest reported-trigger foods: {reported_triggers}.
- Vegetarian Jain: NO root vegetables.
- Indian context unless said otherwise — ragi, dal, paneer, ghee, coconut.
- {span_weeks} weeks of meals — keep variety, don't repeat the same
  dinner 3 nights in a row. Use seasonal swaps to keep it interesting.

{INDIAN_BRANDS}
"""
    return prompt


def _build_prompt(plan: dict, client: dict, weight_loss: dict | None = None,
                  letter_type: str = "consolidated", coach_notes: str = "",
                  existing_partials: dict | None = None,
                  has_exercise_plan: bool = False,
                  phase_start: int | None = None,
                  phase_end: int | None = None) -> str:
    """Build the full prompt for Claude. Dispatches to type-specific builders for non-consolidated types.

    `existing_partials` is a dict like {"meal_plan": "...md content...",
    "supplement_plan": "...", "lifestyle_guide": "..."} — when present and the
    letter_type is consolidated, those sections are injected as
    "use verbatim" instructions so the AI doesn't regenerate already-finalised
    content. Ignored for partial letter types (they generate fresh).
    """

    if letter_type == "meal_plan":
        return _build_prompt_meal_plan(plan, client, weight_loss, coach_notes)
    if letter_type == "meal_plan_phase":
        # Phase letter — coach specified start/end weeks via payload.
        # Default to weeks 3–4 if missing (safe fallback for the most-
        # common continuation case after the initial 2-week meal plan).
        return _build_prompt_meal_plan_phase(
            plan,
            client,
            weight_loss,
            coach_notes,
            phase_start or 3,
            phase_end or 4,
        )
    if letter_type == "supplement_plan":
        return _build_prompt_supplement_plan(plan, client, coach_notes)
    if letter_type == "lifestyle_guide":
        return _build_prompt_lifestyle_guide(plan, client, coach_notes)
    if letter_type == "exercise_plan":
        return _build_prompt_exercise_plan(plan, client, coach_notes)
    # else: consolidated — fall through to existing code
    plan_weeks = int(plan.get("plan_period_weeks") or 12)

    client_name = client.get("display_name") or "the client"
    first_name = client_name.split()[0] if client_name else "there"
    diet_pref = client.get("dietary_preference") or "Not specified"
    _foods_to_avoid_raw = client.get("foods_to_avoid") or ""
    _reported_triggers_raw = client.get("reported_triggers") or ""
    _exclusion_parts = [p.strip() for p in [_foods_to_avoid_raw, _reported_triggers_raw] if p.strip()]
    foods_to_avoid = ", ".join(_exclusion_parts) if _exclusion_parts else "None mentioned"
    reported_triggers = _reported_triggers_raw or "None reported"
    non_negotiables = client.get("non_negotiables") or "None mentioned"
    city = client.get("city") or ""
    country = client.get("country") or "India"
    location_str = ", ".join(filter(None, [city, country])) or "India"
    # Determine current season based on location and today's date
    import datetime as _dt
    _month = _dt.date.today().month
    if country.lower() in ("india", ""):
        # Indian seasons by month
        if _month in (3, 4, 5):
            season = "Summer (Grishma) — hot, dry; prioritise cooling foods"
        elif _month in (6, 7, 8, 9):
            season = "Monsoon (Varsha) — humid; lighter meals, easy-to-digest foods"
        elif _month in (10, 11):
            season = "Autumn/Post-monsoon (Sharad) — transitional; moderate foods"
        else:
            season = "Winter (Hemanta/Shishira) — cold; warming, nourishing foods"
    elif country.lower() in ("uk", "united kingdom", "england"):
        if _month in (3, 4, 5):
            season = "Spring — asparagus, peas, new potatoes, spring greens"
        elif _month in (6, 7, 8):
            season = "Summer — berries, courgette, tomatoes, broad beans"
        elif _month in (9, 10, 11):
            season = "Autumn — squash, root vegetables, apples, pears, mushrooms"
        else:
            season = "Winter — root veg, cabbage, kale, leeks, stored apples"
    else:
        if _month in (3, 4, 5):
            season = "Spring"
        elif _month in (6, 7, 8):
            season = "Summer"
        elif _month in (9, 10, 11):
            season = "Autumn/Fall"
        else:
            season = "Winter"
    age = None
    if client.get("date_of_birth"):
        from datetime import date
        try:
            dob = date.fromisoformat(client["date_of_birth"])
            age = (date.today() - dob).days // 365
        except Exception:
            pass
    sex = client.get("sex", "")
    conditions = client.get("active_conditions") or []
    goals = client.get("goals") or []
    allergies = (client.get("known_allergies") or client.get("allergies") or [])

    # Plan sections
    topics = plan.get("assessment", {}).get("focus_topics", [])
    symptoms = plan.get("assessment", {}).get("presenting_symptoms", [])
    supplements = plan.get("supplement_protocol") or []
    lifestyle = _stringify_list(plan.get("lifestyle_practices"))
    nutrition = plan.get("nutrition") or {}
    education = plan.get("education") or []
    labs = plan.get("lab_orders") or []
    tracking = plan.get("tracking") or {}

    # Build supplement guide — sorted by time of day, ALL items included
    supp_enriched = []
    for s in supplements:
        slug = s.get("supplement_slug", "")
        name = s.get("display_name") or slug.replace("-", " ").title()
        dose = s.get("dose") or s.get("dose_display") or ""
        timing = s.get("timing") or ""
        rationale = (s.get("coach_rationale") or "").split("[evidence-tier note]")[0].strip()
        slot_idx, slot_label, slot_emoji = _timing_slot(timing)
        buy_link_override = s.get("buy_link") or ""
        vitaone = _vitaone_link(name, slug=slug)
        if buy_link_override:
            link_text = f"[Buy here]({buy_link_override})"
        else:
            link_text = vitaone or f"[Search on iHerb]({IHERB_AFFILIATE}) *(affiliate link)*"
        supp_enriched.append((slot_idx, slot_label, slot_emoji, name, dose, timing, rationale, link_text))

    supp_enriched.sort(key=lambda x: (x[0], x[3]))

    supp_guide = []
    for slot_idx, slot_label, slot_emoji, name, dose, timing, rationale, link_text in supp_enriched:
        time_str = timing or slot_label
        supp_guide.append(
            f"- **{name}**{' — ' + dose if dose else ''} · ⏰ {slot_emoji} {time_str}\n"
            f"  - {rationale}\n"
            f"  - 🛒 {link_text}"
        )

    supp_block = "\n".join(supp_guide) if supp_guide else "No supplements in this plan."

    coach_notes_block = ""
    if coach_notes:
        coach_notes_block = f"""
COACH'S CUSTOM KNOWLEDGE (weave these naturally into the plan):
{coach_notes}
Use these tips in relevant sections — don't dump them all in one place. Make them feel like natural advice, not a list.
"""

    nutrition_pattern = nutrition.get("pattern") or ""
    nutrition_add = nutrition.get("add") or []
    nutrition_reduce = nutrition.get("reduce") or []
    cooking = nutrition.get("cooking_adjustments") or []
    remedies = nutrition.get("home_remedies") or []
    meal_timing = nutrition.get("meal_timing") or ""

    lifestyle_block = "\n".join(f"- {p}" for p in lifestyle) if lifestyle else ""
    tracking_habits = _stringify_list(tracking.get("habits"))
    # Pydantic field is `symptoms_to_monitor`; older code read `monitor_symptoms`
    # which silently returned []. Read both for compat.
    tracking_symptoms = _stringify_list(
        tracking.get("symptoms_to_monitor") or tracking.get("monitor_symptoms")
    )

    # ── Calorie targets (weight loss only) ───────────────────────────────────
    cal = _calc_calorie_targets(client, weight_loss or {})
    if cal:
        # Per-meal allocation for each phase (breakfast 25% / lunch 35% / dinner 30% / snacks 10%)
        def _split(daily: int) -> str:
            return (f"Breakfast ~{round(daily*0.25)} kcal · "
                    f"Snack ~{round(daily*0.10)} kcal · "
                    f"Lunch ~{round(daily*0.35)} kcal · "
                    f"Snack ~{round(daily*0.10)} kcal · "
                    f"Dinner ~{round(daily*0.30)} kcal")

        calorie_section = f"""
══════════════════════════════════════════════════════════
WEIGHT LOSS PLAN — HARD CALORIE CONSTRAINTS
This client's BMR is {cal['bmr']} kcal. TDEE (sedentary): {cal['tdee']} kcal.
Giving her 1800–1900 kcal would mean NO weight loss — she would maintain or gain.
Every single meal in this plan MUST hit the targets below. This is non-negotiable.
══════════════════════════════════════════════════════════

Client data:  {cal['weight_kg']} kg · BMR {cal['bmr']} kcal · TDEE {cal['tdee']} kcal
Goal:         Lose {cal['goal_kg']} kg in {cal['goal_weeks']} weeks ({cal['pace_label']})
Daily deficit required: {cal['full_deficit']} kcal/day

PHASE TARGETS (MUST match — check each day before writing it):
  • Weeks 1–2  (Foundation):   {cal['phases']['wk1_2']} kcal/day  → {_split(cal['phases']['wk1_2'])}
  • Weeks 3–4  (Repair):       {cal['phases']['wk3_4']} kcal/day  → {_split(cal['phases']['wk3_4'])}
  • Weeks 5–8  (Full deficit): {cal['phases']['wk5_8']} kcal/day  → {_split(cal['phases']['wk5_8'])}
  • Weeks 9–10 (Ease back):    {cal['phases']['wk9_10']} kcal/day → {_split(cal['phases']['wk9_10'])}
  • Weeks 11–12 (Sustain):     {cal['phases']['wk11_12']} kcal/day→ {_split(cal['phases']['wk11_12'])}

MEAL PLANNING RULES:
- Choose portion sizes and dishes so each DAY totals the phase target (±50 kcal). If a typical Indian dish is too calorie-dense, halve the portion or swap to a lighter variant.
- Include the *~kcal* row in every 7-day table. Each cell must show the actual day total.
- Prioritise: protein (≥20 g/meal) + fibre to maximise satiety at these calorie levels.
- NEVER serve a day below 1200 kcal. If the phase target is below 1200, set it to 1200.
- Write calorie notes to the client warmly: e.g. "This week your meals are calibrated for steady, sustainable loss — satisfying but not excessive." Not clinical, not scary.

EXERCISE PROTOCOL — include a dedicated "Movement & Exercise" section in the plan:
- Current movement: {weight_loss.get('exercise_current') or 'not specified'}
- Open to adding: {weight_loss.get('exercise_open_to') or 'flexible — coach to suggest'}
- Available days/week: {weight_loss.get('exercise_days_per_week') or 3}
- Physical limitations: {weight_loss.get('exercise_limitations') or 'none mentioned'}

Build a phased exercise plan alongside the nutrition plan:
  • Weeks 1–2 (Foundation): gentle — daily walks (30–45 min), morning stretching, breathwork. No high-intensity yet.
  • Weeks 3–4 (Activation): introduce 2x strength training or yoga flow per week alongside walks.
  • Weeks 5–8 (Build): 3x strength / resistance sessions + 2x cardio (brisk walk, cycling, swim) per week.
  • Weeks 9–12 (Sustain): maintain 3–4x mixed training; introduce one longer weekend activity for enjoyment.
- Adapt to her available days ({weight_loss.get('exercise_days_per_week') or 3}/week) and any limitations noted above.
- For each phase give: frequency, session type, duration, and a specific example session.
- Tone: motivating and doable — never punishing. Frame exercise as energy-building and mood-lifting, not calorie burning.
- If she has hormonal/thyroid conditions: caution against high-intensity cardio that spikes cortisol; favour strength, yoga, Pilates, walking.
"""
    else:
        # General wellness — still include a gentle movement section
        calorie_section = """
MOVEMENT & WELLNESS:
- Include a "Movement & Exercise" section in the plan with gentle, sustainable activity recommendations.
- Suggest daily walks, yoga, or strength training appropriate to a healing protocol.
- Frame movement as supportive of hormonal balance, energy, and mood — not weight loss.
- Keep it brief (3–5 bullet points) unless the plan's lifestyle_practices already covers this.
"""

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)

    prompt = f"""You are writing a warm, friendly, practical {plan_weeks}-week wellness plan letter for a client.
The coach (Shivani Hariharan, a functional medicine health coach) has prepared this structured plan.
Your job is to turn the coach's structured data into a beautiful, easy-to-read document the client can actually USE.

{top_of_mind}
{cycle}
{attached_protocol}
{_BANNED_GENERIC_RULE}

CLIENT PROFILE:
- Name: {client_name} (address them as {first_name})
- Age: {age or 'not specified'}, Sex: {sex}
- Location: {location_str}
- Current season: {season}
- Dietary preference: {diet_pref}
- Foods they will NOT eat: {foods_to_avoid}
- ⚠ REPORTED TRIGGERS (client experienced reactions — EXCLUDE from ALL meals): {reported_triggers}
- Non-negotiables (won't give up): {non_negotiables}
- Allergies: {', '.join(allergies) if allergies else 'none known'}
- Active conditions: {', '.join(conditions) if conditions else 'none listed'}
- Goals: {', '.join(goals) if goals else 'not listed'}
{calorie_section}

PLAN DATA (from coach):
Focus areas: {', '.join(topics) if topics else 'general wellness'}
Key symptoms addressed: {', '.join(symptoms) if symptoms else 'not listed'}
Nutrition pattern: {nutrition_pattern}
Meal timing guidance: {meal_timing}
Foods to ADD: {', '.join(nutrition_add) if nutrition_add else 'see meal plan'}
Foods to REDUCE: {', '.join(nutrition_reduce) if nutrition_reduce else 'none specified'}
Cooking adjustments: {', '.join(cooking) if cooking else 'none'}
Home remedies: {', '.join(remedies) if remedies else 'none'}

SUPPLEMENT PROTOCOL:
{supp_block}

LIFESTYLE PRACTICES:
{lifestyle_block or 'None specified in plan'}

TRACKING:
Habits to track: {', '.join(tracking_habits) if tracking_habits else 'none'}
Symptoms to watch: {', '.join(tracking_symptoms) if tracking_symptoms else 'none'}

EDUCATION MODULES:
{'; '.join([e.get('module_title', '') for e in education if e.get('module_title')]) if education else 'none'}

---

INSTRUCTIONS FOR THE LETTER:

Write a complete, warmly-toned {plan_weeks}-WEEK HEALING PLAN document in Markdown.
This is NOT a one-week meal plan. It is a structured healing journey across {plan_weeks} weeks, shared with the client 2 weeks at a time.
The plan must have a logical therapeutic progression — each phase builds on the last.

## Healing phases (the {plan_weeks}-week arc):
- **Weeks 1–2 (Foundation):** Remove biggest inflammatory triggers, establish daily rhythm, introduce 2–3 key supplements. Gentle start — build trust and consistency.
- **Weeks 3–4 (Repair):** Gut lining support, introduce fermented foods, add healing broths/teas. Deepen supplement protocol.
- **Weeks 5–6 (Rebalance):** Hormone and blood sugar focus. Specific foods for hormonal balance. Stress reduction becomes intentional practice.
- **Weeks 7–8 (Strengthen):** Deeper nourishment — therapeutic foods, mitochondrial support, energy focus. Introduce more variety.
- **Weeks 9–10 (Optimize):** Fine-tune based on what's working. Circadian rhythm, sleep, and deeper lifestyle work.
- **Weeks 11–12 (Sustain):** Long-term habit anchoring. Transition to maintenance. Celebrate progress.

## Document structure:

1. **Warm greeting** — 2–3 sentences welcoming {first_name}, naming this as a {plan_weeks}-week journey, setting an excited but calm tone. No clinical words.

2. **Your Healing Journey — The {plan_weeks}-Week Overview**
   A brief (half-page) map of the phases above — what each phase focuses on and why in this order.
   Written in plain language. E.g. "In weeks 1–2 we focus on foundations — clearing the path so your body can start healing. By weeks 5–6 we'll be working on your hormones and energy. By week {plan_weeks} you'll have a way of eating and living that feels completely yours."

3. **YOUR PLAN — WEEKS 1 & 2: Foundation**
   (This section is fully detailed. Weeks 3–12 have an outline only — full detail is sent before each new phase begins.)

   **3a. Theme & goals for weeks 1–2** — 1 short paragraph. What is the body doing in this phase? What should {first_name} focus on?
   Then include this callout block immediately after the paragraph:
   > 🎯 **Weeks 1–2 daily calorie target: ~{cal['phases']['wk1_2'] if cal else 'N/A'} kcal/day**{"" if not cal else f" *(BMR {cal['bmr']} kcal · TDEE {cal['tdee']} kcal · daily deficit {cal['full_deficit']} kcal)*"}

   **3b. 14-Day Meal Plan — TWO 7-day tables. CALORIE TARGETS ARE BINDING.**

   {"⚠️ WEIGHT LOSS PLAN — each day MUST total the target below. Choose portion sizes accordingly." if cal else ""}
   {"Week 1 & 2 target: " + str(cal['phases']['wk1_2']) + " kcal/day (±50 kcal). Portions must reflect this — not a typical 1800-1900 kcal adult plate." if cal else ""}

   USE THIS EXACT TABLE FORMAT. Do NOT use bullet points or prose for the meal plan.

   ## 🗓 Week 1 Meal Plan {"— Target: " + str(cal['phases']['wk1_2']) + " kcal/day" if cal else ""}
   | Meal | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
   |------|-----|-----|-----|-----|-----|-----|-----|
   | **Breakfast** | dish | dish | dish | dish | dish | dish | dish |
   | **Mid-morning snack** | snack | snack | snack | snack | snack | snack | snack |
   | **Lunch** | dish | dish | dish | dish | dish | dish | dish |
   | **Evening snack** | snack | snack | snack | snack | snack | snack | snack |
   | **Dinner** | dish | dish | dish | dish | dish | dish | dish |
   | **Bedtime** | drink/✗ | drink/✗ | drink/✗ | drink/✗ | drink/✗ | drink/✗ | drink/✗ |
   {"| *~kcal* | *" + str(cal['phases']['wk1_2']) + "* | *" + str(cal['phases']['wk1_2']) + "* | *...* | *...* | *...* | *...* | *...* |" if cal else ""}

   ## 🗓 Week 2 Meal Plan {"— Target: " + str(cal['phases']['wk1_2']) + " kcal/day" if cal else ""}
   (Same structure, vary the dishes. Each day must still total ~{cal['phases']['wk1_2'] if cal else 'N/A'} kcal.)

   Table rules:
   - Each cell: dish name only, short (e.g. "Ragi dosa + chutney ✦"). Flag recipes with ✦.
   - Every day total in the *~kcal* row must be within ±50 kcal of the phase target.
   - Meals MUST respect dietary preference ({diet_pref}) and avoid ({foods_to_avoid}).
   - CRITICAL: NEVER use reported triggers in any meal: {reported_triggers}
   - INCORPORATE non-negotiables ({non_negotiables}) with a workaround if needed.
   - Use specific Indian dish names. Week 2 should vary from Week 1.

   **3c. Supplement note** — Add ONLY this single short paragraph (NO table, NO list):
   > *The supplement schedule for this plan — including timings, doses, and where to get each one — is included as a separate printable section in this document.*
   DO NOT write a supplement table or list here. The supplement schedule is generated separately and injected automatically.

   **3d. Movement & Exercise** — heading `## 🏃 Movement & Exercise`
   Produce a SIMPLE 7-day table (Mon-Sun) with Day | Type | Duration |
   Notes columns. At least 1 REST day. Match {first_name}'s baseline
   movement_days_per_week and movement_type. For women in menstruating /
   perimenopausal phases: add 2-line cycle-aware modification (no HIIT
   during menstrual phase or PMS week — restorative only). For
   postmenopausal women: prioritise strength 3×/week. Keep it scannable
   (8-10 lines). {"A separate detailed exercise_plan letter HAS been generated for this client — add this one-liner at the end of the section: 'See your detailed exercise plan for the full weekly progression and exercise specifics.'" if has_exercise_plan else "No separate exercise_plan letter exists for this client — DO NOT reference one. This simple schedule IS the entire movement plan."}
   This is the SIMPLE version — the optional exercise_plan letter has the
   detailed phased programme for clients who want depth.

   **3e. Daily Lifestyle Practices** — bullet list. Sleep, stress, breathwork.

   **3f. What to notice in Weeks 1–2** — 4–6 positive tracking prompts. Frame as curiosity.

4. **Coming Up: Weeks 3–4 Preview** — heading `## 🌿 Coming Up: Weeks 3 & 4`
   Write a SHORT PARAGRAPH ONLY — 3 to 5 warm sentences describing what the theme of weeks 3–4 will be and what {first_name} can look forward to.
   {"Mention that calorie targets will adjust to ~" + str(cal['phases']['wk3_4']) + " kcal/day as the body adapts." if cal else ""}
   DO NOT write a meal plan table, meal schedule, or day-by-day plan for week 3 or week 4.
   DO NOT add a print button or any print-ready formatting for this section.
   This is a teaser paragraph only — the full weeks 3–4 detail will be sent separately.

5. **Roadmap: Weeks 5–12 at a Glance** — heading `## 🗺 Your 12-Week Roadmap`
   {"Calorie targets for this roadmap section (mention briefly per phase):" if cal else ""}
   {"• Weeks 5–8: " + str(cal['phases']['wk5_8']) + " kcal/day (full deficit)" if cal else ""}
   {"• Weeks 9–10: " + str(cal['phases']['wk9_10']) + " kcal/day (ease back)" if cal else ""}
   {"• Weeks 11–12: " + str(cal['phases']['wk11_12']) + " kcal/day (sustain)" if cal else ""}
   One short paragraph per phase. 2–3 sentences each. No meal plans — roadmap only.

6. **Home Remedies & Teas** — use heading `## 🌿 Home Remedies & Daily Teas`
   Any from the plan, simply described.

7. **Recipe Appendix** — use heading `## ✦ Recipe Appendix`
   Detailed recipes for every ✦ dish. Format each as:
   ### ✦ Recipe name
   **Serves:** 1–2 | **Time:** X min
   **Ingredients:** (bullets) | **Method:** (numbered steps) | **Tip:** (optional)

8. **Product guide** — use heading `## 🛒 Recommended Products`
   Only the specific brands from the approved list below that are relevant to THIS plan.

9. **A note from your coach** — warm closing. Remind {first_name} this is a {plan_weeks}-week journey, not a sprint. Shivani's name.

---

LOCATION & SEASONAL NOTES:
- Client is in {location_str}. Current season: {season}.
- ALL meal suggestions must use produce that is IN SEASON and LOCALLY AVAILABLE in {location_str} right now.
- Do not suggest out-of-season produce (e.g. strawberries in December in India, or mangoes in winter in the UK).
- Where possible, name specific local varieties (e.g. "Alphonso mango" for Mumbai, "Cox apple" for UK autumn).
- Account for local cooking culture, available spices, and typical grocery access in {location_str}.

SPECIAL DIET NOTES:
- If dietary_preference is "Vegetarian Jain": strictly NO root vegetables (onion, garlic, potato, carrot, beetroot, radish, turnip). No underground vegetables at all. Also no eating after sunset traditionally. Reflect this in every meal suggestion.

WRITING RULES (very important):
- NEVER use clinical terms: no "HPA axis", "T3/T4", "cortisol dysregulation", "gut permeability", "microbiome diversity"
- Instead use: "stress response system", "thyroid hormones", "stress hormones", "gut lining health", "good gut bacteria"
- Write like a knowledgeable friend, not a doctor
- Sentences short. Paragraphs short (3–4 lines max)
- Use ✅ / ☀️ / 🌙 / 💊 / 🥗 emojis sparingly to make sections scannable
- The client should feel EXCITED and CAPABLE after reading this, not overwhelmed
- If a non-negotiable conflicts with a recommendation, ACKNOWLEDGE it and give a workaround. Example: "We know you love your morning chai — try having it after breakfast instead of on an empty stomach, and swap to jaggery instead of sugar if you can."
- CRITICAL: If reported_triggers exist ({reported_triggers}), NEVER include those foods in any meal, snack, recipe, or suggestion anywhere in this document.
- DO NOT write a supplement protocol table or list — that section is auto-generated from the plan data and injected separately. Just add the one-line placeholder note at 3c.
- Never omit or re-order any supplement — if you mention supplements in passing, use the exact names from SUPPLEMENT PROTOCOL above.

SECTION MARKERS (REQUIRED — do not skip):
Wrap each of the three major reusable sections with HTML comment markers
exactly as shown below. The markers don't render in HTML or PDF, but they
let the system extract sections later when the coach asks for a
standalone meal-plan / supplement-plan / lifestyle-guide document.

Use these three sections and these exact marker lines:

  <!-- SECTION_BEGIN: meal_plan -->
  ...everything that belongs to the nutrition / meal plan side
     (the 7-day tables for weeks 1–2, the recipes appendix, plus
     the per-week roadmap text for weeks 3–{plan_weeks})...
  <!-- SECTION_END: meal_plan -->

  <!-- SECTION_BEGIN: supplement_plan -->
  ...the short supplement-section intro paragraph + the
     placeholder line for the auto-injected schedule...
  <!-- SECTION_END: supplement_plan -->

  <!-- SECTION_BEGIN: lifestyle_guide -->
  ...lifestyle practices + education modules + lab-tracking +
     habits to track + recheck questions...
  <!-- SECTION_END: lifestyle_guide -->

The greeting, healing-journey overview, root-cause hypothesis, and the
coach's closing note do NOT need section markers — they belong to the
consolidated letter only. Place markers tight around the content so
extraction is clean (no extraneous trailing whitespace).

{coach_notes_block}
{INDIAN_BRANDS}
"""
    # ── Existing partials injection ──────────────────────────────────────
    # If the coach has already generated meal_plan / supplement_plan /
    # lifestyle_guide as standalone documents, inject them as "use verbatim"
    # blocks so the AI doesn't regenerate already-finalised content.
    partials_block = ""
    if existing_partials:
        partials_lines = []
        for section_key, label in [
            ("meal_plan", "MEAL PLAN"),
            ("supplement_plan", "SUPPLEMENT PLAN"),
            ("lifestyle_guide", "LIFESTYLE GUIDE"),
        ]:
            content = (existing_partials.get(section_key) or "").strip()
            if not content:
                continue
            partials_lines.append(
                f"\n=== EXISTING {label} (use verbatim — DO NOT regenerate) ===\n"
                f"The coach has already approved this {label.lower()} as a standalone document.\n"
                f"For the {section_key} section of the consolidated letter, use the content below\n"
                f"EXACTLY AS WRITTEN. Wrap it in the SECTION_BEGIN/SECTION_END markers like normal.\n"
                f"Do not edit, summarise, paraphrase, reorder, or shorten it. Reproduce verbatim.\n\n"
                f"{content}\n"
                f"=== END EXISTING {label} ===\n"
            )
        if partials_lines:
            partials_block = (
                "\n\nEXISTING PARTIAL DOCUMENTS — IMPORTANT:\n"
                "Some sections have already been generated separately and approved by the\n"
                "coach. For those sections, use the content below VERBATIM rather than\n"
                "regenerating from the plan data. Only generate NEW content for sections\n"
                "where no existing version is provided.\n"
                + "\n".join(partials_lines)
            )
            prompt = prompt.rstrip() + partials_block + "\n"
    return prompt


def _validate_letter_specificity(
    markdown: str,
    client: dict,
    plan: dict,
    *,
    api_key: str | None = None,
    skip: bool = False,
) -> tuple[str, list[dict]]:
    """Post-validation pass: a Haiku call that scores each coaching tip in the
    generated letter for client-specificity (1–5) and rewrites tips < 3 to
    reference the client's TOP-OF-MIND facts.

    Cost: ~$0.02 per letter (Haiku, ~6K input + ~5K output).

    Returns:
        (rewritten_markdown, change_report)
        change_report is a list of {original_tip, score, reason, rewrite}.
        Empty list means no changes were applied.

    On any failure (no API key, network, parse error, schema error) the
    original markdown is returned unchanged with an empty report — never
    blocks the main flow.
    """
    if skip or not markdown.strip():
        return markdown, []

    try:
        from anthropic import Anthropic
    except ImportError:
        return markdown, []

    api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return markdown, []

    # Build the TOP-OF-MIND context the validator will check tips against.
    top_of_mind = _top_of_mind_block(client, plan).strip()
    if not top_of_mind:
        # No client specifics to anchor against — validator can't help here.
        return markdown, []

    cycle = _cycle_block(client).strip()
    attached_protocol_ctx = _attached_protocol_block(plan).strip()

    SYSTEM = """You are a client-specificity QA assistant for a Functional Medicine coach.
Your only job: catch GENERIC coaching tips in a client letter and rewrite them
so they reference at least one specific item the client told us about themselves.

A "tip" is any actionable line of coaching advice — a sentence or short bullet
telling the client to DO something. Recipe lists, meal-plan tables, plan
overviews, supplement schedules, calorie targets, and warm narrative are NOT
tips and should be left alone.

SCORING (1–5):
  5 = explicitly references this client's chief complaint, lab, trigger,
      non-negotiable, life event, food they eat, named driver, OR the
      attached FM protocol's specific phase / step / food rule
  4 = clearly tailored to a category they mentioned (e.g. "your perimenopausal
      hormone shifts") or to the attached protocol's general approach
  3 = somewhat tailored — references their goal or a general feature
  2 = generic but contextually placed
  1 = pure FM boilerplate ("eat whole foods", "manage stress", "stay hydrated",
      "exercise regularly", "get 7-9 hours of sleep")

REWRITE RULES (only for tips scored < 3):
  - Replace the generic tip with a specific version that references the
    TOP-OF-MIND context AND/OR the ATTACHED PROTOCOL CONTEXT provided.
  - If an attached protocol exists, prefer rewrites that reference the
    protocol's named phase, key step, food rule, or supplement.
  - Keep the same intent. Don't introduce new clinical claims, doses, or
    foods that weren't in the original or the attached protocol.
  - Keep the same line / bullet structure. Don't add new sections.
  - Match the original tone (warm, plain English, India-context).
  - If a tip really can't be made specific from the available context,
    DELETE it rather than ship a generic version.

CRITICAL: Don't touch:
  - Section headings
  - Meal plan tables
  - Supplement tables / schedules
  - Recipe instructions
  - Plan overviews / week roadmaps
  - Calorie targets / numerical guidance
  - Warm narrative paragraphs introducing sections
  - Coach signature / closing notes
"""

    user_payload = {
        "top_of_mind_context": top_of_mind,
        "cycle_context": cycle,
        "attached_protocol_context": attached_protocol_ctx,
        "letter_markdown": markdown,
    }

    tool = {
        "name": "report_specificity",
        "description": "Return a rewritten version of the letter with generic tips replaced + a report of every change made.",
        "input_schema": {
            "type": "object",
            "required": ["rewritten_markdown", "changes"],
            "properties": {
                "rewritten_markdown": {
                    "type": "string",
                    "description": (
                        "The full letter markdown with all generic coaching tips "
                        "(score < 3) rewritten to reference the client's specifics, "
                        "or deleted if they cannot be made specific. Everything else "
                        "(headings, tables, recipes, schedules, narrative, signature) "
                        "must be preserved EXACTLY."
                    ),
                },
                "changes": {
                    "type": "array",
                    "description": "One entry per tip that was rewritten or deleted.",
                    "items": {
                        "type": "object",
                        "required": ["original_tip", "score", "reason"],
                        "properties": {
                            "original_tip": {"type": "string"},
                            "score": {"type": "integer", "description": "1–5"},
                            "reason": {"type": "string", "description": "Why this scored low — what was generic about it."},
                            "rewrite": {"type": "string", "description": "The replacement text. Empty string if the tip was deleted entirely."},
                        },
                    },
                },
            },
        },
    }

    try:
        client_anthropic = Anthropic(api_key=api_key)
        validator_model = os.environ.get("FMDB_VALIDATOR_MODEL", "claude-haiku-4-5")
        with client_anthropic.messages.stream(
            model=validator_model,
            max_tokens=12000,
            system=SYSTEM,
            tools=[tool],
            tool_choice={"type": "tool", "name": "report_specificity"},
            messages=[{"role": "user", "content": json.dumps(user_payload)}],
        ) as stream:
            resp = stream.get_final_message()
        try:
            from fmdb.usage import log_usage as _log_usage
            _log_usage(
                client_id=(client or {}).get("client_id"),
                script="render-client-letter.py:validator",
                model=validator_model,
                usage=resp.usage,
                notes="haiku letter QA pass",
            )
        except Exception:
            pass
    except Exception as e:
        print(f"[validate] {type(e).__name__}: {e}", file=sys.stderr)
        return markdown, []

    tool_use = next((b for b in resp.content if getattr(b, "type", None) == "tool_use"), None)
    if not tool_use:
        return markdown, []

    payload = tool_use.input or {}
    rewritten = payload.get("rewritten_markdown") or ""
    changes = payload.get("changes") or []

    # Sanity: don't accept a rewrite that's drastically shorter (looks like
    # the model summarised instead of rewriting in place).
    if not rewritten.strip() or len(rewritten) < 0.5 * len(markdown):
        print(
            f"[validate] suspicious rewrite ({len(rewritten)} vs {len(markdown)} chars) — skipping",
            file=sys.stderr,
        )
        return markdown, []

    return rewritten, changes


def main() -> int:
    _load_dotenv()

    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "markdown": "", "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    # Stderr progress markers — surface what step is running so coach
    # (and Node parent) can tell whether the script is alive, what's
    # taking long, and where it died if it crashes. `flush=True` is
    # critical: without it Python buffers stderr and the parent reads
    # nothing until the script ends.
    def _step(msg: str) -> None:
        print(f"[render-letter] {msg}", file=sys.stderr, flush=True)

    _step("start")
    plan_slug = payload.get("plan_slug", "")
    client_id = payload.get("client_id", "")
    # Coach can send None / undefined / {} when weight loss isn't a goal.
    # Defensively coerce to an empty dict so downstream `.get()` calls
    # never blow up — `_calc_calorie_targets` already returns None for
    # a dict without `enabled: true`, so the AI prompt skips the
    # calorie/exercise block correctly.
    weight_loss_raw = payload.get("weight_loss")
    weight_loss = weight_loss_raw if isinstance(weight_loss_raw, dict) else {}
    letter_type = payload.get("letter_type") or "consolidated"
    coach_notes = (payload.get("coach_notes") or "").strip()
    existing_partials = payload.get("existing_partials") or {}
    has_exercise_plan = bool(payload.get("has_exercise_plan"))
    # Phase letters (mid-cycle meal plan continuation) — coach picks
    # the week range. Ignored for non-phase letter types.
    phase_start_raw = payload.get("phase_start")
    phase_end_raw = payload.get("phase_end")
    phase_start = int(phase_start_raw) if isinstance(phase_start_raw, (int, str)) and str(phase_start_raw).strip() else None
    phase_end = int(phase_end_raw) if isinstance(phase_end_raw, (int, str)) and str(phase_end_raw).strip() else None

    if not plan_slug:
        json.dump({"ok": False, "markdown": "", "error": "plan_slug is required"}, sys.stdout)
        return 2

    _step(f"loading plan {plan_slug}")
    plan = _load_plan(plan_slug)
    if plan is None:
        json.dump({"ok": False, "markdown": "", "error": f"Plan not found: {plan_slug}"}, sys.stdout)
        return 2

    if not client_id:
        client_id = plan.get("client_id", "")
    _step(f"loading client {client_id}")
    client = _load_client(client_id) if client_id else {}
    if client is None:
        client = {}

    # Merge persistent catalogue coach notes with generation-time notes
    catalogue_notes = _load_catalogue_notes(plan)
    if catalogue_notes and coach_notes:
        coach_notes = f"{coach_notes}\n\n{catalogue_notes}"
    elif catalogue_notes:
        coach_notes = catalogue_notes

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        json.dump({"ok": False, "markdown": "", "error": "ANTHROPIC_API_KEY not set"}, sys.stdout)
        return 2

    _step("importing anthropic")
    try:
        from anthropic import Anthropic
    except ImportError as e:
        json.dump({"ok": False, "markdown": "", "error": f"anthropic not installed: {e}"}, sys.stdout)
        return 1

    _step(f"building {letter_type} prompt")
    try:
        prompt = _build_prompt(
            plan,
            client,
            weight_loss=weight_loss,
            letter_type=letter_type,
            coach_notes=coach_notes,
            existing_partials=existing_partials if isinstance(existing_partials, dict) else {},
            has_exercise_plan=has_exercise_plan,
            phase_start=phase_start,
            phase_end=phase_end,
        )
    except Exception as e:
        import traceback
        tb = traceback.format_exc().splitlines()
        last_lines = "\n".join(tb[-6:])  # innermost frames are usually informative
        json.dump({
            "ok": False, "markdown": "",
            "error": (
                f"Failed to build {letter_type} prompt (weight_loss="
                f"{'set' if weight_loss else 'none'}): {type(e).__name__}: {e}\n{last_lines}"
            ),
        }, sys.stdout)
        return 1
    _step(f"prompt built ({len(prompt)} chars)")

    client_api = Anthropic(api_key=api_key)

    _step("calling Sonnet (streaming, max 16K output tokens — typical 60–180s)")
    try:
        token_count = 0
        with client_api.messages.stream(
            model="claude-sonnet-4-6",
            max_tokens=16000,
            system=(
                "You are a skilled health coach writer. You produce warm, practical, "
                "beautifully formatted Markdown wellness plans for clients in India. "
                "You write like a knowledgeable, encouraging friend — never clinical. "
                "Output ONLY the Markdown document, nothing else."
            ),
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            # Stream text chunks so we get heartbeat output; otherwise the
            # script is silent for 1–3 min while the API generates.
            for _ in stream.text_stream:
                token_count += 1
                if token_count % 200 == 0:
                    _step(f"streaming… ~{token_count} chunks received")
            final_message = stream.get_final_message()
            markdown = final_message.content[0].text
            _step(f"API call done ({len(markdown)} chars markdown)")
        # Log API spend to ~/fm-plans/clients/<id>/_api_usage.jsonl for MIS
        try:
            from fmdb.usage import log_usage as _log_usage
            _log_usage(
                client_id=client_id,
                script="render-client-letter.py",
                model="claude-sonnet-4-6",
                usage=final_message.usage,
                notes=f"letter_type={letter_type} chars={len(markdown)}",
            )
        except Exception:
            pass  # never let usage logging break the user flow
    except Exception as e:
        json.dump({"ok": False, "markdown": "", "error": f"API call failed: {e}"}, sys.stdout)
        return 1

    # Post-validation pass: Haiku scores each coaching tip 1–5 for client-
    # specificity and rewrites tips < 3 to reference the client's TOP-OF-MIND
    # facts. Returns original markdown unchanged on any failure.
    skip_validation = bool(payload.get("skip_validation"))
    _step("validating letter specificity (Haiku)")
    markdown, validation_report = _validate_letter_specificity(
        markdown, client, plan, skip=skip_validation
    )
    _step(f"validation done ({len(validation_report) if validation_report else 0} tips rewritten)")

    # Generate branded HTML
    try:
        from brand_html import wrap_in_brand_html
        display_name = client.get("display_name") or ""
        type_meta = {
            "meal_plan":       ("Your Personalised Meal Plan",    "Meal Plan"),
            "meal_plan_phase": (
                # Phase letter title surfaces the week range so coach +
                # client know which letter they're looking at when there
                # are multiple meal-plan letters on file.
                f"Meal Plan — {('Week ' + str(phase_start)) if phase_start == phase_end else ('Weeks ' + str(phase_start) + '–' + str(phase_end))}"
                if phase_start and phase_end else "Meal Plan — Continuation",
                "Meal Plan Continuation",
            ),
            "supplement_plan": ("Your Supplement Protocol",        "Supplement Plan"),
            "lifestyle_guide":  ("Your Lifestyle Guide",             "Lifestyle Guide"),
            "exercise_plan":   ("Your Personalised Exercise Plan", "Exercise Plan"),
            "consolidated":    ("Your Personalised Wellness Plan", "Personalised Wellness Plan"),
        }
        doc_title, doc_type = type_meta.get(letter_type, type_meta["consolidated"])
        html = wrap_in_brand_html(
            markdown,
            title=doc_title,
            subtitle=display_name,
            doc_type=doc_type,
            client_name=display_name,
        )
        # Inject Python-generated supplement sections (guaranteed complete +
        # buy-link-correct regardless of what the AI wrote). Two pieces:
        #   1. Shopping list — upfront "buy everything now" table with
        #      start-week annotations. Goes FIRST so the client can place
        #      one order before reading the rest of the letter.
        #   2. Detailed dose schedule — timing slots + daily routine.
        # Only inject for types that include supplements (not meal_plan/lifestyle_guide).
        supplements = plan.get("supplement_protocol") or []
        inject_schedule = letter_type in ("consolidated", "supplement_plan")
        if supplements and html and inject_schedule:
            plan_weeks_int = int(plan.get("plan_period_weeks") or 12)
            shopping_list_html = _build_complete_shopping_list_html(supplements, plan_weeks_int)
            schedule_html = _build_supplement_schedule_html(supplements)
            combined = shopping_list_html + "\n" + schedule_html
            # Insert INSIDE the .page container, right before the brand footer.
            # This keeps the sections within the brand-styled max-width box and
            # ensures @media print rules apply correctly.
            footer_marker = '<footer class="brand-footer">'
            if footer_marker in html:
                html = html.replace(footer_marker, combined + "\n    " + footer_marker, 1)
            elif "</body>" in html:
                # fallback — shouldn't happen with current template
                html = html.replace("</body>", combined + "\n</body>", 1)
    except Exception as e:
        html = None  # HTML is a nice-to-have; don't fail if brand module errors

    json.dump(
        {
            "ok": True,
            "markdown": markdown,
            "html": html,
            "validation_report": validation_report,
            "error": None,
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

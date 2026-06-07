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
from datetime import datetime, timezone
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

# ---------------------------------------------------------------------------
# Indian food seasonality reference — lives next to this file. Coach edits
# the YAML freely. The renderer injects the in-season grain list + out-of-
# season "AVOID" list into the meal-plan prompt so the AI doesn't default
# to oats-quinoa-heavy plans (its Western FM training bias) and instead
# picks bajra/jowar/ragi/millets appropriate to the client's month + region.
# ---------------------------------------------------------------------------
_SEASONAL_FOODS_PATH = Path(__file__).resolve().parent / "seasonal_foods.yaml"

def _load_seasonal_foods() -> dict:
    if not _SEASONAL_FOODS_PATH.exists():
        return {}
    try:
        import yaml
        return yaml.safe_load(_SEASONAL_FOODS_PATH.read_text()) or {}
    except Exception:
        return {}


def _seasonality_block(month: int, country: str) -> str:
    """Build a prompt block listing IN-SEASON grains + OUT-OF-SEASON-AVOID
    grains for the current month. Tolerant of missing fields in the YAML.

    Only fires for India for now — non-Indian clients get an empty string
    and the AI uses generic FM seasonality logic.
    """
    if (country or "").strip().lower() not in ("india", ""):
        return ""
    data = _load_seasonal_foods() or {}
    grains = (data.get("grains") or {})
    if not isinstance(grains, dict) or not grains:
        return ""

    in_season: list[str] = []
    out_of_season: list[str] = []
    for name, info in grains.items():
        if not isinstance(info, dict):
            continue
        months_in = info.get("months_in")
        if not isinstance(months_in, list) or len(months_in) == 0:
            # No restriction — counts as in-season (e.g. rice all year)
            continue
        is_in = month in months_in
        aka = info.get("aka")
        label = f"{name}" + (f" ({aka})" if aka else "")
        props = info.get("properties") or []
        props_str = ", ".join(props[:3]) if isinstance(props, list) else ""
        good_for = info.get("good_for") or []
        good_str = ", ".join(good_for[:3]) if isinstance(good_for, list) else ""
        note = (info.get("coach_note") or "").strip()

        if is_in:
            # Surface properties + good_for + note for in-season picks
            bits = [label]
            if props_str:
                bits.append(f"[{props_str}]")
            if good_str:
                bits.append(f"good for: {good_str}")
            if note:
                bits.append(f"coach: {note}")
            in_season.append("  - " + " · ".join(bits))
        else:
            avoid_when = info.get("avoid_when") or []
            avoid_str = ", ".join(avoid_when[:2]) if isinstance(avoid_when, list) else ""
            bits = [label]
            if avoid_str:
                bits.append(f"avoid: {avoid_str}")
            out_of_season.append("  - " + " · ".join(bits))

    if not in_season and not out_of_season:
        return ""

    pieces = ["INDIAN GRAIN SEASONALITY — bias the meal plan toward these (region-specific knowledge the AI shouldn't override):"]
    if in_season:
        pieces.append("")
        pieces.append(f"✓ IN-SEASON this month (use freely):")
        pieces.extend(in_season)
    if out_of_season:
        pieces.append("")
        pieces.append("✗ OUT-OF-SEASON this month (prefer alternatives unless client explicitly asks):")
        pieces.extend(out_of_season)
    pieces.append("")
    pieces.append("Apply this BEFORE defaulting to oats / quinoa / wheat. If the client is on a heating-focused protocol (postpartum, perimenopause, vata) in winter, push bajra / ragi / buckwheat. If on a cooling protocol (PCOS, IR, summer pitta) in summer, push jowar / foxtail / kodo millet. Rotate 3-4 grains across the week — don't pick one and repeat.")
    return "\n".join(pieces)


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


def _load_custom_links_by_slug() -> dict[str, tuple[str, str]]:
    """Coach-managed affiliate links keyed by an explicit catalogue
    `slug:` field on the supplement_links.yaml entry.

    Lets a custom link bind to a catalogue supplement by SLUG — exact,
    and immune to display-name divergence. The name-keyword path
    (_load_custom_links) is fragile when the link entry's title and the
    catalogue display_name don't share a contiguous substring — e.g.
    catalogue 'Whey Protein Isolate' vs a link entry titled 'Whey
    Isolate Unflavored Protein'. Adding `slug: protein-whey-isolate` to
    the YAML entry makes the match deterministic.
    """
    if not _CUSTOM_LINKS_PATH.exists():
        return {}
    try:
        import yaml
        data = yaml.safe_load(_CUSTOM_LINKS_PATH.read_text()) or {}
        out: dict[str, tuple[str, str]] = {}
        for key, val in data.items():
            if not isinstance(val, dict) or not val.get("url"):
                continue
            sl = str(val.get("slug") or "").strip().lower()
            if not sl:
                continue
            name = val.get("display_name") or key.replace("_", " ").title()
            out[sl] = (name, val["url"])
        return out
    except Exception:
        return {}

# Brand recommendations removed 2026-05-19. Coach feedback: hardcoded
# brand lists (RiteBite, Yoga Bar, Organic India, Himalaya, etc.) leaked
# into every meal-plan / lifestyle / consolidated letter unprompted. That's
# wrong — brands are CLIENT-SPECIFIC and should come from:
#   1. The VitaOne affiliate catalog (auto-injected for supplements only,
#      via the existing _vitaone_link / shopping-list helpers).
#   2. Custom supplement_links coach has set in ~/fm-plans/supplement_links.yaml.
#   3. Coach hand-typing brand guidance into coach_notes for THIS letter.
# For non-supplement items (protein bars, herbal teas, etc.) the letter
# now describes WHAT to look for (e.g. "no refined sugar, 10g+ protein,
# minimal ingredients") and leaves the brand choice to the client.
INDIAN_BRANDS = (
    "**Brand guidance:** when the letter mentions a category like "
    "protein bars, herbal sleep formulas, or probiotic curd, describe "
    "what to look for (e.g. 'no refined sugar, 10g+ protein, minimal "
    "ingredients') and let the client pick a brand they trust from their "
    "local store. Do NOT name specific brands (RiteBite, Yoga Bar, "
    "Organic India, Himalaya, Charak, Saffola, Epigamia, Yakult, etc.) — "
    "the coach-curated supplement schedule below is the only place brand "
    "recommendations belong in the letter, and those are injected "
    "automatically. If a coach note explicitly tells you to recommend a "
    "specific brand for a non-supplement item, follow it; otherwise stay "
    "generic."
)


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


def _supplement_key(s: dict) -> str:
    """Canonical supplement identity for diffing — slug if present, else name."""
    return str(
        (s.get("slug") or s.get("supplement_slug") or s.get("name") or "")
    ).strip().lower()


def _supplement_display(s: dict) -> str:
    return str(
        s.get("name")
        or s.get("display_name")
        or s.get("supplement_slug")
        or s.get("slug")
        or "supplement"
    ).strip()


def _supplement_dose_signature(s: dict) -> str:
    """Compact dose-string for diff comparison — catches re-dosed supplements."""
    parts = [
        str(s.get("dose") or "").strip(),
        str(s.get("dose_amount") or "").strip(),
        str(s.get("dose_unit") or "").strip(),
        str(s.get("frequency") or "").strip(),
        str(s.get("timing") or "").strip(),
    ]
    return " · ".join(p for p in parts if p) or "(no dose)"


def _find_predecessor_by_slug_pattern(plan: dict) -> dict | None:
    """Fix F11 2026-05-23 — historical plans pre-dating the auto-supersedes
    wiring (in generate-draft.py) have plan.supersedes = None even when
    they're clearly plan-N with a plan-(N-1) on disk. Fall back to
    slug-pattern lookup: parse `<stem>-plan-N-<date>-<client>` →
    find the highest-numbered `<stem>-plan-<n<N>>` across all buckets.

    Returns the predecessor plan dict, or None if nothing matches.
    """
    import re
    slug = str(plan.get("slug") or "")
    # Match "<stem>-plan-<N>-<rest>"; N is required to be an integer.
    m = re.match(r"^(.+?)-plan-(\d+)-(.+)$", slug)
    if not m:
        return None
    stem, n_str, _ = m.group(1), m.group(2), m.group(3)
    try:
        n = int(n_str)
    except ValueError:
        return None
    if n <= 1:
        return None
    # Try N-1, N-2, ... down to 1 — first hit wins.
    for predecessor_n in range(n - 1, 0, -1):
        prefix = f"{stem}-plan-{predecessor_n}-"
        for bucket in ["superseded", "revoked", "published", "drafts", "ready"]:
            bucket_dir = PLANS_ROOT / bucket
            if not bucket_dir.exists():
                continue
            for candidate in bucket_dir.glob(f"{prefix}*.yaml"):
                try:
                    import yaml
                    return yaml.safe_load(candidate.read_text())
                except Exception:
                    pass
    return None


def _plan_changes_block(plan: dict) -> str:
    """Fix C 2026-05-23 — for phase / continuation letters, compare the
    CURRENT plan against its supersedes-predecessor and surface what
    changed. Client reads this as "WHAT'S NEW VS YOUR LAST PROTOCOL"
    so a fortnight letter explicitly acknowledges any inline edits
    or follow-up plan tweaks since the previous letter.

    Returns "" when no predecessor is locatable OR no meaningful
    changes detected — letter prompts skip the block cleanly.

    Predecessor resolution (Fix F11 2026-05-23):
      1. `plan.supersedes` if explicitly set
      2. Slug-pattern fallback: `<stem>-plan-N-…` → look up `…-plan-(N-1)-…`
    """
    supersedes = (plan.get("supersedes") or "").strip()
    prior: dict | None = None
    if supersedes:
        prior = _load_plan(supersedes)
    if not isinstance(prior, dict):
        # Fix F11 — fall back to slug-pattern lookup so historical plans
        # without explicit supersedes still get a diff block.
        prior = _find_predecessor_by_slug_pattern(plan)
    if not isinstance(prior, dict):
        return ""

    cur_supps = plan.get("supplement_protocol") or []
    prior_supps = prior.get("supplement_protocol") or []
    cur_by_key = {
        _supplement_key(s): s for s in cur_supps if isinstance(s, dict) and _supplement_key(s)
    }
    prior_by_key = {
        _supplement_key(s): s for s in prior_supps if isinstance(s, dict) and _supplement_key(s)
    }

    added = [cur_by_key[k] for k in cur_by_key if k not in prior_by_key]
    removed = [prior_by_key[k] for k in prior_by_key if k not in cur_by_key]
    redosed: list[tuple[dict, str, str]] = []
    for k in cur_by_key:
        if k in prior_by_key:
            old_sig = _supplement_dose_signature(prior_by_key[k])
            new_sig = _supplement_dose_signature(cur_by_key[k])
            if old_sig != new_sig:
                redosed.append((cur_by_key[k], old_sig, new_sig))

    # Lab orders — only added (removing a pending order is rarely
    # interesting for the client; coach handles it offline)
    def _lab_keys(items: list) -> set[str]:
        return {
            str(it.get("test_name") or it.get("name") or "").strip().lower()
            for it in (items or [])
            if isinstance(it, dict)
        }
    lab_added = _lab_keys(plan.get("lab_orders") or []) - _lab_keys(
        prior.get("lab_orders") or []
    )

    # Lifestyle practices — same logic as supplements
    def _lifestyle_keys(items: list) -> set[str]:
        return {
            str(it.get("name") or it.get("practice") or "").strip().lower()
            for it in (items or [])
            if isinstance(it, dict)
        }
    lifestyle_added = _lifestyle_keys(plan.get("lifestyle_practices") or []) - _lifestyle_keys(
        prior.get("lifestyle_practices") or []
    )

    if not (added or removed or redosed or lab_added or lifestyle_added):
        return ""

    lines: list[str] = []
    if added:
        lines.append(
            "  ➕ NEW supplements: "
            + "; ".join(f"{_supplement_display(s)} ({_supplement_dose_signature(s)})" for s in added[:6])
        )
    if removed:
        lines.append(
            "  ➖ DISCONTINUED supplements: "
            + "; ".join(_supplement_display(s) for s in removed[:6])
        )
    if redosed:
        for s, old_sig, new_sig in redosed[:6]:
            lines.append(
                f"  🔄 RE-DOSED {_supplement_display(s)}: was [{old_sig}] → now [{new_sig}]"
            )
    if lifestyle_added:
        lines.append("  ➕ NEW practices: " + "; ".join(sorted(lifestyle_added)[:5]))
    if lab_added:
        lines.append("  🧪 NEW labs ordered: " + "; ".join(sorted(lab_added)[:5]))

    return (
        "═══════════════════════════════════════════════════════════\n"
        "WHAT CHANGED SINCE THE LAST PROTOCOL (frame for the client):\n"
        "Open the letter with ONE short paragraph acknowledging these\n"
        "changes naturally — 'Since your last fortnight, I've added X\n"
        "and adjusted Y because…'. Don't just dump the diff; reason\n"
        "from the root cause (top-of-mind block) into WHY each change\n"
        "was made. If a supplement was removed, explain the rationale\n"
        "(target met, side effect, simplification). Keep this whole\n"
        "preamble to ~80 words.\n"
        "═══════════════════════════════════════════════════════════\n"
        + "\n".join(lines)
        + "\n═══════════════════════════════════════════════════════════"
    )


# Antihistamine + mast-cell-stabiliser drug list (lowercased substring match).
# Add new entries here as we encounter them; keep generic + brand names both.
_HISTAMINE_MEDS = (
    "allegra", "fexofenadine", "levocetirizine", "cetirizine", "loratadine",
    "desloratadine", "montelukast", "ketotifen", "rupatadine", "ebastine",
    "bilastine", "chlorpheniramine", "hydroxyzine", "diphenhydramine",
    "ranitidine", "famotidine", "cimetidine",  # H2 blockers also count
    "sodium cromoglycate", "cromolyn",
)

# Condition / history keywords that imply baseline histamine load.
_HISTAMINE_CONDITION_KEYS = (
    "eczema", "dermatit", "urticaria", "hives", "histamine",
    "mast cell", "mcas", "mastocytosis", "atopic", "allergic rhinitis",
    "chronic rhinitis", "hay fever", "dao deficiency",
)

# Symptom slugs (from the catalogue) that map to histamine load.
_HISTAMINE_SYMPTOM_SLUGS = (
    "eczema-psoriasis-skin", "histamine-intolerance",
    "skin-itching-flushing-hives", "skin-rash",
    "runny-nose-sneezing", "nasal-congestion",
)


def _detect_triad_topics(plan: dict, client: dict) -> set:
    """v0.75.8 — detect MCAS / POTS / EDS / PEM / mould topics in the plan
    or implied by the client's intake signals. Returns a set of triggers
    {'mcas', 'pots', 'eds', 'pem', 'mould'} that the letter generator
    weaves constraint blocks for.

    Looks at:
      - plan.topics (active plan's selected topics)
      - plan.attached_protocols (which protocols the coach has attached)
      - client.intake_insights.top_hypotheses (AI-inferred triad)
      - client.beighton_self_score / lean_test_symptoms / pem_screen /
        mould_exposure / histamine_signals (direct intake signals)
      - client.physical_exam_findings (coach-verified)
    """
    triggers: set = set()

    # Topic-slug match
    topic_match = {
        "mast-cell-activation-syndrome": "mcas",
        "histamine-intolerance-mcas": "mcas",
        "histamine-intolerance": "mcas",
        "postural-orthostatic-tachycardia-syndrome": "pots",
        "ehlers-danlos-hypermobility": "eds",
        "post-exertional-malaise-mecfs": "pem",
        "mold-mycotoxin-exposure": "mould",
    }
    for t in (plan.get("topics") or []):
        key = topic_match.get(t)
        if key:
            triggers.add(key)

    # Attached protocol slug match
    protocol_match = {
        "mcas-gentle-first-30-days": "mcas",
        "pots-first-30-days": "pots",
        "pem-pacing-first-30-days": "pem",
        "mould-cirs-gentle-first-30-days": "mould",
    }
    for p in (plan.get("attached_protocols") or []):
        key = protocol_match.get(p)
        if key:
            triggers.add(key)

    # Direct intake signals (no AI required)
    hist = client.get("histamine_signals") or []
    if isinstance(hist, list) and len(hist) >= 3:
        triggers.add("mcas")
    bey = client.get("beighton_self_score") or []
    if isinstance(bey, list) and len(bey) >= 3:
        triggers.add("eds")
    pem = client.get("pem_screen") or []
    if isinstance(pem, list) and len(pem) >= 2:
        triggers.add("pem")
    mou = client.get("mould_exposure") or []
    if isinstance(mou, list) and len(mou) >= 2:
        triggers.add("mould")
    lean_syms = client.get("lean_test_symptoms") or []
    real_lean = [s for s in lean_syms if isinstance(s, str) and s != "felt completely fine"]
    if len(real_lean) >= 3:
        triggers.add("pots")

    # Coach-verified physical_exam_findings override
    for f in (client.get("physical_exam_findings") or []):
        if not isinstance(f, dict):
            continue
        kind = f.get("kind")
        result = f.get("result") or {}
        if kind == "beighton" and result.get("hypermobile"):
            triggers.add("eds")
        elif kind == "nasa_lean_test" and result.get("pots_pattern"):
            triggers.add("pots")

    return triggers


def _format_triad_constraints_block(triggers: set) -> str:
    """v0.75.8 — render the triad-aware constraint block for the letter
    prompt. Only generated when ≥ 1 triad trigger fires. Threads explicit
    BINDING rules for the AI letter writer: low-histamine meal plan,
    recumbent (not upright) exercise, pacing (not push-through), gentle
    supplement titration, no aggressive detox.
    """
    if not triggers:
        return ""
    blocks: list = []
    if "mcas" in triggers:
        blocks.append(
            "  [MCAS / HISTAMINE] HIGH-PRIORITY BINDING RULES:\n"
            "    • Low-histamine meal plan throughout — STRICTLY avoid: aged cheese, fermented foods (kimchi, sauerkraut, kombucha, miso), leftover meat > 24h, wine, vinegar, tomato, spinach, eggplant, avocado, citrus, chocolate, peanuts, cured meats.\n"
            "    • Fresh-only proteins: fresh fish, fresh-cooked chicken/eggs, eaten same day. No leftovers reheated.\n"
            "    • Supplement timing: ANY quercetin, curcumin, or reishi must be flagged 'start at 1/4 dose for 3 days, watch for paradoxical reaction.' Never start at full dose.\n"
            "    • Prefer: DAO enzyme before high-risk meals, vitamin C, P5P (active B6), magnesium glycinate, nettle leaf tea.\n"
            "    • Lifestyle: cool showers (not hot), gentle exercise, NO aggressive detox / sauna at high heat / vigorous lymph drainage."
        )
    if "pots" in triggers:
        blocks.append(
            "  [POTS / ORTHOSTATIC] HIGH-PRIORITY BINDING RULES:\n"
            "    • Salt loading 3-5 g/day on TOP of normal diet (note: only with prescriber sign-off if BP-sensitive).\n"
            "    • Fluid intake 2.5-3 L/day, sipped continuously not gulped, with electrolytes.\n"
            "    • Exercise prescription: RECUMBENT ONLY for first 8-12 weeks — recumbent bike, rowing, swimming, pool walking. NEVER upright cardio / spin / standing yoga / treadmill walking in the early weeks.\n"
            "    • Sleep with head of bed elevated 4-6 inches (blocks under feet, not just pillow).\n"
            "    • Avoid: prolonged standing, hot showers, large heavy meals, alcohol (all worsen orthostatic symptoms).\n"
            "    • Compression garments (waist-high, 20-30 mmHg) before standing for the day."
        )
    if "eds" in triggers:
        blocks.append(
            "  [EDS / HYPERMOBILITY] BINDING RULES:\n"
            "    • Movement framing: STABILITY work, not flexibility. NO yoga poses that hyperextend joints; emphasise closed-chain strength (clinical Pilates, resistance bands, isometrics).\n"
            "    • Prefer: bone broth, collagen peptides 10-20 g/day, vitamin C 500-1000 mg, magnesium glycinate, balanced zinc-copper.\n"
            "    • Pace cognitive + physical exertion — proprioceptive deficit means clients tire faster from basic movement."
        )
    if "pem" in triggers:
        blocks.append(
            "  [PEM / ME-CFS / LONG COVID] CRITICAL BINDING RULES:\n"
            "    • PACING IS THE INTERVENTION. The exercise prescription is REST + recumbent-only movement, NOT graded exercise / push-through / capacity-building. Graded exercise therapy WORSENS PEM and can crash clients for weeks.\n"
            "    • Energy envelope: client operates at 50-70% of perceived capacity with 24h recovery built in.\n"
            "    • Mitochondrial support stack: CoQ10 (ubiquinol) 100-200 mg, D-ribose 5 g 2-3×/day, L-carnitine 1-2 g, magnesium glycinate, B-complex (methylated forms if MTHFR suspected).\n"
            "    • Permitted movement: restorative yoga, gentle pool walking, recumbent bike 5 min daily building by 1 minute every 3-5 days IF no next-day crash.\n"
            "    • Forbidden language: 'push through', 'graded exercise', 'just walk more', 'you'll feel better with movement'."
        )
    if "mould" in triggers:
        blocks.append(
            "  [MOULD / CIRS] BINDING RULES:\n"
            "    • SOURCE REMOVAL is the protocol. Letter must include a section on home assessment (visible mould, leaks, musty smell, ERMI testing). No detox protocol can out-pace ongoing exposure.\n"
            "    • Gentle binders only: activated charcoal 250-500 mg 2h away from food/meds, chlorella 1-3 tablets/day if tolerated.\n"
            "    • Antioxidant foundation: vitamin C, glutathione (liposomal), NAC, cruciferous vegetables.\n"
            "    • FORBIDDEN: aggressive detox, high-heat sauna, high-dose vitamin C IV, vigorous cleanses. These mobilise toxins faster than binders can clear → makes client worse.\n"
            "    • Low-mould diet — no peanuts, no aged cheese, no leftover food > 24h, fresh-only produce."
        )
    return (
        "\n⚠ TRIAD-AWARE PROTOCOL CONSTRAINTS — apply to meals + supplements + lifestyle\n"
        + "These constraints OVERRIDE the standard letter framing. If a default suggestion conflicts with the triad rules below, the triad rule wins.\n\n"
        + "\n\n".join(blocks)
        + "\n"
    )


def _load_drug_cautions_for_client(client: dict) -> list[dict]:
    """v0.74 — alias-match client medications against fm-database/data/drug_depletions
    and return a flat list of `protocol_cautions` entries augmented with
    drug_name + drug_slug + matched_medication. These get serialised into the
    letter prompt as binding constraints so the AI honours them even when the
    coach hasn't yet enriched the catalogue topic links.
    """
    import yaml
    out: list[dict] = []
    meds: list[str] = []
    raw = client.get("current_medications") or []
    if isinstance(raw, list):
        for m in raw:
            if isinstance(m, dict):
                n = (m.get("name") or "").strip()
                if n: meds.append(n)
            elif m:
                meds.append(str(m))
    elif raw:
        meds.append(str(raw))
    # Also flatten layered medication categories captured at intake
    # (thyroid_medication, glp1_medications, acid_suppressants, statins_bp_diabetes,
    # psych_medications, …). These are stored as their own client fields, NOT in
    # current_medications — so a client's Thyronorm / Ozempic / PPI would otherwise
    # never trigger drug cautions in the letter.
    for fld in (
        "thyroid_medication", "glp1_medications", "acid_suppressants",
        "nsaids_daily", "antibiotics_last_12mo", "hormonal_contraception_hrt",
        "psych_medications", "biologics_immunosuppressants", "statins_bp_diabetes",
    ):
        v = client.get(fld) or []
        if isinstance(v, list):
            for m in v:
                if isinstance(m, dict):
                    n = (m.get("name") or "").strip()
                    if n:
                        meds.append(n)
                elif m:
                    meds.append(str(m))
    if not meds:
        return out

    cat_dir = (Path(__file__).resolve().parent.parent.parent /
               "fm-database" / "data" / "drug_depletions")
    if not cat_dir.exists():
        return out

    drugs: list[dict] = []
    for p in cat_dir.glob("*.yaml"):
        if p.name.startswith("_"):
            continue
        try:
            d = yaml.safe_load(p.read_text()) or {}
        except Exception:
            continue
        if isinstance(d, dict):
            drugs.append(d)

    # Longest alias wins so "metformin xr" picks the more specific entry if any.
    def match_drug(med_text: str) -> dict | None:
        text = med_text.lower()
        best: tuple[int, dict] | None = None
        for d in drugs:
            aliases = [d.get("drug_name") or ""] + list(d.get("drug_aliases") or [])
            for a in aliases:
                a = (a or "").strip().lower()
                # Word-boundary match (audit Phase-1b): a plain `a in text`
                # made short aliases like 'arb' match 'carbamazepine' and 'pan'
                # match 'panadol', attaching the WRONG drug's binding HARD-RULE
                # protocol cautions to a client's letter. Longest-alias-wins.
                if a and _kw_matches(a, text):
                    if best is None or len(a) > best[0]:
                        best = (len(a), d)
        return best[1] if best else None

    seen: set[tuple[str, str]] = set()
    for med in meds:
        drug = match_drug(med)
        if not drug:
            continue
        for c in drug.get("protocol_cautions") or []:
            item = (c.get("item") or "").strip()
            if not item:
                continue
            key = (drug.get("slug") or "", item)
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "drug_name": drug.get("drug_name") or drug.get("slug"),
                "drug_slug": drug.get("slug"),
                "matched_medication": med,
                "kind": c.get("kind") or "info",
                "severity": c.get("severity") or "warning",
                "item": item,
                "reason": c.get("reason") or "",
            })
    return out


def _format_drug_cautions_block(cautions: list[dict]) -> str:
    """Render drug-derived cautions as a clearly-fenced prompt section.

    AI instructions in this block override the protocol AND the meal-plan
    defaults — the medication is a hard constraint on the client's life.
    """
    if not cautions:
        return ""
    critical = [c for c in cautions if c.get("severity") == "critical"]
    warning = [c for c in cautions if c.get("severity") == "warning"]
    info = [c for c in cautions if c.get("severity") == "info"]
    lines = ["", "⚠ MEDICATION-DERIVED PROTOCOL CONSTRAINTS — HARD RULES."]
    lines.append(
        "The client is on the following medications. Each medication brings "
        "constraints that you MUST respect in this meal plan / supplement "
        "schedule / lifestyle guide. CRITICAL items can block the entire plan "
        "if violated. WARNING items must be honoured or coach must approve a "
        "deviation. INFO items are best-practice nudges."
    )
    lines.append("")
    for label, group in (("CRITICAL", critical), ("WARNING", warning), ("INFO", info)):
        if not group:
            continue
        lines.append(f"  [{label}]")
        for c in group:
            kind = (c.get("kind") or "").replace("_", " ")
            lines.append(
                f"   • {c['drug_name']} ({c['matched_medication']}) → "
                f"{kind}: {c['item']}"
            )
            if c.get("reason"):
                lines.append(f"     Reason: {c['reason']}")
    lines.append("")
    lines.append(
        "WHEN PLANNING MEALS: avoid all `avoid_food` items literally; emphasise "
        "all `prefer_food` items; honour `timing` rules in supplement schedule. "
        "WHEN BUILDING SUPPLEMENT SCHEDULE: refuse any `avoid_supplement` item; "
        "include `prefer_supplement` items unless the coach has explicitly "
        "removed them. WHEN SETTING LIFESTYLE: avoid all `avoid_practice` items."
    )
    lines.append(
        "If a CRITICAL caution would be violated by the protocol or by a "
        "foods_to_emphasise entry, the CRITICAL CAUTION WINS — substitute or "
        "drop the offending entry without ambiguity."
    )
    lines.append("")
    return "\n".join(lines)


def _has_histamine_signal(client: dict) -> bool:
    """True if the client shows histamine-sensitivity signals that should
    trigger a low-histamine meal-plan overlay. See catalogue claim:
    histamine-sensitive-clients-need-low-histamine-meal-plans.

    Coach can force-disable the overlay per-client by setting
        disable_overlays: [histamine]
    on client.yaml. Used when the dermatitis / autoimmune marker that
    triggered the overlay turned out to be driven by something else
    (e.g. gluten) — once the trigger is removed the histamine
    restriction stops being clinically useful and the coach wants
    to reintroduce ferments etc.
    """
    disabled = client.get("disable_overlays") or []
    if isinstance(disabled, list) and any(
        str(x).lower() == "histamine" for x in disabled
    ):
        return False

    # Meds — flatten to a single lowercase string for substring matching.
    meds = client.get("current_medications") or []
    if isinstance(meds, list):
        meds_str = " ".join(str(m) for m in meds).lower()
    else:
        meds_str = str(meds).lower()
    if any(k in meds_str for k in _HISTAMINE_MEDS):
        return True

    # Conditions + medical history — string keyword match.
    haystacks = []
    for field in ("active_conditions", "medical_history", "known_allergies"):
        v = client.get(field) or []
        if isinstance(v, list):
            haystacks.append(" ".join(str(x) for x in v))
        else:
            haystacks.append(str(v))
    combined = " ".join(haystacks).lower()
    if any(k in combined for k in _HISTAMINE_CONDITION_KEYS):
        return True

    # Sessions — scan selected_symptoms for histamine-tagged slugs.
    # Optional: only used if sessions are pre-loaded into the client dict
    # under "_recent_symptoms" by the caller. Cheap defensive default.
    syms = client.get("_recent_symptoms") or []
    if isinstance(syms, list):
        sym_set = {str(s).lower() for s in syms}
        if any(s in sym_set for s in _HISTAMINE_SYMPTOM_SLUGS):
            return True

    return False


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


# Energy-recovery protocols — a calorie deficit is contraindicated for any
# client whose plan is anchored to one of these (fatigue / post-viral /
# dysautonomia). See _build_prompt_meal_plan_phase calorie-block logic.
_FATIGUE_PROTOCOLS = {
    "adrenal-recovery-protocol",
    "mitochondrial-support",
    "pem-pacing-first-30-days",
    "pots-first-30-days",
}


def _has_fatigue_protocol(plan: dict) -> bool:
    """True when the plan attaches an energy-recovery protocol where a
    calorie deficit would be clinically harmful."""
    return any(
        s in _FATIGUE_PROTOCOLS
        for s in (plan.get("attached_protocols") or [])
    )


# ── Protocol-aware phasing ───────────────────────────────────────────────
# A phase letter (weeks 3-4, 5-6 …) must describe the client's position in
# THEIR attached protocol — never a hardcoded generic arc. The catalogue
# Protocol entities already carry a `phases` list; the phase NAMES embed the
# canonical week ranges, e.g. "Reinoculate (weeks 3–8)". These helpers parse
# that and resolve which phase(s) a given fortnight falls in, so the letter
# never advances a phase prematurely or invents a phase the protocol lacks.

def _parse_phase_week_range(name: str) -> "tuple[int, int] | None":
    """Extract (week_from, week_to) from a phase name like
    'Reinoculate (weeks 3–8)' or 'Personalised balance (week 11+)'.
    Open-ended ('11+') → (11, 99). Returns None if no range found."""
    import re as _re
    if not name:
        return None
    s = name.replace("–", "-").replace("—", "-")
    m = _re.search(r"weeks?\s+(\d+)\s*-\s*(\d+)", s, _re.I)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = _re.search(r"weeks?\s+(\d+)\s*\+", s, _re.I)
    if m:
        return (int(m.group(1)), 99)
    m = _re.search(r"weeks?\s+(\d+)\b", s, _re.I)
    if m:
        return (int(m.group(1)), int(m.group(1)))
    return None


def _resolve_protocol_phase(plan: dict, phase_start: int, phase_end: int) -> dict:
    """Work out which protocol phase(s) a client is in for a given fortnight.

    Reads plan.attached_protocols, loads each catalogue protocol YAML, and
    uses the FIRST one that carries a `phases` list as the spine (the
    primary protocol). Topics accidentally in attached_protocols are
    skipped (no YAML / no phases).

    Returns:
      kind: "time_phased" | "standing" | "none"
      protocol_name / protocol_slug / summary
      active_phases: phases whose week range overlaps [phase_start, phase_end]
      all_phases:    every phase, with parsed {name, week_from, week_to,
                     summary, key_actions}
    """
    slugs = plan.get("attached_protocols") or []
    standing_fallback: dict | None = None
    for slug in slugs:
        pr = _load_protocol_yaml(slug)
        if not pr:
            continue  # a topic slug or unknown — skip
        phases = pr.get("phases") or []
        if not phases:
            # Standing protocol — real protocol, no week-phase sequence.
            # Remember the first one but keep scanning for a time-phased
            # protocol (which takes precedence as the spine).
            if standing_fallback is None:
                standing_fallback = {
                    "kind": "standing",
                    "protocol_name": pr.get("display_name") or slug,
                    "protocol_slug": slug,
                    "summary": (pr.get("summary") or "").strip(),
                    "active_phases": [],
                    "all_phases": [],
                }
            continue
        parsed: list[dict] = []
        cursor = 1
        for ph in phases:
            rng = _parse_phase_week_range(ph.get("name") or "")
            if rng:
                wf, wt = rng
            else:
                dur = ph.get("weeks") or 1
                wf, wt = cursor, cursor + max(int(dur), 1) - 1
            cursor = max(cursor, wt + 1)
            parsed.append({
                "name": (ph.get("name") or "?").strip(),
                "week_from": wf,
                "week_to": wt,
                "summary": (ph.get("summary") or "").strip(),
                "key_actions": ph.get("key_actions") or [],
            })
        active = [
            p for p in parsed
            if p["week_to"] >= phase_start and p["week_from"] <= phase_end
        ]
        return {
            "kind": "time_phased",
            "protocol_name": pr.get("display_name") or slug,
            "protocol_slug": slug,
            "summary": (pr.get("summary") or "").strip(),
            "active_phases": active,
            "all_phases": parsed,
        }
    if standing_fallback:
        return standing_fallback
    return {
        "kind": "none", "protocol_name": "", "protocol_slug": "",
        "summary": "", "active_phases": [], "all_phases": [],
    }


def _phase_letter_protocol_context(plan: dict, phase_start: int, phase_end: int) -> str:
    """Prompt block telling the AI exactly where the client is in their
    attached protocol for THIS fortnight — so the letter never advances a
    phase prematurely, never names a phase the protocol doesn't have, and
    frames overlapping phases as layered (not a clean graduation)."""
    res = _resolve_protocol_phase(plan, phase_start, phase_end)
    wk = (f"week {phase_start}" if phase_start == phase_end
          else f"weeks {phase_start}–{phase_end}")

    if res["kind"] == "none":
        return (
            "PROTOCOL PHASE — no structured FM protocol is attached to this "
            f"plan. Do NOT invent a 5R / elimination / phase narrative. Frame "
            f"{wk} as a steady continuation of the existing plan — building "
            "consistency and depth. Never claim the client has 'advanced' "
            "to a new phase or stage."
        )

    if res["kind"] == "standing":
        return (
            f"PROTOCOL PHASE — the attached protocol is {res['protocol_name']}, "
            "a STANDING protocol: it runs steadily and has NO week-by-week "
            f"phases. For {wk}, do NOT announce a phase change, do NOT say the "
            "client has 'moved into' a new stage, and do NOT borrow 5R or "
            "elimination-diet phase language. Frame this fortnight as "
            f"continuing {res['protocol_name']} steadily — the work now is "
            "consistency, depth, and refinement, not progression through "
            f"phases. Protocol focus: {res['summary'][:200]}"
        )

    # time_phased
    active = res["active_phases"]
    if not active:
        return (
            f"PROTOCOL PHASE — the client is on {res['protocol_name']}. {wk} "
            "sits outside the protocol's defined phases; frame it as steady "
            "continuation toward the plan's close. Do not invent a phase."
        )
    lines = [
        f"PROTOCOL PHASE — the client is on {res['protocol_name']}. For {wk}, "
        "the ACTIVE protocol phase(s) below are the ONLY ones you may "
        "describe. Rules:",
        "  • NEVER name a later phase the client has not reached.",
        "  • NEVER frame this as a clean graduation ('you've now moved to "
        "phase N'). Protocol phases overlap by design.",
        "  • If two phases overlap this fortnight, say the earlier one "
        "CONTINUES while the next one BEGINS TO LAYER IN GENTLY.",
        "",
        "Active phase(s) this fortnight:",
    ]
    for p in active:
        rng = (f"weeks {p['week_from']}–{p['week_to']}"
               if p["week_to"] < 90 else f"week {p['week_from']}+")
        lines.append(f"  • {p['name']} ({rng}): {p['summary'][:240]}")
        for a in p["key_actions"][:4]:
            lines.append(f"      - {a}")
    later = [p for p in res["all_phases"] if p["week_from"] > phase_end]
    if later:
        nxt = later[0]
        lines.append("")
        lines.append(
            f"  NOT YET — '{nxt['name']}' does not begin until week "
            f"{nxt['week_from']}. Do NOT bring its foods or actions into "
            "this letter."
        )
    return "\n".join(lines)


def _consolidated_healing_arc_block(plan: dict, plan_weeks: int) -> str:
    """The 'Healing phases' arc for the consolidated/initial letter.

    Derives from the attached protocol's real phases when one is
    time-phased; otherwise emits a generic-but-honest arc that makes no
    false clinical-phase claims. Replaces the old hardcoded
    Foundation/Repair/Rebalance/Strengthen/Optimize/Sustain arc, which
    misrepresented every non-5R-shaped protocol."""
    res = _resolve_protocol_phase(plan, 1, plan_weeks)
    header = f"## Healing phases (the {plan_weeks}-week arc):"
    if res["kind"] == "time_phased" and res["all_phases"]:
        lines = [
            header,
            f"This plan is anchored to the {res['protocol_name']} protocol. "
            "Use ITS phases below as the weekly arc — do NOT invent a "
            "different progression or rename these phases:",
        ]
        for p in res["all_phases"]:
            rng = (f"weeks {p['week_from']}–{p['week_to']}"
                   if p["week_to"] < 90 else f"week {p['week_from']}+")
            lines.append(f"- **{p['name']}** ({rng}): {p['summary'][:240]}")
        return "\n".join(lines)
    if res["kind"] == "standing":
        return (
            header + "\n"
            f"This plan is anchored to the {res['protocol_name']} protocol, "
            "which runs STEADILY — it does not move through week-by-week "
            "clinical phases. Do NOT invent a Foundation→Repair→Rebalance "
            f"arc. Frame the {plan_weeks} weeks as one continuous protocol: "
            "settle in and build the core habits first, then deepen "
            "consistency, then refine based on what's working, then "
            "consolidate for the long term — the same protocol throughout, "
            "no phase changes."
        )
    return (
        header + "\n"
        "No structured FM protocol is attached. Frame the arc honestly as "
        "graduated habit-building: establish the foundations first, then "
        "deepen and refine, then consolidate for the long term. Do NOT "
        "invent clinical phase names (Repair / Reinoculate / Rebalance / "
        "etc.) — describe what changes in plain language."
    )


# Module-level backdate override — set by main() when payload carries
# as_of_date. All prompt-builders call _recent_client_voice_block without
# passing the cutoff explicitly, so we read this global when as_of_iso
# arg is None. Keeps the threading minimal.
_AS_OF_OVERRIDE: str | None = None


def _recent_client_voice_block(
    client_id: str,
    days_back: int = 14,
    as_of_iso: str | None = None,
) -> str:
    # Honor module-level override (set by main() when backdating).
    if as_of_iso is None and _AS_OF_OVERRIDE:
        as_of_iso = _AS_OF_OVERRIDE
    """Compact block of between-session client/coach messages the letter
    generator should incorporate into the next week's meal plan.

    Scans `~/fm-plans/clients/<id>/sessions/*.yaml` for sessions in the
    last `days_back` days. For each one with a webhook-saved message,
    pre-session coach observation, or hand-typed quick_note, extract:
       - the body (with [audit-tag] prefixes + WhatsApp envelope stripped)
       - which channel it came from (so AI weights client voice as primary)
       - a relative date label

    Returns an empty string when there's nothing recent → prompt skips
    the block entirely (no stray "RECENT MESSAGES" header with zero
    items). When non-empty, this lives inside the meal-plan prompt as
    BINDING coach-priority instructions: "Dhanishta said X → reflect Y
    in this week's plan."

    Why a separate helper: the meal-plan and meal-plan-phase prompts
    both need this signal; the supplement-plan / lifestyle-guide /
    exercise-plan prompts don't (their content domain is locked to the
    structured plan + protocol, not week-to-week chatter).
    """
    if not client_id:
        return ""
    import yaml as _yaml
    from datetime import date, timedelta
    sessions_dir = PLANS_ROOT / "clients" / client_id / "sessions"
    if not sessions_dir.exists():
        return ""

    # Backdating support: when the caller passes as_of_iso (e.g. coach
    # is generating the historical "initial letter" for a client who
    # started weeks ago), anchor the recent-voice window to that date
    # instead of today. Sessions logged AFTER as_of_iso are excluded
    # even if their date is technically within `days_back` — they
    # weren't visible at the time the letter would have been written.
    if as_of_iso:
        try:
            today = date.fromisoformat(as_of_iso[:10])
        except Exception:
            today = date.today()
    else:
        today = date.today()
    cutoff = today - timedelta(days=days_back)

    _TAG_PREFIX_RE = re.compile(r"^(\s*\[[^\]]+\]\s*)+", re.MULTILINE)
    _WA_ENVELOPE_RE = re.compile(
        r"^WhatsApp message from [^\n]+\n+Received:[^\n]+\n+",
        re.IGNORECASE,
    )

    entries: list[tuple[date, str, str]] = []  # (date, channel_label, body)
    for f in sorted(sessions_dir.glob("*.yaml")):
        try:
            data = _yaml.safe_load(f.read_text()) or {}
        except Exception:
            continue
        d_raw = data.get("date") or ""
        try:
            sess_date = date.fromisoformat(str(d_raw)[:10])
        except Exception:
            continue
        if sess_date < cutoff:
            continue
        # Skip sessions logged AFTER the as-of cutoff — they weren't
        # visible when this letter would have been written.
        if sess_date > today:
            continue
        complaints = data.get("presenting_complaints") or ""
        coach_notes = (data.get("coach_notes") or "").strip()

        # Decide channel
        if "[source: whatsapp_webhook]" in complaints:
            channel = "client WhatsApp"
        elif "[source: whatsapp_outbound]" in complaints:
            # Skip outbound — we don't want the prompt re-echoing what
            # the coach already sent. Inbound and coach-observation only.
            continue
        elif "[source: pre_session_brief]" in complaints:
            channel = "coach observation"
        elif coach_notes:
            channel = "coach note"
        else:
            channel = "client"

        # Extract body
        # Coach-written notes (check-ins, observations) are deliberate
        # clinical decisions — never effectively truncate them. Inbound
        # WhatsApp from the client gets a generous-but-bounded cap.
        # The previous 400-char cap silently dropped the trailing half of
        # detailed check-ins where the most actionable info (travel
        # windows, dose changes, referral flags) typically lives.
        # Bug surfaced for cl-004 18 May 2026 — Australia travel +
        # supplement adjustments were chopped off mid-sentence so the
        # generated phase letter had no idea about any of it.
        if coach_notes:
            body = coach_notes
            char_cap = 5000          # no effective cap for coach decisions
        else:
            body = _TAG_PREFIX_RE.sub("", complaints).strip()
            body = _WA_ENVELOPE_RE.sub("", body).strip()
            char_cap = 2500          # generous cap for client voice
        body = " ".join(body.split())  # collapse newlines for prompt density
        if len(body) > char_cap:
            # Truncate at last sentence break before cap, not mid-word
            truncated = body[:char_cap].rstrip()
            last_break = max(
                truncated.rfind(". "),
                truncated.rfind("? "),
                truncated.rfind("! "),
            )
            if last_break > char_cap * 0.6:
                truncated = truncated[: last_break + 1]
            body = truncated + " […truncated]"
        if not body:
            continue
        entries.append((sess_date, channel, body))

    if not entries:
        return ""

    # Newest first — most actionable signal up top so it weights heavier
    # in the AI's response.
    entries.sort(key=lambda t: t[0], reverse=True)

    lines = [
        "## BETWEEN-SESSION VOICE — INCORPORATE INTO THIS WEEK",
        "",
        f"The following messages came in since the last full session. Treat",
        f"`client WhatsApp` items as PRIMARY EVIDENCE — they're what the",
        f"client is actually experiencing in real life. When something here",
        f"contradicts or extends the existing plan.nutrition.add/reduce,",
        f"adjust the menu this week accordingly. Examples of what to act on:",
        f"  • \"Can't eat enough veggies, stools impacted\" → swap heavy",
        f"    grains for vegetable-forward meals + add a daily fresh",
        f"    vegetable juice or soluble-fibre dish in the menu tables.",
        f"  • \"Travelling next week\" → simplify breakfasts/lunches to",
        f"    portable options, note it in the intro.",
        f"  • \"Loving the X dish\" → keep / repeat that pattern.",
        f"  • \"Skipping breakfast\" → propose protein-rich, fast options.",
        f"Quote the client's own words inside the intro paragraph so they",
        f"feel heard. Don't invent — only act on what's in this list.",
        "",
    ]
    for d, channel, body in entries:
        days_ago = (today - d).days
        when = "today" if days_ago == 0 else (
            "yesterday" if days_ago == 1 else f"{days_ago}d ago"
        )
        lines.append(f"- **{d.isoformat()} ({when}, {channel}):** {body}")
    lines.append("")
    return "\n".join(lines)


def _protocol_changes_since_plan_block(
    client_id: str,
    plan_publish_date_iso: str | None,
    plan_slug: str | None = None,
) -> str:
    """Aggregate EVERY coach session note + every inbound client message
    between plan publish and today, and frame them as BINDING protocol
    decisions for subsequent letters.

    The 14-day `_recent_client_voice_block` covers recency (tonal cues,
    last week's vibe). This block covers the FULL communication arc
    since the plan went live — so a Wks 9-10 letter generated 7 weeks
    after the plan publish still surfaces the mouth tape, gluten
    enzymes, and activated charcoal coach added in Wk 2.

    Coach feedback 2026-05-19: phase letters were missing protocol
    items coach added through check-ins / WhatsApp between plans. The
    fix isn't a per-incident patch — it's wiring every subsequent
    letter to read the full conversation since plan publish and
    incorporate ALL coach decisions, not just the last 14 days.

    Returns an empty string if there's nothing to surface (no plan
    publish date OR no sessions in the window OR client_id missing).
    """
    if not client_id or not plan_publish_date_iso:
        return ""
    try:
        from datetime import date
        publish_d = date.fromisoformat(str(plan_publish_date_iso)[:10])
    except Exception:
        return ""

    import yaml as _yaml
    sessions_dir = PLANS_ROOT / "clients" / client_id / "sessions"
    if not sessions_dir.exists():
        return ""

    today = date.today()
    if _AS_OF_OVERRIDE:
        try:
            today = date.fromisoformat(_AS_OF_OVERRIDE[:10])
        except Exception:
            pass

    _TAG_PREFIX_RE = re.compile(r"^(\s*\[[^\]]+\]\s*)+", re.MULTILINE)
    _WA_ENVELOPE_RE = re.compile(
        r"^WhatsApp message from [^\n]+\n+Received:[^\n]+\n+",
        re.IGNORECASE,
    )

    entries: list[tuple[date, str, str]] = []  # (date, channel, body)
    for f in sorted(sessions_dir.glob("*.yaml")):
        try:
            data = _yaml.safe_load(f.read_text()) or {}
        except Exception:
            continue
        d_raw = data.get("date") or ""
        try:
            sess_date = date.fromisoformat(str(d_raw)[:10])
        except Exception:
            continue
        # Only sessions BETWEEN plan publish and today (or as-of cutoff).
        # Inclusive on both ends — same-day check-ins count.
        if sess_date < publish_d or sess_date > today:
            continue

        complaints = data.get("presenting_complaints") or ""
        coach_notes = (data.get("coach_notes") or "").strip()
        body_raw = ""

        if "[source: whatsapp_outbound]" in complaints:
            # Skip outbound — don't echo coach's own messages back.
            continue
        if "[source: whatsapp_webhook]" in complaints:
            channel = "client WhatsApp"
            body_raw = _WA_ENVELOPE_RE.sub("", complaints).strip()
            body_raw = _TAG_PREFIX_RE.sub("", body_raw).strip()
        elif "[source: pre_session_brief]" in complaints:
            channel = "coach observation"
            body_raw = coach_notes or _TAG_PREFIX_RE.sub("", complaints).strip()
        elif coach_notes:
            channel = "coach note"
            body_raw = coach_notes
        elif complaints:
            channel = "client report"
            body_raw = _TAG_PREFIX_RE.sub("", complaints).strip()
        else:
            continue

        # Trim for prompt budget — coach notes are deliberate clinical
        # decisions, never truncate. WhatsApp client messages can be
        # long ramblings, so cap at 800 chars to keep the prompt manageable.
        if channel == "client WhatsApp":
            body_raw = body_raw[:800] + ("…" if len(body_raw) > 800 else "")
        if not body_raw:
            continue
        entries.append((sess_date, channel, body_raw))

    if not entries:
        return ""

    # Chronological — oldest first — so AI sees the protocol evolve
    # forward through time.
    entries.sort(key=lambda t: t[0])

    days_span = (today - publish_d).days
    lines = [
        "## FULL COMMUNICATION SINCE PLAN PUBLISHED — BINDING CONTEXT",
        "",
        (
            f"Below is EVERY coach decision + client message logged between "
            f"the plan being published ({publish_d.isoformat()}) and now "
            f"({today.isoformat()}, {days_span} days). This is the "
            f"continuous record of what's been added / changed / adjusted "
            f"in the protocol DURING the active plan period."
        ),
        "",
        "BINDING RULES:",
        "  1. If a coach note mentions ADDING a supplement, practice, "
        "product, or protocol step (e.g. mouth tape, gluten digestive "
        "enzymes, activated charcoal, ferment-of-the-week, a new lifestyle "
        "habit) — that item IS CURRENTLY PART OF HER PROTOCOL. Reference "
        "it in the appropriate section of this letter (Supplements / "
        "Lifestyle / Travel / Routine).",
        "  2. If a client message reports a SYMPTOM CHANGE — improvement, "
        "regression, new complaint, side effect — fold it into the "
        "narrative + decide whether to adjust the meal plan accordingly.",
        "  3. If a coach note REMOVES an item, do NOT mention it (the "
        "supplement_protocol YAML is the source of truth for current "
        "pills; this block is for ADDITIONS + observations).",
        "  4. Quote the client's own words where it makes the letter feel "
        "heard. Don't invent items not in this list.",
        "",
        "Items oldest → newest:",
        "",
    ]
    for d, channel, body in entries:
        days_ago = (today - d).days
        when = (
            "today" if days_ago == 0
            else "yesterday" if days_ago == 1
            else f"{days_ago}d ago"
        )
        lines.append(f"- **{d.isoformat()} ({when}, {channel}):** {body}")
    lines.append("")
    return "\n".join(lines)


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
                 "potato / carrot / beetroot from the protocol foods. "
                 "NOTE: Jain is LACTO-VEGETARIAN — dairy (milk, ghee, paneer, "
                 "dahi, buttermilk) is fully permitted and central to the diet; "
                 "do NOT confuse Jain with vegan. Only flesh foods, fish, eggs "
                 "and gelatin are excluded for Jain.")
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
        # Coach-set custom link bound by explicit `slug:` field — exact
        # match, takes precedence over every keyword path below.
        cl = _load_custom_links_by_slug().get(sl)
        if cl:
            return cl
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
    # Protein-management feature — the plant-protein track resolves to
    # VitaOne's Rebuild Plant Protein & Lipid (unflavoured, mung+pea).
    "protein-plant-blend": "rebuild-plant-protein-and-lipid-rebuild-plant-protein-and-lipid-15",
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
    """Return (sort_index, slot_label, slot_emoji) for a supplement timing string.

    Uses WORD-BOUNDARY matching, not naive substring matching. Previous
    behaviour matched "am" inside any word containing those characters —
    so "amla" / "vitamin" / "dampens" / "ammonia" all matched the
    Breakfast slot, and "afternoon" matched the Lunch slot (because it
    contains "noon"). Coach feedback 2026-05-29: too many silent
    mis-classifications. Word boundaries fix the entire class of traps:
    multi-word keywords still substring-match (because regex \\b also
    works mid-string), but single short keywords like "am" or "noon"
    now require actual word boundaries on both sides.
    """
    tl = (timing_str or "").lower()
    for idx, label, emoji, keywords in _TIMING_SLOTS:
        for kw in keywords:
            # Multi-word keywords ("empty stomach", "with food", etc.) still
            # need plain substring match because they're already specific
            # enough. Single-word keywords need word boundaries.
            if " " in kw or "-" in kw:
                if kw in tl:
                    return (idx, label, emoji)
            else:
                if re.search(rf"\b{re.escape(kw)}\b", tl):
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


def _resolve_start_week(supp: dict) -> int:
    """Authoritative start week for a supplement plan entry.

    Prefers the STRUCTURED `start_week` field on the SupplementItem
    (added 2026-05-20 — set by the coach in the plan editor, or pre-filled
    by phased protocol templates like 5R). Falls back to the free-text
    heuristic (_detect_start_week, which scrapes titration / rationale
    prose) only for older plans authored before the field existed.
    Always returns an int >= 1.
    """
    raw = supp.get("start_week")
    if raw is not None:
        try:
            n = int(raw)
            if n >= 1:
                return n
        except (ValueError, TypeError):
            pass
    return _detect_start_week(
        supp.get("titration") or "", supp.get("coach_rationale") or ""
    )


# Brand prefixes stripped from user-facing supplement names. Coach
# feedback 2026-05-19: "Vitaone Ashwagandha" reads weird to the client
# — they don't care about the brand name, they care about what the
# supplement does. Brand shows up in the badge next to the buy link
# anyway (e.g. "Buy ↗ [VitaOne]"). Pure presentation strip — slug stays
# untouched for catalogue lookups.
_BRAND_PREFIX_RE = re.compile(
    r"^\s*(vita[\s\-]*one|vitaone|himalaya|organic india|nature[\s\-]*made|now\s*foods|jarrow|thorne|garden of life)\s+",
    re.IGNORECASE,
)


# Common supplement acronyms that .title() mangles ("coq10" → "Coq10"). Used
# to re-case slug-derived names so client-facing letters read correctly.
_SUPP_ACRONYMS = {
    "coq10": "CoQ10", "epa": "EPA", "dha": "DHA", "b12": "B12", "b6": "B6",
    "b9": "B9", "b3": "B3", "d3": "D3", "k2": "K2", "hcl": "HCl", "nac": "NAC",
    "mct": "MCT", "pqq": "PQQ", "tmg": "TMG", "gla": "GLA", "ala": "ALA",
    "dim": "DIM", "msm": "MSM", "udca": "UDCA", "tudca": "TUDCA",
}


def _prettify_supp_acronyms(name: str) -> str:
    """Fix acronym casing in a supplement display name (post .title())."""
    if not name:
        return name
    out = " ".join(_SUPP_ACRONYMS.get(w.lower(), w) for w in name.split())
    return out.replace("EPA DHA", "EPA + DHA")


def _strip_brand_from_name(name: str) -> str:
    """Remove a leading brand prefix from a display name + fix acronym casing.
    Idempotent. 'Vitaone Ashwagandha' → 'Ashwagandha'. 'Coq10' → 'CoQ10'."""
    if not name:
        return name
    return _prettify_supp_acronyms(_BRAND_PREFIX_RE.sub("", name).strip())


# Buy-source priority. When several products cover the same catalogue
# ingredient, the lowest rank wins — VitaOne first (Shivani's primary
# affiliate), FM Nutrition next (fallback retailer), then Amazon / iHerb.
_SOURCE_RANK = {
    "vitaone": 0,
    "fmnutrition": 1,
    "amazon": 2,
    "iherb": 3,
    "other": 4,
}

# Module-level active client for contradiction checking.
# Set by main() after loading the client YAML. Read by
# _resolve_supplement_products() so callers need no signature changes.
_ACTIVE_CLIENT: dict = {}


def _source_rank(src) -> int:
    return _SOURCE_RANK.get((str(src or "other")).strip().lower(), 4)


def _build_client_avoid_set(client: dict) -> set[str]:
    """Normalised set of ingredient tokens the client must avoid.

    Built from: known_allergies, foods_to_avoid, reported_triggers.
    Medications are intentionally excluded — drug-nutrient interactions
    need a proper database (handled by the plan-checker's contraindication
    model, not a substring match). Each value lowercased and stripped.
    """
    out: set[str] = set()
    for field in ("known_allergies", "foods_to_avoid", "reported_triggers"):
        val = client.get(field) or []
        if isinstance(val, str):
            val = [v.strip() for v in val.split(",") if v.strip()]
        if isinstance(val, list):
            for item in val:
                token = str(item).strip().lower()
                if token:
                    out.add(token)
    return out


def _product_clashes_with(product: dict, avoid_set: set[str]) -> str | None:
    """Return the first clashing ingredient name, or None if the product is safe.

    A clash is a bidirectional substring match: 'dairy' matches
    'dairy whey protein' AND 'casein (dairy)' matches 'dairy'.
    Returns the offending ingredient string for logging.
    """
    if not avoid_set:
        return None
    ingredients: list[str] = product.get("active_ingredients") or []
    for ingr in ingredients:
        ingr_n = ingr.strip().lower()
        if not ingr_n:
            continue
        for avoid in avoid_set:
            avoid_n = avoid.strip().lower()
            if not avoid_n:
                continue
            if ingr_n in avoid_n or avoid_n in ingr_n:
                return ingr_n
    return None


def _load_supplement_links_full() -> dict[str, dict]:
    """supplement_links.yaml expanded to {catalogue-slug → product record}.

    Each product entry carries a `covers:` list — the catalogue supplement
    slugs that product supplies. A blend covers several; this expands
    every covers list so a plan supplement looks up its product by slug.

    Source-priority selection with optional contradiction check:
    - Primary ranking: vitaone > fmnutrition > amazon > iherb > other
    - When _ACTIVE_CLIENT is set, any product whose active_ingredients clash
      with the client's allergies / foods_to_avoid is skipped in favour of
      the next-ranked product for that slug.
    - If ALL candidates for a slug clash, the top-ranked one is used anyway
      (better to give a link than no link — the plan-checker handles clinical
      contraindications separately via the catalogue's contraindications field).

    Consumed by _resolve_supplement_products."""
    if not _CUSTOM_LINKS_PATH.exists():
        return {}
    try:
        import yaml
        data = yaml.safe_load(_CUSTOM_LINKS_PATH.read_text()) or {}

        avoid_set = _build_client_avoid_set(_ACTIVE_CLIENT) if _ACTIVE_CLIENT else set()

        # First pass: collect all products per slug, sorted by rank ascending
        all_per_slug: dict[str, list[tuple[int, dict]]] = {}
        for key, val in data.items():
            if not isinstance(val, dict):
                continue
            covers = val.get("covers")
            if not isinstance(covers, list):
                continue
            active_ingredients = val.get("active_ingredients") or []
            record = {
                "product_key": key,
                "display_name": val.get("display_name") or "",
                "url": val.get("url") or "",
                "source": (str(val.get("source") or "other")).strip().lower(),
                "dose": val.get("dose") or "",
                "timing": val.get("timing") or "",
                "take_with_food": val.get("take_with_food") or "",
                "active_ingredients": [str(i).strip().lower() for i in active_ingredients if i],
            }
            rank = _source_rank(record["source"])
            for cs in covers:
                cs = str(cs).strip().lower()
                if not cs:
                    continue
                all_per_slug.setdefault(cs, []).append((rank, record))

        # Second pass: for each slug pick the best non-clashing product
        out: dict[str, dict] = {}
        for cs, candidates in all_per_slug.items():
            candidates.sort(key=lambda x: x[0])   # stable sort: rank asc, file order within rank
            chosen: dict | None = None
            for _rank, record in candidates:
                clash = _product_clashes_with(record, avoid_set)
                if clash:
                    print(
                        f"[render-letter] skip {record['product_key']!r} for slug {cs!r} "
                        f"— ingredient {clash!r} clashes with client avoid list",
                        file=__import__("sys").stderr,
                        flush=True,
                    )
                    continue
                chosen = record
                break
            if chosen is None:
                # All candidates clash — use top-ranked (better than no link)
                chosen = candidates[0][1]
            out[cs] = chosen
        return out
    except Exception:
        return {}


def _clean_product_name(name: str) -> str:
    """Trim a product's pack-size tail for client-facing display —
    'Autoimmunity Care H. Pylori Care, 90 Veg Capsules' →
    'Autoimmunity Care H. Pylori Care'. Keeps text before the first comma."""
    if not name:
        return name
    return name.split(",")[0].strip()


def _resolve_supplement_products(supplements: list[dict]) -> list[dict]:
    """Collapse a plan's supplement_protocol into the PRODUCTS the client
    actually buys.

    A blend product (e.g. 'H. Pylori Care' = berberine + mastic gum +
    bismuth + zinc carnosine) maps several catalogue slugs to one
    supplement_links.yaml entry (same url). This groups them so the daily
    routine, schedule and shopping list each show the product ONCE — by
    name, with one buy link — never each ingredient.

    A supplement_links entry may carry the product's own label dose /
    timing / take_with_food (the blend's real dosing); when present those
    WIN over the plan item's per-ingredient values. Supplements with no
    link pass through unchanged as their own catalogue line.
    """
    links = _load_supplement_links_full()
    groups: dict[str, dict] = {}
    order: list[str] = []
    for s in supplements:
        if not isinstance(s, dict):
            continue
        slug = (s.get("supplement_slug") or "").strip().lower()
        link = links.get(slug)
        key = ("product:" + link["product_key"]) if link else ("slug:" + slug)
        sw = _resolve_start_week(s)
        if key not in groups:
            if link:
                groups[key] = {
                    "supplement_slug": slug,
                    "display_name": _clean_product_name(link["display_name"]) or slug,
                    "dose": link.get("dose") or s.get("dose") or "",
                    "timing": link.get("timing") or s.get("timing") or "",
                    "take_with_food": link.get("take_with_food") or s.get("take_with_food") or "",
                    "coach_rationale": s.get("coach_rationale") or "",
                    "titration": "",
                    "duration_weeks": s.get("duration_weeks"),
                    "start_week": sw,
                    "buy_link": link.get("url") or "",
                    "_linked_product": True,
                    "_members": [slug],
                }
            else:
                g = dict(s)
                g["start_week"] = sw
                g["_members"] = [slug]
                groups[key] = g
            order.append(key)
        else:
            g = groups[key]
            g["_members"].append(slug)
            try:
                g["start_week"] = min(int(g.get("start_week") or 1), int(sw or 1))
            except (TypeError, ValueError):
                pass
            try:
                if int(s.get("duration_weeks") or 0) > int(g.get("duration_weeks") or 0):
                    g["duration_weeks"] = s.get("duration_weeks")
            except (TypeError, ValueError):
                pass
    return [groups[k] for k in order]


def _week_start_date_label(anchor_ymd, week_n) -> str:
    """Calendar date a plan week begins on — anchor + (week-1)x7 days,
    e.g. '28 Jun'. Returns '' when the anchor is missing or unparseable."""
    if not anchor_ymd:
        return ""
    try:
        from datetime import date as _d, timedelta as _td
        a = _d.fromisoformat(str(anchor_ymd)[:10])
        return (a + _td(days=(int(week_n) - 1) * 7)).strftime("%-d %b")
    except Exception:
        return ""


def _build_complete_shopping_list_html(
    supplements: list[dict], plan_weeks: int, start_anchor_ymd=None
) -> str:
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
    # Collapse to the products the client actually buys (blends → one line).
    supplements = _resolve_supplement_products(supplements)

    items: list[dict] = []
    for s in supplements:
        slug = s.get("supplement_slug", "")
        name = _strip_brand_from_name(s.get("display_name") or slug.replace("-", " ").title())
        dose = _clientify_dose(s.get("dose") or s.get("dose_display") or "")
        titration = s.get("titration") or ""
        rationale = (s.get("coach_rationale") or "").strip()
        dur = s.get("duration_weeks")
        try:
            dur = int(dur) if dur else plan_weeks
        except (ValueError, TypeError):
            dur = plan_weeks
        start_week = _resolve_start_week(s)

        # Reuse the same buy-link logic as the detailed schedule.
        buy_link_override = s.get("buy_link") or ""
        # A defined blend product whose URL is not on file yet — do NOT
        # keyword-fallback (it would resolve to the wrong single-ingredient
        # product). Show a clear placeholder instead.
        pending_product_link = bool(s.get("_linked_product")) and not buy_link_override
        link_info = (
            _vitaone_url_only(name, slug=slug)
            if not buy_link_override and not pending_product_link
            else None
        )
        if buy_link_override:
            buy_html = f'<a href="{buy_link_override}" target="_blank" rel="noopener noreferrer">Buy ↗</a>'
            badge = "Custom"
        elif pending_product_link:
            buy_html = '<span class="buy-badge buy-badge-iherb">Link from Shivani</span>'
            badge = "Pending"
        elif link_info:
            _, url = link_info
            is_vitaone = "vitaone.in" in url
            is_amazon = "amzn" in url or "amazon." in url
            badge = "VitaOne" if is_vitaone else ("Amazon" if is_amazon else "Buy")
            cls = "vitaone" if is_vitaone else "amazon"
            buy_html = f'<a href="{url}" target="_blank" rel="noopener noreferrer">Buy ↗</a> <span class="buy-badge buy-badge-{cls}">{badge}</span>'
        else:
            buy_html = f'<a href="{IHERB_AFFILIATE}" target="_blank" rel="noopener noreferrer">Search iHerb ↗</a> <span class="buy-badge buy-badge-iherb">iHerb</span>'
            badge = "iHerb"

        # Phase label: "Start now" for week-1 items; otherwise a real
        # calendar date when the start anchor is known (clients track
        # dates, not "week N"), falling back to "week N".
        if start_week == 1:
            phase_label = "Start now"
        else:
            _dlabel = _week_start_date_label(start_anchor_ymd, start_week)
            phase_label = f"Starts {_dlabel}" if _dlabel else f"Starts week {start_week}"
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
            f"in a later phase of your protocol — check the <em>When to start</em> column. "
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
    💬 <em>If anything's unclear, feel free to check with your doctor before adding a new supplement.
    Your dose schedule shows exactly when each one fits into your day.</em>
  </p>
</section>
"""


# Friendly labels for known home-remedy slugs — woven into the daily
# routine so a supplement is shown next to the drink/remedy it sits beside.
_REMEDY_LABELS = {
    "triphala-churan": "Triphala churna in warm water",
    "triphala": "Triphala churna in warm water",
    "cumin-coriander-fennel-tea": "CCF tea (cumin · coriander · fennel)",
    "ccf-tea": "CCF tea (cumin · coriander · fennel)",
    "golden-milk": "Golden milk",
}


# Cues that mark a supplement as PRN / as-needed (taken occasionally for
# travel, eating out, or emergencies) — NOT every day. These are kept OUT
# of the daily routine timeline and shown in their own "as needed" block.
_PRN_CUES = (
    "as needed", "as-needed", "as required", "as-required", "prn",
    "when needed", "when-needed", "if needed", "if-needed", "as and when",
    "at-risk", "at risk", "before at-risk", "before risky", "risky meals",
    "restaurant", "eating out", "travel", "social meal", "off-plan",
    "emergency", "emergencies", "occasional", "only when", "only as",
)


def _is_prn(supp: dict) -> bool:
    """True when a supplement is taken occasionally / on-demand (travel,
    eating out, emergencies) rather than every single day — so it should
    NOT clutter the Daily Routine timeline. Checked against the timing and
    frequency fields only (coach_rationale can mention 'travel' for
    unrelated reasons and would false-positive)."""
    blob = " ".join(
        str(supp.get(k) or "") for k in ("timing", "frequency")
    ).lower()
    return any(cue in blob for cue in _PRN_CUES)


def _parse_routine_pos(text: str) -> dict[int, int]:
    """Parse a free-text timing / dose string into {slot: earliest keyword
    position}. No collapse, no default. Slots: 0 waking · 1 breakfast ·
    2 mid-morning · 3 lunch · 4 afternoon · 5 dinner · 6 bedtime."""
    t = (text or "").lower()
    pos: dict[int, int] = {}

    def mark(slot: int, *keywords: str) -> None:
        for kw in keywords:
            i = t.find(kw)
            if i != -1:
                pos[slot] = min(pos.get(slot, i), i)

    mark(6, "bedtime", "before bed", "before sleep", "at night")
    mark(2, "mid-morning", "mid morning")
    mark(4, "mid-afternoon", "mid afternoon", "afternoon")
    # "before breakfast" (e.g. "30 min before breakfast") → On waking (slot 0),
    # not Breakfast (slot 1). The client takes it, waits, then eats. Likewise
    # "before lunch" → Mid-morning (slot 2). Handled BEFORE the bare meal marks
    # so the bare mark doesn't fire for the same occurrence.
    if "before breakfast" in t:
        i = t.find("before breakfast")
        pos[0] = min(pos.get(0, i), i)
    else:
        mark(1, "breakfast")
    if "before lunch" in t:
        i = t.find("before lunch")
        pos[2] = min(pos.get(2, i), i)
    else:
        # NB: don't test bare "noon" — it is a substring of "afternoon".
        mark(3, "lunch", "midday", "12 noon")
    mark(5, "dinner", "supper", "evening meal")
    # Bare 'morning' → breakfast, only if no mid-morning / breakfast already.
    # BUT 'morning on empty stomach / fasting' (with no breakfast option
    # named) belongs at On Waking — the fasted, pre-breakfast anchor — not
    # alongside breakfast. A supplement taken on an empty stomach should
    # not sit at the 'eat breakfast' slot.
    # EXCEPTION: 'between meals' + 'morning' → mid-morning (slot 2), not
    # Breakfast, because "between meals in the morning" means the gap
    # between breakfast and lunch — a genuinely between-meal timing.
    fasted = any(
        k in t for k in
        ("empty stomach", "fasting", "on waking", "first thing", "before food")
    )
    if "morning" in t and 2 not in pos and 1 not in pos:
        if "between meal" in t:
            mark(2, "morning")   # between-meals morning → mid-morning
        else:
            mark(0 if fasted else 1, "morning")
    # Bare 'evening' (not 'evening meal') → afternoon, if no dinner already.
    if "evening" in t and 5 not in pos:
        mark(4, "evening")
    # 'On waking' / fasting — only when nothing more specific matched.
    if not pos and any(
        k in t for k in ("waking", "early morning", "fasting", "empty stomach")
    ):
        pos[0] = 0
    return pos


def _routine_slots(timing_str: str, dose_str: str = "") -> list[int]:
    """Every day-anchor a supplement belongs to, parsed from its free-text
    timing — for the Daily Routine. Unlike _timing_slot (one slot, used by
    the dose table), this returns a LIST: a genuinely thrice-daily enzyme
    placed with breakfast + lunch + dinner returns [1, 3, 5].

    'X or Y' (e.g. 'with dinner or at bedtime') is a once-daily pick-one
    timing — it collapses to a SINGLE anchor so the supplement is never
    listed twice. The dose text is consulted first (it often pins the
    intended slot precisely — 'magnesium glycinate at bedtime'); failing
    that, the slot mentioned first in the timing wins. Only true 'and'
    multi-dose timings keep multiple slots.

    'Between X and Y' (e.g. 'between breakfast and lunch (mid-morning)')
    is a single-window timing — the meal keywords X and Y describe the
    boundaries of the window, NOT separate doses. Collapse to the most
    specific slot named (a parenthetical like '(mid-morning)' wins;
    failing that, use the midpoint slot between X and Y)."""
    t = (timing_str or "").lower()
    pos = _parse_routine_pos(timing_str)
    if not pos:
        pos = {1: 0}  # safe default: with breakfast

    slots = sorted(pos)

    # 'Between X and Y' where X and Y are two *specific* meal names
    # (breakfast/lunch/dinner) → single-window; collapse to one anchor.
    # Contrast: 'Between meals — morning and evening' uses a generic
    # 'between meals' phrase + separate time-of-day hints (morning /
    # evening) — that's two distinct between-meal windows (e.g. mid-
    # morning AND afternoon for twice-daily zinc carnosine), so it must
    # NOT be collapsed.
    _meal_names = {"breakfast", "lunch", "dinner"}
    _between_meal_pair = (
        len(slots) > 1
        and "between" in t
        # Require two explicit meal names in the text (not just "morning",
        # "evening", or bare "meals") so generic 'between meals' phrases
        # are excluded from single-window collapse.
        and sum(1 for m in _meal_names if m in t) >= 2
    )
    if _between_meal_pair:
        # A more specific mid-slot (parenthetical like '(mid-morning)')
        # wins; fall back to deriving the midpoint from the named pair.
        # Known mid-slot candidates: 2 (mid-morning), 4 (afternoon).
        specific = [s for s in slots if s in (2, 4)]
        if specific:
            return [min(specific, key=lambda s: pos[s])]
        if 1 in pos and 3 in pos:
            return [2]   # between breakfast and lunch → mid-morning
        if 3 in pos and 5 in pos:
            return [4]   # between lunch and dinner → afternoon
        if 1 in pos and 5 in pos:
            return [4]   # between breakfast and dinner → afternoon
        return [min(slots, key=lambda s: pos[s])]

    # 'X or Y' / 'X / Y' → once-daily, pick one.
    if len(slots) > 1 and (" or " in t or " / " in t):
        # If the dose text pins exactly one of the candidate slots, use it.
        dose_pos = _parse_routine_pos(dose_str)
        narrowed = [s for s in slots if s in dose_pos]
        if len(narrowed) == 1:
            return narrowed
        # Otherwise keep the first-mentioned (coach's primary recommendation).
        return [min(slots, key=lambda s: pos[s])]
    return slots


def _build_daily_routine_html(plan: dict, window_end_week: int | None = None) -> str:
    """The integrated 'Your Daily Routine' timeline.

    One chronological strip for the whole day — every supplement placed
    next to the meal / drink / habit anchor it belongs beside, with a
    clear 'with food' / 'empty stomach' tag, so the client never has to
    guess 'do I take this before or after the methi water'. Generated
    deterministically from plan data. This is THE section the client
    prints and keeps on the fridge.
    """
    # Collapse to the products the client actually buys (blends → one line).
    supplements = _resolve_supplement_products(plan.get("supplement_protocol") or [])
    # Current-window only: a consolidated / fortnight letter shows just
    # what the client STARTS in this window — the every-2-weeks phase
    # letters introduce the rest. Avoids handing a new client a scary
    # 15-line list. The shopping list still carries everything.
    if window_end_week is not None:
        supplements = [
            s for s in supplements if _resolve_start_week(s) <= window_end_week
        ]
    if not supplements:
        return ""

    from collections import defaultdict
    by_slot: dict[int, list] = defaultdict(list)
    prn_entries: list = []  # as-needed / travel-only — kept out of the timeline
    for s in supplements:
        if not isinstance(s, dict):
            continue
        slug = s.get("supplement_slug", "")
        name = _strip_brand_from_name(
            s.get("display_name") or slug.replace("-", " ").title()
        )
        if not name:
            continue
        tw = (s.get("take_with_food") or "").lower()
        timing_l = (s.get("timing") or "").lower()
        # If the timing names a meal (breakfast/lunch/dinner/with food), the
        # anchor placement decides — don't force a contradictory food tag.
        timing_has_meal = any(
            w in timing_l for w in
            ("breakfast", "lunch", "dinner", "with food", "with meal",
             "with a meal", "with meals")
        )
        if "empty" in tw or tw.strip() in ("no", "without food"):
            food_tag = "on an empty stomach"
        elif "with" in tw or "food" in tw or tw.strip() == "yes":
            food_tag = "with food"
        elif not timing_has_meal and any(
            k in timing_l
            for k in ("empty stomach", "away from food", "before food")
        ):
            food_tag = "on an empty stomach"
        else:
            food_tag = ""
        entry = {
            "name": name,
            "dose": s.get("dose") or "",
            "food_tag": food_tag,
            "start_week": _resolve_start_week(s),
            "when": (s.get("timing") or "").strip(),
        }
        # PRN / as-needed supplements (travel, eating out, emergencies) are
        # NOT part of the daily routine — collect them for a separate block.
        if _is_prn(s):
            prn_entries.append(entry)
            continue
        # A genuine multi-dose supplement can belong to several anchors
        # (e.g. a thrice-daily enzyme → breakfast + lunch + dinner).
        for idx in _routine_slots(s.get("timing") or "", s.get("dose") or ""):
            by_slot[idx].append(entry)

    # Remedies in the plan → friendly labels for the relevant anchors.
    remedies = [
        str(r).lower()
        for r in ((plan.get("nutrition") or {}).get("home_remedies") or [])
    ]
    has_triphala = any("triphala" in r for r in remedies)
    has_ccf = any(("cumin" in r) or ("ccf" in r) or ("fennel" in r) for r in remedies)
    has_methi = any(("methi" in r) or ("fenugreek" in r) for r in remedies)

    # 7 day anchors aligned to the _timing_slot indices. Each: emoji,
    # label, ~time hint, and the meal/drink/habit the client already does.
    anchors = [
        (0, "🌅", "On waking", "~7 am",
         "Methi (fenugreek) seed water — soak 1 tsp overnight, drink it first thing"
         if has_methi else "Warm water — add lemon if that is your routine"),
        (1, "🍳", "Breakfast", "~8 am", "Eat breakfast"),
        (2, "🕙", "Mid-morning", "~11 am", "Mid-morning snack or drink"),
        (3, "🥗", "Lunch", "~1 pm",
         "Eat lunch — then a 10-minute walk"),
        (4, "🌤", "Afternoon", "~4 pm",
         "CCF tea between meals" if has_ccf else "Afternoon"),
        (5, "🌆", "Dinner", "by 7 pm",
         "Eat a light dinner — then a 10-minute walk"),
        (6, "🌙", "Bedtime", "~10 pm",
         "Triphala in warm water, then wind down"
         if has_triphala else "Wind down for sleep"),
    ]

    rows_html = ""
    for idx, emoji, label, time_hint, activity in anchors:
        supps = by_slot.get(idx, [])
        supp_html = ""
        if supps:
            for sp in supps:
                tags = []
                if sp["food_tag"]:
                    tags.append(sp["food_tag"])
                if sp["start_week"] > 1:
                    tags.append(f"from week {sp['start_week']}")
                tag_str = (
                    f" <span class='routine-supp-tag'>({' · '.join(tags)})</span>"
                    if tags else ""
                )
                dose_str = (
                    f" <span class='routine-supp-dose'>{sp['dose']}</span>"
                    if sp["dose"] else ""
                )
                supp_html += (
                    f"<div class='routine-supp'>💊 <strong>{sp['name']}</strong>"
                    f"{dose_str}{tag_str}</div>"
                )
        else:
            supp_html = "<div class='routine-supp routine-supp-none'>— no supplement at this time —</div>"
        rows_html += (
            f"<div class='routine-row'>"
            f"<div class='routine-anchor'>"
            f"<span class='routine-emoji'>{emoji}</span>"
            f"<span class='routine-label'>{label}</span>"
            f"<span class='routine-time'>{time_hint}</span>"
            f"</div>"
            f"<div class='routine-body'>"
            f"<div class='routine-activity'>{activity}</div>"
            f"{supp_html}"
            f"</div>"
            f"</div>"
        )

    # As-needed / travel-only supplements — shown in their own block, clearly
    # separated from the daily timeline so the client never takes them daily.
    prn_html = ""
    if prn_entries:
        prn_items = ""
        for sp in prn_entries:
            dose_str = (
                f" <span class='routine-supp-dose'>{sp['dose']}</span>"
                if sp["dose"] else ""
            )
            when_str = (
                f" <span class='routine-prn-when'>— {sp['when']}</span>"
                if sp["when"] else ""
            )
            prn_items += (
                f"<div class='routine-supp'>💊 <strong>{sp['name']}</strong>"
                f"{dose_str}{when_str}</div>"
            )
        prn_html = f"""
  <div class="routine-prn">
    <div class="routine-prn-head">🧳 As needed — travel &amp; eating out only</div>
    <p class="routine-prn-note">
      These are <strong>not</strong> part of your daily routine. Keep them on
      hand and use them only for the occasion noted — eating out, travel, or
      an off-plan meal.
    </p>
    {prn_items}
  </div>"""

    return f"""
<!-- ════════════════ DAILY ROUTINE ════════════════ -->
<section id="daily-routine">
  <div class="routine-header">
    <div>
      <h2 class="routine-title">📋 Your Daily Routine</h2>
      <p class="routine-subtitle">
        Your whole day at a glance — when to take each supplement, and
        which meal or drink it sits beside. Print this and keep it where
        you'll see it: the fridge, or a photo on your phone.
        <br><a class="no-print" href="#supplement-buy-list" onclick="var e=document.getElementById('supplement-buy-list');if(e){{e.scrollIntoView({{behavior:'smooth'}});}}return false;" style="color:#a9651f;font-weight:600;text-decoration:none;">👉 Where to buy each one (below)</a>
      </p>
    </div>
    <button class="print-btn no-print" onclick="printRoutine()">🖨 Print my routine</button>
  </div>
  <div class="routine-track">
    {rows_html}
  </div>
  {prn_html}
  <p class="routine-foot">
    Times are a guide — keep the <em>order</em> (which supplement sits with
    which meal), and shift the clock to suit your day. This routine covers
    what you start now; your next letter introduces the later supplements
    when the time comes.
  </p>
</section>
<script>
function printRoutine() {{
  document.body.setAttribute('data-print-routine', '1');
  window.print();
}}
</script>
<!-- ════════════════════════════════════════════════ -->
"""


def _clientify_dose(text: str) -> str:
    """Coach feedback 2026-05-23 — clients can't titrate in mg increments
    (no scale; only fixed-size capsules). Strip "titrate by N mg" verbs
    and coach-only caveats from the dose text so the client sees only
    the starting dose + simple instructions. The full titration logic
    stays on the coach's plan editor; clients message the coach if
    anything's unclear.

    Idempotent + safe — when the dose has no titrate language we just
    return it unchanged.
    """
    import re as _re
    if not text:
        return ""
    s = str(text)
    # Drop ", titrate up/down by N mg every M nights to …" clauses
    s = _re.sub(r"[;,]\s*titrat\w*[^.;]*(?:[.;]|$)", ". ", s, flags=_re.IGNORECASE)
    # Drop standalone parentheticals like "(typical landing dose 300-400 mg)"
    s = _re.sub(
        r"\((?:typical|target|aim for|usually|landing|usual)[^)]*\)",
        "",
        s,
        flags=_re.IGNORECASE,
    )
    # Drop "back off one step if …" coach adjustments
    s = _re.sub(r"\bback off[^.;]*(?:[.;]|$)", "", s, flags=_re.IGNORECASE)
    # Drop "reassess at week N …" coach reminders
    s = _re.sub(r"\breassess at week \d+[^.;]*(?:[.;]|$)", "", s, flags=_re.IGNORECASE)
    # Drop "re-test … at week N" coach reminders
    s = _re.sub(
        r"\bre-?test[^.;]*\b(?:week|month)\b[^.;]*(?:[.;]|$)",
        "",
        s,
        flags=_re.IGNORECASE,
    )
    # Tidy doubled whitespace + trailing punctuation
    s = _re.sub(r"\s{2,}", " ", s)
    s = _re.sub(r"\s+([.,;])", r"\1", s)
    s = _re.sub(r"[;.]\s*$", "", s).strip()
    return s


def _build_portion_plate_html(meal_style: str = "hybrid", dietary_preference: str = "") -> str:
    """Self-contained 'how to build your plate' portions visual.

    Deterministic — no AI, no plan data needed. Shows the FM balanced-plate
    rule (½ non-starchy veg, ¼ protein, ¼ smart carbs + a thumb of healthy
    fat) as an SVG plate + legend, with India-context food examples.

    Included in EVERY meal-bearing letter regardless of meal_plan_style
    (Principles / Detailed / Hybrid) — it's the orienting visual the client
    keeps. Print-safe (kept on one page, prints with the letter body).
    """
    VEG = "#4a6152"      # forest — non-starchy veg (half)
    PROTEIN = "#a9651f"  # ochre — protein (quarter)
    CARB = "#c2832e"     # warm gold — smart carbs (quarter)
    INK = "#262219"
    MUTED = "#6f6a5d"
    PAPER = "#faf9f7"
    style = (meal_style or "hybrid").lower()
    if style == "principles":
        caption = (
            "Your plan gives you principles, not a fixed menu — use this plate "
            "as your guide at every meal."
        )
    elif style == "detailed":
        caption = (
            "Your daily menu already follows this balance — this is the shape "
            "behind every meal I've planned for you."
        )
    else:
        caption = (
            "Build each main meal to this shape — it's the simplest way to keep "
            "every plate balanced without counting anything."
        )
    # Diet-aware protein examples. CRITICAL: never list flesh foods or eggs
    # for vegetarian / Jain / vegan clients (coach rule 2026-06-04 — a Jain
    # client saw "chicken" on her plate card). Check non-veg FIRST so that
    # "non-vegetarian" isn't swallowed by the "vegetarian" substring test.
    _dp = (dietary_preference or "").lower()
    _nonveg = any(m in _dp for m in ("non-veg", "non veg", "nonveg", "omnivore",
                                     "chicken", "fish", "mutton", "meat", "prawn"))
    _vegan = "vegan" in _dp
    _veg = (not _nonveg) and (("veg" in _dp) or ("jain" in _dp) or _vegan)
    _eats_eggs = ("egg" in _dp) and not _vegan
    if _vegan:
        protein_examples = "Dal, rajma, chana, tofu, tempeh, soya, nuts and seeds"
    elif _veg:
        protein_examples = "Dal, rajma, chana, paneer, tofu, curd" + (", eggs" if _eats_eggs else "")
    elif _nonveg:
        protein_examples = "Dal, rajma, chana, paneer, curd, eggs, fish, chicken, tofu"
    else:
        # Diet unknown — stay vegetarian-safe by default; name flesh foods
        # only as a conditional aside so a veg client is never shown meat.
        protein_examples = ("Dal, rajma, chana, paneer, tofu, curd "
                            "(plus eggs, fish or chicken if those are part of your diet)")
    return f"""
<section class="portion-plate-card" style="margin:18px 0;padding:20px 22px;border:1px solid #e6dfd1;border-radius:14px;background:{PAPER};page-break-inside:avoid;break-inside:avoid;">
  <h2 style="margin:0 0 4px;font-family:Georgia,serif;font-size:20px;color:{INK};">🍽 Building Your Plate</h2>
  <p style="margin:0 0 16px;font-size:13.5px;color:{MUTED};line-height:1.5;">{caption}</p>
  <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:center;">
    <svg width="190" height="190" viewBox="0 0 200 200" role="img" aria-label="Balanced plate: half vegetables, quarter protein, quarter smart carbs" style="flex:0 0 auto;">
      <circle cx="100" cy="100" r="94" fill="#ffffff" stroke="#d6cdbb" stroke-width="3"/>
      <path d="M100,12 A88,88 0 0 0 100,188 Z" fill="{VEG}"/>
      <path d="M100,100 L100,12 A88,88 0 0 1 188,100 Z" fill="{PROTEIN}"/>
      <path d="M100,100 L188,100 A88,88 0 0 1 100,188 Z" fill="{CARB}"/>
      <line x1="100" y1="12" x2="100" y2="188" stroke="#ffffff" stroke-width="2.5"/>
      <line x1="100" y1="100" x2="188" y2="100" stroke="#ffffff" stroke-width="2.5"/>
      <text x="52" y="98" text-anchor="middle" fill="#ffffff" font-family="Georgia,serif" font-size="15" font-weight="bold">½</text>
      <text x="52" y="116" text-anchor="middle" fill="#ffffff" font-family="Inter,Arial,sans-serif" font-size="9">Veg</text>
      <text x="143" y="62" text-anchor="middle" fill="#ffffff" font-family="Georgia,serif" font-size="13" font-weight="bold">¼</text>
      <text x="143" y="76" text-anchor="middle" fill="#ffffff" font-family="Inter,Arial,sans-serif" font-size="8.5">Protein</text>
      <text x="143" y="142" text-anchor="middle" fill="#ffffff" font-family="Georgia,serif" font-size="13" font-weight="bold">¼</text>
      <text x="143" y="156" text-anchor="middle" fill="#ffffff" font-family="Inter,Arial,sans-serif" font-size="8.5">Carbs</text>
    </svg>
    <ul style="flex:1 1 240px;margin:0;padding:0;list-style:none;font-size:13.5px;color:{INK};line-height:1.55;">
      <li style="margin-bottom:9px;"><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:{VEG};margin-right:8px;"></span><strong>½ plate — non-starchy veg.</strong> Sabzi, salad, greens, lauki, bhindi, beans, gourds. Aim for colour + variety.</li>
      <li style="margin-bottom:9px;"><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:{PROTEIN};margin-right:8px;"></span><strong>¼ plate — protein.</strong> {protein_examples}. Roughly a palm-sized portion.</li>
      <li style="margin-bottom:9px;"><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:{CARB};margin-right:8px;"></span><strong>¼ plate — smart carbs.</strong> Millet, brown rice, 1–2 rotis, sweet potato, oats. Cupped-hand portion.</li>
      <li style="margin-bottom:0;"><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:#9b9587;margin-right:8px;"></span><strong>+ a thumb of healthy fat</strong> (ghee, cold-pressed oil, nuts, seeds) and a <strong>glass of water</strong>. Skip sugary drinks.</li>
    </ul>
  </div>
</section>
"""


def _load_home_remedy(slug: str) -> dict | None:
    """Load a HomeRemedy YAML from fm-database/data/home_remedies/<slug>.yaml."""
    import yaml as _yaml
    p = FMDB_ROOT / "data" / "home_remedies" / f"{slug}.yaml"
    if not p.exists():
        return None
    try:
        return _yaml.safe_load(p.read_text()) or None
    except Exception:
        return None


def _build_remedies_html(plan: dict) -> str:
    """Conditional '🍵 Drinks & digestives' section. Renders the plan's catalogue
    home_remedies (churan / tea / juice / infused water — with preparation) PLUS
    any bespoke custom_remedies (a kitchen-spice blend authored for this client).
    Returns '' when the plan has none, so the section only shows when relevant.
    """
    nutrition = plan.get("nutrition") or {}
    cards: list[str] = []

    def _card(name: str, kind: str, body_parts: list[str]) -> str:
        kind_chip = f' <span class="remedy-kind">{kind}</span>' if kind else ""
        return (
            f'    <article class="remedy-card"><h3 class="remedy-name">{name}{kind_chip}</h3>'
            + "".join(p for p in body_parts if p)
            + "</article>"
        )

    # 1. Catalogue remedies (by slug)
    for slug in (nutrition.get("home_remedies") or []):
        hr = _load_home_remedy(str(slug))
        if not hr:
            continue
        name = hr.get("display_name") or str(slug).replace("-", " ").title()
        prep = (hr.get("preparation") or "").strip()
        when = (hr.get("typical_dose") or hr.get("timing_notes") or "").strip()
        cards.append(_card(name, str(hr.get("category") or "").replace("_", " "), [
            f'<p class="remedy-prep">{prep}</p>' if prep else "",
            f'<p class="remedy-when"><strong>When:</strong> {when}</p>' if when else "",
        ]))

    # 2. Bespoke custom remedies (authored for this client)
    for cr in (nutrition.get("custom_remedies") or []):
        if not isinstance(cr, dict):
            continue
        name = (cr.get("name") or "").strip()
        if not name:
            continue
        cards.append(_card(name, (cr.get("kind") or "").strip(), [
            f'<p class="remedy-why">{cr["reason"]}</p>' if cr.get("reason") else "",
            f'<p class="remedy-prep"><strong>What\'s in it:</strong> {cr["ingredients"]}</p>' if cr.get("ingredients") else "",
            f'<p class="remedy-prep"><strong>How to make it:</strong> {cr["preparation"]}</p>' if cr.get("preparation") else "",
            f'<p class="remedy-when"><strong>When:</strong> {cr["timing"]}</p>' if cr.get("timing") else "",
        ]))

    if not cards:
        return ""
    return (
        '<section id="remedies" class="remedies">\n'
        '  <h2 class="remedies-title">🍵 Your daily drinks &amp; digestives</h2>\n'
        '  <p class="remedies-sub">Simple kitchen preparations chosen for you — gentle, '
        "easy to make, and part of your daily rhythm.</p>\n"
        '  <div class="remedy-grid">\n'
        + "\n".join(cards)
        + "\n  </div>\n"
        "</section>"
    )


def _buy_source_label(url: str) -> str:
    """Retailer label for a supplement buy link (shown beside 'Buy here')."""
    u = (url or "").lower()
    if "vitaone.in" in u:
        return "VitaOne"
    if "fmnutrition" in u:
        return "FM Nutrition"
    if "amzn" in u or "amazon." in u:
        return "Amazon"
    if "iherb" in u:
        return "iHerb"
    return "Buy"


def _build_supplement_buy_list_html(supplements: list[dict]) -> str:
    """Simple supplement buy-links list — FIRST LETTER ONLY.

    Coach 2026-06-07: the letter needs the daily schedule (Daily Routine) plus
    a plain 'Buy here' list — NOT the full dose/why table and NOT the weekly-
    quantity shopping list (those duplicated the buy links and felt like the
    schedule appeared three times). Each row is just: supplement name + one
    'Buy here ↗' link (+ source badge). Reuses the same link resolution as the
    old schedule so VitaOne / Amazon / iHerb still resolve with the referral.
    """
    if not supplements:
        return ""
    rows: list[str] = []
    for s in supplements:
        slug = s.get("supplement_slug", "")
        name = _strip_brand_from_name(
            s.get("display_name") or slug.replace("-", " ").title()
        )
        buy_link_override = s.get("buy_link") or ""
        pending_product_link = bool(s.get("_linked_product")) and not buy_link_override
        link_info = (
            _vitaone_url_only(name, slug=slug)
            if not buy_link_override and not pending_product_link
            else None
        )
        # badge (source label) sits LEFT of the button so every "Buy here"
        # button right-aligns to a clean vertical column.
        badge = ""
        if buy_link_override:
            button = (
                f'<a href="{buy_link_override}" target="_blank" '
                f'rel="noopener noreferrer" class="buy-here">Buy here ↗</a>'
            )
            badge = f'<span class="buy-src">{_buy_source_label(buy_link_override)}</span>'
        elif pending_product_link:
            button = '<span class="buy-here buy-here--pending">link from Shivani</span>'
        elif link_info:
            _, url = link_info
            button = (
                f'<a href="{url}" target="_blank" rel="noopener noreferrer" '
                f'class="buy-here">Buy here ↗</a>'
            )
            badge = f'<span class="buy-src">{_buy_source_label(url)}</span>'
        else:
            button = (
                f'<a href="{IHERB_AFFILIATE}" target="_blank" '
                f'rel="noopener noreferrer" class="buy-here">Buy here ↗</a>'
            )
            badge = '<span class="buy-src">iHerb</span>'
        rows.append(
            f'      <li class="buy-row"><span class="buy-row-name">{name}</span>'
            f'<span class="buy-cta">{badge}{button}</span></li>'
        )
    return (
        '<section id="supplement-buy-list" class="supp-buy">\n'
        '  <h2 class="supp-buy-title">🛒 Where to buy your supplements</h2>\n'
        '  <p class="supp-buy-sub">Your full set for this plan — tap “Buy here” for each. '
        "I'll share these links just this once, here in your first letter.</p>\n"
        '  <ul class="buy-list">\n'
        + "\n".join(rows)
        + "\n  </ul>\n"
        "</section>"
    )


def _build_supplement_schedule_html(
    supplements: list[dict], window_end_week: int | None = None
) -> str:
    """
    Build a self-contained HTML section: visual timeline + sortable table.
    Generated purely from structured plan data — not from AI output — so
    every supplement in the plan is guaranteed to appear.
    """
    if not supplements:
        return ""
    # Collapse to the products the client actually buys (blends → one line).
    supplements = _resolve_supplement_products(supplements)
    # Current-window only — see _build_daily_routine_html note.
    if window_end_week is not None:
        supplements = [
            s for s in supplements if _resolve_start_week(s) <= window_end_week
        ]
    if not supplements:
        return ""

    # Enrich each supplement with slot info and buy link
    rows: list[dict] = []
    for s in supplements:
        slug = s.get("supplement_slug", "")
        name = _strip_brand_from_name(s.get("display_name") or slug.replace("-", " ").title())
        dose = _clientify_dose(s.get("dose") or s.get("dose_display") or "")
        timing_raw = s.get("timing") or ""
        rationale = (s.get("coach_rationale") or "").split("\n")[0].strip()
        # Strip evidence-tier note suffix if present
        if "[evidence-tier note]" in rationale:
            rationale = rationale.split("[evidence-tier note]")[0].strip()
        # Buy link: prefer explicit buy_link on item, then catalog lookup
        buy_link_override = s.get("buy_link") or ""
        # Defined blend product, URL not on file — no keyword fallback.
        pending_product_link = bool(s.get("_linked_product")) and not buy_link_override
        link_info = (
            _vitaone_url_only(name, slug=slug)
            if not buy_link_override and not pending_product_link
            else None
        )
        if buy_link_override:
            buy_html = f'<a href="{buy_link_override}" target="_blank" rel="noopener noreferrer">Buy ↗</a>'
            buy_badge = "Custom link"
        elif pending_product_link:
            buy_html = '<span class="buy-badge buy-badge-iherb">Link from Shivani</span>'
            buy_badge = "Pending"
        elif link_info:
            product_name, url = link_info
            is_vitaone = "vitaone.in" in url
            is_amazon = "amzn" in url or "amazon." in url
            badge = "VitaOne" if is_vitaone else ("Amazon" if is_amazon else "Buy")
            buy_html = f'<a href="{url}" target="_blank" rel="noopener noreferrer">{product_name} ↗</a> <span class="buy-badge buy-badge-{"vitaone" if is_vitaone else "amazon"}">{badge}</span>'
            buy_badge = badge
        else:
            buy_html = f'<a href="{IHERB_AFFILIATE}" target="_blank" rel="noopener noreferrer">Search on iHerb ↗</a> <span class="buy-badge buy-badge-iherb">iHerb</span>'
            buy_badge = "iHerb"

        slot_idx, slot_label, slot_emoji = _timing_slot(timing_raw)
        start_week = _resolve_start_week(s)
        rows.append({
            "name": name,
            "dose": dose,
            "timing_raw": timing_raw or slot_label,
            "slot_idx": slot_idx,
            "slot_label": slot_label,
            "slot_emoji": slot_emoji,
            "rationale": rationale,
            "buy_html": buy_html,
            "start_week": start_week,
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
            f'{"<span class=supp-pill-week>from wk " + str(r["start_week"]) + "</span>" if r["start_week"] > 1 else ""}'
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
        if r["start_week"] > 1:
            start_cell = (
                f"<span class='phase-chip phase-later'>Week {r['start_week']}</span>"
            )
        else:
            start_cell = "<span class='phase-chip phase-now'>Now</span>"
        table_rows += (
            f"<tr>"
            f"<td><span class='slot-chip'>{r['slot_emoji']} {r['slot_label']}</span></td>"
            f"<td><strong>{r['name']}</strong></td>"
            f"<td>{r['dose']}</td>"
            f"<td>{start_cell}</td>"
            f"<td class='rationale-cell'>{r['rationale']}</td>"
            f"<td class='buy-cell'>{r['buy_html']}</td>"
            f"</tr>"
        )

    return f"""
<!-- ════════════════ SUPPLEMENT SCHEDULE ════════════════ -->
<!-- Screen-only (no-print) per LETTER_TEMPLATE_SPEC: the printable
     at-a-glance version is Your Daily Routine; this full doses/buy-links
     table is reference, hyperlinked from the routine, kept off the print. -->
<section id="supplement-schedule" class="no-print">
  <div class="schedule-header">
    <div>
      <h2 class="schedule-title">💊 Your Supplement Schedule</h2>
      <p class="schedule-subtitle">
        The full reference detail — dose, timing, and where to buy each one.
        For the at-a-glance daily version, use <strong>Your Daily Routine</strong>
        near the top of this letter (that is the one to print). Please check
        with your doctor before starting any new supplement, especially if
        you're on medication.
      </p>
    </div>
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
          <th>Start</th>
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

<!-- printSchedule() removed 2026-05-21 — the supplement schedule no longer
     has its own print button. The Daily Routine (printRoutine) is the
     single supplement printout the client keeps; a second schedule-table
     print was a confusing, contradictory duplicate. -->
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


# ── Protein management ──────────────────────────────────────────────────
#
# Protein top-up for FM clients — especially non-meat-eaters, who routinely
# under-eat protein. Two helpers:
#   _calc_protein_target  — daily gram target (1.2-1.5 g/kg, adjusted body
#                           weight for high BMI; suppressed for kidney
#                           disease / high uric acid)
#   _pick_protein_source  — which of the 3 catalogue protein powders fits,
#                           from dairy status + histamine / gut-protocol
#                           suppression flags
# See fm-database/data/sources/protein-intake-guidance.yaml.

# Protein heuristics now live in the shared protein_logic module so the plan
# generator (generate-draft.py) and this letter generator stay in lock-step.
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import protein_logic as _protein
# Back-compat aliases — _protein_guidance_block below calls these names.
_calc_protein_target = _protein.calc_protein_target
_pick_protein_source = _protein.pick_protein_source
_protein_condition_text = _protein.protein_condition_text
_protein_lab_marker_high = _protein.protein_lab_marker_high


def _protein_guidance_block(client: dict, plan: dict | None = None) -> str:
    """Protein-management block for the meal-plan / consolidated / phase
    prompts. Tells the AI the client's daily protein target, the
    food-first sources to lean on, and — only if the day's food is likely
    to fall short — which protein powder to recommend as a top-up.

    Returns "" when weight data is missing. When protein is
    contraindicated for raising (kidney disease / high uric acid / gout)
    the block instead instructs a moderate, no-powder, 'confirm with your
    doctor' framing — the app never pushes protein on those clients.
    """
    target = _calc_protein_target(client, plan)
    if not target:
        return ""

    if target.get("suppressed"):
        why = _protein.suppress_why(target.get("suppress_reason"))
        return (
            "PROTEIN — KEEP MODERATE (do NOT push):\n"
            f"This client has a medical reason ({why}) not to raise protein "
            "intake.\n"
            "- Do NOT set a high-protein target and do NOT recommend a "
            "protein powder.\n"
            "- Keep protein at normal everyday amounts, spread across meals.\n"
            "- Add ONE gentle line telling the client protein should stay "
            "moderate and the exact amount is best confirmed with their "
            "doctor.\n"
        )

    low, high = target["low_g"], target["high_g"]
    src = _pick_protein_source(client, plan)
    powder = src["display"]
    if src["dairy_free"]:
        eats_eggs = "egg" in str(client.get("dietary_preference") or "").lower()
        food_sources = (
            "dal and whole legumes, tofu, sattu (roasted chana), nuts and "
            "seeds" + (", and eggs" if eats_eggs else "")
        )
        mix_into = "a smoothie or plant-milk"
    else:
        food_sources = (
            "dal and whole legumes, paneer and curd, eggs (if eaten), tofu, "
            "sattu (roasted chana), nuts and seeds"
        )
        mix_into = "curd, milk or a smoothie"

    return (
        f"PROTEIN TARGET — {low}-{high} g per day:\n"
        "Most Indian vegetarian clients under-eat protein. Build the meal "
        f"plan so the day's FOOD delivers as much of the {low}-{high} g "
        "target as realistically possible — protein at EVERY meal.\n"
        f"- Food first: lean on {food_sources}.\n"
        "- Note the approximate protein (in grams) beside each main meal so "
        f"the client can see the day adding up toward {low}-{high} g.\n"
        "- ONLY if the day's food still falls short, add ONE short line "
        f"recommending a protein-powder top-up: {powder} — about one "
        f"unflavoured scoop (~25 g protein) stirred into {mix_into}. Frame "
        "it as a gap-filler, not a meal replacement, and never as a "
        "'shake'.\n"
        "- Do NOT name a specific brand.\n"
    )


def _portion_control_block(kcal_total: int = 0) -> str:
    """Explicit per-meal portion guidance for weight-loss letters — the
    'visible reference plate' + measured portions. Portions are the
    mechanism that turns a calorie target into actual plates, so EVERY
    weight-loss meal-plan letter (consolidated, meal_plan, phase) must
    carry this box, not just the phase letter. Coach requirement
    2026-05-20. The plate proportions and measured portions are constant;
    only the headline kcal number varies by phase."""
    header = (
        f"PORTION CONTROL FOR WEIGHT LOSS — {kcal_total} kcal/day target:"
        if kcal_total
        else "PORTION CONTROL FOR WEIGHT LOSS:"
    )
    return f"""{header}
Visible reference plate (every meal should look like this):
  • Half the plate = non-starchy veg (cooked or raw — 2 fist-sized portions)
  • Quarter of the plate = protein (1 palm-size = ~25-30g)
  • Quarter of the plate = whole grains or starchy veg (1 cupped-hand = ~30g cooked)
  • Healthy fat = 1 thumb-size (1 tsp ghee / 1 tbsp seeds / 10 nuts)
Specific portions to MEASURE (not guess):
  • Rice / millet / quinoa: ½ cup cooked = ~100 kcal
  • Dal / kidney beans cooked: ¾ cup = ~150 kcal
  • Paneer: 50g cube = ~130 kcal (palm-size)
  • Ghee: 1 tsp = 45 kcal (NOT a tablespoon)
  • Nuts/seeds: 1 small handful = ~150 kcal (NOT a bowl)
  • Fruit: 1 medium piece OR 1 cup berries = ~80 kcal
INCLUDE this portion guidance as its own clearly-marked callout box in
the letter (heading: "🍽 Portion Guide") so the client has a reference
they can look at while plating each meal. This box is REQUIRED for every
weight-loss plan.
"""


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

    # 🚨 Allergies — promoted from profile-only into TOP-OF-MIND with the same
    # NEVER framing as reported triggers. Anaphylactic risk doesn't get to
    # live in a footer the AI might gloss over.
    allergies = client.get("known_allergies") or client.get("allergies") or []
    if isinstance(allergies, list) and allergies:
        bullets.append(
            f"- 🚨 Known ALLERGIES (NEVER suggest — anaphylactic / hypersensitivity risk): {', '.join(allergies)}"
        )

    conditions = client.get("active_conditions") or []
    if conditions:
        bullets.append(f"- Active conditions: {', '.join(conditions)}")

    # 📋 Medical history (past diagnoses + current state, e.g. "Hashimoto's
    # diagnosed 2018, antibodies normalised, on levothyroxine"). Distinct
    # from active_conditions — these are background facts the recommendations
    # must respect (e.g., cholecystectomy → low-fat caveat; UC remission →
    # avoid trigger foods even when not currently flaring).
    med_hx = client.get("medical_history") or []
    if isinstance(med_hx, list) and med_hx:
        bullets.append(f"- 📋 Medical history (respect when planning): {', '.join(med_hx[:5])}")
    elif isinstance(med_hx, str) and med_hx.strip():
        bullets.append(f"- 📋 Medical history (respect when planning): {med_hx.strip()[:240]}")

    # 🧬 Family history — drives preventive nutrition emphasis (T2D parent →
    # low-glycaemic emphasis; CVD parent → cardiometabolic; breast Ca →
    # cruciferous + lignans; osteoporosis → bone-supportive).
    fam_hx = (client.get("family_history") or "").strip()
    if fam_hx:
        bullets.append(f"- 🧬 Family history (preventive emphasis): {fam_hx[:240]}")

    meds = client.get("current_medications") or []
    if meds:
        bullets.append(f"- Medications (check interactions): {', '.join(meds)}")

    # 🟠 HISTAMINE-AWARE OVERLAY — fires when client shows histamine-sensitivity
    # signals (chronic antihistamine use, eczema/dermatitis baseline,
    # MCAS / DAO / methylation flags). Indian-context food exclusions
    # baked in. Catalogue rule:
    #   claims/histamine-sensitive-clients-need-low-histamine-meal-plans
    # Surfaced after a real client flare (cl-006 / Geetika, 2026-05-17):
    # ragi dosa landed on top of pre-existing Allegra + eczema baseline →
    # skin itching. Meal plan defaults should pre-empt this.
    if _has_histamine_signal(client):
        bullets.append(
            "- 🟠 HISTAMINE-AWARE OVERLAY — client shows histamine-sensitivity signals "
            "(antihistamine medication, eczema/dermatitis, or MCAS/DAO/methylation flags). "
            "Default the meal plan to a LOW-HISTAMINE framework for 6–8 weeks: "
            "(a) NO ragi (finger millet — fermenting grain), NO ragi dosa/idli/ambali; "
            "(b) NO cherry tomatoes or tomatoes generally — substitute pumpkin, bottle gourd, beetroot for sauces; "
            "(c) NO fermented foods (idli/dosa batter aged >24h, sauerkraut, kimchi, kombucha, vinegar pickles, soy sauce, miso); "
            "(d) NO aged cheese, NO leftover proteins (>24h refrigerated) — cook fresh same day; "
            "(e) NO citrus, chocolate, alcohol, vinegar dressings, smoked/cured meats, spinach, brinjal/eggplant; "
            "(f) PREFER fresh proteins same-day, low-histamine grains (basmati rice, quinoa, oats, jowar/sorghum, bajra), "
            "fresh herbs over aged spice blends. Frame as a 6–8 week reset, not 'forever'."
        )

    # 🤰 Pregnancy / lactation safety overlay — protocol-gating. Hides high-
    # mercury fish, raw sprouts, unpasteurised dairy, liver organ meats,
    # adaptogens (ashwagandha, holy basil), and certain bitters from any
    # meal plan or supplement schedule. The AI is told below to apply the
    # pregnancy-safe rule set when this flag is set.
    preg_status = (client.get("pregnancy_status") or "").strip()
    if preg_status and preg_status not in ("not_applicable", "not_pregnant", ""):
        bullets.append(
            f"- 🤰 PREGNANCY / LACTATION SAFETY OVERLAY — status: {preg_status.replace('_', ' ')}. "
            "Apply pregnancy-safe rules: NO high-mercury fish (king mackerel, swordfish, tilefish, bigeye tuna), "
            "NO raw sprouts, NO unpasteurised dairy or soft cheeses, NO liver / organ meats (Vit A excess), "
            "NO ashwagandha / holy basil / licorice / pennyroyal / blue cohosh, "
            "limit caffeine to ≤200mg/day, NO alcohol. Folate + iron + DHA emphasis."
        )
    lact_started = (client.get("lactation_started") or "").strip()
    if lact_started and not preg_status:
        bullets.append(
            f"- 🍼 LACTATING (started {lact_started}) — galactagogue-supportive foods OK "
            "(fenugreek, fennel, oats); avoid sage, peppermint (oversupply risk), and ashwagandha."
        )

    # 🧪 Out-of-range lab markers — when lab_reference_ranges are set on the
    # client, compare each lab_marker to its range and surface only the ones
    # that are abnormal. Drives meal-plan emphasis (high HbA1c → low GL,
    # low ferritin → iron-rich foods, low Vit D → fortified + sun exposure,
    # high homocysteine → folate / B12 emphasis, etc.). When no ranges are
    # configured we still surface the top 5 markers so AI has data to work
    # with — the AI is FM-trained and knows the optimal ranges.
    markers = client.get("lab_markers") or []
    ranges = client.get("lab_reference_ranges") or {}
    if isinstance(markers, list) and markers:
        abnormal_lines: list[str] = []
        normal_count = 0
        for m in markers[:25]:
            if not isinstance(m, dict):
                continue
            mname = m.get("marker") or m.get("name") or ""
            mval = m.get("value")
            munit = m.get("unit") or ""
            if not mname or mval is None:
                continue
            rng = ranges.get(mname) if isinstance(ranges, dict) else None
            if isinstance(rng, dict):
                try:
                    lo = float(rng.get("optimal_low")) if rng.get("optimal_low") is not None else None
                    hi = float(rng.get("optimal_high")) if rng.get("optimal_high") is not None else None
                    v = float(mval)
                    if (lo is not None and v < lo) or (hi is not None and v > hi):
                        direction = "low" if (lo is not None and v < lo) else "high"
                        abnormal_lines.append(
                            f"  · 🔴 {mname}: {v} {munit} ({direction}; optimal {lo or '—'}–{hi or '—'})"
                        )
                    else:
                        normal_count += 1
                except (TypeError, ValueError):
                    pass
        if abnormal_lines:
            bullets.append(
                "- 🧪 Lab markers FLAGGED (drive meal choices to address these):\n"
                + "\n".join(abnormal_lines[:8])
                + (f"\n  · ✅ {normal_count} other markers within optimal" if normal_count else "")
            )
        elif not ranges:
            # No FM ranges configured — surface the most recent 5 markers raw
            # so AI has visibility even without our optimal annotations.
            raw_lines = []
            for m in markers[:5]:
                if isinstance(m, dict):
                    raw_lines.append(f"  · {m.get('marker', '?')}: {m.get('value', '?')} {m.get('unit', '')}")
            if raw_lines:
                bullets.append(
                    "- 🧪 Recent lab markers (no FM ranges set — interpret per FM optimal):\n"
                    + "\n".join(raw_lines)
                )

    # FM body-systems intake — only show fields with substance. These are
    # the deep intake prose fields the coach captures during onboarding.
    # Important for nuance: digestion_notes shapes meal textures + fermented
    # food tolerance; sleep_notes drives caffeine cutoff + carb timing;
    # stress_response informs adaptogen + nervine choices.
    body_systems = [
        ("💩 Digestion", client.get("digestion_notes")),
        ("😴 Sleep", client.get("sleep_notes")),
        ("⚡ Energy pattern", client.get("energy_pattern")),
        ("🌙 Menstrual / hormonal", client.get("menstrual_notes")),
        ("🌀 Stress response", client.get("stress_response")),
        ("👶 Childhood history", client.get("childhood_history")),
        ("☣ Toxic exposures", client.get("toxic_exposures")),
    ]
    body_sys_lines: list[str] = []
    for label, val in body_systems:
        if isinstance(val, str) and val.strip():
            body_sys_lines.append(f"  · {label}: {val.strip()[:180]}")
    if body_sys_lines:
        bullets.append("- 🩺 FM body-systems intake (refer to these when relevant):\n" + "\n".join(body_sys_lines))

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

    # AI-summarised intake insights (v0.72). Generated once after intake
    # submit; surface here so the letter generator references the same
    # clinical map as every other AI call. Coach-edited corrections in
    # coach_notes_for_ai are appended too — those override AI inference
    # without needing a full regenerate.
    insights = client.get("intake_insights")
    if insights and isinstance(insights, dict):
        # Fix B 2026-05-23 — ROOT CAUSE leads. Letter generator frames
        # downstream conditions as "will improve as we address X" instead
        # of stacking 10 parallel protocols.
        rc = insights.get("root_cause")
        if rc and isinstance(rc, dict) and (rc.get("label") or "").strip():
            rc_label = str(rc.get("label", "")).strip()
            rc_reasoning = str(rc.get("reasoning", "")).strip()
            downstream = rc.get("downstream_effects") or []
            line = f"- 🎯 ROOT CAUSE (anchor the letter here): {rc_label}"
            if rc_reasoning:
                line += f" — {rc_reasoning[:280]}"
            bullets.append(line)
            if isinstance(downstream, list) and downstream:
                bullets.append(
                    "- ↪ Downstream (frame as 'will improve as we address the root', NOT as parallel targets): "
                    + "; ".join(str(d) for d in downstream[:5])
                )
        red_flags = insights.get("red_flags") or []
        if red_flags:
            bullets.append(
                "- ⚠ Intake red flags (protocol-gating): "
                + "; ".join(red_flags[:4])
            )
        patterns = insights.get("patterns") or []
        if patterns:
            bullets.append(
                "- 🧬 Intake patterns: "
                + "; ".join(patterns[:3])
            )
        hyps = insights.get("top_hypotheses") or []
        if hyps:
            hyp_strs = []
            for h in hyps[:2]:
                if isinstance(h, dict):
                    hyp_strs.append(h.get("driver", "?"))
            if hyp_strs:
                bullets.append(f"- 🎯 Top FM hypotheses: {' · '.join(hyp_strs)}")
        coach_notes = (insights.get("coach_notes_for_ai") or "").strip()
        if coach_notes:
            bullets.append(f"- ✍ Coach correction / addition (overrides AI): {coach_notes[:220]}")

    # v0.74 — drug-derived protocol cautions (hard constraints from
    # medications). Surface them inside top-of-mind so every letter type
    # inherits the constraints without needing per-builder wiring.
    cautions = _load_drug_cautions_for_client(client)
    drug_block = _format_drug_cautions_block(cautions)

    # v0.75.8 — triad-aware constraint block (MCAS / POTS / EDS / PEM /
    # mould). Detected from plan topics + attached protocols + intake
    # signals + coach-verified findings. Same wovenness — every letter
    # type inherits the constraints via top_of_mind.
    triad_triggers = _detect_triad_topics(plan, client)
    triad_block = _format_triad_constraints_block(triad_triggers)

    if not bullets and not drug_block and not triad_block:
        return ""

    body = "\n".join(bullets)
    return f"""
═══════════════════════════════════════════════════════════
THIS CLIENT — TOP-OF-MIND ({first_name}'s specifics):
═══════════════════════════════════════════════════════════
{body}
═══════════════════════════════════════════════════════════
{drug_block}
{triad_block}

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
        # Plain string (not f-string) — the literal "{first_name}" inside is
        # a placeholder for the .replace() at the bottom. Using an f-string
        # here would make Python try to interpolate {first_name} at parse
        # time and crash with NameError before .replace() ever runs.
        return """
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
def _start_when_block(plan: dict, scope: str) -> str:
    """Frame the start-of-protocol timing for the client.

    Coaches send plans on day X but clients don't start on day X — empirically
    +3d for the meal plan (grocery shop, prep, settle in) and +7d for
    supplements (have to be ordered + delivered + habit-built).

    Coach can capture the actual start date in plan.meal_plan_started_on /
    plan.supplements_started_on; otherwise we use plan_period_start + the
    default delays. This block is injected into all 4 letter prompts so the
    client understands the timeline labels are RELATIVE to their personal
    Day 1, not the date the letter landed in their inbox.

    scope: 'meal' | 'supplement' | 'both' — controls which dates appear.
    """
    from datetime import datetime as _dt, timedelta as _td

    def _coerce_date(v):
        if v is None or v == "":
            return None
        if isinstance(v, str):
            try:
                return _dt.fromisoformat(v[:10]).date()
            except Exception:
                return None
        if hasattr(v, "year"):  # date / datetime
            return v.date() if isinstance(v, _dt) else v
        return None

    period_start = _coerce_date(plan.get("plan_period_start"))
    meal_actual = _coerce_date(plan.get("meal_plan_started_on"))
    supp_actual = _coerce_date(plan.get("supplements_started_on"))

    if period_start is None:
        # No start info at all — give a soft "start when you're ready" framing.
        if scope == "meal":
            return "TIMING NOTE: Week 1 of this meal plan starts whenever the client is ready — typically 2–3 days after receiving this letter, to allow time for grocery shopping and prep. The week numbering is RELATIVE to her Day 1, not the date she received this letter."
        if scope == "supplement":
            return "TIMING NOTE: The supplement Week 1 starts when she's received her supplements and is ready to begin — typically about 1 week after this plan is sent. The week numbering is RELATIVE to her Day 1, not the date she received this plan."
        return "TIMING NOTE: Week 1 of this plan starts when the client is ready — give 2–3 days for the meal plan to settle in, and about 1 week before she expects supplements to arrive. All week numbering is RELATIVE to her personal Day 1, not the date the plan was sent."

    meal_eff = meal_actual or (period_start + _td(days=3))
    supp_eff = supp_actual or (period_start + _td(days=7))

    def _human(d) -> str:
        # "Monday 19 May 2026" — warm format for the client-facing letter.
        return d.strftime("%A %-d %B %Y") if hasattr(d, "strftime") else str(d)

    # Coach-facing pushback instruction — woven into the AI prompt so the
    # letter explicitly names the start date AND invites the client to
    # message back if it doesn't suit her. The webhook (once configured)
    # parses replies starting with "START:" or "✅ Start:" / "📅 Start:"
    # and auto-updates plan.meal_plan_started_on via the start-date parser
    # in src/lib/start-date-parser.ts. Until the webhook is live the coach
    # reads the inbox and updates manually via PlanStartDatesPanel.
    pushback_meal_instruction = (
        "GREETING REQUIREMENT — name the start date EXPLICITLY: write a sentence like "
        f"\"I've set your Day 1 for **{_human(meal_eff)}** — that gives you the weekend "
        f"to grocery shop and settle in.\" Then in the SAME paragraph, invite pushback "
        f"warmly: \"If that day doesn't suit you, just reply to this WhatsApp with the "
        f"date you'd prefer and I'll shift everything.\" The date must appear in BOLD. "
        f"Do not skip this — the client needs to see the date and know she can change it."
    )
    pushback_supp_instruction = (
        "ADDITIONAL: warmly tell her to message back the day her supplements actually "
        f"arrive (e.g. \"Once they land, just reply with 'supplements arrived' and I'll "
        f"start the count from that day.\") so we can update Day 1 for the supplement protocol."
    )

    if scope == "meal":
        if meal_actual:
            return (
                f"TIMING NOTE: Client confirmed she actually started the meal plan on "
                f"{_human(meal_eff)}. Week 1 is the week beginning that date — write "
                f"the letter as though Week 1 begins on her Day 1, not today. Mention "
                f"the date warmly in the greeting (\"Now that Day 1 is locked in for "
                f"{_human(meal_eff)}...\") but DON'T re-invite pushback (it's already "
                f"confirmed)."
            )
        return (
            f"TIMING NOTE: Plan sent {period_start.isoformat()}. Empirically clients start "
            f"the meal plan ~3 days later — Week 1 begins ~{_human(meal_eff)}.\n"
            f"\n"
            f"{pushback_meal_instruction}\n"
            f"\n"
            f"All week numbering throughout the letter is RELATIVE to her Day 1, not today.\n"
            f"\n"
            f"USE-DATES-NOT-WEEKS RULE (coach feedback 2026-05-29): for any "
            f"sentence the CLIENT reads, use specific calendar dates "
            f"(e.g. \"Sun {_human(meal_eff).split(' ', 1)[1] if ' ' in _human(meal_eff) else _human(meal_eff)}\"), "
            f"NEVER bare \"Week N\" phrasing. Clients don't track week numbers in their "
            f"head — they navigate by calendar dates. Acceptable: \"Sun 24 May "
            f"(start of Week 2)\". UNACCEPTABLE: just \"Week 2\" with no date anchor. "
            f"Week numbers are coach-facing shorthand; the client letter must "
            f"spell out the actual dates every time."
        )

    if scope == "supplement":
        if supp_actual:
            return (
                f"TIMING NOTE: Client confirmed she started supplements on "
                f"{_human(supp_eff)}. Week 1 of the supplement protocol begins that date — "
                f"name the date warmly in the greeting and frame timeline labels RELATIVE."
            )
        return (
            f"TIMING NOTE: Plan sent {period_start.isoformat()}. Supplements typically take "
            f"~1 week to arrive — Day 1 best framed as ~{_human(supp_eff)}.\n"
            f"\n"
            f"GREETING REQUIREMENT — name the date EXPLICITLY: \"I've pencilled in "
            f"**{_human(supp_eff)}** as the day your supplements should arrive and you'll "
            f"begin.\" {pushback_supp_instruction}\n"
            f"\n"
            f"All supplement week numbering is RELATIVE to her Day 1."
        )

    # scope == 'both'
    meal_line = (
        f"  - **Meal plan Day 1**: {_human(meal_eff)} "
        f"({'coach-confirmed' if meal_actual else 'default +3d for grocery shop / prep'})"
    )
    supp_line = (
        f"  - **Supplements Day 1**: {_human(supp_eff)} "
        f"({'coach-confirmed' if supp_actual else 'default +7d for order / delivery'})"
    )
    pushback_block = ""
    if not meal_actual:
        pushback_block += "\n\n" + pushback_meal_instruction
    if not supp_actual:
        pushback_block += "\n\n" + pushback_supp_instruction
    return (
        f"TIMING NOTE: Plan sent {period_start.isoformat()}. The week numbering throughout "
        f"this document is RELATIVE to her personal Day 1, not the date she received this letter.\n"
        f"\n"
        f"{meal_line}\n"
        f"{supp_line}{pushback_block}"
    )


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

NO TITRATE LANGUAGE — Coach rule 2026-05-23. Clients don't have a scale
and don't dose in milligrams — they buy capsules of fixed strengths.
NEVER tell a client to "titrate up by N mg" or "increase by X mg every
3 nights". Use PILL-COUNT language instead:
  - BAD: "Start 200 mg, titrate up by 100 mg every 3 nights to 400 mg."
  - GOOD: "Start with 1 capsule (200 mg) at bedtime. If stools are still
    hard after 3 nights, add a second capsule. Most people land on
    1–2 capsules. Message me if you're unsure."
The coach's titration intent stays in plan.notes_for_coach — never
surface mg-level titration to the client. Same rule for back-off:
  - BAD: "Back off one step if stool turns loose."
  - GOOD: "If stools become too loose, drop back to 1 capsule and
    message me."

SEASONAL GRAIN RULE — India-specific, non-negotiable:
Bajra (pearl millet) is a WINTER grain (Nov–Feb). It generates internal
heat (Ayurvedic: heating, agni-increasing). NEVER recommend bajra during
April–September (summer + monsoon). This includes bajra roti, bajra
khichdi, bajra bhakri.

Summer-appropriate grains (March–September) — use these instead:
  - Jowar / sorghum (primary swap — cooling, low GI, ideal for IR/diabetes)
  - Sama / barnyard millet (cooling, light, good for gut-sensitive clients)
  - Foxtail millet (neutral-cooling, versatile)
  - Kodo millet (neutral, easy to digest)
  - Ragi (cooling in Ayurveda — appropriate year-round in South India,
    use in moderation in North Indian summer as it is dense)

GRAIN ROTATION RULE: Never repeat the same grain at both lunch and
dinner on the same day. Rotate across at least 3 different grains across
the week — do not default to jowar roti for every meal (common failure
mode: every lunch AND dinner becomes jowar roti). Use rice, sama, kodo,
foxtail, ragi, and jowar in rotation.
"""


def _coach_notes_block(coach_notes: str) -> str:
    """Wrap freeform coach notes + the structured SPECIAL REQUESTS block
    (from the SendPackageButton panel) into a single prompt section. When
    a 🧳 TRAVEL line is detected, force the AI to render a dedicated
    "Travel week" subsection in the meal plan with restaurant-ordering
    rules for the named destination — cost ~2¢ for a much more useful
    artifact (coach decision log 2026-05-15)."""
    if not coach_notes:
        return ""
    has_travel = "🧳 TRAVEL" in coach_notes or "Travel:" in coach_notes
    has_structured = "=== SPECIAL REQUESTS ===" in coach_notes
    if has_structured:
        instr = (
            "COACH'S SPECIAL REQUESTS + CUSTOM KNOWLEDGE — these are PROTOCOL-"
            "GATING. The structured block below carries (a) meal preference "
            "chips to honour throughout the plan (e.g. eggs at breakfast, IF "
            "until 11am — apply EVERY relevant day), (b) optional TRAVEL "
            "window with destination + cooking-access flag, (c) any freeform "
            "additions. Weave them naturally — don't dump in one place."
        )
    else:
        instr = "COACH'S CUSTOM KNOWLEDGE (weave naturally into the relevant sections):"
    travel_rule = (
        "\n\nTRAVEL HANDLING — a 🧳 TRAVEL block IS present in the requests above.\n"
        "Insert a clearly-labelled '## 🧳 Travel week: <destination> (<dates>)' "
        "subsection inside the meal plan (right after the regular week tables for "
        "those dates). Include:\n"
        "  - 6-10 specific dishes the client can ORDER at restaurants in the "
        "named destination that fit her protocol (respect allergies, dietary "
        "preference, reported triggers, glycaemic load for diabetes / IR clients, "
        "pregnancy-safety overlay if active).\n"
        "  - 2-3 common local dishes to AVOID, with a one-line why each.\n"
        "  - Travel-specific hydration + meal-timing guidance (jet lag, long flights).\n"
        "  - If cooking access = 'restaurants only': skip the daily-table grid for "
        "those exact dates and replace with a 'flexible ordering' card. If 'can "
        "cook' or 'mixed': keep simplified versions of usual meals (~3-4 ingredient).\n"
        "Stay warm and practical — no lectures.\n"
    ) if has_travel else ""
    return f"""
{instr}
{coach_notes}
{travel_rule}
Use these tips in the RELEVANT meal / lifestyle / lab section — don't dump them all in one place. Make them feel like natural personalised advice, not bolted-on notes.
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
    grain_seasonality = _seasonality_block(_month, country)
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

    # Weight-loss plans MUST carry an explicit portion guide — the
    # mechanism that turns the calorie target into actual plates.
    portion_block = _portion_control_block(cal["phases"]["wk1_2"]) if cal else ""
    protein_block = _protein_guidance_block(client, plan)

    coach_notes_block = _coach_notes_block(coach_notes)

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)
    start_when = _start_when_block(plan, "meal")
    # Between-session client/coach voice — pulled live from the last 14
    # days of session files. When the client has been WhatsApping the
    # coach about adherence problems, food triggers, travel, etc., this
    # block carries that signal into the meal-plan prompt so the next
    # week's menu reflects it WITHOUT needing a full reassessment.
    recent_voice = _recent_client_voice_block(client.get("client_id") or "")

    prompt = f"""You are writing a warm, friendly {plan_weeks}-week MEAL PLAN document for a client.
The coach (Shivani Hariharan) has prepared a structured plan. Turn the nutrition data into a beautiful, practical meal plan the client can actually USE.

{top_of_mind}
{cycle}
{attached_protocol}
{start_when}
{recent_voice}
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
{portion_block}
{protein_block}

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

2b. **How to swap meals** — `## 🔁 How to use this plan`
   Insert this short, warm box (≤ 8 lines, plain English) so {first_name} knows the rules of swapping BEFORE she reads the tables. Use bullets. Cover EXACTLY these rules and no more:
   - You can swap a meal with the SAME meal on a different day in the same week. (e.g. if you'd rather have Wednesday's breakfast on Monday, just swap them — eat eggs both days if you like, and shift the ragi porridge to Wednesday.)
   - You can NOT swap across meal slots — don't move breakfast into the lunch column or dinner into breakfast. The slot matters because each meal's nutrient density and timing are designed together (e.g. breakfast is the lower-glycaemic anchor, dinner is lighter).
   - If something doesn't fit your week, repeat a meal you liked from the same slot earlier in the week rather than skipping. Two breakfasts of eggs in a week is fine; eggs at dinner is not.
   - Mid-morning, evening, and bedtime snacks follow the same rule — they're independent slots, not "spare" meals.
   - If you genuinely can't eat what's on the plan for a meal slot, fall back to a simple safe option: dal + sabzi + 1 roti for lunch/dinner; oats + nuts for breakfast.

   Keep the tone soft — this is freedom + structure, not rigidity.

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

8. **Sign-off** — TWO LINES ONLY: "**With warmth,**" / "**Shivani** 🌿".
   Do NOT add another "A note from your coach" section — the entire
   letter is already written FROM Shivani TO the client, so a closing
   note would just repeat what's above. End cleanly.

RULES:
- NO supplement tables or lists (see separate supplement document)
- SEASONAL produce for {location_str}, current season: {season}

{grain_seasonality}

- Respect dietary preference ({diet_pref}), avoid ({foods_to_avoid})
- CRITICAL: NEVER suggest foods listed as reported triggers: {reported_triggers}
- No clinical jargon — write like a knowledgeable friend
- If Vegetarian Jain: NO root vegetables (onion, garlic, potato, carrot, beetroot, radish, turnip)
- {"INCLUDE a *~kcal* row at the bottom of each weekly table with the per-day total (±50 kcal of the phase target)." if cal else "DO NOT add a *~kcal* row or any per-day calorie totals — this client is NOT on a weight-loss plan. Calorie counts are off-topic and create unnecessary anxiety."}

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

    coach_notes_block = _coach_notes_block(coach_notes)

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)
    start_when = _start_when_block(plan, "supplement")
    # Pull recent check-ins / coach observations / inbound client voice so
    # supplement letters reflect the latest clinical state (dose drops,
    # tolerance issues, travel windows). See _recent_client_voice_block
    # for full rationale.
    recent_voice = _recent_client_voice_block(client.get("client_id") or "")

    prompt = f"""You are writing a short supplement protocol introduction letter for a client.

{top_of_mind}
{cycle}
{attached_protocol}
{recent_voice}
{start_when}
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
    tracking_symptoms = _stringify_list(tracking.get("symptoms_to_monitor"))
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

    coach_notes_block = _coach_notes_block(coach_notes)

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)
    start_when = _start_when_block(plan, "both")
    # Pull recent check-ins / coach notes / inbound client voice so the
    # lifestyle guide reflects the latest clinical state.
    recent_voice = _recent_client_voice_block(client.get("client_id") or "")

    prompt = f"""You are writing a warm, practical {plan_weeks}-week COACHING PLAN for a client — covering lifestyle, learning, labs, and tracking.
This document is the companion to the meal plan and supplement plan. It covers everything EXCEPT food and supplements.
The coach (Shivani Hariharan) has prepared the structured data below.

{top_of_mind}
{cycle}
{attached_protocol}
{recent_voice}
{start_when}
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
   Present the lab orders in plain English ("Ask your doctor for...").
   Group FIRST by sample type so {first_name} knows exactly what to give on
   the day (one blood draw vs collect-at-home stool kit vs urine 24-hr vs
   breath test vs saliva). Use these subheadings IN THIS ORDER, skipping any
   that have no tests:
     ### 🩸 Blood draw — single visit
     ### 💩 Stool sample (collect at home)
     ### 💧 Urine (spot or 24-hr — instructions per test)
     ### 🌬️ Breath test (at clinic, ~2-3 hours)
     ### 🧪 Saliva
     ### 🩻 Imaging / scans (separate appointment)
   Under each subheading, give the test name, what it reveals (one sentence),
   and any prep ("fasting 10-12 hrs", "morning sample", "before any antibiotic").
   At the end, add a tiny "When to time these" line summarising baseline vs
   mid-plan vs end-of-plan ordering — don't repeat the full list, just say
   things like "Most are baseline; SIBO breath retest at 12 weeks."

7. **What to Track** — `## 📊 What to Track`
   Present tracking habits and symptoms as a simple daily/weekly check-in framework. Use bullet lists. Frame as curiosity, not pressure.

8. **Your Check-In Questions** — `## 💬 Your Check-In Questions`
   Questions {first_name} should reflect on before each coaching session. Include both provided recheck questions and 3–4 general wellbeing prompts.

9. **Sign-off** — TWO LINES: "**With warmth,**" / "**Shivani** 🌿".
   No separate "A note from coach" section — letter is already FROM her.

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

    coach_notes_block = _coach_notes_block(coach_notes)

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)
    # Pull recent check-ins / coach notes / inbound client voice so the
    # exercise plan reflects current state (injuries, pacing limits, travel).
    recent_voice = _recent_client_voice_block(client.get("client_id") or "")

    prompt = f"""You are writing a warm, practical {plan_weeks}-week DETAILED EXERCISE PLAN
for a client who has explicitly asked for the depth. Most clients get a simple
weekly schedule inside their wellness letter; this document is for those who
want a real, progressive movement programme.

{top_of_mind}
{cycle}
{attached_protocol}
{protocol_changes}
{recent_voice}
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

10. **Sign-off** — TWO LINES: "**With warmth,**" / "**Shivani** 🌿".
    No separate "A note from coach" — letter is already FROM her.

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


def _build_prompt_recipes(plan: dict, client: dict, coach_notes: str) -> str:
    """Standalone recipe pack — full ingredients + method for every ✦ dish
    referenced from the meal-plan tables.

    Served publicly at /recipes/<planSlug>. Split out of the consolidated
    letter post-reformat: the main letter stays under 7 pages, the recipe
    pack lives as a separate reference doc the client opens in the
    kitchen.

    Read priority for source dishes:
      1. plan.recipes_to_include (explicit list — coach can pin specific
         dishes)
      2. dishes mentioned in the saved meal_plan letter (extracted from
         the 7-day tables)
      3. AI picks ~12-20 dishes that fit the dietary preference + season

    We pass the saved meal_plan markdown verbatim (when present) so the
    AI grounds recipes to what's actually in the table — not invents new
    dishes the client never sees.
    """
    client_name = client.get("display_name") or "the client"
    first_name = client_name.split()[0] if client_name else "there"
    diet_pref = client.get("dietary_preference") or "Not specified"
    _foods_to_avoid_raw = client.get("foods_to_avoid") or ""
    _reported_triggers_raw = client.get("reported_triggers") or ""
    _exclusion_parts = [p.strip() for p in [_foods_to_avoid_raw, _reported_triggers_raw] if p.strip()]
    foods_to_avoid = ", ".join(_exclusion_parts) if _exclusion_parts else "None mentioned"
    reported_triggers = _reported_triggers_raw or "None reported"
    city = client.get("city") or ""
    country = client.get("country") or "India"
    location_str = ", ".join(filter(None, [city, country])) or "India"

    coach_notes_block = _coach_notes_block(coach_notes)
    top_of_mind = _top_of_mind_block(client, plan)
    # Pull recent check-ins / coach notes / inbound client voice so the
    # recipe pack reflects current state (food likes/dislikes from check-in,
    # new sensitivities, travel context affecting cooking access).
    recent_voice = _recent_client_voice_block(client.get("client_id") or "")

    # Pull the saved meal-plan markdown if available so the recipe pack
    # matches what the client actually sees in the meal tables.
    import os as _os
    plan_slug = plan.get("slug") or ""
    client_id = plan.get("client_id") or ""
    home = _os.path.expanduser("~")
    candidate_paths = [
        f"{home}/fm-plans/clients/{client_id}/meal-plans/{plan_slug}-meal_plan.md",
        f"{home}/fm-plans/clients/{client_id}/meal-plans/{plan_slug}.md",
    ]
    meal_plan_md = ""
    for p in candidate_paths:
        try:
            with open(p, "r", encoding="utf-8") as f:
                meal_plan_md = f.read()
            break
        except FileNotFoundError:
            continue

    meal_plan_context = ""
    if meal_plan_md:
        # Trim to the meal-plan tables block to keep prompt tight.
        snippet = meal_plan_md[:8000]
        meal_plan_context = (
            "MEAL PLAN ALREADY GENERATED FOR THIS CLIENT (extract every ✦ dish you can find and write a recipe for it):\n"
            "---\n"
            f"{snippet}\n"
            "---\n\n"
        )

    pinned = plan.get("recipes_to_include") or []
    pinned_block = ""
    if isinstance(pinned, list) and pinned:
        pinned_block = (
            "COACH-PINNED RECIPES (MUST include these, in addition to ✦ dishes from the meal plan above):\n"
            + "\n".join(f"  - {p}" for p in pinned)
            + "\n\n"
        )

    prompt = f"""You are writing a warm, practical RECIPE PACK for one client. This is the
companion document to their meal plan. The client opens it on their phone
while cooking — so format must be SCANNABLE, ingredients listed clearly,
method as numbered steps, no clinical jargon.

{top_of_mind}
{recent_voice}
{_BANNED_GENERIC_RULE}

CLIENT PROFILE:
- Name: {client_name} (address as {first_name} only if needed; mostly just write recipes)
- Location: {location_str}
- Dietary preference: {diet_pref}
- Foods to avoid: {foods_to_avoid}
- Reported triggers (NEVER include): {reported_triggers}

{coach_notes_block}
{pinned_block}{meal_plan_context}WHAT TO PRODUCE — a single Markdown document with these sections:

1. **Header note** — 1 short paragraph (3-4 sentences). Welcome
   {first_name} to the recipe pack, tell them to bookmark it on their
   phone, mention that ✦ in their meal plan refers to recipes here.

2. **Recipe index** — a single Markdown list with one line per recipe:
   ```
   - [Ragi dosa with coconut chutney](#ragi-dosa-with-coconut-chutney)
   - [Methi paratha with curd](#methi-paratha-with-curd)
   ```
   Helps the client jump to the recipe they need.

3. **Recipes** — one `### ✦ Recipe Name` heading per recipe, then:

   ### ✦ Recipe Name
   **Serves:** 1–2 | **Time:** X min | **Best at:** breakfast / lunch / dinner / snack

   **Ingredients:**
   - Item 1 — quantity (substitute if needed)
   - Item 2 — quantity
   - …

   **Method:**
   1. First step (specific — temperatures, times)
   2. Second step
   3. …

   **Tip:** (optional — one line on storage, prep-ahead, swap idea, or
   why this recipe is good for {first_name}'s condition.)

RULES:
- 12–20 recipes minimum. Cover every ✦ dish in the meal plan above
  PLUS any pinned recipes from the coach.
- All recipes MUST respect dietary preference ({diet_pref}) and avoid
  the foods listed above. Reported triggers ({reported_triggers}) are
  HARD bans — never appear in any recipe.
- Use specific Indian dish names where applicable. For non-Indian
  context (UK / US clients), use locally-familiar names.
- Ingredient quantities in grams + cups / tablespoons / teaspoons —
  whichever is more natural for that dish.
- Method steps short. Each step ≤ 2 sentences.
- DO NOT include nutrition tables, macro breakdowns, or kcal counts
  per recipe.
- DO NOT include shopping lists or sourcing notes (those live elsewhere).
- Sort recipes alphabetically by name.

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
    grain_seasonality = _seasonality_block(_month, country)

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

    # Active supplements — classified by phase relationship:
    #   • continuing — supplements the client has been taking since wk 1
    #   • introducing — first appears in the current phase window
    #   • titrating_up — phase-N dose differs from the prior dose
    # The AI prompt below references continuing supplements as a backdrop
    # ("alongside your magnesium and ashwagandha as before") but CALLS OUT
    # introduce/titrate items as foreground changes that need attention.
    supplements = plan.get("supplement_protocol") or []
    continuing: list[str] = []
    introducing: list[dict] = []     # {name, dose, timing, rationale}
    titrating_up: list[dict] = []    # {name, titration, rationale}
    _titrate_up_re = re.compile(
        r"(?:then\s+|increase\s+to\s+|step\s+up\s+to\s+|from\s+wk?\s*|from\s+week\s+)(\d+)",
        re.IGNORECASE,
    )

    for s in supplements:
        if not isinstance(s, dict):
            continue
        name = (
            s.get("display_name")
            or (s.get("supplement_slug") or "").replace("-", " ").title()
        )
        if not name:
            continue
        titration = s.get("titration") or ""
        rationale = (s.get("coach_rationale") or "").strip()
        start_week = _resolve_start_week(s)

        # Step-up detection first — if the titration contains a "then X
        # from week N" / "increase to X from week N" pattern AND N is in
        # this phase window, it's a dose change on a supplement that was
        # already running. This wins over the introduce classification
        # because the wording implies a prior dose existed.
        uplift_weeks = [
            int(m.group(1)) for m in _titrate_up_re.finditer(titration)
        ]
        is_step_up = any(phase_start <= w <= phase_end for w in uplift_weeks)
        # An introduce is a clean start where the titration's earliest
        # week reference is the FIRST mention (not "weeks 1-4 then ..."
        # → that's a step-up). Heuristic: a step-up titration usually
        # contains the word "then" / "increase" / "step up". Treat as
        # introduce only when no step-up cue is present.
        has_step_up_cue = bool(
            re.search(
                r"\b(then|increase|step\s+up|step-?up)\b",
                titration,
                re.IGNORECASE,
            )
        )

        if is_step_up:
            titrating_up.append({
                "name": name,
                "titration": titration,
                "rationale": rationale.split("\n")[0] if rationale else "",
            })
        elif (
            phase_start <= start_week <= phase_end
            and not has_step_up_cue
        ):
            _slug = s.get("supplement_slug") or s.get("slug")
            _u = s.get("buy_link") or ""
            if not _u:
                try:
                    _resolved = _vitaone_url_only(name, slug=_slug)
                    _u = _resolved[1] if _resolved else ""
                except Exception:
                    _u = ""
            introducing.append({
                "name": name,
                "dose": s.get("dose") or "",
                "timing": s.get("timing") or "",
                "rationale": rationale.split("\n")[0] if rationale else "",
                "titration": titration,
                "buy_link": _u,
            })
        else:
            continuing.append(name)

    supp_summary = ", ".join(continuing) if continuing else "your current supplement routine"

    # Build phase-supplement instruction block for the AI. Only emit
    # sections that have entries — keeps the prompt tight.
    supp_phase_block_parts: list[str] = []
    if introducing:
        lines = [
            f"NEW SUPPLEMENTS TO INTRODUCE THIS PHASE ({phase_label_short if False else 'wks ' + str(phase_start) + '–' + str(phase_end)}):"
        ]
        for it in introducing:
            bits = [it["name"]]
            if it["dose"]:
                bits.append(it["dose"])
            if it["timing"]:
                bits.append(f"({it['timing']})")
            line = " — ".join(bits) if len(bits) > 1 else bits[0]
            if it["titration"]:
                line += f" · titration: {it['titration']}"
            if it["rationale"]:
                line += f" · why: {it['rationale']}"
            if it.get("buy_link"):
                line += f" · BUY LINK (include in the letter): {it['buy_link']}"
            lines.append(f"- {line}")
        supp_phase_block_parts.append("\n".join(lines))
    if titrating_up:
        lines = ["SUPPLEMENTS WITH A DOSE STEP-UP IN THIS PHASE:"]
        for it in titrating_up:
            line = it["name"]
            if it["titration"]:
                line += f" · {it['titration']}"
            if it["rationale"]:
                line += f" · {it['rationale']}"
            lines.append(f"- {line}")
        supp_phase_block_parts.append("\n".join(lines))
    supp_phase_block = (
        "\n\n".join(supp_phase_block_parts) if supp_phase_block_parts else ""
    )

    # Phase calorie target (if weight loss config). Select the bucket
    # that maps to the requested week range — phases are weeks 1–2,
    # 3–4, 5–8, 9–10, 11–12.
    # NOTE: the calorie-phase NAMES are deliberately weight-loss-specific
    # ("Gentle start", "Settling in", "Active loss", …) — they used to be
    # "Foundation"/"Repair"/etc. which collided with FM protocol phase
    # names (5R Repair, etc.) and the AI conflated the two.
    cal = _calc_calorie_targets(client, weight_loss or {})
    calorie_block = ""
    # Energy-recovery protocols — a calorie deficit is clinically harmful
    # (worsens fatigue / cortisol / triggers post-exertional crashes).
    # Suppress the deficit entirely even if a weight-loss goal is set.
    if cal and _has_fatigue_protocol(plan):
        cal = None
        calorie_block = (
            "\n⚠ NO CALORIE DEFICIT — the attached protocol is an "
            "energy-recovery protocol (adrenal / mitochondrial / PEM / "
            "POTS). A calorie deficit is clinically harmful here: it "
            "worsens fatigue and cortisol dysregulation and can trigger "
            "post-exertional crashes. Build meals to ADEQUATE, well-fuelled "
            "portions — protein at every meal, NO skipped meals, NO fasting "
            "windows. Any weight management comes only AFTER energy is "
            "restored.\n"
        )
    if cal:
        if phase_start <= 2:
            kcal = cal["phases"]["wk1_2"]
            phase_label = "Gentle start (wks 1–2)"
        elif phase_start <= 4:
            kcal = cal["phases"]["wk3_4"]
            phase_label = "Settling in (wks 3–4)"
        elif phase_start <= 8:
            kcal = cal["phases"]["wk5_8"]
            phase_label = "Active loss (wks 5–8)"
        elif phase_start <= 10:
            kcal = cal["phases"]["wk9_10"]
            phase_label = "Easing back (wks 9–10)"
        else:
            kcal = cal["phases"]["wk11_12"]
            phase_label = "Maintenance (wks 11–12)"

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

    coach_notes_block = _coach_notes_block(coach_notes)

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)
    # Between-session voice — the MOST important block for phase letters.
    # The whole point of a phase letter is "what should the NEXT week look
    # like given what's changed?" — and what's changed is precisely what
    # the client has been WhatsApping about: adherence wins, food
    # struggles, travel, side effects. This block forces the AI to
    # adjust the next week's menu to those signals instead of just
    # re-rendering the plan.yaml verbatim.
    recent_voice = _recent_client_voice_block(client.get("client_id") or "")
    # FULL communication arc since plan publish — captures coach
    # protocol additions (mouth tape, gluten enzymes, activated
    # charcoal, etc.) that happened mid-cycle through check-ins or
    # WhatsApp and must surface in the next letter. Different from
    # recent_voice (14d) which is for tone/recency; this one covers
    # the entire active plan window. Coach feedback 2026-05-19.
    protocol_changes = _protocol_changes_since_plan_block(
        client.get("client_id") or "",
        plan.get("plan_period_start"),
        plan.get("slug"),
    )

    # Fix C 2026-05-23 — supersedes-diff: when this plan superseded a prior
    # plan (e.g. follow-up phase, recheck rewrite, quick-edit republish),
    # compare the two and surface added / removed / re-dosed supplements
    # + new labs + new practices. Distinct from protocol_changes (which
    # reads session notes); this one reads structured plan YAML diff.
    plan_changes_block = _plan_changes_block(plan)

    phase_label_short = (
        f"Week {phase_start}"
        if phase_start == phase_end
        else f"Weeks {phase_start}–{phase_end}"
    )
    span_weeks = phase_end - phase_start + 1

    # Protocol-aware phase context — derived from the client's ACTUAL
    # attached protocol's catalogue `phases`, not a hardcoded arc. This is
    # the single source of truth for "what phase is the client in" — see
    # _phase_letter_protocol_context / _resolve_protocol_phase.
    phase_context = _phase_letter_protocol_context(plan, phase_start, phase_end)

    # Per-client meal plan letter shape preference. Set via PreferencesEditor
    # on the Overview tab. Default "hybrid" — works for most new clients.
    style_raw = (client.get("meal_plan_style") or "hybrid").lower()
    style = style_raw if style_raw in ("detailed", "principles", "hybrid") else "hybrid"

    # Coaching goals — pulled from plan.tracking. Surfaces what coach is
    # asking the client to TRACK this fortnight (symptoms, habits, labs).
    # Always emit a section heading in the letter so clients have an
    # explicit "what to notice / what to track" anchor. Plain text → AI
    # weaves into the letter as a section.
    tracking = (plan.get("tracking") or {}) if isinstance(plan, dict) else {}
    track_habits = tracking.get("habits") or []
    track_symptoms = tracking.get("symptoms_to_monitor") or []
    recheck_q = tracking.get("recheck_questions") or []
    coaching_goals_lines: list[str] = []
    if track_habits:
        coaching_goals_lines.append("Tracking habits this fortnight: " + ", ".join(
            str(h).strip() for h in track_habits[:6] if h
        ))
    if track_symptoms:
        coaching_goals_lines.append("Symptoms to monitor: " + ", ".join(
            str(s).strip() for s in track_symptoms[:6] if s
        ))
    if recheck_q:
        coaching_goals_lines.append("Recheck questions: " + " · ".join(
            str(q).strip() for q in recheck_q[:4] if q
        ))
    coaching_goals_block = (
        "COACHING GOALS THIS FORTNIGHT (weave into 'What to notice' section):\n  - "
        + "\n  - ".join(coaching_goals_lines)
        if coaching_goals_lines
        else ""
    )

    # Weight-loss portion control — when weight loss is enabled, generate
    # explicit per-meal portion guidance. Coach asked for this in ALL
    # three modes (detailed/principles/hybrid) — portions are the
    # mechanism by which the calorie target translates to plates.
    wl_enabled = bool(weight_loss and weight_loss.get("enabled"))
    portion_block = ""
    if wl_enabled and cal:
        kcal_total = cal["phases"]["wk1_2"] if phase_start <= 2 else (
            cal["phases"]["wk3_4"] if phase_start <= 4 else (
                cal["phases"]["wk5_8"] if phase_start <= 8 else (
                    cal["phases"]["wk9_10"] if phase_start <= 10 else cal["phases"]["wk11_12"]
                )
            )
        )
        portion_block = _portion_control_block(kcal_total)

    protein_block = _protein_guidance_block(client, plan)

    # Mode-specific body instructions (section 3 onwards). Sections 1-2
    # are common across modes — only the meat changes.
    if style == "detailed":
        body_instructions = f"""3. **{span_weeks} × 7-day meal plan tables** — one per week in the range
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

   After the table(s), add ONE short warm note: she can mix the days around —
   just swap like for like (a lunch for another lunch, a breakfast for a
   breakfast) so each day stays balanced.

4. **A few new dishes to try** — list 3–5 NEW recipes/dishes introduced
   this phase (different from initial-letter weeks). Tag each with ✦
   and add full recipes in the Appendix.

5. **What to notice in {phase_label_short}** — 3–4 curiosity prompts
   tied to phase outcomes (e.g. "Notice if your post-meal bloating
   has reduced", "Track energy at 4pm — should be steadier than week 1").
   WEAVE IN any items from "COACHING GOALS THIS FORTNIGHT" above.

6. **Recipe Appendix** — `## ✦ Recipe Appendix` — full ingredient
   lists + steps for every ✦ dish."""
    elif style == "principles":
        body_instructions = f"""3. **🟢 What to lean into this fortnight** — categories with examples
   and portion guidance. NOT a menu grid. Use this structure:
     • Cooked vegetables — 4–6 servings/day, specific examples
     • Protein — every meal, specific portion sizes (palm = ~25-30g)
     • Healthy fats — examples with portions
     • Fermented foods (if appropriate to phase) — small daily
     • Hydration — front-loaded if nocturia / late peeing

4. **🔴 What to step back from** — bullets with WHY tied to her
   labs/conditions, NOT generic. E.g. "Cow dairy — gut barrier still
   settling. A2 ghee is fine."

5. **⏰ Daily structure** — meal timing, fasting window, hydration
   timing (especially relevant if client has nocturia or evening
   energy issues).

6. **🍽 Meal-by-meal inspiration** — 5 ideas per slot:
     • Breakfast (5 options, brief 1-line descriptions)
     • Mid-morning snack (3 options)
     • Lunch (5 options)
     • Evening snack (3 options)
     • Dinner (5 options)
   NOT a 7-day grid. Tag any new dish names but do NOT include full
   recipes (this mode skips the recipe appendix).

7. **What to notice in {phase_label_short}** — 3–4 curiosity prompts.
   WEAVE IN any items from "COACHING GOALS THIS FORTNIGHT" above."""
    else:  # hybrid
        body_instructions = f"""3. **🟢 What to lean into this fortnight** — categories with examples
   and portion guidance. Same shape as principles mode.

4. **🔴 What to step back from** — bullets with WHY tied to her
   labs/conditions, NOT generic.

5. **⏰ Daily structure** — meal timing, fasting window, hydration.

6. **🗓 If you want a sample week — Week {phase_start}** — ONE 7-day
   table at the end as inspiration (clients in hybrid mode want
   structure but won't follow a grid religiously). Use the standard
   format:

   ## 🗓 Sample Week {phase_start}{(' — ~' + str(kcal) + ' kcal/day') if cal else ''}
   | Meal | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
   |------|-----|-----|-----|-----|-----|-----|-----|
   | **Breakfast** | ... |
   | **Mid-morning** | ... |
   | **Lunch** | ... |
   | **Evening snack** | ... |
   | **Dinner** | ... |

   Only ONE week — NOT both weeks in range. This is inspiration, not
   prescription. After the table, add ONE short warm note: she can mix the
   days around — just swap like for like (a lunch for another lunch, a
   breakfast for a breakfast) so each day stays balanced.

7. **A few new dishes to try** — 3–5 ✦-tagged dishes from the sample
   week table. Include compact recipe entries (ingredients + 1-para
   method) in the Appendix.

8. **What to notice in {phase_label_short}** — 3–4 curiosity prompts.
   WEAVE IN any items from "COACHING GOALS THIS FORTNIGHT" above.

9. **Recipe Appendix** — `## ✦ Recipe Appendix` — compact format
   (ingredients + 1-paragraph method per dish, not the full multi-step
   recipe pack). The save layer splits this section into a separate
   `<stem>-recipes.md/.html` file that goes to the client as an email
   attachment, so the main letter ships without the appendix taking up
   pages 4-7."""

    prompt = f"""You are writing a CONTINUATION meal plan letter for {first_name}.
This is a MID-CYCLE update — {first_name} is currently in week {phase_start} of her
{plan_weeks}-week protocol. She already has her supplements + lifestyle plan from
the initial letter. This letter ONLY covers meals for {phase_label_short}.

MEAL PLAN STYLE FOR THIS CLIENT: {style}
  - detailed:   full 7-day Mon-Sun tables for each week
  - principles: do's/don'ts + categories + 5 ideas per slot, NO menu grid
  - hybrid:     principles first, ONE sample week table as inspiration (NOT prescription)

Tone: warm, encouraging, acknowledges momentum. Reference what she's been doing
the past weeks. Don't re-prescribe — continue + evolve.

{top_of_mind}
{cycle}
{attached_protocol}

{phase_context}
{protocol_changes}
{plan_changes_block}
{recent_voice}
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
- Supplements continuing (in the background): {supp_summary}
- Nutrition pattern: {nutrition_pattern or 'see initial letter'}
- Foods to emphasise from initial plan: {', '.join(nutrition_add[:8]) if nutrition_add else 'see initial letter'}
- Foods to reduce from initial plan: {', '.join(nutrition_reduce[:8]) if nutrition_reduce else 'see initial letter'}

{supp_phase_block}
{portion_block}
{protein_block}
{coaching_goals_block}
{coach_notes_block}

DOCUMENT STRUCTURE — keep TIGHT, no extra sections:

1. **Warm 2-sentence opener** — name the week range, acknowledge momentum
   (e.g. "Hi {first_name} — you've made it through the first couple of weeks,
   and your gut is starting to settle into a new rhythm. Here's what
   {phase_label_short} look like.")

2. **What's evolving this phase** — 1 short paragraph (3-5 sentences).
   Describe where the client honestly is in their protocol for THIS week
   range. CRITICAL — use ONLY the "PROTOCOL PHASE" block above as your
   source of truth for which phase(s) the client is in. Do NOT advance
   the protocol faster than that block states, do NOT name a phase the
   block does not list as active, and do NOT frame overlapping phases as
   a clean graduation ("you've moved to phase N"). If the block says the
   protocol is STANDING or none is attached, write a steady-continuation
   paragraph with no phase-change language at all. Concrete and specific,
   tied to her labs/symptoms — NOT generic.

1b. **📝 Responding to your note** — CONDITIONAL: include this section ONLY IF
    the BETWEEN-SESSION VOICE block above (or coach notes / special requests)
    contains the client's OWN questions, concerns, food swaps, or updates since
    the last letter. If so, open with a short warm section that answers each
    point specifically and practically, tied to her plan (2–4 bullets, one per
    point — e.g. "Hung curd: fine in a small portion 2–3×/week, keep it separate
    from fruit"). If there is NOTHING from the client this fortnight, SKIP this
    section entirely — do NOT fabricate questions or write a generic placeholder.

2a. **✨ What's new this phase** — ONE combined section for everything that's
    new this fortnight — food AND supplements together. Do NOT split this into
    two separate "new this phase" sections, and do NOT re-list the full
    supplement routine (the day schedule + doses/buy table are already in this
    letter). Use up to two short groups, and include a group ONLY if it has
    content. If NOTHING at all is new this phase, skip this whole section.

      **In your food & routine:** any new foods, practices, or focus for this
      phase, drawn from the PROTOCOL PHASE intent above (e.g. "add one daily
      fermented food", "lightly steamed sprouts 3× this week", "start
      mouth-taping at night"). 2–4 bullets max, each with a one-line why.
      Don't invent — only what the phase actually calls for.

      **In your supplements:** changes ONLY.
        - For each NEW supplement (from "NEW SUPPLEMENTS TO INTRODUCE"): name,
          dose, timing, one-line why, AND its purchase link as a markdown link
          "👉 [Order it here](<BUY LINK from the block above>)". ALWAYS include
          the link when the block provides one.
        - For each step-up (from "TITRATING UP"): name + new dose + why.
        - If no supplement changes: one short line — "Your supplements stay the
          same this fortnight — keep going (it's all in your day schedule below)."

2c. **✈ For your travel** — INCLUDE THIS SECTION ONLY IF the RECENT
    BETWEEN-SESSION VOICE block above OR special requests / coach notes
    mention upcoming travel (destination + dates). Otherwise SKIP this
    section entirely — do NOT fabricate trips.

    When travel IS detected, write a focused practical section:
      • Travel dates + destination (one line)
      • 5-6 safe foods commonly available at the destination that fit
        her dietary preference + protocol. Be SPECIFIC — draw on real
        local cuisine knowledge. Example for Australia / Vegetarian Jain:
        "Cafes commonly have poached eggs (skip if eggetarian-only),
        avocado on gluten-free toast — ask for no butter; supermarket
        Vital range has gluten-free wraps; Indian and Thai restaurants
        in any major Australian city accommodate Jain (just say 'no
        garlic, no onion, no root veg'); fresh fruit + nuts everywhere."
      • Restaurant strategy: 3-4 specific phrases she can use ("Is
        this gluten-free?", "Can I have the sauce on the side?",
        "Could you cook with olive oil instead of butter?")
      • Portable snacks to pack from home (4-5 items, e.g. Brazil nuts,
        homemade ladoos, dry-roasted makhana, soaked dates, herbal tea
        sachets)
      • One watch-out tied to the destination + her conditions (e.g.
        "Australian sourdough is widely promoted as 'gluten-free' but
        it isn't — only certified GF counts; ask to see the packet")

    For DETAILED mode: also mark travel-week days with ✈ in the meal
    table column header.
    For HYBRID mode: mark travel days with ✈ in the sample week table.
    For PRINCIPLES mode: this section sits before the "5 ideas per
    slot" section.

{body_instructions}

10. **Sign-off** — TWO LINES: "**With warmth,**" / "**Shivani** 🌿".
    No separate "A note from coach" section — letter is already FROM her.

RULES:
- {first_name}'s supplement routine continues from the initial letter —
  surface it in section 2a as required but DO NOT generate a separate
  supplement schedule table.
- NO 12-week overview, NO roadmap — this letter is laser-focused on
  {phase_label_short}.
- SEASONAL produce for {location_str}, current season: {season}.
- MEAL PLAN STYLE = {style} — respect the body-instruction structure
  above EXACTLY. If style is "principles" do NOT generate a 7-day grid.
  If style is "hybrid" generate ONE sample week only, not both weeks.
{f"- WEIGHT LOSS ACTIVE — include the portion control box from above as a callout. Apply the visible reference plate to every meal idea you suggest." if wl_enabled else ""}

{grain_seasonality}

- Respect dietary preference ({diet_pref}), avoid ({foods_to_avoid}).
- CRITICAL: NEVER suggest reported-trigger foods: {reported_triggers}.
- Vegetarian Jain: NO root vegetables.
- Indian context unless said otherwise — ragi, dal, paneer, ghee, coconut.
{f"- Keep variety across {span_weeks} weeks — don't repeat the same dinner 3 nights in a row." if style == "detailed" else "- Keep meal ideas varied — different proteins, grains, cooking methods."}

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
    if letter_type == "recipes":
        return _build_prompt_recipes(plan, client, coach_notes)
    # else: consolidated — fall through to existing code
    plan_weeks = int(plan.get("plan_period_weeks") or 12)

    # Meal-plan presentation in the consolidated letter is driven by the
    # client's meal_plan_style preference (set by the coach in the Memory /
    # preferences panel — Detailed / Principles / Hybrid):
    #   detailed   → full 14-day Mon-Sun meal tables
    #   hybrid     → nutrition principles + ONE sample-week table
    #   principles → nutrition principles only, no tables
    #
    # BUG FIX 2026-05-20: this was previously gated on
    # `"meal_plan" in letter_types_active`, which conflated "which
    # standalone letter documents to ship" with "how the client wants her
    # meal plan presented" — and ignored the coach's explicit Detailed
    # setting entirely. A client set to Detailed but whose letter_types_active
    # was just ["consolidated"] silently got a Principles letter. Now the
    # consolidated meal section honours meal_plan_style directly.
    style_raw = (client.get("meal_plan_style") or "hybrid").lower()
    meal_plan_style = (
        style_raw if style_raw in ("detailed", "principles", "hybrid") else "hybrid"
    )
    include_daily_meal_plan = meal_plan_style == "detailed"

    # Pre-compute the section 3 body — either daily meal-plan tables OR
    # nutrition principles. Held as a plain string so the main f-string
    # below stays readable (Python 3.9 chokes on nested f-strings + can't
    # have backslashes inside f-string expressions). NB: this string gets
    # interpolated, then the AI uses it as the prompt for section 3.

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
    grain_seasonality = _seasonality_block(_month, country)
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
        name = _strip_brand_from_name(s.get("display_name") or slug.replace("-", " ").title())
        dose = _clientify_dose(s.get("dose") or s.get("dose_display") or "")
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

    coach_notes_block = _coach_notes_block(coach_notes)

    nutrition_pattern = nutrition.get("pattern") or ""
    nutrition_add = nutrition.get("add") or []
    nutrition_reduce = nutrition.get("reduce") or []
    cooking = nutrition.get("cooking_adjustments") or []
    remedies = nutrition.get("home_remedies") or []
    meal_timing = nutrition.get("meal_timing") or ""

    lifestyle_block = "\n".join(f"- {p}" for p in lifestyle) if lifestyle else ""
    tracking_habits = _stringify_list(tracking.get("habits"))
    tracking_symptoms = _stringify_list(tracking.get("symptoms_to_monitor"))

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

    # Weight-loss plans MUST carry an explicit portion guide — the
    # mechanism that turns the calorie target into actual plates.
    portion_block = _portion_control_block(cal["phases"]["wk1_2"]) if cal else ""
    protein_block = _protein_guidance_block(client, plan)

    top_of_mind = _top_of_mind_block(client, plan)
    cycle = _cycle_block(client)
    attached_protocol = _attached_protocol_block(plan)
    # Healing-phase arc — derived from the attached protocol's real phases
    # (or honest continuity language when standing / none).
    healing_arc = _consolidated_healing_arc_block(plan, plan_weeks)
    start_when = _start_when_block(plan, "both")
    # Between-session voice (last 14 days of WhatsApp inbound + coach
    # quick notes). Lets a consolidated regenerate pick up "low veg
    # intake, constipation" without needing a full reassessment first.
    recent_voice = _recent_client_voice_block(client.get("client_id") or "")
    # FULL communication arc since plan publish — coach protocol
    # additions (mouth tape, gluten enzymes, activated charcoal, etc.)
    # that happened mid-cycle. Coach feedback 2026-05-19. See helper for
    # rules.
    protocol_changes = _protocol_changes_since_plan_block(
        client.get("client_id") or "",
        plan.get("plan_period_start"),
        plan.get("slug"),
    )

    # ── Pre-compute the section 3 body ──
    # Two alternate prompt fragments depending on whether the coach has
    # opted this client into day-to-day meal planning. Built as plain
    # strings so the giant f-string prompt below stays readable.
    if include_daily_meal_plan:
        if cal:
            calorie_callout = (
                "Then include this callout block immediately after the paragraph:\n"
                "   > 🎯 **Weeks 1–2 daily calorie target: ~"
                + str(cal['phases']['wk1_2']) + " kcal/day**"
                + " *(BMR " + str(cal['bmr']) + " kcal · TDEE "
                + str(cal['tdee']) + " kcal · daily deficit "
                + str(cal['full_deficit']) + " kcal)*"
            )
            target_label = " — Target: " + str(cal['phases']['wk1_2']) + " kcal/day"
            calorie_warn = "⚠️ WEIGHT LOSS PLAN — each day MUST total the target below. Choose portion sizes accordingly."
            calorie_band = ("Week 1 & 2 target: " + str(cal['phases']['wk1_2'])
                            + " kcal/day (±50 kcal). Portions must reflect this — not a typical 1800-1900 kcal adult plate.")
            kcal_row = ("| *~kcal* | *" + str(cal['phases']['wk1_2'])
                        + "* | *" + str(cal['phases']['wk1_2'])
                        + "* | *...* | *...* | *...* | *...* | *...* |")
            week2_kcal_target = " Each day must still total ~" + str(cal['phases']['wk1_2']) + " kcal."
            table_kcal_rule = "Every day total in the *~kcal* row must be within ±50 kcal of the phase target."
        else:
            calorie_callout = ""
            target_label = ""
            calorie_warn = ""
            calorie_band = ""
            kcal_row = ""
            week2_kcal_target = ""
            table_kcal_rule = ("DO NOT add a *~kcal* row or any per-day calorie totals "
                               "— this client is NOT on a weight-loss plan. Calorie counts are off-topic.")

        meal_plan_section = (
            "**3b. 14-Day Meal Plan — TWO 7-day tables. CALORIE TARGETS ARE BINDING.**\n\n"
            + calorie_warn + "\n" + calorie_band + "\n\n"
            "USE THIS EXACT TABLE FORMAT. Do NOT use bullet points or prose for the meal plan.\n\n"
            "## 🗓 Week 1 Meal Plan" + target_label + "\n"
            "| Meal | Mon | Tue | Wed | Thu | Fri | Sat | Sun |\n"
            "|------|-----|-----|-----|-----|-----|-----|-----|\n"
            "| **Breakfast** | dish | dish | dish | dish | dish | dish | dish |\n"
            "| **Mid-morning snack** | snack | snack | snack | snack | snack | snack | snack |\n"
            "| **Lunch** | dish | dish | dish | dish | dish | dish | dish |\n"
            "| **Evening snack** | snack | snack | snack | snack | snack | snack | snack |\n"
            "| **Dinner** | dish | dish | dish | dish | dish | dish | dish |\n"
            "| **Bedtime** | drink/✗ | drink/✗ | drink/✗ | drink/✗ | drink/✗ | drink/✗ | drink/✗ |\n"
            + kcal_row + "\n\n"
            "## 🗓 Week 2 Meal Plan" + target_label + "\n"
            "(Same structure, vary the dishes." + week2_kcal_target + ")\n\n"
            "Table rules:\n"
            "- Each cell: dish name only, short (e.g. \"Ragi dosa + chutney ✦\"). Flag recipes with ✦.\n"
            "- " + table_kcal_rule + "\n"
            "- Meals MUST respect dietary preference (" + diet_pref + ") and avoid (" + foods_to_avoid + ").\n"
            "- CRITICAL: NEVER use reported triggers in any meal: " + reported_triggers + "\n"
            "- INCORPORATE non-negotiables (" + non_negotiables + ") with a workaround if needed.\n"
            "- Use specific Indian dish names. Week 2 should vary from Week 1.\n\n"
            "**3b-ii. Foods to Reduce or Avoid — ALWAYS include this section.**\n"
            "AFTER the two meal-plan tables, ALWAYS add a clear section headed\n"
            "## \U0001F6AB Foods to Reduce or Avoid\n"
            "Even for a detailed plan the client needs the reduce/avoid list "
            "spelled out explicitly. Render the coach's plan list below, each "
            "as a bullet with a brief one-line reason:\n"
            + ("\n".join("  - " + str(x) for x in nutrition_reduce)
               if nutrition_reduce else "  - (coach specified none)")
            + "\nAlso restate inline: reported triggers (NEVER eat) — "
            + reported_triggers + "; dietary exclusions — " + foods_to_avoid + "."
        )
        recipe_appendix_instr = (
            "Detailed recipes for every ✦ dish. Format each as:\n"
            "   ### ✦ Recipe name\n"
            "   **Serves:** 1–2 | **Time:** X min\n"
            "   **Ingredients:** (bullets) | **Method:** (numbered steps) | **Tip:** (optional)"
        )
        roadmap_calorie_lines = ""
        if cal:
            roadmap_calorie_lines = (
                "Calorie targets for this roadmap section (mention briefly per phase):\n"
                "   • Weeks 5–8: " + str(cal['phases']['wk5_8']) + " kcal/day (full deficit)\n"
                "   • Weeks 9–10: " + str(cal['phases']['wk9_10']) + " kcal/day (ease back)\n"
                "   • Weeks 11–12: " + str(cal['phases']['wk11_12']) + " kcal/day (sustain)"
            )
        weeks_3_4_calorie_line = ""
        if cal:
            weeks_3_4_calorie_line = ("Mention that calorie targets will adjust to ~"
                                      + str(cal['phases']['wk3_4']) + " kcal/day as the body adapts.")
    else:
        # Client opted OUT of day-to-day meal plans. Replace with principles.
        calorie_callout = ""
        meal_plan_section = (
            "**3b. Nutrition Principles — NO daily meal tables for this client.**\n\n"
            "This client explicitly opted OUT of day-to-day meal planning. Coach decision: "
            + first_name + " wants overall nutrition guidance, NOT prescriptive daily menus. "
            "They will plan their own meals using these principles.\n\n"
            "DO NOT include any weekly meal-plan table, daily meal schedule, sample-day breakdown, "
            "recipe appendix, or kcal targets. Replace with the following structured guidance instead:\n\n"
            "## 🥗 Daily Eating Principles\n"
            "5–7 short, specific principles that apply across every meal. Make each tied to "
            + first_name + "'s actual situation (conditions / triggers / non-negotiables surfaced "
            "in TOP-OF-MIND above). Examples (rewrite to be specific):\n"
            "  - Protein at every meal — aim ≥20 g; helps with [client-specific reason]\n"
            "  - Veg + fibre fill half the plate at lunch + dinner\n"
            "  - Refined carbs OUT (maida, white rice, biscuits); complex carbs IN (millets, dal, brown rice)\n"
            "  - Stop eating 3 hrs before bed\n"
            "  - [client-specific principle, e.g. \"chai with milk OK in the morning — your non-negotiable — but no sugar after week 2\"]\n\n"
            "## 🍽 Foods to emphasise\n"
            "START by listing the coach's plan ADD foods verbatim as bullets "
            "(do not drop any): "
            + ("; ".join(str(x) for x in nutrition_add) if nutrition_add else "see protocol")
            + "\n"
            "THEN two short paragraphs (NOT a daily plan):\n"
            "  - **In-season picks for " + location_str + " this " + season + "**: 6–10 specific items "
            "(vegetables, fruits, grains, fats, proteins) that suit the client's protocol AND respect "
            "dietary preference (" + diet_pref + ").\n"
            "  - **What to bias toward at each meal slot** (breakfast / lunch / snack / dinner / bedtime): "
            "1–2 dishes or food-types per slot. PROSE, not a table. E.g. \"For breakfast lean on eggs or "
            "paneer-bhurji with a small fruit; avoid the sweet upma or sugar-loaded poha that spike "
            "mid-morning energy.\"\n\n"
            "## 🚫 Foods to reduce or avoid\n"
            "START by listing the coach's plan REDUCE/AVOID foods verbatim as "
            "bullets (do not drop any): "
            + ("; ".join(str(x) for x in nutrition_reduce) if nutrition_reduce else "see protocol")
            + "\n"
            "- Reported triggers (NEVER eat): " + reported_triggers + "\n"
            "- Dietary exclusions: " + foods_to_avoid + "\n"
            "- 4–6 more items specific to this client's protocol — name them, brief reason each "
            "(\"sugar — drives the 3pm energy crash you mentioned\")\n\n"
            "## 💡 Coach's note on flexibility\n"
            "One warm paragraph from Shivani: \"" + first_name + ", I've kept the day-to-day food flexible "
            "because you wanted that. If you ever change your mind and want a structured daily breakdown — "
            "say the word, I'll send one through.\""
        )
        # Hybrid clients want principles to live by PLUS one example week
        # showing how they come together — append a single sample-week table.
        if meal_plan_style == "hybrid":
            meal_plan_section += (
                "\n\n## 🗓 Sample Week — one example, not a prescription\n"
                "AFTER the principles above, add ONE 7-day table for a typical "
                "Week 1 (rows: Breakfast / Mid-morning snack / Lunch / Evening "
                "snack / Dinner / Bedtime; columns Mon-Sun). Label it clearly as "
                "a SAMPLE to show how the principles come together — "
                + first_name + " is on a hybrid plan, so this is inspiration, "
                "not a rigid menu. Use specific Indian dishes, respect dietary "
                "preference (" + diet_pref + "), avoid (" + foods_to_avoid
                + "), and never use reported triggers (" + reported_triggers + ")."
            )
        recipe_appendix_instr = (
            "SKIP this entire section. No daily meal plan in this letter "
            "(per client preference) → no ✦ recipes to expand. Move directly to the Product guide below."
        )
        roadmap_calorie_lines = ""
        weeks_3_4_calorie_line = ""

    prompt = f"""You are writing a warm, friendly, practical {plan_weeks}-week wellness plan letter for a client.
The coach (Shivani Hariharan, a functional medicine health coach) has prepared this structured plan.
Your job is to turn the coach's structured data into a beautiful, easy-to-read document the client can actually USE.

{top_of_mind}
{cycle}
{attached_protocol}
{start_when}
{recent_voice}
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
{portion_block}
{protein_block}

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

{healing_arc}

## Document structure — MANDATORY ORDER (action-first, 5–7 pages — don't overwhelm):

Output the sections in EXACTLY this order: **Why → Take → Eat → Do → Track → Recipes → Sign-off.**
Where you see a placeholder line like `<!--FM:TAKE-->` or `<!--FM:PLATE-->`, output that
literal HTML comment on its OWN line — it marks where a ready-made section is inserted
automatically. **DO NOT write** a supplement table/list/schedule, a daily routine, a
shopping list, or a portion-plate description anywhere in the letter — those are injected
at the placeholders. Write only the narrative + the meal tables.

1. **Why this plan** — heading `## 🌱 Why this plan, {first_name}`
   This LEADS the letter — she should understand WHY before WHAT. 3–5 short paragraphs:
   - A warm 1–2 sentence hello, naming this as a {plan_weeks}-week journey.
   - **What we found:** name the 1–2 key drivers from her assessment in plain language ("your stress-response system is running hot", "your gut isn't absorbing nutrients well right now"). No jargon.
   - **The plan in brief + why it fits you:** in 2–4 sentences, say what this plan does and the ORDER it does it in (e.g. "first we calm the immune trigger, then rebuild the gut, then steady your blood sugar"), and why that approach is right for HER specifically.
   - The {plan_weeks}-week arc, one short line per phase (no meal plans, just narrative):
   {roadmap_calorie_lines}
   - **Weeks 3–4** (Continuation):{weeks_3_4_calorie_line}
   - Weeks 5–8 (Deepening) · Weeks 9–10 (Easing) · Weeks 11–12 (Sustaining)

2. **What to take** — heading `## 💊 What to take`
   ONE short sentence only: "Here's your supplement routine — your printable day schedule is below, with the full doses and where to order each one just under it." Then output this placeholder on its OWN line and write nothing else in this section (no table, no list, no supplement names):
   <!--FM:TAKE-->

3. **What to eat** — heading `## 🍽 What to eat`
   First output this placeholder on its OWN line:
   <!--FM:PLATE-->
   Then:

   **3a. Theme for weeks 1–2** — 1 short paragraph: what is the body doing in this phase?
   {calorie_callout}

   {meal_plan_section}

   **3b. Eat more / Eat less** — TWO short bulleted columns (NOT a table, NOT prose). 6–8 bullets each, each with a one-line why. In "Eat less / avoid" include: "Reported triggers: NEVER eat <list from {reported_triggers}>".

4. **What to do daily** — heading `## 🌿 What to do daily`

   **4a. Daily non-negotiables** — bullet list, 3–5 lines MAX, ≤12 words each. Sleep, stress / breathwork, movement, sun, connection. Only what matters for THIS client — don't list everything.

   **4b. Movement this week** — heading `### 🏃 Movement this week`
   Simple 7-day table (Day | Type | Duration | Notes). At least 1 REST day. Match {first_name}'s baseline movement_days_per_week and movement_type. Cycle-aware for menstruating / perimenopausal women (no HIIT in menstrual/PMS week — restorative only); strength 3×/week for postmenopausal. Scannable (8–10 lines). {"A separate detailed exercise_plan letter HAS been generated for this client — add this one-liner at the end of the section: 'See your detailed exercise plan for the full weekly progression and exercise specifics.'" if has_exercise_plan else "No separate exercise_plan letter exists for this client — DO NOT reference one. This simple schedule IS the entire movement plan."}

   **4c. Daily teas & home remedies** — heading `### 🌿 Daily teas & home remedies` — brief, any from the plan, simply described. Skip entirely if none.

5. **What to track** — heading `## 📊 What to track`

   **5a. What to notice in Weeks 1–2** — 4–6 positive tracking prompts. Curiosity, not surveillance.

   **5b. Labs to recheck** — Only if the plan has lab_orders. Bullet list with marker name + when to draw. Skip this sub-block if no labs.

6. **Recipe pack** — Add ONLY this callout (DO NOT write the recipes inline):
   > *Your recipe pack — full ingredients, method, and tips for every ✦ dish in this meal plan — is at a separate link your coach is sending you over WhatsApp. Bookmark it on your phone for easy access in the kitchen.*
   {"DO NOT write any ✦ recipe details, ingredient lists, or methods in this letter. Recipes live on a separate page (linked from the meal plan ✦ symbols once the letter is published)." if include_daily_meal_plan else "No meal plan in this letter (per client preference) → no recipe pack needed. Skip this sub-block."}

7. **Sign-off** — 2–4 warm closing sentences, then TWO LINES ONLY: "**With warmth,**" / "**Shivani** 🌿". No separate "A note from Shivani" heading — the whole letter is already FROM Shivani. Remind {first_name} this is a {plan_weeks}-week journey, not a sprint.

---

LOCATION & SEASONAL NOTES:
- Client is in {location_str}. Current season: {season}.

{grain_seasonality}

- ALL meal suggestions must use produce that is IN SEASON and LOCALLY AVAILABLE in {location_str} right now.
- Do not suggest out-of-season produce (e.g. strawberries in December in India, or mangoes in winter in the UK).
- Where possible, name specific local varieties (e.g. "Alphonso mango" for Mumbai, "Cox apple" for UK autumn).
- Account for local cooking culture, available spices, and typical grocery access in {location_str}.

SPECIAL DIET NOTES:
- If dietary_preference is "Vegetarian Jain": strictly NO root vegetables (onion, garlic, potato, carrot, beetroot, radish, turnip). No underground vegetables at all. Also no eating after sunset traditionally. Reflect this in every meal suggestion. IMPORTANT: Jain is LACTO-VEGETARIAN — dairy is fully permitted and traditionally central (milk, ghee, paneer, dahi/curd, buttermilk/chaas, malai, kheer). Do NOT exclude dairy when generating Jain meal plans; it is one of the primary protein and fat sources for this diet. Only flesh/fish/eggs/gelatin are excluded.

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
     (the eat-more/eat-less bullets from section 2c, the 7-day tables
     for weeks 1–2 from section 3a/3b, plus the per-week roadmap text
     for weeks 3–{plan_weeks} from section 4a). DO NOT include any
     ✦ recipe details here — recipes live on a separate page now...
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
    # Wrapped in try/except because any of these helpers can blow up on
    # edge-case client/plan shapes (e.g. an exercise_plan run where the
    # plan field shapes differ), and the validator MUST never crash the
    # main letter render — its only job is to QA a letter we already have.
    try:
        top_of_mind = _top_of_mind_block(client, plan).strip()
        if not top_of_mind:
            # No client specifics to anchor against — validator can't help here.
            return markdown, []
        cycle = _cycle_block(client).strip()
        attached_protocol_ctx = _attached_protocol_block(plan).strip()
    except Exception as e:
        print(
            f"[validate] context-build failed ({type(e).__name__}: {e}) — skipping QA",
            file=sys.stderr,
            flush=True,
        )
        return markdown, []

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

VOICE — CRITICAL:
  The letter is written and signed by Shivani Hariharan (the coach) IN
  FIRST PERSON to the client. Your rewrites MUST stay in first person —
  use 'I', 'me', 'my', 'we', 'our'. NEVER introduce phrases like
  "check with Shivani", "Shivani recommends", "your coach has advised",
  "ask Shivani before", or any other third-person reference to the
  coach. The coach IS the author. Saying "check with Shivani" in a
  letter signed by Shivani is nonsensical to the client. If a tip
  needs a "check with the coach" caveat, write "let me know before
  you start this" or "message me first" instead.

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

    try:
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
                flush=True,
            )
            return markdown, []

        return rewritten, changes
    except Exception as e:
        print(
            f"[validate] response-parse failed ({type(e).__name__}: {e}) — keeping original markdown",
            file=sys.stderr,
            flush=True,
        )
        return markdown, []


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
    # Default a meal_plan_phase letter's bounds to weeks 3-4 — matching the
    # prompt builder's `phase_start or 3, phase_end or 4` — so the injected
    # supplement schedule/routine window matches the narrative instead of
    # showing the full 12-week list (audit Phase-1b).
    if letter_type == "meal_plan_phase":
        if phase_start is None:
            phase_start = 3
        if phase_end is None:
            phase_end = 4
    # Backdating: coach generates the "as-of" version of a letter for a
    # client whose protocol started weeks ago. as_of_date filters all
    # dated client data (sessions, measurements_log, health_snapshots)
    # to entries on/before that date, and anchors the recent-voice
    # window to that date instead of today. Format: YYYY-MM-DD.
    as_of_date = (payload.get("as_of_date") or "").strip() or None
    if as_of_date:
        # Validate ISO date BEFORE setting the module global so a malformed
        # value can't poison the recent-voice cutoff. Empty / unparseable
        # → treat as no-op + log to stderr. Audit feedback (B4 2026-05-19).
        try:
            from datetime import date as _date
            _date.fromisoformat(as_of_date[:10])
            valid_as_of = as_of_date
        except Exception:
            print(
                f"[render-letter] as_of_date {as_of_date!r} is not ISO YYYY-MM-DD — ignoring",
                file=sys.stderr,
                flush=True,
            )
            valid_as_of = None
            as_of_date = None
        if valid_as_of:
            _step(f"backdate mode — filtering client data to ≤ {valid_as_of}")
            global _AS_OF_OVERRIDE
            _AS_OF_OVERRIDE = valid_as_of

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

    # Expose client to the supplement contradiction checker so product
    # blends that clash with the client's allergies / foods_to_avoid are
    # skipped in favour of the next-ranked alternative.
    global _ACTIVE_CLIENT
    _ACTIVE_CLIENT = client

    # Weight-loss fallback: when the caller didn't pass a weight_loss config
    # (e.g. phase-letter generation, which doesn't re-ask the weight-loss
    # questionnaire), fall back to the one stored on the client profile.
    # The config lives on client.yaml — so every letter type, including
    # mid-cycle phase letters, gets the calorie targets without the UI
    # having to re-supply them each time.
    if not weight_loss.get("enabled"):
        client_wl = client.get("weight_loss")
        if isinstance(client_wl, dict) and client_wl.get("enabled"):
            weight_loss = client_wl
            _step("weight_loss not in payload — using client profile config")

    # Backdating: filter dated arrays on the client object so the prompt
    # sees only what was known on/before as_of_date. Mutating a fresh
    # dict (not the YAML on disk) — disk stays authoritative.
    if as_of_date:
        try:
            from datetime import date as _date
            cutoff = _date.fromisoformat(as_of_date[:10])

            def _entry_date_le(e: dict, key: str = "date") -> bool:
                raw = e.get(key) if isinstance(e, dict) else None
                if not raw:
                    # Undated entries — keep them. Safer than dropping
                    # legitimate context that just happens to lack a
                    # date stamp.
                    return True
                try:
                    return _date.fromisoformat(str(raw)[:10]) <= cutoff
                except Exception:
                    return True

            filtered_total = 0
            for field in ("measurements_log", "health_snapshots", "health_data_snapshots", "weight_log"):
                items = client.get(field)
                if isinstance(items, list):
                    before = len(items)
                    kept = [it for it in items if _entry_date_le(it)]
                    if len(kept) != before:
                        client[field] = kept
                        filtered_total += (before - len(kept))
            if filtered_total:
                _step(f"backdate: filtered out {filtered_total} post-cutoff dated entries from client")
        except Exception as e:
            print(f"[render-letter] backdate-filter failed ({type(e).__name__}: {e}) — continuing without filter",
                  file=sys.stderr, flush=True)

    # Merge persistent catalogue coach notes with generation-time notes
    catalogue_notes = _load_catalogue_notes(plan)
    if catalogue_notes and coach_notes:
        coach_notes = f"{coach_notes}\n\n{catalogue_notes}"
    elif catalogue_notes:
        coach_notes = catalogue_notes

    # Auto-inject weight_loss.week_overrides (set on the Overview tab via
    # the WeightLossCard) into coach_notes so the existing `🧳 TRAVEL`
    # detection in _coach_notes_block fires and the AI applies the
    # travel-localisation rules (restaurant ordering at destination,
    # local cuisine swaps, maintenance kcal for those dates).
    #
    # Coach asked for this 2026-05-19: she set Sydney travel via the
    # weight-loss override card but the consolidated letter still didn't
    # localise the meal plan — turned out the prompt only looked at
    # coach_notes, never read the override. This bridges the two.
    try:
        wl = client.get("weight_loss") or {}
        overrides = wl.get("week_overrides") or []
        if isinstance(overrides, list) and overrides:
            from datetime import date as _date, timedelta as _td

            # Compute the phase letter's effective date window so we can
            # scope overrides to it. Was previously a real bug: a Sydney
            # override for Wks 7-8 was leaking into the Wks 5-6 letter
            # because we only filtered on "ended before today". Now we
            # require the override date range to OVERLAP the phase
            # window. For non-phase letters (consolidated, supplement
            # plan, etc.) we use the full plan window so overrides still
            # surface as relevant background context.
            # DURABLE RULE: Day 1 of the 12-week protocol is meal_plan_started_on
            # (coach-asserted) — NOT plan_period_start. plan_period_start is when
            # the YAML was authored; meal_plan_started_on is when the client
            # actually began executing. Use the same +3d fallback as
            # _start_when_block / wrap_in_brand_html convention. Once Day 1 is set,
            # the 12-week clock is FIXED — regenerations do not extend the protocol.
            plan_weeks_for_window = int(plan.get("plan_period_weeks") or 12)
            _plan_start_raw = plan.get("plan_period_start") or ""
            _meal_started_raw = plan.get("meal_plan_started_on") or ""
            try:
                _period_start_d = _date.fromisoformat(str(_plan_start_raw)[:10]) if _plan_start_raw else None
            except Exception:
                _period_start_d = None
            try:
                _meal_actual_d = _date.fromisoformat(str(_meal_started_raw)[:10]) if _meal_started_raw else None
            except Exception:
                _meal_actual_d = None
            # Effective Day 1 = coach-asserted meal_plan_started_on, else period_start + 3d
            plan_start_d = _meal_actual_d or (
                _period_start_d + _td(days=3) if _period_start_d else None
            )

            if letter_type in ("meal_plan_phase", "meal_plan") and phase_start and phase_end and plan_start_d:
                # Phase letters: tight window = the requested fortnight only.
                phase_from = plan_start_d + _td(weeks=(phase_start - 1))
                phase_to = plan_start_d + _td(weeks=phase_end) - _td(days=1)
            elif plan_start_d:
                # Other letters: cover the whole plan period.
                phase_from = plan_start_d
                phase_to = plan_start_d + _td(weeks=plan_weeks_for_window) - _td(days=1)
            else:
                phase_from = None
                phase_to = None

            injected_lines: list[str] = []
            for ov in overrides:
                if not isinstance(ov, dict):
                    continue
                ctx = (ov.get("context") or "").lower()
                date_from = ov.get("date_from") or ""
                date_to = ov.get("date_to") or ""
                mode = ov.get("mode") or "maintenance"
                location = (ov.get("location") or "").strip()
                reason = (ov.get("reason") or "").strip()
                if not date_from or not date_to:
                    continue
                # Skip overrides that ended before today — they're past
                # and irrelevant to a letter being generated now.
                try:
                    if _date.fromisoformat(date_to[:10]) < _date.today():
                        continue
                except Exception:
                    pass
                # Scope check: skip overrides whose date range doesn't
                # intersect this letter's effective window. Prevents
                # "phantom Sydney section" in unrelated fortnight letters.
                if phase_from and phase_to:
                    try:
                        ov_from_d = _date.fromisoformat(date_from[:10])
                        ov_to_d = _date.fromisoformat(date_to[:10])
                        # No intersection iff override ends before window
                        # starts OR override starts after window ends.
                        if ov_to_d < phase_from or ov_from_d > phase_to:
                            _step(
                                f"skipping override ({ctx or 'unspecified'} {date_from}→{date_to}) "
                                f"— outside letter window {phase_from}→{phase_to}"
                            )
                            continue
                    except Exception:
                        # Malformed date — fall through and include the
                        # override defensively (better to over-include
                        # than to silently drop on a coach typo).
                        pass
                if ctx == "travel" and location:
                    # Emoji-prefixed marker = exactly what _coach_notes_block
                    # looks for to trigger the travel_rule prompt.
                    line = (
                        f"🧳 TRAVEL: {location} ({date_from} → {date_to}). "
                        f"Override mode: {mode}. "
                        f"Cooking access: restaurants/hotel (assume no kitchen unless coach overrides). "
                        f"Apply travel-localisation: restaurant-ordering guide for {location}, "
                        f"local cuisine swaps that still fit her protocol, hotel-breakfast tips, "
                        f"hydration + jet-lag guidance."
                    )
                    if reason:
                        line += f" Context note: {reason}."
                    injected_lines.append(line)
                elif ctx == "festival":
                    injected_lines.append(
                        f"🎉 FESTIVAL window ({date_from} → {date_to}): relax restrictions for cultural meals. "
                        f"Reason: {reason or 'family / festival flexibility'}. Mode: {mode}."
                    )
                elif ctx == "illness":
                    injected_lines.append(
                        f"🤒 ILLNESS window ({date_from} → {date_to}): skip structured meal plan for these dates. "
                        f"Reason: {reason or 'recovery'}."
                    )
                elif ctx == "plateau_break":
                    injected_lines.append(
                        f"⏸ PLATEAU BREAK ({date_from} → {date_to}): coach-initiated diet break. Mode: {mode}."
                    )
                else:
                    injected_lines.append(
                        f"🔧 OVERRIDE ({date_from} → {date_to}): {mode}. {reason}"
                    )
            if injected_lines:
                override_block = (
                    "=== ACTIVE WEIGHT-LOSS OVERRIDES (from client.weight_loss) ===\n"
                    + "\n".join(injected_lines)
                )
                coach_notes = (
                    f"{coach_notes}\n\n{override_block}" if coach_notes else override_block
                )
                _step(f"auto-injected {len(injected_lines)} weight-loss override(s) into coach_notes")
    except Exception as e:
        # Override injection is a nice-to-have; if it explodes, ship the
        # letter without it rather than crash.
        print(f"[render-letter] override-injection failed ({type(e).__name__}: {e}) — continuing without",
              file=sys.stderr, flush=True)

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

    # Timeout + retry config lives in the shared scripts/anthropic_client.py
    # helper (audit Phase-1 H2) — single source of truth so every shim's
    # timeout config can't drift. Without a read timeout a stalled connection
    # hangs to the caller's SIGKILL ("exited null with no stdout").
    from anthropic_client import build_client
    client_api = build_client(api_key)

    # ── Letter cache (E.2) ─────────────────────────────────────────────
    # The prompt string captures every input that drives Sonnet's output
    # for this letter — plan fields, client context, coach notes, phase
    # window, weight-loss params. Hashing the prompt + letter_type +
    # model gives us a deterministic cache key. If a previous letter
    # exists with the same key, we return it verbatim and skip the
    # ~$0.05–0.30 Sonnet call. Cache lives at
    # ~/.fm-cache/letters/<plan_slug>-<letter_type>-<keyHash>.json and
    # persists markdown + validation report + recipes sidecar. Coach
    # disables via FM_LETTER_NO_CACHE=1. Cache CAN be safely deleted
    # any time — the next regen just rebuilds.
    import hashlib as _hashlib
    _letter_cache_dir = (
        Path(os.environ.get("FM_LETTER_CACHE_DIR"))
        if os.environ.get("FM_LETTER_CACHE_DIR")
        else Path.home() / ".fm-cache" / "letters"
    )
    _letter_cache_disabled = os.environ.get("FM_LETTER_NO_CACHE") == "1"
    _letter_cache_key = _hashlib.sha256(
        (
            f"letter_type={letter_type}\n"
            f"model=claude-sonnet-4-6\n"
            f"prompt={prompt}"
        ).encode()
    ).hexdigest()[:32]
    _letter_cache_file = _letter_cache_dir / f"{plan_slug}-{letter_type}-{_letter_cache_key}.json"
    if not _letter_cache_disabled and not payload.get("reuse_markdown") and _letter_cache_file.exists():
        try:
            with open(_letter_cache_file) as _fh:
                _cached = json.load(_fh)
            _step(f"cache HIT — skipping Sonnet call (key {_letter_cache_key})")
            # Annotate the returned payload so the TS layer / UI can show
            # a subtle "regenerated from cache" badge if it wants.
            _cached["_from_cache"] = True
            _cached["_cache_key"] = _letter_cache_key
            json.dump(_cached, sys.stdout)
            return 0
        except Exception as _cache_err:
            _step(f"cache file unreadable ({_cache_err}) — falling through to live call")

    # ── No-API re-render mode ────────────────────────────────────────
    # When the caller passes reuse_markdown, skip the Sonnet call entirely
    # and reuse the already-generated/edited markdown. Only the
    # deterministic post-processing below (brand HTML, supplement schedule,
    # portion-plate, print buttons) runs. $0, no API. Used after manual
    # letter edits or when a rendering rule changes.
    reuse_md = payload.get("reuse_markdown")
    if reuse_md:
        markdown = reuse_md
        _step(f"reuse_markdown mode — skipping Sonnet + Haiku ({len(markdown)} chars, $0 — re-rendering HTML only)")
    if not reuse_md:
        _step("calling Sonnet (streaming, max 16K output tokens — typical 60–180s)")
        try:
            token_count = 0
            with client_api.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=16000,
                system=(
                    "You are Shivani Hariharan — a Functional Medicine health coach in "
                    "India — writing a personal letter TO your client. Write entirely "
                    "in FIRST PERSON. Use 'I', 'me', 'my', 'we', and 'our' (you and the "
                    "client together on this journey). Never refer to yourself as "
                    "'Shivani' or 'your coach' in the third person — the letter is "
                    "signed by you, so saying 'check with Shivani' or 'Shivani recommends' "
                    "would make zero sense to the reader. The ONLY exception is when "
                    "you reference something the client and you discussed in a past "
                    "session and you're recalling it ('the wall analogy I shared with "
                    "you in our first session') — even then, prefer 'I shared' over "
                    "'Shivani shared'. "
                    "\n\nTONE — IMPORTANT: write to an intelligent adult. Be warm, "
                    "direct, and respectful — like a competent friend who happens to "
                    "be your coach. AVOID:\n"
                    "  - Patronising reassurance like 'you are not broken' or 'this is "
                    "    not your fault' (it presumes she feels broken / blaming "
                    "    herself, which we don't know).\n"
                    "  - Excessive validation ('I'm SO excited!', 'amazing job!', "
                    "    'such a gift!'). One quiet sentence of warmth at intake is "
                    "    fine; don't sprinkle exclamation marks throughout.\n"
                    "  - Therapeutic / self-help register ('honour your body', "
                    "    'sit with this', 'lean into the discomfort').\n"
                    "  - Over-explaining what the client already knows. If she's "
                    "    been through a Full Assessment session, she understands her "
                    "    diagnosis — recap in one or two sentences max, not three "
                    "    paragraphs.\n"
                    "  - Talking down ('think of your gut lining as a wall...' for "
                    "    the third letter in a row). Use analogies sparingly and only "
                    "    once per concept across the full plan.\n"
                    "PREFER: clinically grounded warmth. Plain English. Real specifics "
                    "tied to her data. Short paragraphs. Reasoning given once, not "
                    "repeated. If she's already in week 3, write to a competent adult "
                    "who's been doing the work — not a beginner who needs hand-holding.\n\n"
                    "\nSUPPLEMENT INTEGRITY — CRITICAL: the supplement protocol is "
                    "100% coach-controlled and provided to you in the prompt as a "
                    "structured list. NEVER suggest a supplement, pill, capsule, "
                    "tablet, dose, or brand that is NOT in that structured list. "
                    "If a supplement was previously prescribed and the coach has "
                    "since removed it (e.g. selenium → discontinued), do NOT "
                    "re-introduce it in the narrative. You may reference food "
                    "sources of nutrients ('your daily Brazil nuts provide "
                    "selenium for thyroid support', 'lentils give you iron') — "
                    "that's nutrition, not supplementation. The line is: do not "
                    "tell the client to take ANY pill that isn't in the list. "
                    "The Python-generated supplement schedule injected after this "
                    "section is the canonical record; your job is to weave the "
                    "supplements that ARE in the list into the narrative where "
                    "relevant, never invent new ones.\n\n"
                    "CONSISTENCY RULES — avoid these specific contradictions:\n"
                    "  - IRON/MINERAL TIMING: if the client is on a thyroid tablet "
                    "(levothyroxine / Thyronorm), iron, calcium and magnesium MUST be "
                    "described as taken AT LEAST 4 HOURS APART from it — NEVER 'first "
                    "thing in the morning' / 'on an empty stomach' (that slot belongs to "
                    "the thyroid tablet). The prose AND the supplement schedule must "
                    "agree on this.\n"
                    "  - DAIRY: do NOT assume the client is dairy-free. Only suggest "
                    "dairy-free swaps (coconut yogurt, coconut milk, etc.) when the "
                    "client is explicitly flagged dairy-free. Never mix dairy-free items "
                    "with dairy ones (coconut yogurt AND golden milk AND curd) in the "
                    "same plan — use what matches the client's actual diet.\n"
                    "  - SEED CYCLING: do NOT frame flax / pumpkin / sesame / sunflower "
                    "as 'seed cycling' or phase-timed unless the plan explicitly calls "
                    "for it. For estrogen-dominance / endometriosis clients, present "
                    "these as daily nutrients (fibre, omega-3, zinc) — not seed cycling.\n"
                    "  - NO REPETITION: give the 'foods to emphasise / foods to reduce' "
                    "list exactly ONCE. Do not repeat the same eat-more/eat-less list in "
                    "two different sections.\n\n"
                    "Output beautifully formatted Markdown. Output ONLY the Markdown "
                    "document, nothing else."
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
                # Truncation guard (audit Phase-1b): if Sonnet hit the output
                # token cap the letter is cut off mid-sentence. Bail BEFORE any
                # post-processing or cache write so a truncated clinical letter
                # is never shipped/cached as ok:true.
                if getattr(final_message, "stop_reason", None) == "max_tokens":
                    json.dump({"ok": False, "markdown": "",
                               "error": "letter truncated — hit the output token limit; not saved. Retry or shorten the plan."},
                              sys.stdout)
                    return 1
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
    # In reuse_markdown (no-API re-render) mode, skip the Haiku validation
    # pass too — it's an API call and the markdown is already final.
    skip_validation = bool(payload.get("skip_validation")) or bool(payload.get("reuse_markdown"))
    _step("validating letter specificity (Haiku)")
    try:
        markdown, validation_report = _validate_letter_specificity(
            markdown, client, plan, skip=skip_validation
        )
    except Exception as e:
        # Validator is QA-only — its failure must NEVER kill the letter we
        # already paid Sonnet $0.30+ to generate. Log to stderr, ship the
        # un-validated markdown.
        import traceback
        tb_lines = traceback.format_exc().splitlines()
        _step(f"validator crashed ({type(e).__name__}: {e}) — shipping unvalidated letter")
        for line in tb_lines[-6:]:
            print(f"[validate] {line}", file=sys.stderr, flush=True)
        validation_report = []
    _step(f"validation done ({len(validation_report) if validation_report else 0} tips rewritten)")

    # ── Supplement-integrity post-check ──────────────────────────
    # Hard regex check on top of the soft AI prompt rule. Scans the
    # generated markdown for any mention of supplement display names
    # NOT in the current supplement_protocol. Catches AI drift where
    # narrative momentum re-introduces a removed supplement (e.g.
    # selenium got dropped from the plan but the AI says "your daily
    # selenium 200mcg"). Flags get added to validation_report; we DON'T
    # auto-strip (false-positives on food references like "Brazil nuts
    # → selenium" are common), just surface for coach review. (B5).
    try:
        active_slugs = {
            (s.get("supplement_slug") or "").lower()
            for s in (plan.get("supplement_protocol") or [])
            if isinstance(s, dict)
        }
        active_names_lower = {
            _strip_brand_from_name(
                (s.get("display_name") or s.get("supplement_slug", "").replace("-", " ").title())
            ).lower()
            for s in (plan.get("supplement_protocol") or [])
            if isinstance(s, dict)
        }
        # Known supplements coach has ever prescribed (for prior plans) —
        # scan the body for any of these that are NOT in the current
        # active list. We use the catalogue's published supplement slugs
        # as the universe.
        WATCH_LIST = {
            "selenium", "magnesium glycinate", "magnesium", "omega-3",
            "omega 3", "ashwagandha", "probiotics", "curcumin",
            "vitamin d", "vitamin d3", "vitamin b12", "b12",
            "l-glutamine", "l glutamine", "glutamine",
            "zinc", "iron", "iodine", "tudca", "n-acetylcysteine", "nac",
            "coq10", "alpha lipoic acid",
        }
        # A token is "leaked" if it appears in the markdown but its
        # name token doesn't match any active supplement name. Use word
        # boundaries to avoid false positives on partial matches.
        body_lower = markdown.lower()
        leaks: list[str] = []
        for token in WATCH_LIST:
            if token in active_names_lower or any(token in n for n in active_names_lower):
                continue  # supplement is active; mentions are fine
            if any(token in s for s in active_slugs):
                continue
            # Use a word-boundary check so "selenium" doesn't false-
            # positive in "selenoprotein" (unlikely but defensive).
            pattern = re.compile(rf"\b{re.escape(token)}\b", re.IGNORECASE)
            if pattern.search(body_lower):
                # Common food-source references that are LEGITIMATELY
                # in the letter (nutrition advice, not supplementation).
                # Allow these whitelisted contexts.
                FOOD_CONTEXT_PATTERNS = [
                    rf"brazil nut[s]?\b[^.]*\b{token}",
                    rf"food source[s]?[^.]*\b{token}",
                    rf"dietary {token}",
                    rf"{token} from food",
                    rf"{token}-rich food",
                ]
                if any(re.search(p, body_lower) for p in FOOD_CONTEXT_PATTERNS):
                    continue
                leaks.append(token)

        if leaks:
            _step(f"⚠ supplement-integrity check: possible mentions of removed supplements: {', '.join(leaks)}")
            # Surface as a validation_report entry so coach sees it in
            # the letter-editor right pane.
            for leak in leaks:
                validation_report.append({
                    "original_tip": f"(any mention of '{leak}')",
                    "score": 2,
                    "reason": (
                        f"⚠ Supplement-integrity flag: '{leak}' is referenced in the letter but is NOT "
                        f"in the active supplement_protocol. This may be AI drift after a removal. "
                        f"Check whether the mention is a food-source reference (fine) or a supplement "
                        f"recommendation (needs fix — open the AI Refine chat and ask to remove or "
                        f"re-anchor to a food source)."
                    ),
                    "rewrite": "",
                })
    except Exception as e:
        print(f"[render-letter] supplement-integrity check failed ({type(e).__name__}: {e})",
              file=sys.stderr, flush=True)

    # ── Recipe split-out for phase letters ─────────────────────────
    # Coach decision 2026-05-19: phase meal-plan letters were running
    # 7+ pages because the recipe appendix occupied half the document.
    # Strip the recipe appendix out of the main letter markdown,
    # replace it with a "📎 Recipes — attached separately" pointer,
    # and stash the recipe content for sidecar HTML/MD generation
    # downstream. The sidecar file lives next to the main letter as
    # `<stem>-recipes.md/.html` and ships as an email attachment.
    #
    # Detection: the prompt asks for `## ✦ Recipe Appendix` heading.
    # We extract from that heading to the next `## ` (or end of doc),
    # whichever comes first.
    recipes_md: str | None = None
    if letter_type in ("meal_plan_phase", "meal_plan") and markdown:
        # Emoji-agnostic: the prompt says ✦, but the model freely
        # substitutes ✨, ⭐, 🍴, etc. — and if the heading emoji doesn't
        # match, the appendix silently stays embedded and the letter
        # balloons to 7+ pages (coach bug 2026-05-20: Dhanishta's wk3-4
        # letter used ⭐). Anchor on the words "Recipe Appendix" and
        # allow any decorative prefix between "## " and the words.
        m = re.search(
            # Stop the capture before the sign-off too (audit Phase-1b): the
            # AI closing ("**With warmth,** / **Shivani**" / "— Shivani") has no
            # ## heading, so the old `(?=\n##\s+|\Z)` ran to \Z and swallowed it
            # into the recipe sidecar — the main letter ended abruptly.
            r"(?m)^(##\s+[^\n]*?Recipe\s+Appendix.*?)(?=\n##\s+|\n\s*\*\*With\s+warmth|\n\s*—\s*Shivani|\Z)",
            markdown,
            flags=re.DOTALL | re.IGNORECASE,
        )
        if m:
            recipes_md = m.group(1).strip() + "\n"
            # Clickable link to the public recipe-pack page. Root-relative
            # so it resolves on whatever origin the letter is opened from
            # (the client opens the letter at /letter/<token>, so
            # /recipes/<slug> lands on the same host). This is how the
            # recipe pack actually reaches the client — the old wording
            # said "attached to this email", which is no longer true
            # since the WhatsApp cutover.
            # Use the stable per-plan letter_token when present so the client's
            # recipe link survives letter regeneration (and is unguessable);
            # fall back to the slug. The /recipes route resolves either.
            _recipes_id = plan.get("letter_token") or plan_slug
            recipes_url = f"/recipes/{_recipes_id}"
            pointer = (
                "## 📎 Your Recipe Pack\n\n"
                f"The recipes for this fortnight's new dishes — full "
                f"ingredients and method — are in your **Recipe Pack**, "
                f"kept separate so this letter stays short and easy to scan.\n\n"
                f"👉 **[Open your recipe pack]({recipes_url})**\n\n"
                f"Save it to your phone for easy reference in the kitchen.\n\n"
            )
            markdown = markdown[: m.start()] + pointer + markdown[m.end():]
            _step(f"split out recipe appendix ({len(recipes_md)} chars) → sidecar pending")

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

        # Compute effective start dates for the in-letter WhatsApp confirm
        # buttons (brand_html._start_date_buttons_html). Mirrors the Python
        # Plan.effective_*_start helpers — if the coach has asserted actual
        # dates use those, else fall back to plan_period_start + 3d/7d.
        from datetime import datetime as _dt, timedelta as _td

        def _coerce_ymd(v):
            if v is None or v == "":
                return None
            if isinstance(v, str):
                try:
                    return _dt.fromisoformat(v[:10]).date()
                except Exception:
                    return None
            if hasattr(v, "year"):
                return v.date() if isinstance(v, _dt) else v
            return None

        _ps = _coerce_ymd(plan.get("plan_period_start"))
        _ma = _coerce_ymd(plan.get("meal_plan_started_on"))
        _sa = _coerce_ymd(plan.get("supplements_started_on"))
        meal_ymd = (_ma or (_ps + _td(days=3)) if _ps else None) if _ma is None else _ma
        if meal_ymd is None and _ps:
            meal_ymd = _ps + _td(days=3)
        supp_ymd = _sa if _sa else (_ps + _td(days=7) if _ps else None)

        # Template guardrail (LETTER_TEMPLATE_SPEC): a consolidated letter MUST
        # carry the <!--FM:TAKE--> and <!--FM:PLATE--> markers so the Take/Eat
        # blocks land in the coach-approved order (Why → Take → Eat → …). The
        # dashboard prompt emits them automatically; a hand-authored
        # (reuse_markdown / chat) letter might omit them. If so, auto-insert at
        # the right anchors + warn — so BOTH generation paths produce the
        # identical structure regardless of how the markdown was authored.
        if letter_type == "consolidated":
            _missing = []
            if "<!--FM:TAKE-->" not in markdown:
                _missing.append("TAKE")
                _eat = re.search(r'(?im)^##\s.*(what to eat|🍽|meal plan|🗓)', markdown)
                if _eat:
                    markdown = markdown[:_eat.start()] + "<!--FM:TAKE-->\n\n" + markdown[_eat.start():]
                else:
                    markdown += "\n\n<!--FM:TAKE-->\n"
            if "<!--FM:PLATE-->" not in markdown:
                _missing.append("PLATE")
                _eat = re.search(r'(?im)^##\s.*(what to eat|🍽|meal plan|🗓).*$', markdown)
                if _eat:
                    markdown = markdown[:_eat.end()] + "\n\n<!--FM:PLATE-->\n" + markdown[_eat.end():]
                else:
                    markdown = markdown.replace("<!--FM:TAKE-->", "<!--FM:TAKE-->\n\n<!--FM:PLATE-->", 1)
            if _missing:
                _step(f"⚠ template guardrail: auto-inserted missing marker(s) {', '.join(_missing)} — structure normalized to spec")

        html = wrap_in_brand_html(
            markdown,
            title=doc_title,
            subtitle=display_name,
            doc_type=doc_type,
            client_name=display_name,
            meal_start_ymd=meal_ymd.isoformat() if meal_ymd else None,
            supplements_start_ymd=supp_ymd.isoformat() if supp_ymd else None,
            plan_slug=plan.get("slug"),
            letter_type=letter_type,
            recipes_link_id=plan.get("letter_token"),
        )
        # Inject the "Building Your Plate" portions visual at the top of the
        # letter body. Per LETTER_TEMPLATE_SPEC (coach-approved 2026-06-04):
        # the plate is a FIRST-LETTER section only — fortnight (meal_plan_phase)
        # letters drop it (it's a static reference the client already has).
        if html and letter_type in ("consolidated", "meal_plan"):
            try:
                import re as _re_plate
                plate_html = _build_portion_plate_html(
                    client.get("meal_plan_style") or "hybrid",
                    client.get("dietary_preference") or "",
                )
                if plate_html and "<!--FM:PLATE-->" in html:
                    # Marker mode: plate sits in the "Eat" group where the body placed it.
                    html = html.replace("<!--FM:PLATE-->", plate_html, 1)
                else:
                    _pm = _re_plate.search(r'(<div class="content"[^>]*>)', html)
                    if _pm and plate_html:
                        html = html[: _pm.end()] + "\n      " + plate_html + html[_pm.end():]
            except Exception as _plate_err:
                print(f"[render-letter] plate inject failed ({type(_plate_err).__name__}: {_plate_err})",
                      file=sys.stderr, flush=True)
        # Inject Python-generated supplement sections (guaranteed complete +
        # buy-link-correct regardless of what the AI wrote). Two pieces:
        #   1. Shopping list — upfront "buy everything now" table with
        #      start-week annotations. Goes FIRST so the client can place
        #      one order before reading the rest of the letter.
        #   2. Detailed dose schedule — timing slots + daily routine.
        # Only inject for types that include supplements (not meal_plan/lifestyle_guide).
        supplements = plan.get("supplement_protocol") or []
        # Coach feedback 2026-05-19: include the supplement schedule in
        # follow-up phase letters too — clients forget or start skipping
        # supplements after the initial week. Re-printing the full
        # schedule in every fortnight's letter keeps adherence high.
        # Was previously only consolidated + supplement_plan.
        inject_schedule = letter_type in (
            "consolidated",
            "supplement_plan",
            "meal_plan_phase",
            "meal_plan",
        )
        if supplements and html and inject_schedule:
            plan_weeks_int = int(plan.get("plan_period_weeks") or 12)
            # Consolidated / meal-plan letters cover the FIRST fortnight —
            # the routine + schedule show only what the client starts in
            # weeks 1-2 (the every-2-weeks phase letters introduce the
            # rest, so a new client isn't handed a scary 15-line list).
            # The shopping list still carries everything, with calendar
            # start dates instead of "week N".
            _supp_window = (
                phase_end
                if (letter_type == "meal_plan_phase" and phase_end)
                else (2 if letter_type in ("consolidated", "meal_plan") else None)
            )
            _supp_anchor = (
                plan.get("supplements_started_on")
                or plan.get("meal_plan_started_on")
                or plan.get("plan_period_start")
            )
            # Per LETTER_TEMPLATE_SPEC: the complete shopping list (bulk
            # weekly-supply buying math) is a FIRST-LETTER section only.
            # Fortnight (meal_plan_phase) letters omit it — any NEW supplement
            # that fortnight is surfaced in the AI "what's new this phase"
            # section with its own buy link instead.
            # Coach 2026-06-07: replace the full dose/why schedule table + the
            # weekly-quantity shopping list (both carried the buy links, so the
            # supplements appeared ~3 times) with a single plain "Buy here"
            # list. FIRST LETTER ONLY — fortnight (meal_plan_phase) letters omit
            # it; a new supplement that phase carries its own link in the AI
            # "what's new this phase" section instead.
            buy_list_html = (
                ""
                if letter_type == "meal_plan_phase"
                else _build_supplement_buy_list_html(supplements)
            )
            combined = buy_list_html
            # Conditional '🍵 Drinks & digestives' — only if the plan carries
            # catalogue home_remedies or bespoke custom_remedies. Shown in every
            # letter type (it's a daily ritual, not a first-letter-only block).
            remedies_html = _build_remedies_html(plan)
            if remedies_html:
                combined = (combined + "\n" + remedies_html) if combined else remedies_html
            # The integrated Daily Routine timeline — placed at the TOP of
            # the letter (right before .content) so the client can't miss
            # it. It's the one they print and keep. Injected as a sibling
            # of .content so the print-routine CSS can isolate it.
            import re as _re_dr
            routine_html = _build_daily_routine_html(plan, window_end_week=_supp_window)
            # Marker mode (LETTER_TEMPLATE_SPEC): if the letter body contains
            # the <!--FM:TAKE--> placeholder, the whole "Take" block (day
            # schedule → screen-only supplement table → shopping list) is
            # placed there, in the coach-approved order (Why → Take → Eat …).
            # Otherwise fall back to the legacy positional injection.
            _take_marker = "<!--FM:TAKE-->"
            _take_marker_mode = bool(routine_html) and _take_marker in (html or "")
            if _take_marker_mode:
                # Day schedule leads the Take block; combined (table + list)
                # follows. Final placement happens at the marker below.
                combined = routine_html + "\n" + combined
            elif routine_html:
                _co = _re_dr.compile(r'(<div class="content"[^>]*>)')
                _m = _co.search(html)
                if _m:
                    html = html[: _m.start()] + routine_html + "\n      " + html[_m.start():]
                elif '<footer class="brand-footer">' in html:
                    html = html.replace(
                        '<footer class="brand-footer">',
                        routine_html + "\n    " + '<footer class="brand-footer">', 1,
                    )
            # Position depends on letter type:
            #
            #  - consolidated / supplement_plan / lifestyle_guide: schedule
            #    goes at the BOTTOM (existing behaviour). The wellness
            #    letter narrative is the lead, supplement protocol is
            #    reference at the end.
            #
            #  - meal_plan_phase / meal_plan: schedule goes at the TOP,
            #    right after the title block (coach decision 2026-05-19).
            #    Follow-up letters are check-in artifacts — clients have
            #    already seen the narrative; what they need is the
            #    current supplement schedule visible BEFORE the meal
            #    tables so they don't forget or start skipping.
            top_position_types = ("meal_plan_phase", "meal_plan")
            # Inject AS A SIBLING of <div class="content">, not a child.
            # Reason: the print-supplement CSS hides .page > .content so
            # only the supplement schedule prints. If schedule lives
            # inside .content, its ancestor's display:none kills it too
            # and the print is blank (coach bug 2026-05-19). Sibling
            # injection avoids that — schedule + content coexist as
            # siblings of .page; CSS hides .content + shows
            # #supplement-schedule in print mode.
            import re as _re
            content_open_re = _re.compile(r'(<div class="content"[^>]*>)')
            content_close_marker = '</div>\n\n    <!-- Footer -->'
            if _take_marker_mode:
                # Marker mode: drop the whole Take block where the body asked.
                html = html.replace(_take_marker, combined, 1)
            elif letter_type in top_position_types:
                # TOP-position: insert combined BEFORE <div class="content">
                m = content_open_re.search(html)
                if m:
                    html = html[: m.start()] + combined + "\n      " + html[m.start():]
                else:
                    footer_marker = '<footer class="brand-footer">'
                    if footer_marker in html:
                        html = html.replace(footer_marker, combined + "\n    " + footer_marker, 1)
            else:
                # Default: bottom-insert AFTER </div> closing .content,
                # before the brand-footer. Still siblings — print-supp
                # isolation works either way.
                if content_close_marker in html:
                    html = html.replace(
                        content_close_marker,
                        '</div>\n\n      ' + combined + '\n\n    <!-- Footer -->',
                        1,
                    )
                else:
                    footer_marker = '<footer class="brand-footer">'
                    if footer_marker in html:
                        html = html.replace(footer_marker, combined + "\n    " + footer_marker, 1)
                    elif "</body>" in html:
                        html = html.replace("</body>", combined + "\n</body>", 1)
    except Exception as e:
        html = None  # HTML is a nice-to-have; don't fail if brand module errors

    # Build the recipes sidecar HTML if we extracted a recipe section
    # above. Uses the same brand template (Deep Mind palette + Libre
    # Baskerville) so the attachment looks consistent with the main
    # letter when the client opens it.
    recipes_html: str | None = None
    if recipes_md:
        try:
            from brand_html import wrap_in_brand_html as _wrap_recipes
            recipes_doc_title = (
                f"Recipes — Week {phase_start}" if phase_start == phase_end
                else f"Recipes — Weeks {phase_start}–{phase_end}"
            ) if (phase_start and phase_end) else "Recipes"
            recipes_html = _wrap_recipes(
                (
                    f"# {recipes_doc_title} ({display_name or client.get('client_id') or ''})\n\n"
                    f"Your recipe pack for this fortnight — full ingredients + method "
                    f"for every ✦ dish in the meal plan. Save to your phone for easy "
                    f"kitchen reference.\n\n"
                    + recipes_md
                ),
                title=recipes_doc_title,
                subtitle=display_name,
                doc_type="Recipe Pack",
                client_name=display_name,
                plan_slug=plan.get("slug"),
                letter_type="recipes",
            )
        except Exception as e:
            print(f"[render-letter] recipes-sidecar build failed ({type(e).__name__}: {e})",
                  file=sys.stderr, flush=True)

    _output_payload = {
        "ok": True,
        "markdown": markdown,
        "html": html,
        "validation_report": validation_report,
        # Sidecar files written alongside the main letter when the
        # save layer sees these populated. Phase-letter recipes only.
        "recipes_markdown": recipes_md,
        "recipes_html": recipes_html,
        "error": None,
    }

    # ── Letter cache WRITE (E.2) ───────────────────────────────────────
    # Persist the rendered letter + sidecar so subsequent identical
    # regenerations short-circuit at the cache-check above. Best-effort
    # — a failed write must never break the user flow.
    if not _letter_cache_disabled:
        try:
            _letter_cache_dir.mkdir(parents=True, exist_ok=True)
            _out_to_cache = {
                **_output_payload,
                "_cached_at": datetime.now(timezone.utc).isoformat(),
                "_cache_key": _letter_cache_key,
            }
            with open(_letter_cache_file, "w") as _fh:
                json.dump(_out_to_cache, _fh)
            _step(f"cache WRITE → {_letter_cache_file.name}")
        except Exception as _cache_err:
            _step(f"cache write failed ({_cache_err}) — non-fatal")

    json.dump(_output_payload, sys.stdout)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        # Belt-and-braces: even though main() is one-shot per subprocess
        # invocation today, reset the module-level backdate global so a
        # future caller that reuses the process can't inherit stale state.
        _AS_OF_OVERRIDE = None

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
import sys
from pathlib import Path

FMDB_ROOT = Path("/Users/shivani/code/healwithshivanih-ads/fm-database")
PLANS_ROOT = Path.home() / "fm-plans"
sys.path.insert(0, str(FMDB_ROOT))


# ---------------------------------------------------------------------------
# VitaOne supplement catalog — verified live URLs (scraped 2026-05-04)
# Referral code format: ?pr=vita13720sh appended to each product URL
# ---------------------------------------------------------------------------
_V = "https://vitaone.in/shop/"
_R = "?pr=vita13720sh"
IHERB_AFFILIATE = "https://in.iherb.com/?rcode=LWG566"

def _v(slug: str, name: str) -> tuple[str, str]:
    """Build a (display_name, url_with_referral) tuple for a VitaOne product."""
    return (name, f"{_V}{slug}{_R}")

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
        return yaml.safe_load(p.read_text())
    except Exception:
        return None


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


def _vitaone_link(supplement_name: str) -> str | None:
    """Try to find a match for a supplement name across custom, VitaOne, Amazon catalogs.
    Returns a markdown link string, or None if not found anywhere."""
    nl = supplement_name.lower()
    # Custom coach-managed links take top priority
    for kw, (product, url) in _load_custom_links().items():
        if kw in nl or nl in kw:
            return f"[{product}]({url}) *(affiliate link)*"
    # VitaOne catalog
    for kw, (product, url) in VITAONE_CATALOG.items():
        if kw in nl:
            return f"[{product}]({url}) *(VitaOne — referral link)*"
    # Amazon fallback
    for kw, (product, url) in AMAZON_CATALOG.items():
        if kw in nl:
            return f"[{product}]({url}) *(Amazon affiliate link)*"
    return None


def _vitaone_url_only(supplement_name: str) -> tuple[str, str] | None:
    """Returns (product_name, url) for a supplement, or None."""
    nl = supplement_name.lower()
    for kw, (product, url) in _load_custom_links().items():
        if kw in nl or nl in kw:
            return (product, url)
    for kw, (product, url) in VITAONE_CATALOG.items():
        if kw in nl:
            return (product, url)
    for kw, (product, url) in AMAZON_CATALOG.items():
        if kw in nl:
            return (product, url)
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
        name = s.get("display_name") or s.get("supplement_slug", "").replace("-", " ").title()
        dose = s.get("dose") or s.get("dose_display") or ""
        timing_raw = s.get("timing") or ""
        rationale = (s.get("coach_rationale") or "").split("\n")[0].strip()
        # Strip evidence-tier note suffix if present
        if "[evidence-tier note]" in rationale:
            rationale = rationale.split("[evidence-tier note]")[0].strip()
        # Buy link: prefer explicit buy_link on item, then catalog lookup
        buy_link_override = s.get("buy_link") or ""
        link_info = _vitaone_url_only(name) if not buy_link_override else None
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


def _build_prompt_meal_plan(plan: dict, client: dict, weight_loss: dict | None, coach_notes: str) -> str:
    """Meal plan only — 12-week nutrition journey, no supplements, no lifestyle."""
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

    prompt = f"""You are writing a warm, friendly 12-week MEAL PLAN document for a client.
The coach (Shivani Hariharan) has prepared a structured plan. Turn the nutrition data into a beautiful, practical meal plan the client can actually USE.

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

1. **Warm greeting** — 2–3 sentences welcoming {first_name}, naming this as a 12-week nutrition journey.

2. **Your 12-Week Nutrition Overview** — brief half-page map of the 6 phases, nutrition lens only.

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

5. **Your 12-Week Roadmap** — one short paragraph per phase, nutrition focus only, no meal tables

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

    prompt = f"""You are writing a short supplement protocol introduction letter for a client.

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
    lifestyle = plan.get("lifestyle_practices") or []
    education = plan.get("education") or []
    labs = plan.get("lab_orders") or []
    tracking = plan.get("tracking") or {}
    tracking_habits = (tracking.get("habits") or [])
    tracking_symptoms = (tracking.get("monitor_symptoms") or [])
    recheck_questions = (tracking.get("recheck_questions") or [])

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

    prompt = f"""You are writing a warm, practical 12-week COACHING PLAN for a client — covering lifestyle, learning, labs, and tracking.
This document is the companion to the meal plan and supplement plan. It covers everything EXCEPT food and supplements.
The coach (Shivani Hariharan) has prepared the structured data below.

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

1. **Warm greeting** — 2–3 sentences: you are {first_name}'s guide for the next 12 weeks, this plan covers your lifestyle, learning, and health monitoring.

2. **Your Healing Framework** — brief 12-week arc from a lifestyle and wellness lens. What each phase focuses on (not food-focused — mindset, stress, sleep, habits, learning).

3. **Movement & Exercise** — `## 🏃 Movement & Exercise`
   Phased movement plan across 12 weeks. Adapt to any conditions noted. Include frequency, type, duration, and a specific example per phase. Frame as energy-building, not calorie-burning.

4. **Daily Lifestyle Practices** — `## 🌙 Daily Lifestyle Practices`
   Expand the lifestyle practices into actionable daily routines. Group by theme (morning routine, sleep practices, stress techniques, breathwork). Use bullet lists.

5. **What to Learn** — `## 📚 What to Learn`
   Present the education modules as a phased reading/learning plan. Group by phase. For each module explain WHY it matters in plain language (no jargon).

6. **Labs to Order** — `## 🔬 Labs to Order`
   Present the lab orders in plain English ("Ask your doctor for..."). Explain what each test reveals in simple terms. Group by when to order (baseline / 6-week / 12-week).

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


def _build_prompt(plan: dict, client: dict, weight_loss: dict | None = None,
                  letter_type: str = "consolidated", coach_notes: str = "") -> str:
    """Build the full prompt for Claude. Dispatches to type-specific builders for non-consolidated types."""

    if letter_type == "meal_plan":
        return _build_prompt_meal_plan(plan, client, weight_loss, coach_notes)
    if letter_type == "supplement_plan":
        return _build_prompt_supplement_plan(plan, client, coach_notes)
    if letter_type == "lifestyle_guide":
        return _build_prompt_lifestyle_guide(plan, client, coach_notes)
    # else: consolidated — fall through to existing code

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
    lifestyle = plan.get("lifestyle_practices") or []
    nutrition = plan.get("nutrition") or {}
    education = plan.get("education") or []
    labs = plan.get("lab_orders") or []
    tracking = plan.get("tracking") or {}

    # Build supplement guide — sorted by time of day, ALL items included
    supp_enriched = []
    for s in supplements:
        name = s.get("display_name") or s.get("supplement_slug", "").replace("-", " ").title()
        dose = s.get("dose") or s.get("dose_display") or ""
        timing = s.get("timing") or ""
        rationale = (s.get("coach_rationale") or "").split("[evidence-tier note]")[0].strip()
        slot_idx, slot_label, slot_emoji = _timing_slot(timing)
        buy_link_override = s.get("buy_link") or ""
        vitaone = _vitaone_link(name)
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
    tracking_habits = (tracking.get("habits") or [])
    tracking_symptoms = (tracking.get("monitor_symptoms") or [])

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

    prompt = f"""You are writing a warm, friendly, practical wellness plan letter for a client.
The coach (Shivani Hariharan, a functional medicine health coach) has prepared this structured plan.
Your job is to turn the coach's structured data into a beautiful, easy-to-read document the client can actually USE.

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

Write a complete, warmly-toned 12-WEEK HEALING PLAN document in Markdown.
This is NOT a one-week meal plan. It is a structured healing journey across 12 weeks, shared with the client 2 weeks at a time.
The plan must have a logical therapeutic progression — each phase builds on the last.

## Healing phases (the 12-week arc):
- **Weeks 1–2 (Foundation):** Remove biggest inflammatory triggers, establish daily rhythm, introduce 2–3 key supplements. Gentle start — build trust and consistency.
- **Weeks 3–4 (Repair):** Gut lining support, introduce fermented foods, add healing broths/teas. Deepen supplement protocol.
- **Weeks 5–6 (Rebalance):** Hormone and blood sugar focus. Specific foods for hormonal balance. Stress reduction becomes intentional practice.
- **Weeks 7–8 (Strengthen):** Deeper nourishment — therapeutic foods, mitochondrial support, energy focus. Introduce more variety.
- **Weeks 9–10 (Optimize):** Fine-tune based on what's working. Circadian rhythm, sleep, and deeper lifestyle work.
- **Weeks 11–12 (Sustain):** Long-term habit anchoring. Transition to maintenance. Celebrate progress.

## Document structure:

1. **Warm greeting** — 2–3 sentences welcoming {first_name}, naming this as a 12-week journey, setting an excited but calm tone. No clinical words.

2. **Your Healing Journey — The 12-Week Overview**
   A brief (half-page) map of the 6 phases above — what each phase focuses on and why in this order.
   Written in plain language. E.g. "In weeks 1–2 we focus on foundations — clearing the path so your body can start healing. By weeks 5–6 we'll be working on your hormones and energy. By week 12 you'll have a way of eating and living that feels completely yours."

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
   Bullet list. Specific, doable. Adapted to her available days and any limitations.

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

9. **A note from your coach** — warm closing. Remind {first_name} this is a 12-week journey, not a sprint. Shivani's name.

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
{coach_notes_block}
{INDIAN_BRANDS}
"""
    return prompt


def main() -> int:
    _load_dotenv()

    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "markdown": "", "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    plan_slug = payload.get("plan_slug", "")
    client_id = payload.get("client_id", "")
    weight_loss = payload.get("weight_loss") or {}
    letter_type = payload.get("letter_type") or "consolidated"
    coach_notes = (payload.get("coach_notes") or "").strip()

    if not plan_slug:
        json.dump({"ok": False, "markdown": "", "error": "plan_slug is required"}, sys.stdout)
        return 2

    plan = _load_plan(plan_slug)
    if plan is None:
        json.dump({"ok": False, "markdown": "", "error": f"Plan not found: {plan_slug}"}, sys.stdout)
        return 2

    if not client_id:
        client_id = plan.get("client_id", "")
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

    try:
        from anthropic import Anthropic
    except ImportError as e:
        json.dump({"ok": False, "markdown": "", "error": f"anthropic not installed: {e}"}, sys.stdout)
        return 1

    prompt = _build_prompt(plan, client, weight_loss=weight_loss, letter_type=letter_type, coach_notes=coach_notes)

    client_api = Anthropic(api_key=api_key)

    try:
        with client_api.messages.stream(
            model="claude-sonnet-4-5",
            max_tokens=16000,
            system=(
                "You are a skilled health coach writer. You produce warm, practical, "
                "beautifully formatted Markdown wellness plans for clients in India. "
                "You write like a knowledgeable, encouraging friend — never clinical. "
                "Output ONLY the Markdown document, nothing else."
            ),
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            markdown = stream.get_final_message().content[0].text
    except Exception as e:
        json.dump({"ok": False, "markdown": "", "error": f"API call failed: {e}"}, sys.stdout)
        return 1

    # Generate branded HTML
    try:
        from brand_html import wrap_in_brand_html
        display_name = client.get("display_name") or ""
        type_meta = {
            "meal_plan":       ("Your Personalised Meal Plan",    "Meal Plan"),
            "supplement_plan": ("Your Supplement Protocol",        "Supplement Plan"),
            "lifestyle_guide":  ("Your Lifestyle Guide",             "Lifestyle Guide"),
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
        # Inject the Python-generated supplement schedule (guaranteed complete)
        # so that no supplement is ever omitted regardless of what the AI wrote.
        # Only inject for types that include supplements (not meal_plan/lifestyle_guide).
        supplements = plan.get("supplement_protocol") or []
        inject_schedule = letter_type in ("consolidated", "supplement_plan")
        if supplements and html and inject_schedule:
            schedule_html = _build_supplement_schedule_html(supplements)
            # Insert INSIDE the .page container, right before the brand footer.
            # This keeps the schedule within the brand-styled max-width box and
            # ensures @media print rules for #supplement-schedule apply correctly.
            footer_marker = '<footer class="brand-footer">'
            if footer_marker in html:
                html = html.replace(footer_marker, schedule_html + "\n    " + footer_marker, 1)
            elif "</body>" in html:
                # fallback — shouldn't happen with current template
                html = html.replace("</body>", schedule_html + "\n</body>", 1)
    except Exception as e:
        html = None  # HTML is a nice-to-have; don't fail if brand module errors

    json.dump({"ok": True, "markdown": markdown, "html": html, "error": None}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

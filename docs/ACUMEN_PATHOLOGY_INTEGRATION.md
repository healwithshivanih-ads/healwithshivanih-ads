# Acumen Diagnostics — Pathology Integration Plan

**Status:** Proposal / pre-negotiation. Data layer scaffolded; pricing sheet generated.
**Source docs:** `~/Downloads/Acumen Diagnostics/` — Acumen DOS.pdf (full B2B Directory of Services) + 11 consumer-panel marketing images.
**Date:** 2026-06-16.

---

## 1. What Acumen actually is

Two distinct things in the documents:

1. **The DOS (Directory of Services)** — Acumen's full B2B reference-lab menu (~1,000+ tests):
   esoteric send-outs (FISH/cytogenetics, LC-MS/MS hormones, metabolic HPLC, salivary cortisol,
   fatty-acid profiles, HLA typing). These are the **specialised per-test orders** we place ad-hoc.

2. **The 11 consumer marketing panels** — pre-built B2C bundles (Diabetes Care, PCOD Advanced,
   Ultra Men's/Women's, Senior Citizen), discounted ~55–70% off list.

**Critical point:** Acumen's consumer panels are **conventional-medicine bundles, not FM-optimal.**
Their "Diabetes Advanced ₹4499" has fasting insulin but **no HOMA-IR, ApoB, homocysteine, hs-CRP,
or full thyroid antibodies.** Their PCOD panel has **no fasting insulin/HOMA, ApoB, hs-CRP, or vit D.**

→ We do **not** resell their panels. We design **our own FM-optimal tiered packages** from their
à-la-carte list, and negotiate a bundle rate. Same lab, *right markers*, FM interpretation in our app.

---

## 2. The 3 tiered FM packages — Basic / Advanced / Platinum

Broad, lifestyle-and-disease-spanning packages (the way we currently prescribe), tiered by depth —
not condition-specific. Each tier is a superset of the one below. Every marker maps to a catalogue
`lab_test` slug, so FM-optimal ranges + interpretation already exist in the app.

Pricing uses **confirmed Acumen DOS list prices** (₹). Components not separately listed in the DOS
are flagged ⚠ (confirm with Acumen). "Target price" = proposed client price (~55–65% off list,
matching Acumen's own consumer-panel discounts).

### TIER 1 — **FM Essential (Basic)** · ~14 markers
The "everyone starts here" screen. Metabolic + thyroid + lipids + inflammation + key nutrients.

| Marker | catalogue slug | list ₹ |
|---|---|---|
| CBC / Hemoglobin ⚠ | `hemoglobin` | 300 |
| TSH | `tsh` | 400 |
| Free T3 + Free T4 | `free-t3` `free-t4` | 900 |
| Fasting glucose ⚠ | `fasting-glucose` | 100 |
| Fasting insulin | `fasting-insulin` | 1080 |
| HbA1c | `hba1c` | 640 |
| HOMA-IR | `homa-ir` | *(calculated)* |
| Lipid Profile (chol/TG/HDL/LDL) | `hdl-cholesterol` `triglycerides` | 1000 |
| hs-CRP | `hscrp` | 850 |
| Ferritin | `ferritin` | 1000 |
| Vitamin D 25-OH | `vitamin-d-25-oh` | 1650 |
| Vitamin B12 | `vitamin-b12` | 1150 |
| **List total (approx)** | | **≈ ₹9,070** |
| **Target client price** | | **₹3,999** |

### TIER 2 — **FM Comprehensive (Advanced)** · ~22 markers
Everything in Basic **plus** thyroid antibodies, ApoB, methylation, deeper nutrients. The standard FM workup.

Basic **+**:

| Marker | catalogue slug | list ₹ |
|---|---|---|
| Anti-TPO + Anti-Tg | `tpo-antibodies` `tg-antibodies` | 2400 |
| ApoB | `apob` | 685 |
| Homocysteine | `homocysteine` | 1450 |
| RBC Folate | `folate-rbc` | 2300 |
| Magnesium (serum) | `magnesium-rbc` | 610 |
| Uric acid | `uric-acid` | 270 |
| ESR | `esr` | 200 |
| **Add subtotal** | | **+ ₹7,915** |
| **List total (approx)** | | **≈ ₹16,985** |
| **Target client price** | | **₹5,999** |

### TIER 3 — **FM Total Deep-Dive (Platinum)** · ~30 markers · Female / Male variant
Everything in Advanced **plus** full hormones, advanced CV risk, gold-standard nutrients.

Advanced **+** (common):

| Marker | catalogue slug | list ₹ |
|---|---|---|
| AM Cortisol (8am) | `am-cortisol` | 850 |
| DHEA-S ⚠ | `dhea-s` | 900 |
| Apolipoprotein Profile | *(add-on)* | 1870 |
| Lipoprotein(a) | `lp-a` | 1320 |
| B12 Active – HoloTC *(upgrades B12)* | `holotranscobalamin-active-b12` | +400 |
| Magnesium RBC *(upgrades serum)* | `magnesium-rbc` | +2280 |

Plus sex-specific hormones:
- **Female:** Estradiol `estradiol-e2` 700 · Progesterone `progesterone` 740 · AMH `amh` 2400 · SHBG 2800
- **Male:** Testosterone Profile (total+free) 3640 · SHBG 2800

| | list ₹ | target |
|---|---|---|
| **Platinum (Female)** | ≈ ₹29,200 | **₹8,999** |
| **Platinum (Male)** | ≈ ₹27,500 | **₹8,999** |

> **Reverse T3 is NOT available at Acumen** (absent from their DOS). If a client needs rT3 (tissue-level
> thyroid conversion), order it from the existing specialty lab. Removed from Platinum above.

**Negotiation lever:** Acumen discounts their own consumer panels 55–70% off list. A 55–65%
bundled discount on ours lands on the target prices above — realistic asks. Lead with **expected
monthly volume** (client throughput).

---

## 3. Specialised per-test add-ons (ordered ad-hoc)

FM tests ordered case-by-case beyond the tiers. All confirmed in the DOS with list price:

| Test | catalogue slug | DOS list ₹ | FM use |
|---|---|---|---|
| Vitamin D Gold (LC-MS/MS) | `vitamin-d-25-oh` | 2650 | gold-standard vit D |
| B12 Active – HoloTC | `holotranscobalamin-active-b12` | 1550 | true B12 status |
| MMA Serum, Quantitative (LC-MS/MS) | `methylmalonic-acid` | 3430 | functional B12 — catches deficiency normal serum B12 misses |
| Magnesium RBC | `magnesium-rbc` | 2890 | intracellular Mg |
| Apolipoprotein Profile | — | 1870 | full CV risk |
| Lipoprotein(a) | `lp-a` | 1320 | genetic CV risk |
| SHBG | `shbg` | 2800 | free androgen index |
| Free Testosterone | `free-testosterone` | 2150 | androgens |
| Testosterone Profile | `total-testosterone` | 3640 | full androgen panel |
| AMH | `amh` | 2400 | ovarian reserve / PCOS |
| 17-OH Progesterone | `17-oh-progesterone` | 1800 | CAH / PCOS |
| Cortisol, Saliva (single, ELISA) | `am-cortisol` | 2940 | adrenal — single sample, NOT a 4-pt curve |
| Cortisol LC-MS/MS (serum) | `am-cortisol` | 3500 | precise cortisol |
| Full Fatty Acid Profile (GC-MS) | `omega-3-index` | 4000 | omega-3/6 status |
| Zinc RBC (ICP-MS) | `zinc-rbc` | 2330 | mineral status |
| Iron Studies | `iron-studies` | 880 | full iron panel |
| Homocysteine reflex B12-folate | `homocysteine` | 1770 | methylation |

**⚠ Gaps — NOT available at Acumen (keep with existing specialty lab):**
- **DUTCH** (dried-urine hormone metabolites) — no equivalent. 4-pt salivary cortisol is closest.
- **GI-MAP / comprehensive stool** — not in DOS.
- **Organic Acids Test (OAT)** — not in DOS.
- **True Omega-3 Index** — they offer Full Fatty Acid Profile (GC-MS, ₹4000) as the closest proxy.

Acumen covers all blood/serum work; the above FM mainstays stay with your current specialty lab.

---

## 4. App integration — what's built & what's next

The catalogue already has the hard part: `LabPanel` + `LabTest` entities with FM-optimal ranges,
and the client app has a **Labs / Lab Vault** tab. We layer a *provider* on top.

**✅ Done this session:**
- This plan + the 3-tier design.
- **Data layer:** `fm-database/data/lab_providers/acumen.yaml` — the 3 packages (component slugs +
  confirmed list price + target price placeholder) + à-la-carte add-on prices. Single source of truth.
- **Acumen pricing sheet:** `docs/acumen-pricing-sheet.html` (open → Save-as-PDF) to send Acumen for
  rate negotiation.

**⏳ Next (after Acumen rates lock):**
- **Phase 2 — coach side:** in the plan editor / `LabOrdersEditor`, surface the matching Acumen
  package + price + "Generate Acumen requisition" (client name, package, fasting prep, home collection).
- **Phase 3 — client app (Labs tab):** show coach-recommended package + price + "Book home
  collection" → WhatsApp/booking to Acumen (`+91 9808 050 050`).
- **Phase 4 — loop closed:** Acumen result PDF → Lab Vault → existing lab parser → FM-optimal
  interpretation → plan rework. Already wired; provider is just the front door.

---

## 5. Decisions locked (2026-06-16)
- **Structure:** tiered Basic / Advanced / Platinum spanning lifestyles + diseases. ✅
- **Sequencing:** pricing sheet + data-layer scaffold now; coach/client UI after rates negotiated. ✅

## 6. Still open
- **Target prices** (₹3,999 / ₹5,999 / ₹8,999) are my recommendation — confirm before Acumen talks.
- A few ⚠ components (fasting glucose, reverse T3, DHEA-S) not separately listed in DOS — confirm with Acumen.

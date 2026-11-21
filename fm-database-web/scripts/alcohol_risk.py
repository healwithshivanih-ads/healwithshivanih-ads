"""
alcohol_risk — does this client get the gentle "skip it" alcohol answer?

Coach, 21 Nov 2026: "it needs to be plan by plan. Certain markers — better to
say no, but if no alcohol risk, the first answer is better" (the first answer:
one drink, slowly, with food and water). Decided on the Mac from the full
record (labs never reach Fly) and copied to the app as one yes/no with no
reason. The coach's own `alcohol_ok` (true / false) on client.yaml wins.

Markers (each one is enough): pregnancy or trying to conceive; liver disease,
fatty liver or a raised liver enzyme; gout or high uric acid; triglycerides
200+; pancreatitis; reflux, gastritis or an ulcer; diabetes on insulin or a
sulfonylurea (low sugar); anxiety, depression or sleep medicines; metronidazole
or tinidazole; a history of alcohol problems or an eating disorder; a plan
whose leave-out list names alcohol.
"""
from __future__ import annotations

import re

from day_targets import _drug_classes, _terms_hit, fold
from protein_logic import _iter_lab_values

CONDITIONS = [
    "fatty liver", "nafld", "masld", "nash", "mash", "liver disease", "hepatitis", "cirrhosis",
    "gout", "hyperuricemia", "hyperuricaemia", "high uric acid", "raised uric acid",
    "pancreatitis", "hypertriglyceridemia", "hypertriglyceridaemia",
    "gerd", "gord", "acid reflux", "reflux", "gastritis", "peptic ulcer", "stomach ulcer", "ulcer",
    "alcohol use disorder", "alcoholism", "alcohol dependence", "alcohol misuse",
    "eating disorder", "anorexia", "bulimia", "binge eating",
]
MEDICINES = [
    {"slug": "calming", "drug_aliases": [
        "sertraline", "escitalopram", "citalopram", "fluoxetine", "paroxetine", "fluvoxamine", "venlafaxine", "desvenlafaxine",
        "duloxetine", "mirtazapine", "amitriptyline", "nortriptyline", "trazodone", "bupropion", "vortioxetine",
        "alprazolam", "clonazepam", "lorazepam", "diazepam", "etizolam", "zolpidem", "zopiclone", "eszopiclone",
        "quetiapine", "olanzapine", "pregabalin", "gabapentin",
    ]},
    {"slug": "nitroimidazole", "drug_aliases": ["metronidazole", "tinidazole", "flagyl", "secnidazole"]},
]


def _meds(client: dict) -> set[str]:
    from fmdb.drug_match import match_drugs

    found: set[str] = set()
    for med in client.get("current_medications") or []:
        for d in match_drugs(str(med), MEDICINES):
            found.add(d["slug"])
    return found


def alcohol_risk(client: dict, plan: dict | None = None) -> bool:
    ok = client.get("alcohol_ok")
    if isinstance(ok, bool):
        return not ok
    preg = str(client.get("pregnancy_status") or "").lower()
    if preg in ("pregnant", "breastfeeding", "lactating", "trying", "trying_to_conceive", "ttc"):
        return True
    if _terms_hit(client, CONDITIONS):
        return True
    # Whole words only: "ast" must not match "fasting".
    for pat, excl, limit in (
        (r"\b(alt|sgpt|alanine aminotransferase)\b", "ratio", 40),
        (r"\b(ast|sgot|aspartate aminotransferase)\b", "ratio", 40),
        (r"\b(ggt|gamma gt|gamma-glutamyl\w*)\b", None, 50),
        (r"\btriglycerides?\b", "ratio|hdl", 200),
        (r"\b(uric acid|urate)\b", "ratio|urine", 7.0),
    ):
        for name, val in _iter_lab_values(client):
            n = str(name).lower()
            if not re.search(pat, n) or (excl and re.search(excl, n)) or val is None:
                continue
            # Units are not stored: uric acid over 20 is µmol/L (÷ 59.48),
            # triglycerides under 20 are mmol/L (× 88.57).
            if "uric" in pat and val > 20:
                val = val / 59.48
            elif "triglycer" in pat and val < 20:
                val = val * 88.57
            if val > limit:
                return True
    if {"insulin", "sulfonylurea"} & _drug_classes(client):
        return True
    if _meds(client):
        return True
    reduce = " ".join(str(x) for x in ((plan or {}).get("nutrition") or {}).get("reduce") or [])
    if re.search(r"\b(alcohol|wine|beer|liquor|spirits|drinks?)\b", fold(reduce)):
        return True
    return False

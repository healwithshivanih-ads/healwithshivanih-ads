"""Does a supplement's contraindication apply to THIS client?

Both sides are free text. A contraindication reads "Active peptic or gastric
ulcer, gastritis or erosive oesophagitis — supplemental acid can worsen mucosal
injury"; the client's record reads "GERD / acid reflux", and the medications may
be one string, "Shell cal 500, omez 20, restil 0.25, melatonin 3mg". check_plan
compared them by exact equality, so across 20 published plans and 370 supplements
these checks fired zero times.

CONDITIONS join on a shared concept (`data/_condition_terms.yaml`), never on the
strings. MEDICATIONS go through the shared alias matcher, `fmdb/drug_match.py`.

The failure this has to avoid is the opposite one: a check that cries wolf gets
ignored, and a record is full of words that are not diagnoses.

  * Only the LABEL of a record entry counts. "Hypothyroidism — ... do not trial
    betaine HCl until H. pylori and ulcer are excluded" is a hypothyroid client,
    and the rest is narrative. Same on the catalogue side.
  * A drug someone stopped, or an eye drop, is not a clash with an oral capsule.
  * A record that says "mild" is not a hit for a line about severe disease.
  * A hit is FIRM or SOFT. It is firm only when the record states the diagnosis
    outright and the catalogue states the contraindication flatly. "Suspected:",
    history, and any catalogue line that hedges ("uncontrolled", "monitor",
    "consult a physician") are questions, so they are soft. Soft never blocks.

Every hit is a question, not a ban: client_fit.py carries it, and one answered
row in plan.client_fit clears it, same as a screen.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..drug_match import alias_matches, match_drug, match_drugs

TERMS_PATH = Path(__file__).resolve().parents[2] / "data" / "_condition_terms.yaml"

# How many members of a drug record a supplement must itself name before a BRAND
# in that record counts as that drug. A record is a class, and "same class" is
# not "same drug": omez reaches omeprazole only through the PPI record, which is
# safe because supplements list PPIs as a set. Measured on the live roster before
# this shipped, class-expanding antibiotics fired 23 times and all 23 were false:
# amoxicillin matched doxycycline's chelation rule, and an eye drop matched calcium.
#   None = never expand, only the drug's own name counts.
#   2    = expand only when the supplement names the class, not one drug. Beta
#          blockers and calcium channel blockers carry single-drug entries
#          ('propranolol', 'diltiazem') that do not apply to the rest of the class.
_MEMBERS_NEEDED: dict[str, int | None] = {
    "antibiotics-broad-spectrum": None,
    "beta-blockers": 2,
    "calcium-channel-blockers": 2,
}

_BLOCKING_KINDS = {"contraindicated", "avoid_together"}

# "Blood thinner" names a class and no drug, so it could be any of them and the
# only safe answer is to ask. cl-023's list says exactly that and the plan carries
# K2, which opposes warfarin and does nothing to clopidogrel. The word also appears
# as a catalogue term, where it covers both records.
_BLOOD_THINNER_RECORDS = {"vitamin-k-antagonists", "anticoagulants-antiplatelets"}
_BLOOD_THINNER_WORD = re.compile(r"\bblood[ -]thinners?\b|\banticoagulants?\b")

_NOT_SWALLOWED = re.compile(
    r"\b(?:eye|ear)[ -]drops?\b|\bophthalmic\b|\btopical\b|\bointment\b|\bnasal spray\b"
)
_STOPPED = re.compile(r"(?<!not )(?<!not be )\b(?:stopped|discontinued|ceased|completed)\b")

# On a record entry: the diagnosis is not established.
_TENTATIVE = re.compile(r"^\W*(?:suspected|possible|probable|query|likely|borderline)\b[:\s]*")
_CLEARED = re.compile(
    r"\b(?:resolved|defused|ruled out|excluded|negative|in remission|remission)\b"
)

# On a catalogue line: the contraindication hedges, or turns on something the
# record cannot show (a severity, a dose, whether it is controlled).
_HEDGED = re.compile(
    r"\b(?:severe|severely|uncontrolled|poorly controlled|advanced|acute|untreated|unchecked"
    r"|unconfirmed|unexplained|high doses?|very high|with caution|monitor|coordinate|consult"
    r"|seek|with clinician|clinician guidance|clinician input|clinician oversight"
    r"|clinician supervision|provider|theoretical|traditional|precaution|may|limit"
    r"|trying to conceive|preparing for|on immunosuppress\w*|on aromatase|sodium restricted"
    r"|on a sodium|use sugar free|use a low sodium)\b"
)

# A catalogue line about severe disease says nothing to a record that says mild.
_SEVERE_ONLY = re.compile(r"\b(?:severe|advanced)\b")
_MILD = re.compile(r"\bmild\b")

_FOLDS = (
    ("oesoph", "esoph"), ("oestr", "estr"), ("diarrhoea", "diarrhea"),
    ("coeliac", "celiac"), ("aem", "em"),
)


def fold(text: str) -> str:
    """Spelling and punctuation out of the way, so a term is written once."""
    low = (text or "").lower()
    for a, b in _FOLDS:
        low = low.replace(a, b)
    low = re.sub(r"['’`]", " ", low)
    low = re.sub(r"[-_/]", " ", low)
    return re.sub(r"\s+", " ", low).strip()


def is_hedged(text: str) -> bool:
    return _HEDGED.search(fold(text)) is not None


def _catalogue_head(text: str) -> str:
    return re.split(r"\s[—–]\s", text or "", maxsplit=1)[0]


def _record_label(entry: str) -> tuple[str, bool]:
    """(the diagnosis an entry names, is it tentative). Prose after the label is
    narrative and routinely names conditions the client does not have."""
    low = (entry or "").strip().lower()
    tentative = _TENTATIVE.search(low) is not None
    low = _TENTATIVE.sub("", low, count=1)
    # The full stop needs a word before it: "H. pylori" is not two sentences.
    return re.split(r"\s[—–-]\s|:\s|\s\(|(?<=[a-z]{3})\.\s", low, maxsplit=1)[0], tentative


@lru_cache(maxsize=1)
def _load_concepts(path: str) -> tuple[dict, ...]:
    # A missing or malformed file must never break plan-check, same rule as the
    # screens and the product file.
    try:
        import yaml
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    except Exception:
        return ()
    return tuple(data.get("concepts") or [])


def load_concepts(path: Path = TERMS_PATH) -> tuple[dict, ...]:
    return _load_concepts(str(path))


def has_term(text: str, term: str) -> bool:
    # Letter boundaries, not \b: "ulcer" must not hit "ulcerative", and a digit
    # may end a term ("omez20").
    return re.search(rf"(?<![a-z]){re.escape(term.lower())}(?![a-z])", text) is not None


def _any_term(text: str, terms: list[str] | None) -> bool:
    return any(has_term(text, t) for t in (terms or []))


def concepts_in_contraindication(text: str, concepts: tuple[dict, ...]) -> list[dict]:
    """The concepts one catalogue string names, read from its head."""
    head = fold(_catalogue_head(text))
    return [
        c for c in concepts
        if _any_term(head, c.get("contra")) and not _any_term(head, c.get("contra_not"))
    ]


def _record_entries(client: Any, concept: dict) -> list[tuple[str, bool]]:
    """(label as written, firm?) for each entry this concept may read."""
    if concept.get("fields") == "allergies":
        return [(a.lower(), True) for a in (getattr(client, "known_allergies", None) or [])]
    out: list[tuple[str, bool]] = []
    for entry in getattr(client, "active_conditions", None) or []:
        label, tentative = _record_label(entry)
        if not _CLEARED.search(label):
            out.append((label, not tentative))
    # Past diagnoses: asked about, never blocking. A resolved stamp sits in the
    # tail, so test the whole entry here.
    for entry in getattr(client, "medical_history", None) or []:
        if not _CLEARED.search((entry or "").lower()):
            out.append((_record_label(entry)[0], False))
    return out


def condition_clashes(
    conditions: list[str],
    client: Any,
    concepts: tuple[dict, ...] | None = None,
) -> list[dict]:
    """One hit per concept, for one supplement's `contraindications.conditions`."""
    concepts = load_concepts() if concepts is None else concepts
    hits: dict[str, dict] = {}
    for text in conditions or []:
        hedged = is_hedged(text)
        severe_only = _SEVERE_ONLY.search(fold(_catalogue_head(text))) is not None
        for concept in concepts_in_contraindication(text, concepts):
            terms = concept.get("client") or concept.get("contra")
            for label, entry_firm in _record_entries(client, concept):
                entry = fold(label)
                if not _any_term(entry, terms) or _any_term(entry, concept.get("client_not")):
                    continue
                if severe_only and _MILD.search(entry):
                    continue
                firm = entry_firm and not hedged
                hit = hits.get(concept["id"])
                # A firm reading of a concept outranks a soft one for the same concept.
                if hit is None or (firm and hit["soft"]):
                    hits[concept["id"]] = {
                        "concept": concept["id"],
                        "contraindication": text,
                        "record": label,
                        "soft": not firm,
                    }
    return list(hits.values())


def active_medications(client: Any) -> list[str]:
    """Each swallowed, still-running item on the client's list, lowercased.

    Split on commas outside brackets, because a list often arrives as one string,
    and cut the narrative first: "Berberine 500 mg ... Taken in place of Janumet."
    is not a client on Janumet.
    """
    out: list[str] = []
    for raw in getattr(client, "current_medications", None) or []:
        head, *tail = re.split(r"\s[—–]\s|(?<=[a-z)\]])\.\s+(?=[A-Z])", raw or "", maxsplit=1)
        if _NOT_SWALLOWED.search((raw or "").lower()):
            continue
        # "Glycomet — STOPPED": the status lives in the part we cut.
        if tail and _STOPPED.search(tail[0].split(". ")[0].lower()):
            continue
        for part in re.split(r"[,;](?![^()\[\]]*[)\]])", head):
            part = part.strip().lower()
            if part and not _STOPPED.search(part):
                out.append(part)
    return out


def _term_parts(term: str) -> list[str]:
    """Single drug names from one catalogue term, which may be a slug
    ("oral-contraceptives") or a sentence ("thiazide or loop diuretics — ...")."""
    head = re.sub(r"\([^)]*\)", " ", _catalogue_head(term)).lower().replace("-", " ")
    parts = re.split(r"\s*(?:,|/|\band\b|\bor\b)\s*", head)
    return [p.strip() for p in parts if len(p.strip()) >= 3]


def prose_terms(line: str) -> list[str]:
    """A free-text line, then whatever its brackets name. `_term_parts` drops
    brackets on purpose: a supplement's "(furosemide, torsemide)" only illustrates
    its class. A home remedy's line often names the drug nowhere else."""
    return [line, *re.findall(r"\(([^)]*)\)", _catalogue_head(line))]


def _forms(part: str) -> list[str]:
    # A plural is not an alias: "statins" must reach "atorvastatin".
    return [part, part[:-1]] if part.endswith("s") else [part]


def term_record(term: str, drugs: list[dict]) -> dict | None:
    for part in _term_parts(term):
        for form in _forms(part):
            record = match_drug(form, drugs)
            if record is not None:
                return record
    return None


def medication_hit(
    term: str,
    meds: list[str],
    drugs: list[dict],
    named_by_supplement: list[str],
) -> dict | None:
    """The client medication a catalogue term lands on, or None.

    `group` identifies the drug or class so a supplement that lists eight ARBs
    reports a client on one of them once.
    """
    parts = _term_parts(term)
    record = term_record(term, drugs)
    group = record["slug"] if record else (parts[0] if parts else term)

    def found(med: str) -> dict:
        # The narrative cut can leave a bracket open; do not show that to the coach.
        return {"term": term, "med": re.sub(r"\s*\([^)]*$", "", med), "group": group}

    for med in meds:
        for part in parts:
            if any(alias_matches(form, med) for form in _forms(part)):
                return found(med)

    if record is None:
        return None
    if record["slug"] in _BLOOD_THINNER_RECORDS:
        for med in meds:
            if _BLOOD_THINNER_WORD.search(med):
                return found(med)
            if _BLOOD_THINNER_WORD.search(term.lower()) and any(
                d["slug"] in _BLOOD_THINNER_RECORDS for d in match_drugs(med, drugs)
            ):
                return found(med)
    needed = _MEMBERS_NEEDED.get(record["slug"], 1)
    if needed is None:
        return None
    named = sum(
        1 for t in named_by_supplement
        if (r := term_record(t, drugs)) and r["slug"] == record["slug"]
    )
    if named < needed:
        return None
    for med in meds:
        if any(d["slug"] == record["slug"] for d in match_drugs(med, drugs)):
            return found(med)
    return None


def medication_clashes(supp: Any, meds: list[str], drugs: list[dict]) -> list[dict]:
    """What one supplement's own entry says about this client's medications, one
    hit per drug or class. Contraindicated and avoid-together lines are `blocking`
    and come first, so a drug named on both reads as the stronger line. A hedged
    line is `soft`, and soft never blocks. `monitor` and `space_by_hours` are told,
    not gated.

    `unnamed` means the record says "blood thinner" and no drug. check_plan can gate
    that because the coach has a row to answer it in. A surface with no such row
    must ask, not refuse.
    """
    if not meds:
        return []
    with_meds = supp.interactions.with_medications
    contra = list(supp.contraindications.medications)
    named = [m.medication for m in with_meds] + contra
    lines = [(term, "contraindicated", "") for term in contra]
    lines += [(m.medication, m.type.value, m.reason) for m in with_meds if m.type.value == "avoid_together"]
    lines += [(m.medication, m.type.value, m.reason) for m in with_meds if m.type.value != "avoid_together"]
    hits: list[dict] = []
    seen: set[str] = set()
    for term, kind, reason in lines:
        hit = medication_hit(term, meds, drugs, named)
        if hit is None or hit["group"] in seen:
            continue
        seen.add(hit["group"])
        hits.append({
            **hit,
            "kind": kind,
            "reason": reason or "",
            "blocking": kind in _BLOCKING_KINDS,
            "soft": is_hedged(term),
            "unnamed": _BLOOD_THINNER_WORD.search(hit["med"]) is not None,
        })
    return hits


def already_spaced(timing: str, hit: dict) -> bool:
    """The plan's own timing line names this drug, so the spacing is handled.
    "at least 4 hours after your morning Thyronorm" needs no reminder; a bare
    "Mid-morning" does."""
    text = (timing or "").lower()
    names = [*_term_parts(hit["term"]), *re.findall(r"[a-z]{4,}", hit["med"])[:1]]
    return any(alias_matches(form, text) for name in names for form in _forms(name))


def drug_records(catalogue: Any) -> list[dict]:
    return [
        {"slug": d.slug, "drug_name": d.drug_name, "drug_aliases": list(d.drug_aliases)}
        for d in getattr(catalogue, "drug_depletions", []) or []
    ]

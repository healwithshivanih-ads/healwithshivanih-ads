"""Cross-reference a practice's contraindications against one client's record.

A practice's `contraindications` list is a PRESCRIBING CHECKLIST — it covers
every client who might ever be offered that practice. Rendering it whole
against a specific person produces noise about conditions they do not have,
and worse, invites a reader to treat "not mentioned" as "unknown risk". That is
how a standing glaucoma screen on `legs-up-the-wall` became a doubt about a
client whose intake had already answered `eye_signs: []`.

So the screen returns THREE buckets, and the distinction between the last two
is the whole point:

    live     — the record positively shows this applies. Act on it.
    cleared  — the record was ASKED and came back negative. Say nothing.
    unknown  — the record has no field that would carry this. Ask before use.

`cleared` and `unknown` are not the same thing, and collapsing them is the bug
this module exists to prevent.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable


@dataclass
class Caution:
    text: str
    category: str


@dataclass
class ContraScreen:
    """The result of screening one practice against one client."""
    practice_slug: str
    live: list[Caution] = field(default_factory=list)
    cleared: list[Caution] = field(default_factory=list)
    unknown: list[Caution] = field(default_factory=list)

    @property
    def blocked(self) -> bool:
        """True when something positively applies — do not auto-release."""
        return bool(self.live)

    def summary(self) -> str:
        if self.live:
            return f"{len(self.live)} live caution(s)"
        if self.unknown:
            return f"clear on record; {len(self.unknown)} to confirm"
        return "clear — all standard screens cleared on record"


# category -> (keywords that identify the caution, client fields that would
# carry evidence, regex that matches a positive finding in those fields)
_RULES: dict[str, tuple[tuple[str, ...], tuple[str, ...], str]] = {
    "hypertension": (
        ("hypertens", "blood pressure"),
        ("active_conditions", "medical_history", "current_medications", "medications", "statins_bp_diabetes"),
        r"hypertens|high blood pressure|\btelma\b|telmisartan|amlodip|losartan|ramipril|olmesartan|"
        r"metoprolol|atenolol|propranolol|ciplar|\bbp\b",
    ),
    "glaucoma": (
        ("glaucoma", "intraocular"),
        ("eye_signs", "active_conditions", "medical_history"),
        r"glaucoma|intraocular|raised iop",
    ),
    "pregnancy": (
        ("pregnan", "trimester", "lactation", "breastfeed"),
        ("pregnancy_status", "pregnancies", "active_conditions", "sex"),
        r"pregnan|trimester|lactating|breastfeed",
    ),
    "neuropathy_diabetes": (
        ("neuropath", "diabet", "insensate"),
        ("active_conditions", "medical_history", "statins_bp_diabetes", "glp1_medications"),
        r"diabet|neuropath|\bt2d\b|hba1c",
    ),
    "back_injury": (
        ("back pain", "disc", "back injury", "sciatica"),
        ("active_conditions", "medical_history", "pain_locations", "pain_pattern"),
        r"back pain|disc |sciatic|lumbar|spondyl",
    ),
    "knee_joint": (
        ("knee", "hip replacement", "joint replacement"),
        ("active_conditions", "medical_history", "pain_locations"),
        r"\bknee\b|replacement|arthritis|meniscus|tendinopath",
    ),
    "shoulder": (
        ("shoulder", "rotator cuff", "impingement"),
        ("active_conditions", "medical_history", "pain_locations"),
        r"shoulder|rotator cuff|impingement|frozen",
    ),
    "balance": (
        ("balance", "dizzi", "unsteady"),
        ("active_conditions", "medical_history", "lean_test_symptoms"),
        r"dizzi|vertigo|balance|unsteady|falls?\b|syncope",
    ),
    "anticoagulant_bruising": (
        ("anticoagul", "bruis", "blood thinner"),
        ("current_medications", "medications", "active_conditions"),
        r"warfarin|apixaban|rivaroxaban|clopidogrel|anticoagul|blood thinner|aspirin",
    ),
    "respiratory": (
        ("asthma", "respiratory", "breathless", "copd"),
        ("active_conditions", "medical_history"),
        r"asthma|copd|respiratory|breathless",
    ),
    "trauma_dissociation": (
        ("trauma", "dissociat", "sexual"),
        ("ace_signals", "active_conditions", "psych_medications", "medical_history"),
        r"trauma|ptsd|dissociat|abuse",
    ),
}


#: Structured intake fields store negatives as VALUES — `pregnancy_status:
#: not_pregnant`, `mould_exposure: none`. Matching the bare keyword inside them
#: reads a negative answer as a positive finding, which is the same
#: absence/evidence confusion this module exists to stop. Strip them first.
_NEGATED = re.compile(
    r"\b(?:not|non|no|never|nil|none|negative|denies|absent|unremarkable)[ _\-]?\w*", re.I
)


def _blob(client: dict[str, Any], fields: Iterable[str]) -> tuple[str, bool]:
    """Return (searchable text, whether any of these fields was recorded at all).

    A field present but empty (``eye_signs: []``) counts as ASKED — that is what
    lets a caution be `cleared` rather than `unknown`.
    """
    parts: list[str] = []
    asked = False
    for f in fields:
        if f not in client:
            continue
        asked = True
        v = client[f]
        if isinstance(v, list):
            parts += [str(x) for x in v]
        elif isinstance(v, dict):
            parts += [f"{k} {x}" for k, x in v.items()]
        elif v:
            parts.append(str(v))
    text = " ".join(parts).lower()
    return _NEGATED.sub(" ", text), asked


def _category_for(caution: str) -> str | None:
    low = caution.lower()
    for cat, (keys, _, _) in _RULES.items():
        if any(k in low for k in keys):
            return cat
    return None


def screen(practice: dict[str, Any], client: dict[str, Any]) -> ContraScreen:
    """Sort one practice's contraindications into live / cleared / unknown."""
    out = ContraScreen(practice_slug=practice.get("slug", "?"))
    for text in practice.get("contraindications") or []:
        cat = _category_for(text)
        if cat is None:
            # No rule covers it — cannot be checked automatically, so it is a
            # thing to confirm rather than something silently dropped.
            out.unknown.append(Caution(text, "uncategorised"))
            continue
        _, fields, positive = _RULES[cat]
        blob, asked = _blob(client, fields)
        if re.search(positive, blob):
            out.live.append(Caution(text, cat))
        elif asked:
            out.cleared.append(Caution(text, cat))
        else:
            out.unknown.append(Caution(text, cat))
    return out

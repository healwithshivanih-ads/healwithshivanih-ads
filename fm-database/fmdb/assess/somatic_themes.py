"""A controlled vocabulary for the emotional roots, and convergence scoring.

WHY THIS EXISTS. The 123 somatic maps carry 353 root patterns, of which 348 are
textually unique — every entry authored its own wording. "Suppressed anger",
"Swallowed frustration" and "Suppressed emotion reaching a threshold" are three
unrelated strings to a machine. So the convergence a coach sees instantly when
reading a client's maps side by side is, as authored, completely invisible to
code. This layer makes it computable.

FOURTEEN THEMES, derived from the corpus rather than imposed on it. The count
matters in both directions: too fine and nothing ever converges (the failure we
already have at 348), too coarse and everything converges on "stress" and the
finding is worthless.

WHAT A THEME IS NOT. It is not a diagnosis and not a cause. It is a recurring
description in one source. Convergence across a client's symptoms is a
HYPOTHESIS to test with them, and the honest test is whether their own logged
triggers agree — see the trigger-vs-symptom correlation, which is evidence from
the client rather than from a book.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from enum import Enum
from typing import Any, Iterable


class SomaticTheme(str, Enum):
    unexpressed_anger = "unexpressed_anger"
    silenced_voice = "silenced_voice"
    grief_loss = "grief_loss"
    fear_hypervigilance = "fear_hypervigilance"
    boundaries_intrusion = "boundaries_intrusion"
    self_abandonment = "self_abandonment"
    control_rigidity = "control_rigidity"
    shame_self_rejection = "shame_self_rejection"
    holding_on = "holding_on"
    depletion_overwhelm = "depletion_overwhelm"
    trapped_stuck = "trapped_stuck"
    not_seen = "not_seen"
    numbing_disconnection = "numbing_disconnection"
    old_wound = "old_wound"


#: Coach-facing label, then the CLIENT-facing phrasing.
#: The client phrasing is deliberately plainer and non-accusatory: it describes a
#: pattern, never assigns a fault. "Things that go unsaid" — not "you suppress
#: your anger".
THEME_LABELS: dict[SomaticTheme, tuple[str, str]] = {
    SomaticTheme.unexpressed_anger:    ("Unexpressed anger", "Things that go unsaid"),
    SomaticTheme.silenced_voice:       ("Silenced voice", "Not feeling able to speak"),
    SomaticTheme.grief_loss:           ("Grief and loss", "Something not yet grieved"),
    SomaticTheme.fear_hypervigilance:  ("Fear and hypervigilance", "Staying on alert"),
    SomaticTheme.boundaries_intrusion: ("Boundaries and intrusion", "Lines that get crossed"),
    SomaticTheme.self_abandonment:     ("Self-abandonment", "Everyone else first"),
    SomaticTheme.control_rigidity:     ("Control and rigidity", "Holding it all together"),
    SomaticTheme.shame_self_rejection: ("Shame and self-rejection", "Being hard on yourself"),
    SomaticTheme.holding_on:           ("Holding on", "Finding it hard to let go"),
    SomaticTheme.depletion_overwhelm:  ("Depletion and overwhelm", "Running on empty"),
    SomaticTheme.trapped_stuck:        ("Trapped or stuck", "Feeling stuck where you are"),
    SomaticTheme.not_seen:             ("Not being seen", "Taking up less room"),
    SomaticTheme.numbing_disconnection:("Numbing and disconnection", "Going quiet inside"),
    SomaticTheme.old_wound:            ("Old wound resurfacing", "Something old coming back"),
}

#: Ordered: earlier rules win a tie only in the sense that all matches are kept.
#: Patterns are matched against `pattern` + `note` lowercased.
_RULES: list[tuple[SomaticTheme, str]] = [
    (SomaticTheme.unexpressed_anger,
     r"anger|rage|fury|resentment|frustration|bitterness|irritation|hostil|"
     r"swallow|unfairness|aggress|conflict"),
    (SomaticTheme.silenced_voice,
     r"silenc|unspoken|speak|spoken|voice|said|say|words|honest|niceness|"
     r"express(ion|ing)? (?:in childhood|blocked)|self-expression|articulat|inner knowing|intuition"),
    (SomaticTheme.grief_loss,
     r"grief|griev|mourn|loss|lost|sadness|tears|crying|bereave|"
     r"heartbreak|longing|anticipated loss|support that fell|used to nourish|sweetness that went|nourish has turned"),
    (SomaticTheme.fear_hypervigilance,
     r"fear|afraid|anxiet|anxious|alarm|vigilan|threat|bracing|brace|dread|"
     r"panic|survival|freeze|high alert|scanning|unsafe|worry|unease|insecur|constant emergency|dysregulation|emotional pressure|hesitation"),
    (SomaticTheme.boundaries_intrusion,
     r"boundar|invad|intrusion|saying no|say no|smother|under your skin|"
     r"tolerat|absorb|not yours|entry|filter|consumed|exclusion|tolerance finally|being asked of you|refusal|rejection"),
    (SomaticTheme.self_abandonment,
     r"caretak|caring for others|over-?giv|people-?pleas|self-neglect|"
     r"self-abandon|minimised needs|refusal to rest|rest treated|"
     r"holds everything together|holding everything together|over-?extension|"
     r"carrying burdens alone|carrying the world|self-justification|long override|fair share"),
    (SomaticTheme.control_rigidity,
     r"control|rigid|stubborn|perfection|overthink|thinking that loops|"
     r"inflamed thinking|either/or|indecision|judgement|scattered|"
     r"gripping|grip|pride|deferring|stand behind decisions|myositis"),
    (SomaticTheme.shame_self_rejection,
     r"shame|self-blame|self-critic|self-reject|unworth|not deserving|"
     r"not accepting yourself|self-attack|disgust|guilt|inadequacy|"
     r"body shame|humiliat|deserving|self-worth"),
    (SomaticTheme.holding_on,
     r"holding on|hold on|let(ting)? go|release|releasing|surrender|"
     r"withhold|retain|stagnat|unreleasable|not releasing|clench|suppress|repress|containment|contained|sitting on|storing|store"),
    (SomaticTheme.depletion_overwhelm,
     r"depletion|deplet|exhaust|overwhelm|running on|empty|fumes|maxed|"
     r"overwork|overload|too much|burnout|reserves|hopeless|discourage|"
     r"pushing through|accumulat|yes-but"),
    (SomaticTheme.trapped_stuck,
     r"trapped|stuck|powerless|helpless|blocked|frozen|constrict|"
     r"not feel like yours|forward movement|unable to move|out of alignment|"
     r"circumstances that deplete|against the grain"),
    (SomaticTheme.not_seen,
     r"seen|watched|exposed|recognition|take up space|taking up space|"
     r"invisible|identity|made small|smaller|performance anxiety|social threat"),
    (SomaticTheme.numbing_disconnection,
     r"numb|shutdown|shut down|hibernat|disconnect|isolation|withdraw|"
     r"armor|armour|vulnerable|distrust|mistrust|joyless|pleasure shut|"
     r"going quiet|protective|masking|refusal to receive|difficulty receiving|avoidance|avoid|softened vision|protection that stayed"),
    (SomaticTheme.old_wound,
     r"trauma|childhood|early|old material|something old|past|inherited|"
     r"reactivat|carried relational|previous relationship|birth trauma|"
     r"undigested|unprocessed (?:reproductive|sexual)"),
]

_COMPILED = [(t, re.compile(rx)) for t, rx in _RULES]


def classify_root(pattern: str, note: str = "") -> list[SomaticTheme]:
    """Themes for one emotional root. A root may carry more than one."""
    blob = f"{pattern} {note}".lower()
    return [t for t, rx in _COMPILED if rx.search(blob)]


# ---------------------------------------------------------------------------
# Convergence
# ---------------------------------------------------------------------------

@dataclass
class ThemeHit:
    theme: SomaticTheme
    coach_label: str
    client_label: str
    #: distinct target symptoms/topics carrying this theme — the thing that matters
    symptoms: list[str]
    #: how many individual roots matched, across those symptoms
    root_count: int
    #: breadth relative to chance. None until scored by converge_vs_baseline.
    lift: float | None = None

    @property
    def breadth(self) -> int:
        return len(self.symptoms)


#: A finding must clear this to be reported. Calibrated, not chosen: 400 random
#: eight-map draws give a top-lift of 1.92x at the median and 2.93x at p95, so
#: anything under ~2.9x is indistinguishable from pulling maps out of a hat.
#: Consequence to be honest about — this is a LOW-YIELD test on symptom data
#: alone. Of three real clients, one cleared it.
MIN_LIFT = 2.9


def corpus_prevalence(all_maps: Iterable[dict[str, Any]]) -> dict[SomaticTheme, float]:
    """Fraction of ALL maps carrying each theme — the null model.

    Without this, convergence just reports the book's vocabulary. Fear appears
    in a third of all roots, so it tops 41% of RANDOM eight-map draws; a client
    whose top themes are fear, anger and holding-on has told you nothing that
    eight maps pulled out of a hat would not.
    """
    maps = list(all_maps)
    if not maps:
        return {}
    counts: Counter = Counter()
    for m in maps:
        seen = {t for r in (m.get("emotional_roots") or [])
                for t in classify_root(str(r.get("pattern", "")), str(r.get("note", "")))}
        counts.update(seen)
    return {t: counts[t] / len(maps) for t in SomaticTheme}


def converge(maps: Iterable[dict[str, Any]], min_breadth: int = 2) -> list[ThemeHit]:
    """Rank themes across a client's maps by how many DISTINCT symptoms carry them.

    Breadth, not frequency, is the signal. One entry listing "anger" three times
    is one symptom's author being emphatic. Six different symptoms carrying it
    is a finding. Ranking on raw root counts would reward verbose entries, which
    is a property of the book rather than of the client.
    """
    by_theme: dict[SomaticTheme, set[str]] = {}
    roots: Counter = Counter()
    for m in maps:
        target = str(m.get("target_slug") or m.get("slug") or "?")
        for r in (m.get("emotional_roots") or []):
            for t in classify_root(str(r.get("pattern", "")), str(r.get("note", ""))):
                by_theme.setdefault(t, set()).add(target)
                roots[t] += 1

    hits = [
        ThemeHit(
            theme=t,
            coach_label=THEME_LABELS[t][0],
            client_label=THEME_LABELS[t][1],
            symptoms=sorted(s),
            root_count=roots[t],
        )
        for t, s in by_theme.items()
        if len(s) >= min_breadth
    ]
    hits.sort(key=lambda h: (-h.breadth, -h.root_count, h.theme.value))
    return hits


def converge_vs_baseline(
    client_maps: Iterable[dict[str, Any]],
    all_maps: Iterable[dict[str, Any]],
    min_breadth: int = 2,
    min_lift: float = MIN_LIFT,
) -> list[ThemeHit]:
    """Convergence corrected for how common each theme is in the book.

    `lift` = observed breadth / breadth expected by chance. A theme is only a
    finding if this client carries it MORE than a random client would. Ranking
    on raw breadth reproduces the corpus's own frequency order and tells the
    coach nothing — verified against 200 random draws.
    """
    client_maps = list(client_maps)
    prev = corpus_prevalence(all_maps)
    n = len(client_maps)
    out: list[ThemeHit] = []
    for h in converge(client_maps, min_breadth=min_breadth):
        expected = prev.get(h.theme, 0.0) * n
        if expected <= 0:
            continue
        h.lift = h.breadth / expected
        if h.lift >= min_lift:
            out.append(h)
    out.sort(key=lambda x: (-(x.lift or 0), -x.breadth))
    return out

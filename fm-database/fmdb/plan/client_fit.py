"""Is this plan fitted to the client, or is it a template with a name on it?

A protocol lists what SOME people need. Attaching it proves nothing about the
person in front of us, and everything downstream used to treat it as if it did:
the UI seeds supplements from the template, generate-draft merges the protocol's
`supplements_typically_used`, and the chat path follows its phases. Shweta
(cl-906) got digestive enzymes that way, and a bad reaction was the first test
of that item anyone ran.

Two parts, both reported through check_plan so every authoring route passes them:

  1. THE RECORD. A plan with a protocol attached carries a `client_fit` row for
     the protocol as a whole and for every supplement: what in this client's
     record says she needs it, what could make it go wrong. Missing or empty is
     CRITICAL, so `submit_plan` refuses. A person or the model still writes the
     answers; the gate only makes it impossible to skip the question.

  2. THE SCREENS. `data/_client_screens.yaml` names known clashes between a
     supplement or a product's real ingredients and something on the client's
     record. A hit raises its question on ANY plan, protocol or not.

Plans already published are not re-gated: a hit there is a WARNING, because it
describes something the client may be taking today.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

from .models import Client, Plan

SCREENS_PATH = Path(__file__).resolve().parents[2] / "data" / "_client_screens.yaml"

# Below this an answer is a placeholder ("ok", "n/a", "as per protocol").
MIN_ANSWER_CHARS = 20

_GATED_STATUSES = {"draft", "ready_to_publish"}


def load_screens(path: Path = SCREENS_PATH) -> list[dict]:
    """Active screens only. A missing or malformed file must never break
    plan-check, same rule as the product file."""
    try:
        import yaml
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return []
    return [s for s in (data.get("screens") or []) if s.get("status", "active") == "active"]


def _has_term(text: str, term: str) -> bool:
    # Letter boundaries, not \b: "ulcer" must not hit "ulcerative", and a digit
    # may end a term ("omez20").
    return re.search(rf"(?<![a-z]){re.escape(term.lower())}(?![a-z])", text) is not None


def _client_text(client: Client, fields: list[str]) -> str:
    parts: list[str] = []
    for name in fields:
        value = getattr(client, name, None)
        if isinstance(value, (list, tuple)):
            parts.extend(str(v) for v in value)
        elif value:
            parts.append(str(value))
    return " · ".join(parts).lower()


def screen_hits(
    slug: str,
    ingredients: str,
    client: Client | None,
    screens: list[dict],
) -> list[dict]:
    """Screens this one supplement trips for this client."""
    if client is None:
        return []
    ingredients = (ingredients or "").lower()
    hits = []
    for screen in screens:
        named = slug in (screen.get("supplements") or [])
        in_product = any(_has_term(ingredients, t) for t in (screen.get("ingredients") or []))
        if not (named or in_product):
            continue
        text = _client_text(client, screen.get("client_fields") or [])
        matched = [t for t in (screen.get("client_terms") or []) if _has_term(text, t)]
        if matched:
            hits.append({**screen, "matched": matched})
    return hits


def fit_requirements(
    plan: Plan,
    client: Client | None,
    links: dict,
    resolve_product: Callable[[str, dict], dict | None],
    screens: list[dict] | None = None,
) -> list[dict]:
    """Everything on this plan that has to be tested, with what to look at.

    Also drives the plan-editor panel, so the coach sees the same list the gate
    enforces.
    """
    screens = load_screens() if screens is None else screens
    protocols = list(plan.attached_protocols or [])
    required: list[dict] = [
        {"item": slug, "kind": "protocol", "label": slug, "flags": []} for slug in protocols
    ]
    for supp in plan.supplement_protocol:
        slug = supp.supplement_slug
        product = resolve_product(slug, links) or {}
        hits = screen_hits(slug, str(product.get("ingredients") or ""), client, screens)
        if protocols or hits:
            required.append({
                "item": slug,
                "kind": "supplement",
                "label": product.get("display_name") or slug,
                "flags": [
                    {
                        "id": h["id"],
                        "reason": h.get("reason", ""),
                        "ask": h.get("ask", ""),
                        "matched": h["matched"],
                    }
                    for h in hits
                ],
            })
    return required


def check_client_fit(plan, client, findings, finding_cls, links, resolve_product) -> None:
    gated = str(getattr(plan.status, "value", plan.status)) in _GATED_STATUSES
    rows = {row.item: row for row in plan.client_fit}
    supplement_slugs = {s.supplement_slug for s in plan.supplement_protocol}

    for need in fit_requirements(plan, client, links, resolve_product):
        slug = need["item"]
        row = rows.get(slug)
        answered = (
            row is not None
            and len(row.client_evidence.strip()) >= MIN_ANSWER_CHARS
            and len(row.risk_check.strip()) >= MIN_ANSWER_CHARS
        )
        for flag in need["flags"]:
            if answered:
                continue
            findings.append(finding_cls(
                "CRITICAL" if gated else "WARNING",
                "client_fit", "screen",
                f"{need['label']!r} clashes with this client's record "
                f"({', '.join(flag['matched'])}): {flag['reason']} {flag['ask']}".strip(),
                target=f"{slug}:{flag['id']}",
            ))
        if gated and not answered and not need["flags"]:
            findings.append(finding_cls(
                "CRITICAL", "client_fit", need["kind"],
                f"{need['label']!r} has not been tested against this client. Say what "
                "in her record shows she needs it and what could go wrong for her, "
                "or take it out. The protocol listing it is not a reason.",
                target=slug,
            ))

    if not gated:
        return
    for row in plan.client_fit:
        if row.decision == "drop" and row.item in supplement_slugs:
            findings.append(finding_cls(
                "CRITICAL", "client_fit", "decision",
                f"{row.item!r} is marked drop but is still in the supplement protocol.",
                target=row.item,
            ))

"""Shared protein-management logic.

Single source of truth for:
  - protein daily target (1.2-1.5 g/kg, adjusted body weight for high BMI;
    suppressed for kidney disease / high uric acid / gout)
  - which catalogue protein powder fits (dairy / histamine / gut-protocol /
    legume-sensitivity flags)
  - protein-gap detection from labs (low albumin / total protein)
  - whether to add a protein-powder item to a PLAN's supplement_protocol,
    and the fields for that item

Used by both the plan generator (generate-draft.py — adds the item to the
structured Plan) and the letter generator (render-client-letter.py — writes
the food-first prose + conditional top-up). Keep all protein heuristics here
so the two callers can never drift.

See fm-database/data/sources/protein-intake-guidance.yaml.
"""

from __future__ import annotations

_PROTEIN_KIDNEY_TERMS = (
    "kidney disease", "chronic kidney", "ckd", "renal failure",
    "renal insufficiency", "renal disease", "nephropathy", "dialysis",
)
_PROTEIN_URIC_TERMS = (
    "gout", "hyperuricemia", "hyperuricaemia", "high uric acid",
    "elevated uric acid", "raised uric acid",
)
_PROTEIN_HISTAMINE_TERMS = ("histamine", "mcas", "mast cell")
_PROTEIN_GUT_TERMS = ("sibo", "candida", "candidiasis", "dysbiosis")
_PROTEIN_GUT_SLUG_HINTS = (
    "5r", "sibo", "candida", "gut-heal", "gut-repair", "gut-restoration",
)
_PROTEIN_DAIRY_FREE_TERMS = (
    "vegan", "dairy-free", "dairy free", "no dairy", "without dairy",
    "plant-based", "plant based",
)
_PROTEIN_DAIRY_AVOID_TERMS = ("dairy", "milk", "lactose", "casein")
# Kept deliberately narrow — yeast protein is a rare niche, so auto-routing
# to it should require an explicit pea/legume-protein sensitivity, not a
# casual "I avoid soy" note.
_PROTEIN_LEGUME_TERMS = ("pea protein", "legume allergy", "pulse allergy")

# Any dietary_preference containing one of these counts as a vegetarian /
# vegan plate for the "always add for vegetarians" rule.
_VEGETARIAN_TERMS = ("vegetarian", "vegan", "plant-based", "plant based")


def protein_condition_text(client: dict) -> str:
    """Lowercased blob of every place a condition / diet note could live."""
    parts: list[str] = []
    for key in ("active_conditions", "medical_history"):
        v = client.get(key)
        if isinstance(v, list):
            parts.extend(str(x) for x in v)
        elif v:
            parts.append(str(v))
    for key in ("notes", "dietary_preference"):
        if client.get(key):
            parts.append(str(client[key]))
    return " ".join(parts).lower()


def protein_lab_marker_high(client: dict, name_terms: tuple) -> bool:
    """True if a lab marker whose name matches any term carries a
    high / elevated flag. `lab_markers` rows look like
    {marker_name, value, unit, reference_range, flag, ...}."""
    for m in (client.get("lab_markers") or []):
        if not isinstance(m, dict):
            continue
        name = str(m.get("marker_name") or m.get("name") or "").lower()
        if not any(t in name for t in name_terms):
            continue
        flag = str(m.get("flag") or "").lower()
        if any(w in flag for w in ("high", "elevat", "above", "raised")):
            return True
    return False


def _iter_lab_values(client: dict):
    """Yield (test_name_lower, float_value) over every lab on file —
    both the flat `lab_markers` list and the dated `health_snapshots`
    lab_values rows. Non-numeric values are skipped."""
    def _num(v):
        try:
            return float(str(v).strip())
        except (TypeError, ValueError):
            return None

    for m in (client.get("lab_markers") or []):
        if isinstance(m, dict):
            name = str(m.get("marker_name") or m.get("name") or "").lower()
            val = _num(m.get("value"))
            if name and val is not None:
                yield name, val
    for snap in (client.get("health_snapshots") or []):
        if not isinstance(snap, dict):
            continue
        for lv in (snap.get("lab_values") or []):
            if isinstance(lv, dict):
                name = str(lv.get("test_name") or lv.get("name") or "").lower()
                val = _num(lv.get("value"))
                if name and val is not None:
                    yield name, val


_PROTEIN_LIVER_TERMS = (
    "cirrhosis", "hepatic encephalopathy", "liver failure", "decompensated",
    "esld", "end-stage liver", "portal hypertension",
)


def _lab_value(client: dict, name_terms: tuple, exclude: tuple = ()):
    """First numeric lab value whose name contains any of name_terms and
    none of `exclude`. Returns float or None. `exclude` guards against
    composite markers (e.g. 'bun/creatinine ratio' must not be read as
    creatinine)."""
    for name, val in _iter_lab_values(client):
        if any(t in name for t in name_terms) and not any(x in name for x in exclude):
            return val
    return None


def suppress_why(reason: str) -> str:
    """Human phrase for a protein-suppression reason."""
    return {
        "kidney": "kidney function",
        "liver": "advanced (decompensated) liver disease",
        "uric_acid": "high uric acid / gout",
    }.get(reason, "a medical reason")


def protein_gap_signal(client: dict) -> str:
    """Detect a lab-based protein-insufficiency signal.

    Returns a short human reason string (e.g. "albumin 4.2 g/dL (low)") if
    found, else "". Thresholds use the FM-optimal floor, not the lab
    reference floor: albumin < 4.5 g/dL or total protein < 6.5 g/dL.
    """
    best = ""
    for name, val in _iter_lab_values(client):
        if "albumin" in name and "globulin" not in name and "micro" not in name:
            # albumin is reported in g/dL (3.5-5.5). Ignore mg/L microalbumin.
            if 2.0 <= val < 4.5:
                return f"albumin {val:g} g/dL (below FM-optimal 4.5)"
        if "total protein" in name or name.strip() in ("protein, total", "protein total"):
            if 4.0 <= val < 6.5:
                best = best or f"total protein {val:g} g/dL (low)"
    return best


def weight_loss_active(client: dict) -> bool:
    """True when the client has an enabled weight-loss goal. In a calorie
    deficit, protein needs go UP (not down) to protect lean mass — the
    1.2-1.5 g/kg maintenance band loses muscle, which lowers metabolism and
    stalls the scale. See calc_protein_target's deficit bump."""
    wl = client.get("weight_loss")
    if not isinstance(wl, dict) or wl.get("enabled") is False:
        return False
    return bool(wl.get("enabled") or wl.get("goal_kg") or wl.get("starting_weight_kg"))


def calc_protein_target(client: dict, plan: dict | None = None) -> dict | None:
    """Daily protein target for the client.

    Returns a dict with low_g / high_g. Baseline is 1.2-1.5 g/kg of body
    weight (adjusted body weight when BMI >= 30). When a weight-loss goal is
    active the band is RAISED to 1.6-2.0 g/kg (`deficit_adjusted: True`) to
    preserve lean muscle through the deficit — unless a contraindication
    suppresses it. Returns None if weight is missing.

    When the client has a contraindication to a RAISED protein intake —
    kidney disease or hyperuricemia / gout — `suppressed` is True,
    low_g/high_g are None, and the letter must show a 'keep moderate,
    confirm with your doctor' note instead of a number. The app never
    pushes protein up for these clients.
    """
    m = client.get("measurements") or {}

    def _f(*vals) -> float:
        for v in vals:
            try:
                f = float(v)
                if f:
                    return f
            except (TypeError, ValueError):
                continue
        return 0.0

    weight_kg = _f(m.get("weight_kg"), client.get("weight_kg"))
    height_cm = _f(m.get("height_cm"), client.get("height_cm"))
    if not weight_kg:
        return None

    # ── Contraindication scan — never raise protein for impaired kidneys,
    # decompensated liver disease, or hyperuricaemia / gout. Checks BOTH
    # condition text AND numeric labs (a low eGFR / high creatinine / high
    # urate can be present without any disease label on the record). ──
    cond_text = protein_condition_text(client)
    sex = str(client.get("sex") or "").strip().lower()

    egfr = _lab_value(client, ("egfr", "gfr"))
    creat = _lab_value(client, ("creatinine",),
                       exclude=("ratio", "bun", "clearance", "urine"))
    kidney = (
        any(t in cond_text for t in _PROTEIN_KIDNEY_TERMS)
        or protein_lab_marker_high(client, ("creatinine",))
        or (egfr is not None and egfr < 60)
        or (creat is not None and creat > 1.3)
    )

    liver = any(t in cond_text for t in _PROTEIN_LIVER_TERMS)

    urate = _lab_value(client, ("uric acid", "urate"), exclude=("ratio", "urine"))
    urate_ceiling = 6.0 if sex in ("f", "female") else 7.0
    uric = (
        any(t in cond_text for t in _PROTEIN_URIC_TERMS)
        or protein_lab_marker_high(client, ("uric acid", "urate"))
        or (urate is not None and urate > urate_ceiling)
    )

    # Precedence: kidney (most restrictive) → liver → uric acid.
    suppress_reason = (
        "kidney" if kidney else "liver" if liver else "uric_acid" if uric else ""
    )

    # ── Adjusted body weight for high BMI ──────────────────────────────
    basis = "actual"
    basis_weight = weight_kg
    bmi = None
    if height_cm:
        h_m = height_cm / 100.0
        bmi = weight_kg / (h_m * h_m)
        if bmi >= 30:
            ibw = 22.5 * h_m * h_m
            if weight_kg > ibw:
                basis_weight = ibw + 0.4 * (weight_kg - ibw)
                basis = "adjusted"

    # Baseline maintenance band. Raise it in a calorie deficit to protect
    # lean mass (muscle loss lowers BMR and stalls loss). Never raise when a
    # contraindication is suppressing protein — kidney/liver/uric wins.
    per_kg_low, per_kg_high = 1.2, 1.5
    deficit_adjusted = False
    if weight_loss_active(client) and not suppress_reason:
        per_kg_low, per_kg_high = 1.6, 2.0
        deficit_adjusted = True
    low_g = round(basis_weight * per_kg_low)
    high_g = round(basis_weight * per_kg_high)
    basis_label = "adjusted body weight" if basis == "adjusted" else "body weight"

    if suppress_reason:
        why = suppress_why(suppress_reason)
        return {
            "suppressed": True,
            "suppress_reason": suppress_reason,
            "low_g": None, "high_g": None,
            "actual_weight_kg": round(weight_kg, 1),
            "basis": basis, "basis_weight_kg": round(basis_weight, 1),
            "bmi": round(bmi, 1) if bmi else None,
            "per_kg_low": per_kg_low, "per_kg_high": per_kg_high,
            "rationale": (
                f"Protein intake should be kept moderate and guided by the "
                f"client's doctor — {why} is a reason not to raise protein "
                f"without medical advice."
            ),
        }

    rationale = (
        f"Target {low_g}-{high_g} g protein/day "
        f"({per_kg_low}-{per_kg_high} g/kg of {basis_label})."
    )
    if deficit_adjusted:
        rationale += (
            " Raised from the usual 1.2-1.5 g/kg because she's in a calorie "
            "deficit — higher protein + resistance training preserve muscle, "
            "which keeps the metabolism up so the weight lost is fat, not muscle."
        )

    return {
        "suppressed": False,
        "suppress_reason": "",
        "low_g": low_g, "high_g": high_g,
        "actual_weight_kg": round(weight_kg, 1),
        "basis": basis, "basis_weight_kg": round(basis_weight, 1),
        "bmi": round(bmi, 1) if bmi else None,
        "per_kg_low": per_kg_low, "per_kg_high": per_kg_high,
        "deficit_adjusted": deficit_adjusted,
        "rationale": rationale,
    }


def pick_protein_source(client: dict, plan: dict | None = None) -> dict:
    """Pick which protein powder to recommend — from the client's dairy
    status plus histamine / gut-protocol suppression flags.

    Returns {slug, display, reason, dairy_free, histamine, gut_protocol,
    legume_sensitive}. `slug` is one of protein-whey-isolate /
    protein-plant-blend / protein-yeast-fermented and always resolves.
    """
    cond_text = protein_condition_text(client)

    diet = str(client.get("dietary_preference") or "").lower()
    avoid = str(client.get("foods_to_avoid") or "").lower()
    allergies = " ".join(
        str(x) for x in (client.get("known_allergies") or [])
    ).lower()
    # Dairy avoidance for many clients doesn't live in foods_to_avoid /
    # allergies — it's a reported trigger, or it's the plan eliminating
    # dairy (nutrition.reduce). Scan all of those so a vegetarian whose
    # dairy is being removed routes to the plant blend, not whey.
    reported_triggers = str(client.get("reported_triggers") or "").lower()
    nutrition_reduce = ""
    if plan:
        nutrition_reduce = " ".join(
            str(x) for x in ((plan.get("nutrition") or {}).get("reduce") or [])
        ).lower()
    dairy_avoid_text = " ".join((avoid, allergies, reported_triggers,
                                 nutrition_reduce))
    dairy_free = (
        any(t in diet for t in _PROTEIN_DAIRY_FREE_TERMS)
        or any(t in dairy_avoid_text for t in _PROTEIN_DAIRY_AVOID_TERMS)
    )

    histamine = any(t in cond_text for t in _PROTEIN_HISTAMINE_TERMS)

    # Gut protocol — 5R / SIBO / candida, from conditions OR an attached
    # catalogue protocol whose slug hints at gut-dysbiosis work.
    gut_protocol = any(t in cond_text for t in _PROTEIN_GUT_TERMS)
    if plan and not gut_protocol:
        for slug in (plan.get("attached_protocols") or []):
            s = str(slug).lower()
            if any(h in s for h in _PROTEIN_GUT_SLUG_HINTS):
                gut_protocol = True
                break

    legume_sensitive = any(
        t in avoid or t in allergies for t in _PROTEIN_LEGUME_TERMS
    )

    WHEY = ("protein-whey-isolate", "Whey Protein Isolate")
    PLANT = ("protein-plant-blend", "Plant Protein Blend (Mung & Pea)")
    YEAST = ("protein-yeast-fermented", "Fermented Yeast Protein")

    # ── Decision tree ──────────────────────────────────────────────────
    if histamine:
        slug, display = PLANT
        reason = ("Plant protein blend — fermented yeast and dairy are both "
                  "plausible histamine triggers, so the plant blend is the "
                  "safest fit for a histamine-sensitive client.")
    elif gut_protocol:
        if dairy_free:
            slug, display = PLANT
            reason = ("Plant protein blend — fermented yeast is the wrong "
                      "signal during a gut-dysbiosis protocol, and dairy is "
                      "being eliminated.")
        else:
            slug, display = WHEY
            reason = ("Whey isolate — dairy is still tolerated, and "
                      "fermented yeast is avoided during a gut-dysbiosis "
                      "protocol.")
    elif not dairy_free:
        slug, display = WHEY
        reason = ("Whey isolate — dairy is tolerated; whey isolate is the "
                  "lightest, most palatable option.")
    elif legume_sensitive:
        slug, display = YEAST
        reason = ("Fermented yeast protein — dairy-free, and the client also "
                  "reacts to legume / plant proteins, so the most "
                  "allergen-free option fits best.")
    else:
        slug, display = PLANT
        reason = ("Plant protein blend — dairy-free, and legumes are "
                  "tolerated.")

    return {
        "slug": slug,
        "display": display,
        "reason": reason,
        "dairy_free": dairy_free,
        "histamine": histamine,
        "gut_protocol": gut_protocol,
        "legume_sensitive": legume_sensitive,
    }


def is_vegetarian(client: dict) -> bool:
    diet = str(client.get("dietary_preference") or "").lower()
    # "non-vegetarian" / "non veg" contains the substring "vegetarian" —
    # guard against the false positive before the substring scan.
    if any(t in diet for t in ("non-veg", "nonveg", "non veg", "non-vegetarian")):
        return False
    return any(t in diet for t in _VEGETARIAN_TERMS)


_PROTEIN_SLUGS = (
    "protein-plant-blend", "protein-whey-isolate", "protein-yeast-fermented",
    "plant-based-protein-powder", "whey-protein", "protein-whey",
)


def plan_has_protein(plan: dict) -> bool:
    """True if the plan's supplement_protocol already carries any protein
    powder (so we never double-add)."""
    for sp in (plan.get("supplement_protocol") or []):
        slug = ""
        if isinstance(sp, dict):
            slug = str(sp.get("supplement_slug") or "").lower()
        else:
            slug = str(getattr(sp, "supplement_slug", "") or "").lower()
        if slug in _PROTEIN_SLUGS or "protein" in slug:
            return True
    return False


def should_add_protein_supplement(client: dict, plan: dict | None = None):
    """Decide whether a protein-powder item belongs on the PLAN's
    supplement_protocol, per the coach rule: add for vegetarians, OR for
    anyone with a lab protein-gap signal — but NEVER when protein is
    contraindicated (kidney disease / high uric acid / gout).

    Returns (add: bool, reason: str). `reason` records why it was added or
    skipped, for the change log / coach_rationale.
    """
    target = calc_protein_target(client, plan)
    # Contraindicated → never push protein.
    if target and target.get("suppressed"):
        why = suppress_why(target.get("suppress_reason"))
        return False, f"skipped — protein not raised ({why})"

    veg = is_vegetarian(client)
    gap = protein_gap_signal(client)
    if not (veg or gap):
        return False, "skipped — not vegetarian and no protein-gap lab signal"

    triggers = []
    if veg:
        triggers.append("vegetarian/vegan plate (routinely under-eats protein)")
    if gap:
        triggers.append(gap)
    return True, "; ".join(triggers)


def build_protein_supplement_fields(client: dict, plan: dict | None = None) -> dict:
    """Build the SupplementItem field dict for the protein powder.

    Returns {supplement_slug, form, dose, timing, take_with_food,
    duration_weeks, coach_rationale}. Caller constructs the model and
    appends to plan.supplement_protocol.
    """
    src = pick_protein_source(client, plan)
    target = calc_protein_target(client, plan)
    _, add_reason = should_add_protein_supplement(client, plan)

    slug = src["slug"]
    if slug == "protein-plant-blend":
        form = ("powder — mung + pea isolate (dairy / soy / gluten free), "
                "unsweetened (reference product VitaOne Rebuild Plant Protein "
                "& Lipid)")
    elif slug == "protein-whey-isolate":
        form = "powder — unflavoured whey protein isolate, unsweetened"
    else:
        form = "powder — fermented yeast protein, unflavoured, unsweetened"

    if target and target.get("low_g"):
        low, high = target["low_g"], target["high_g"]
        per_lo, per_hi = target["per_kg_low"], target["per_kg_high"]
        wt = target.get("basis_weight_kg")
        dose = (f"20-25 g (1 scoop) once daily, building toward a total "
                f"daily protein target of {low}-{high} g "
                f"({per_lo}-{per_hi} g/kg of {wt} kg) from food + this top-up")
    else:
        dose = "20-25 g (1 scoop) once daily as a protein top-up"

    rationale = (
        f"Protein top-up — added because {add_reason}. {src['reason']} "
        "Food first at every meal; this scoop fills the gap so the daily "
        "protein target is actually met (protects lean mass, supports "
        "satiety and blood-sugar control). Not a meal replacement."
    )

    weeks = None
    if plan:
        weeks = plan.get("plan_period_weeks")
    return {
        "supplement_slug": slug,
        "form": form,
        "dose": dose,
        "timing": "With or just before breakfast",
        "take_with_food": "optional",
        "duration_weeks": int(weeks) if isinstance(weeks, (int, float)) and weeks else 12,
        "coach_rationale": rationale,
    }

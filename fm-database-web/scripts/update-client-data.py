#!/usr/bin/env python3
"""Merge transcript-extracted health data into a client YAML.

Reads JSON from stdin:
{
  "client_id": str,
  "measurements": {          # optional — null fields are skipped
    "height_cm": float | null,
    "weight_kg": float | null,
    "bp_systolic": int | null,
    "bp_diastolic": int | null,
    "hr_bpm": int | null,
    "waist_cm": float | null,
    "hip_cm": float | null
  },
  "medications": [str],      # optional — merged (deduplicated) with existing
  "conditions": [str],       # optional — merged (deduplicated) with existing
  "source": str              # attribution note (e.g. "transcript-2026-05-03")
}

Writes JSON to stdout:
{
  "ok": bool,
  "updated_fields": [str],   # which top-level fields were touched
  "error": str | null
}
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

FMDB_ROOT = Path(__file__).resolve().parent.parent.parent / "fm-database"
sys.path.insert(0, str(FMDB_ROOT))


def plans_root() -> Path:
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return Path.home() / "fm-plans"


_MONTHS = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun",
         "jul", "aug", "sep", "oct", "nov", "dec"], 1)
}


def normalize_date_iso(s):
    """Coerce a lab/report date string to ISO YYYY-MM-DD.

    Lab-report extractors read dates verbatim off the PDF — e.g.
    Indian labs print "06/Jul/2026" or "13/03/2026". Stored unnormalised,
    those string-sort BELOW real ISO dates ("06/..." < "2026-..."), so
    recompute-lab-markers.py treats the newest report as the OLDEST and
    the coach's markers silently keep stale values (Nidhi 2026-07-07:
    July HbA1c never overrode May). Normalise at ingest so every
    downstream date compare is correct. Unparseable input is returned
    unchanged (never crash, never drop the value).
    """
    import re
    import datetime
    if not isinstance(s, str):
        return s
    v = s.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return v  # already ISO
    # DD/Mon/YYYY or DD-Mon-YYYY (month name) — e.g. 06/Jul/2026
    m = re.fullmatch(r"(\d{1,2})[/\-\s]([A-Za-z]{3,})[/\-\s](\d{4})", v)
    if m:
        mon = _MONTHS.get(m.group(2)[:3].lower())
        if mon:
            try:
                return datetime.date(int(m.group(3)), mon, int(m.group(1))).isoformat()
            except ValueError:
                pass
    # DD/MM/YYYY or DD-MM-YYYY — Indian day-first convention
    m = re.fullmatch(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})", v)
    if m:
        a, b, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        dd, mm = (a, b) if not (a <= 12 and b > 12) else (b, a)
        try:
            return datetime.date(yy, mm, dd).isoformat()
        except ValueError:
            pass
    # YYYY/MM/DD
    m = re.fullmatch(r"(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})", v)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        except ValueError:
            pass
    return v  # unrecognised — leave untouched


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        json.dump({"ok": False, "error": f"invalid JSON: {e}"}, sys.stdout)
        return 2

    client_id: str = payload.get("client_id") or ""
    if not client_id:
        json.dump({"ok": False, "error": "client_id is required"}, sys.stdout)
        return 2

    measurements: dict = payload.get("measurements") or {}
    new_medications: list[str] = payload.get("medications") or []
    new_conditions: list[str] = payload.get("conditions") or []
    source: str = payload.get("source") or "manual"
    # lab_values are stored in snapshots but not merged into the profile
    # (profile only stores computed FM ratios from assess.py)

    # ── Load client YAML ─────────────────────────────────────────────────────
    client_dir = plans_root() / "clients" / client_id
    client_yaml = client_dir / "client.yaml"
    if not client_yaml.exists():
        json.dump({"ok": False, "error": f"client not found: {client_id}"}, sys.stdout)
        return 2

    try:
        import yaml  # type: ignore
    except ImportError as e:
        json.dump({"ok": False, "error": f"pyyaml not installed: {e}"}, sys.stdout)
        return 1

    with client_yaml.open("r", encoding="utf-8") as f:
        data: dict = yaml.safe_load(f) or {}

    updated_fields: list[str] = []

    # ── Merge measurements ────────────────────────────────────────────────────
    meas_field_map = {
        "height_cm": "height_cm",
        "weight_kg": "weight_kg",
        "bp_systolic": "blood_pressure_systolic",
        "bp_diastolic": "blood_pressure_diastolic",
        "hr_bpm": "resting_heart_rate",
        "waist_cm": "waist_cm",
        "hip_cm": "hip_cm",
    }

    existing_meas: dict = data.get("measurements") or {}
    meas_updated = False

    for src_key, dst_key in meas_field_map.items():
        val = measurements.get(src_key)
        if val is not None:
            existing_meas[dst_key] = val
            meas_updated = True

    if meas_updated:
        import datetime
        existing_meas["measured_on"] = datetime.date.today().isoformat()
        existing_meas["notes"] = (
            (existing_meas.get("notes") or "") +
            f" [auto-captured from {source}]"
        ).strip()
        data["measurements"] = existing_meas
        updated_fields.append("measurements")

    # ── Merge medications ─────────────────────────────────────────────────────
    if new_medications:
        existing_meds: list[str] = data.get("current_medications") or data.get("medications") or []
        existing_lower = {m.lower() for m in existing_meds}
        added = [m for m in new_medications if m.lower() not in existing_lower]
        if added:
            merged = existing_meds + added
            # Write to whichever key the file already uses
            if "current_medications" in data:
                data["current_medications"] = merged
            else:
                data["medications"] = merged
            updated_fields.append("medications")

    # ── Merge conditions ─────────────────────────────────────────────────────
    # Real-use bug surfaced 2026-05-16: cl-006 (Geetika) had 14 active
    # conditions including Type 1 diabetes, Type 2 diabetes, Insulinoma, PCOS,
    # "At risk for diabetes", plus duplicates of real diagnoses. Likely
    # injected by an early extractor reading a lab report whose reference
    # text mentioned those topics — the extractor treated topical mentions
    # as the client's own diagnoses.
    #
    # Three guards against recurrence:
    #   1. BLOCKLIST: never add conditions that look like "at risk for X"
    #      ("at risk" is a coach assessment, not a diagnosis).
    #   2. SUSPICIOUS_PATTERNS: skip + log conditions that look like topic
    #      labels rather than diagnoses (single noun-phrase from a
    #      well-known FM topic taxonomy). The caller can re-add explicitly.
    #   3. DEDUP: case-insensitive AND substring-aware — "Prediabetes"
    #      and "Prediabetes (HbA1c 6.20%)" are treated as the same
    #      condition (longer wins, since it carries more detail).
    if new_conditions:
        existing_conds: list[str] = data.get("active_conditions") or data.get("conditions") or []

        # Guard 1: blocklist phrases.
        BLOCKLIST_SUBSTRINGS = (
            "at risk for ",
            "at risk of ",
            "risk for ",  # generic "risk for X" framings
        )
        # Guard 2: extraction-noise patterns that historically slipped in.
        # These are concepts the AI sometimes confuses with diagnoses when
        # they appear as topics in source material (lab references, FM
        # textbooks, articles). If they show up here without the client
        # ALREADY having them in existing_conds, drop them — coach can
        # add manually if it's a real diagnosis.
        EXTRACTION_NOISE = {
            "type 1 diabetes", "t1dm", "type 1 diabetes mellitus",
            "type 2 diabetes",  "t2dm", "type 2 diabetes mellitus",
            "insulinoma",
            "polycystic ovary syndrome", "pcos",
            "celiac disease",  # frequently appears in gut-health articles
            "lupus", "sle",
            "rheumatoid arthritis", "ra",
            "multiple sclerosis", "ms",
        }

        suspicious_dropped: list[str] = []
        def keep(c: str) -> bool:
            cl = c.lower().strip()
            if any(b in cl for b in BLOCKLIST_SUBSTRINGS):
                suspicious_dropped.append(c)
                return False
            # Only block extraction-noise if it's not ALREADY on the
            # client's record (coach added it manually before, presumably
            # because it IS the diagnosis).
            existing_lower_set = {e.lower().strip() for e in existing_conds}
            if cl in EXTRACTION_NOISE and cl not in existing_lower_set:
                suspicious_dropped.append(c)
                return False
            return True

        filtered_new = [c for c in new_conditions if keep(c)]

        # Guard 3: substring-aware dedup. Build a working list of
        # (canonical_form, original) pairs; if a new entry's canonical
        # form is a substring of an existing canonical form (or vice
        # versa), treat them as the same condition. Longer (more detail)
        # wins.
        def canonicalise(s: str) -> str:
            # Strip parens content, punctuation, normalise whitespace.
            import re
            s2 = re.sub(r"\(.*?\)", "", s).lower()
            s2 = re.sub(r"[^a-z0-9 ]+", " ", s2)
            s2 = re.sub(r"\s+", " ", s2).strip()
            return s2

        merged = list(existing_conds)  # start with existing
        for new_c in filtered_new:
            new_canon = canonicalise(new_c)
            if not new_canon:
                continue
            dup_idx = None
            for i, ex in enumerate(merged):
                ex_canon = canonicalise(ex)
                if not ex_canon:
                    continue
                # Match: exact, substring either direction, or token-set equality.
                if new_canon == ex_canon:
                    dup_idx = i; break
                if new_canon in ex_canon or ex_canon in new_canon:
                    dup_idx = i; break
            if dup_idx is None:
                merged.append(new_c)
            else:
                # Longer (more detail) wins — keep whichever has more
                # information.
                if len(new_c) > len(merged[dup_idx]):
                    merged[dup_idx] = new_c

        if merged != existing_conds:
            if "active_conditions" in data:
                data["active_conditions"] = merged
            else:
                data["conditions"] = merged
            updated_fields.append("conditions")

        if suspicious_dropped:
            print(
                f"[update-client-data] Dropped {len(suspicious_dropped)} suspicious "
                f"condition(s) (extraction-noise / blocklist): "
                f"{suspicious_dropped}",
                file=sys.stderr,
            )

    # A pure-lab upload (lab_values only, no new measurements / meds /
    # conditions) wouldn't otherwise be persisted because `updated_fields`
    # tracks profile-merge edits — not snapshot additions. Treat the
    # presence of lab_values OR a non-default source as a reason to
    # still append the snapshot below.
    new_lab_values = payload.get("lab_values") or []
    if not updated_fields and not new_lab_values:
        json.dump({"ok": True, "updated_fields": [], "message": "nothing to update"}, sys.stdout)
        return 0
    if not updated_fields and new_lab_values:
        # Surface that we're still adding a snapshot even though no
        # profile merge happened. Useful in audit logs.
        updated_fields.append("lab_snapshot_only")

    # ── Append health snapshot ────────────────────────────────────────────────
    # Every apply-call adds an immutable snapshot so we can build trend charts.
    # For OLDER lab reports, derive the snapshot date from the labs themselves
    # (their `date_drawn` field) rather than today's date — otherwise the
    # trend chart shows a flat-line bunch on the day-of-upload instead of
    # the actual chronological history. Coach: "older reports should help
    # generate client history over time."
    import datetime
    snap_date = datetime.date.today().isoformat()
    snap_labs_in = payload.get("lab_values") or []
    if isinstance(snap_labs_in, list) and snap_labs_in:
        # Normalise each extracted date_drawn to ISO BEFORE deriving the
        # snapshot date — labs print "06/Jul/2026" etc., which would
        # otherwise string-sort as older than every real ISO date.
        for lv in snap_labs_in:
            if isinstance(lv, dict) and lv.get("date_drawn"):
                lv["date_drawn"] = normalize_date_iso(lv["date_drawn"])
        # Use the EARLIEST date_drawn across the bundle as the snapshot
        # date (a single report is usually one collection day; if multiple
        # dates leak in, earliest captures the report's primary draw).
        drawn_dates = sorted(
            d for d in (lv.get("date_drawn") for lv in snap_labs_in if isinstance(lv, dict))
            if d and isinstance(d, str)
        )
        if drawn_dates:
            snap_date = normalize_date_iso(drawn_dates[0])
    snap: dict = {
        "date": snap_date,
        "source": source,
    }
    # Optional: link this snapshot to the session that ordered the report.
    linked_session_id = payload.get("linked_session_id")
    if linked_session_id and isinstance(linked_session_id, str):
        snap["linked_session_id"] = linked_session_id
    # Include whatever we received (even if not new vs profile, the snapshot is the record)
    snap_meas = {k: measurements.get(k) for k in meas_field_map if measurements.get(k) is not None}
    if snap_meas:
        snap["measurements"] = snap_meas
    snap_labs = payload.get("lab_values") or []
    if snap_labs:
        snap["lab_values"] = snap_labs
    if new_medications:
        snap["medications"] = new_medications
    if new_conditions:
        snap["conditions"] = new_conditions

    existing_snaps: list = data.get("health_snapshots") or []
    # MERGE into an existing same-date + same-source snapshot rather than
    # replacing it. A client routinely uploads several reports drawn the same
    # day (e.g. a biochemistry panel AND a CBC/Hemogram), all tagged source
    # "lab_report". The old behaviour deleted the earlier snapshot and appended
    # the new one, silently dropping the first report's values. Now we union
    # lab_values by test_name (new value wins on conflict) and merge the other
    # snapshot fields so both reports accumulate.
    prior = next(
        (s for s in existing_snaps
         if s.get("date") == snap["date"] and s.get("source") == snap["source"]),
        None,
    )
    if prior is not None:
        merged_labs = [lv for lv in (prior.get("lab_values") or []) if isinstance(lv, dict)]
        seen = {str(lv.get("test_name", "")).lower() for lv in merged_labs}
        for lv in (snap.get("lab_values") or []):
            if not isinstance(lv, dict):
                continue
            name = str(lv.get("test_name", "")).lower()
            if name in seen:
                merged_labs = [x for x in merged_labs
                               if str(x.get("test_name", "")).lower() != name]
            merged_labs.append(lv)
            seen.add(name)
        if merged_labs:
            prior["lab_values"] = merged_labs
        if snap.get("measurements"):
            merged_meas = dict(prior.get("measurements") or {})
            merged_meas.update(snap["measurements"])
            prior["measurements"] = merged_meas
        for key in ("medications", "conditions"):
            if snap.get(key):
                combined = list(prior.get(key) or [])
                low = {str(x).lower() for x in combined}
                for v in snap[key]:
                    if str(v).lower() not in low:
                        combined.append(v)
                        low.add(str(v).lower())
                prior[key] = combined
        if snap.get("linked_session_id") and not prior.get("linked_session_id"):
            prior["linked_session_id"] = snap["linked_session_id"]
    else:
        existing_snaps.append(snap)
    data["health_snapshots"] = existing_snaps

    # ── Compute FM-interpreted lab_markers from the merged-lab history ────────
    # Previously only the Full Assessment AI pass wrote client.lab_markers,
    # so the Overview FM markers panel only updated after an expensive
    # synthesis run. Now any lab-bearing snapshot rebuilds the markers from
    # the union of all snapshot lab_values so the panel reflects fresh data
    # immediately. Saves ~$0.20 + ~3 min per upload.
    if snap_labs or any((s.get("lab_values") or []) for s in existing_snaps):
        try:
            from fmdb.assess.lab_ratios import compute_ratios  # type: ignore

            # Walk all snapshots, flatten their lab_values. compute_ratios's
            # _find() uses date_drawn to pick the most-recent value per
            # marker, so older snapshots are naturally superseded by newer
            # entries with the same test_name.
            all_labs: list = []
            for s in existing_snaps:
                for lv in (s.get("lab_values") or []):
                    if not isinstance(lv, dict):
                        continue
                    # date_drawn falls back to the snapshot's date if the
                    # extracted lab didn't carry one.
                    if not lv.get("date_drawn") and s.get("date"):
                        lv = dict(lv)
                        lv["date_drawn"] = s["date"]
                    all_labs.append(lv)
            if all_labs:
                markers = compute_ratios(all_labs)
                if markers:
                    data["lab_markers"] = markers
                    # Pick the newest date across all labs as the marker date
                    all_dates = sorted(
                        [lv.get("date_drawn") or "" for lv in all_labs],
                        reverse=True,
                    )
                    if all_dates and all_dates[0]:
                        data["lab_markers_date"] = all_dates[0]
                    if "lab_markers" not in updated_fields:
                        updated_fields.append("lab_markers")
        except Exception as e:
            # Don't fail the whole save if marker compute breaks — surface
            # in the response so the UI can warn.
            updated_fields.append(f"lab_markers_compute_skipped: {e}")

    # Bump version
    data["version"] = (data.get("version") or 1) + 1

    with client_yaml.open("w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

    json.dump({"ok": True, "updated_fields": updated_fields}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

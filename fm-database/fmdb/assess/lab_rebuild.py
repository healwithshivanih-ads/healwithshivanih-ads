"""Rebuild a client's lab_markers + lab_synthesis from every lab snapshot.

The same walk `recompute-lab-markers.py` and `update-client-data.py` do:
flatten every snapshot's lab_values (a lab without date_drawn inherits the
snapshot date, so compute_ratios' newest-wins rule orders it), run
compute_ratios with the client context, then the holistic synthesis.

Pure over the client dict — the caller reads and writes the YAML.
"""
from __future__ import annotations

from typing import Any

from fmdb.assess.client_context import lab_client_context
from fmdb.assess.lab_ratios import compute_ratios
from fmdb.assess.lab_synthesis import synthesise_labs


def flatten_snapshot_labs(data: dict[str, Any]) -> list[dict]:
    out: list[dict] = []
    for snap in data.get("health_snapshots") or []:
        if not isinstance(snap, dict):
            continue
        for lv in snap.get("lab_values") or []:
            if not isinstance(lv, dict):
                continue
            if not lv.get("date_drawn") and snap.get("date"):
                lv = {**lv, "date_drawn": snap["date"]}
            out.append(lv)
    return out


def rebuild_lab_outputs(data: dict[str, Any]) -> int:
    """Set data["lab_markers"], ["lab_markers_date"], ["lab_synthesis"] in
    place. Returns the marker count (0 = no labs; nothing is changed)."""
    labs = flatten_snapshot_labs(data)
    if not labs:
        return 0
    ctx = lab_client_context(data)
    markers = compute_ratios(labs, ctx)
    data["lab_markers"] = markers
    dates = sorted((str(lv.get("date_drawn") or "") for lv in labs), reverse=True)
    if dates and dates[0]:
        data["lab_markers_date"] = dates[0]
    data["lab_synthesis"] = synthesise_labs(markers, ctx) if markers else None
    return len(markers)

"""The `--check-new --json` ratchet, as failable tests.

Why this file exists
--------------------
`fmdb duplicates` has two JSON shapes on purpose, and the dashboard chip reads
only the second one:

    --json                 -> a bare ARRAY of every finding (349 today)
    --check-new --json     -> an OBJECT {new: [...], known: N}

The distinction is load-bearing. Every one of the 349 findings is already in
`_duplicates_baseline.yaml`, so a chip that read the array would report 47
criticals on every dashboard load, forever, about debt that has been explicitly
accepted — the "after 3-4 they become wallpaper" failure FmAlertGroup was built
to fix. The chip must show what is NEW.

And it fails CLOSED: FmCatalogueDuplicateChip's server action returns an empty
status on any error, so if someone renames a key here the chip does not break
loudly — it silently HIDES, and the ratchet's coach-facing half is gone with no
symptom. Hence a test that pins the shape rather than trusting review.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from fmdb.duplicates import DuplicateFinding, fingerprint

FMDB_DIR = Path(__file__).resolve().parent.parent

# The exact field set `DuplicateItem` declares in
# fm-database-web/src/app/catalogue-duplicate-action.ts. Keep in lockstep.
_TS_FIELDS = {"check", "entity_kind", "slugs", "severity", "detail", "evidence"}


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "fmdb.cli", "duplicates", *args],
        cwd=FMDB_DIR, capture_output=True, text=True, timeout=300,
    )


@pytest.fixture(scope="module")
def ratchet_json() -> subprocess.CompletedProcess:
    """One real scan (~15s over the whole catalogue), shared by every test."""
    return _run("--check-new", "--json")


def test_ratchet_json_is_an_object_with_new_and_known(ratchet_json):
    """The shape the chip destructures. A rename here hides the chip silently."""
    payload = json.loads(ratchet_json.stdout)
    assert isinstance(payload, dict), (
        "--check-new --json must emit an OBJECT. A bare array is the full-scan "
        "shape, and reading it as the ratchet would surface the whole accepted "
        "baseline as if it were new."
    )
    assert isinstance(payload["new"], list)
    assert isinstance(payload["known"], int)
    # `known` counts ALL findings, `new` only those outside the baseline.
    assert payload["known"] >= len(payload["new"])


def test_ratchet_items_carry_every_field_the_chip_renders(ratchet_json):
    for item in json.loads(ratchet_json.stdout)["new"]:
        assert set(item) == _TS_FIELDS, (
            f"item fields {sorted(item)} != the DuplicateItem interface "
            f"{sorted(_TS_FIELDS)} — the chip renders these by name."
        )
        assert item["severity"] in {"CRITICAL", "WARNING"}
        assert isinstance(item["slugs"], list) and item["slugs"]


def test_ratchet_exit_code_tracks_whether_anything_is_new(ratchet_json):
    """0 when clean, 1 when new. The action recovers the payload from the
    error's stdout precisely because a NEW finding exits non-zero."""
    payload = json.loads(ratchet_json.stdout)
    assert ratchet_json.returncode == (1 if payload["new"] else 0)


def test_plain_json_is_still_a_bare_array():
    """The pre-existing contract. Adding the object shape must not change it."""
    proc = _run("--json")
    assert isinstance(json.loads(proc.stdout), list)


def test_baseline_filtering_keeps_only_unaccepted_findings():
    """The ratchet itself, synthetically — no catalogue load.

    Adoption started at 111 criticals. Gating on the total just teaches everyone
    to pass --no-verify, so the gate is on what is absent from the baseline.
    """
    accepted = DuplicateFinding("SHARED_ALIAS", "topics", ["a", "b"], "known")
    brand_new = DuplicateFinding("SHARED_ALIAS", "topics", ["c", "d"], "new")
    baseline = {fingerprint(accepted)}

    fresh = [f for f in (accepted, brand_new) if fingerprint(f) not in baseline]
    assert fresh == [brand_new]


def test_fingerprint_survives_rewording_and_regrading():
    """Fingerprints exclude `detail` and `severity` on purpose — improving a
    message or re-grading a finding must not invalidate a whole baseline."""
    a = DuplicateFinding("SHARED_ALIAS", "topics", ["x", "y"], "one wording",
                         severity="WARNING", evidence=["tg"])
    b = DuplicateFinding("SHARED_ALIAS", "topics", ["y", "x"], "quite another",
                         severity="CRITICAL", evidence=["tg", "thyroglobulin"])
    assert fingerprint(a) == fingerprint(b)

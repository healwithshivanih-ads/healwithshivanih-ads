"""Plan lifecycle transitions: submit, publish, revoke, supersede, diff.

State machine
-------------
    draft ──submit──▶ ready_to_publish ──publish──▶ published
                                                       │
                                              ┌────────┴────────┐
                                              │                 │
                                          revoke              supersede
                                              │                 │
                                              ▼                 ▼
                                          revoked          superseded

Rules:
- submit:    requires plan_check returning 0 CRITICAL findings.
- publish:   irreversible. Bumps version (max published version + 1), freezes
             catalogue_snapshot to current git SHA, removes ready/<slug>.yaml,
             writes published/<slug>-vN.yaml.
- revoke:    only published plans. Requires reason. Writes the flipped record
             to revoked/<slug>-vN.yaml AND removes the matching published/
             file (so load_plan returns the revoked record, not the stale
             published one). Audit trail lives in status_history + git history.
- supersede: publish a NEW plan that has supersedes=<old_slug>. The old plan
             must be currently 'published'. The old plan's status flips to
             'superseded' and is moved to superseded/ (latest version).
- diff:      structural diff of two plan versions (or current vs prior).
"""
from __future__ import annotations

import shutil
import subprocess
from datetime import datetime, timezone, date
from pathlib import Path
from typing import Optional

import yaml

from ..enums import PlanStatus
from ..validator import load_all
from .checker import check_plan, auto_fix_plan_routing
from .models import Plan, StatusEvent, CatalogueSnapshot
from . import storage as plan_storage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _append_event(plan: Plan, state: PlanStatus, by: str, reason: str = "") -> None:
    plan.status_history.append(StatusEvent(state=state, by=by, at=_now(), reason=reason))


def _git_sha(repo_dir: Path) -> Optional[str]:
    """Return short git SHA of HEAD for the catalogue repo, or None if not a repo."""
    try:
        out = subprocess.check_output(
            ["git", "-C", str(repo_dir), "rev-parse", "--short", "HEAD"],
            stderr=subprocess.DEVNULL,
        )
        return out.decode().strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def _max_published_version(root: Path, slug: str) -> int:
    """Highest version of this slug already in published/ (0 if never published)."""
    d = root / "published"
    if not d.exists():
        return 0
    highest = 0
    for f in d.glob(f"{slug}-v*.yaml"):
        try:
            n = int(f.stem.rsplit("-v", 1)[1])
            highest = max(highest, n)
        except (ValueError, IndexError):
            continue
    return highest


# ---------------------------------------------------------------------------
# submit: draft → ready_to_publish
# ---------------------------------------------------------------------------


def submit_plan(
    root: Path,
    slug: str,
    by: str,
    catalogue_dir: Path,
    reason: str = "",
) -> tuple[Plan, list]:
    """Move a draft to ready_to_publish if plan-check is clean (0 CRITICAL).

    Returns (plan, findings). Raises RuntimeError if the plan has CRITICAL findings.
    """
    plan = plan_storage.load_plan(root, slug)
    if plan.status != PlanStatus.draft:
        raise RuntimeError(f"plan {slug!r} is {plan.status.value!r}; only drafts can be submitted")

    # Run deterministic check
    try:
        client = plan_storage.load_client(root, plan.client_id)
    except FileNotFoundError:
        client = None
    catalogue = load_all(catalogue_dir)

    # Auto-fix routing errors (e.g. mechanism slugs accidentally placed in
    # contributing_topics) BEFORE running plan-check. The fix mutates the
    # plan in place; persist the corrected plan so subsequent loads see the
    # cleaned-up data.
    fixes = auto_fix_plan_routing(plan, catalogue)
    if fixes:
        plan_storage.write_plan(root, plan)

    findings = check_plan(plan, client, catalogue)
    critical = [f for f in findings if f.severity == "CRITICAL"]
    if critical:
        raise RuntimeError(
            f"plan {slug!r} has {len(critical)} CRITICAL finding(s); fix before submitting:\n"
            + "\n".join(f"  - {f.render()}" for f in critical)
        )

    # Transition + move file
    old_path = root / "drafts" / f"{slug}.yaml"
    plan.status = PlanStatus.ready_to_publish
    plan.updated_by = by
    _append_event(plan, PlanStatus.ready_to_publish, by, reason)
    plan_storage.write_plan(root, plan)  # writes to ready/
    if old_path.exists():
        old_path.unlink()
    return plan, findings


# ---------------------------------------------------------------------------
# publish: ready → published (irreversible, freezes catalogue snapshot)
# ---------------------------------------------------------------------------


def publish_plan(
    root: Path,
    slug: str,
    by: str,
    catalogue_dir: Path,
    reason: str = "",
) -> tuple[Plan, Path, Optional[str]]:
    """Promote ready_to_publish → published.

    - Bumps version (max published version + 1).
    - Freezes catalogue_snapshot.git_sha to current HEAD of the catalogue repo.
    - Re-runs plan-check; refuses if anything is CRITICAL (catalogue may have
      drifted between submit and publish).
    - Removes ready/<slug>.yaml.
    - Writes published/<slug>-vN.yaml.

    Returns (plan, written_path, git_sha).
    """
    plan = plan_storage.load_plan(root, slug)
    if plan.status != PlanStatus.ready_to_publish:
        raise RuntimeError(
            f"plan {slug!r} is {plan.status.value!r}; only ready_to_publish plans can be published"
        )

    # Re-check: catalogue may have changed since submit
    try:
        client = plan_storage.load_client(root, plan.client_id)
    except FileNotFoundError:
        client = None
    catalogue = load_all(catalogue_dir)

    # Re-run auto-fix in case the plan was edited after submit_plan
    fixes = auto_fix_plan_routing(plan, catalogue)
    if fixes:
        plan_storage.write_plan(root, plan)

    findings = check_plan(plan, client, catalogue)
    critical = [f for f in findings if f.severity == "CRITICAL"]
    if critical:
        raise RuntimeError(
            f"plan {slug!r} has {len(critical)} CRITICAL finding(s) on re-check; "
            f"catalogue likely drifted since submit. Fix and re-submit:\n"
            + "\n".join(f"  - {f.render()}" for f in critical)
        )

    # Freeze catalogue snapshot
    sha = _git_sha(catalogue_dir)
    plan.catalogue_snapshot = CatalogueSnapshot(
        git_sha=sha,
        snapshot_date=date.today(),
    )

    # ── Capture baseline_snapshot for outcome tracking (Phase 1) ─────────
    # Records the client's lab markers / measurements / presenting symptoms
    # at publish time so downstream delta computation can attribute
    # changes ("TSH dropped 1.4 over 12 weeks") to the interventions in
    # this plan rather than to ambient noise.
    if client is not None:
        client_dict = client.model_dump(mode="json") if hasattr(client, "model_dump") else {}
        # Pull the latest five-pillars assessment from sessions if available
        # within the last 30 days — keeps the snapshot synced with the
        # client's recent self-rating, not an outdated one.
        latest_pillars = None
        try:
            sessions = plan_storage.list_sessions(root, plan.client_id)
            recent = [s for s in sessions if getattr(s, "five_pillars", None)]
            if recent:
                # newest by date
                recent.sort(key=lambda s: s.date, reverse=True)
                cutoff = date.today().toordinal() - 30
                if recent[0].date.toordinal() >= cutoff:
                    fp = recent[0].five_pillars
                    if hasattr(fp, "model_dump"):
                        latest_pillars = fp.model_dump(mode="json")
        except Exception:
            pass

        plan.baseline_snapshot = {
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "plan_period_start": plan.plan_period_start.isoformat(),
            "plan_slug": plan.slug,
            "plan_version_at_capture": (_max_published_version(root, plan.slug) + 1),
            "lab_markers": client_dict.get("lab_markers") or [],
            "lab_markers_date": client_dict.get("lab_markers_date"),
            "measurements": client_dict.get("measurements") or {},
            "presenting_symptoms": list(plan.presenting_symptoms),
            "active_conditions": client_dict.get("active_conditions") or [],
            "current_medications": (
                client_dict.get("current_medications")
                or client_dict.get("medications")
                or []
            ),
            "five_pillars": latest_pillars,
        }

    # Bump version
    new_version = _max_published_version(root, slug) + 1
    plan.version = new_version
    plan.status = PlanStatus.published
    plan.updated_by = by
    _append_event(plan, PlanStatus.published, by, reason)

    written = plan_storage.write_plan(root, plan)  # writes to published/<slug>-vN.yaml
    # Remove the ready/ file
    ready_path = root / "ready" / f"{slug}.yaml"
    if ready_path.exists():
        ready_path.unlink()

    # Auto-supersede: when the coach publishes a NEW plan for a client who
    # already has one or more published plans, flip every other published
    # plan for the same client_id to `superseded`. This stops stale plans
    # from polluting "active plan" surfaces (start-date-reminder list,
    # dashboard recheck timers, SOAP "P" section, etc.) when the coach
    # forgets to manually supersede.
    #
    # Coach decision 2026-05-15: a client can only have one active plan
    # at a time. Two plans in `published/` for the same client is always
    # a leak — the previous publish forgot to flip the old one.
    _auto_supersede_siblings(root, plan, by)

    return plan, written, sha


def _auto_supersede_siblings(root: Path, new_plan: Plan, by: str) -> list[str]:
    """Find every other published plan for new_plan.client_id and flip them
    to superseded. Returns the list of slugs that were flipped.

    Skips:
      - the just-published plan itself
      - plans that aren't currently in `published/` status (already
        superseded, revoked, or draft — leave them alone)

    Each flipped plan gets a status_history event tying it to new_plan.slug
    so the audit trail is complete.
    """
    pub_dir = root / "published"
    if not pub_dir.exists():
        return []
    flipped: list[str] = []
    # Build a slug → highest_version map of published files for this client
    by_slug: dict[str, int] = {}
    for f in pub_dir.glob("*-v*.yaml"):
        # Cheap pre-filter: load to confirm client_id match
        try:
            data = yaml.safe_load(f.read_text())
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        if data.get("client_id") != new_plan.client_id:
            continue
        slug = data.get("slug")
        if not isinstance(slug, str) or slug == new_plan.slug:
            continue
        try:
            v = int(f.stem.rsplit("-v", 1)[1])
        except (ValueError, IndexError):
            continue
        by_slug[slug] = max(by_slug.get(slug, 0), v)

    for old_slug, _v in by_slug.items():
        try:
            old_plan = plan_storage.load_plan(root, old_slug)
        except Exception:
            continue
        if old_plan.status != PlanStatus.published:
            continue
        old_version = old_plan.version
        old_plan.status = PlanStatus.superseded
        old_plan.updated_by = by
        _append_event(
            old_plan,
            PlanStatus.superseded,
            by,
            f"auto-superseded by {new_plan.slug} v{new_plan.version}",
        )
        plan_storage.write_plan(root, old_plan)
        # Remove the now-stale published/ file
        old_pub = root / "published" / f"{old_slug}-v{old_version}.yaml"
        if old_pub.exists():
            old_pub.unlink()
        flipped.append(old_slug)
    return flipped


# ---------------------------------------------------------------------------
# revoke: published → revoked
# ---------------------------------------------------------------------------


def graduate_plan(root: Path, slug: str, by: str, reason: str = "") -> tuple[Plan, Path]:
    """Mark a published plan as graduated. Used when the client has
    successfully completed the protocol — distinct from `revoked` which
    is a withdrawal.

    Graduated plans drop out of active triage but stay in the historical
    record. Dashboard / client list can filter them into an Alumni bucket.

    Reason is optional but useful for the audit trail (e.g.
    "Symptoms resolved, transitioning to maintenance cadence").
    """
    plan = plan_storage.load_plan(root, slug)
    if plan.status != PlanStatus.published:
        raise RuntimeError(
            f"plan {slug!r} is {plan.status.value!r}; only published plans can be graduated"
        )
    old_version = plan.version
    plan.status = PlanStatus.graduated
    plan.updated_by = by
    _append_event(plan, PlanStatus.graduated, by, reason or "Client graduated — protocol complete")
    written = plan_storage.write_plan(root, plan)
    # Remove the now-stale published/ file so load_plan resolves to graduated
    pub_file = root / "published" / f"{slug}-v{old_version}.yaml"
    if pub_file.exists():
        pub_file.unlink()
    return plan, written


def revoke_plan(root: Path, slug: str, by: str, reason: str) -> tuple[Plan, Path]:
    """Mark a published plan as revoked. Reason is required.

    Implementation: load latest published version, flip status, write a NEW
    file to revoked/<slug>-vN.yaml (same version number). The original
    published/<slug>-vN.yaml stays in place as the historical record.
    """
    if not reason or not reason.strip():
        raise ValueError("revoke requires a non-empty reason")
    plan = plan_storage.load_plan(root, slug)
    if plan.status != PlanStatus.published:
        raise RuntimeError(
            f"plan {slug!r} is {plan.status.value!r}; only published plans can be revoked"
        )
    old_version = plan.version
    plan.status = PlanStatus.revoked
    plan.updated_by = by
    _append_event(plan, PlanStatus.revoked, by, reason)
    written = plan_storage.write_plan(root, plan)
    # Remove the now-stale published/ file so load_plan resolves to revoked
    pub_file = root / "published" / f"{slug}-v{old_version}.yaml"
    if pub_file.exists():
        pub_file.unlink()
    return plan, written


# ---------------------------------------------------------------------------
# supersede: publish a new plan that replaces an old one
# ---------------------------------------------------------------------------


def supersede_plan(
    root: Path,
    new_slug: str,
    by: str,
    catalogue_dir: Path,
    reason: str = "",
) -> tuple[Plan, Plan, Path]:
    """Publish `new_slug` (which must already be ready_to_publish AND have
    supersedes=<old_slug> set), and flip the old plan from published → superseded.

    Returns (new_plan, old_plan, new_written_path).
    """
    new_plan = plan_storage.load_plan(root, new_slug)
    if not new_plan.supersedes:
        raise RuntimeError(
            f"plan {new_slug!r} has no `supersedes` field set; "
            f"set it to the slug of the plan being replaced before superseding"
        )
    old_slug = new_plan.supersedes
    old_plan = plan_storage.load_plan(root, old_slug)
    if old_plan.status != PlanStatus.published:
        raise RuntimeError(
            f"old plan {old_slug!r} is {old_plan.status.value!r}; "
            f"only published plans can be superseded"
        )

    # Publish the new one
    new_plan, new_path, _sha = publish_plan(root, new_slug, by, catalogue_dir, reason=reason)

    # Flip the old one
    old_version = old_plan.version
    old_plan.status = PlanStatus.superseded
    old_plan.updated_by = by
    _append_event(old_plan, PlanStatus.superseded, by,
                  reason or f"superseded by {new_slug} v{new_plan.version}")
    plan_storage.write_plan(root, old_plan)  # writes to superseded/<old_slug>-vN.yaml
    # Remove the now-stale published/ file so load_plan resolves to superseded
    pub_file = root / "published" / f"{old_slug}-v{old_version}.yaml"
    if pub_file.exists():
        pub_file.unlink()

    return new_plan, old_plan, new_path


# ---------------------------------------------------------------------------
# diff
# ---------------------------------------------------------------------------


def diff_plans(root: Path, slug_a: str, slug_b: str) -> str:
    """Return a textual diff of two plans (whichever versions are current).

    Diff is computed on the YAML dump for readability.
    """
    import difflib
    pa = plan_storage.load_plan(root, slug_a)
    pb = plan_storage.load_plan(root, slug_b)
    ya = yaml.safe_dump(pa.model_dump(mode="json"), sort_keys=False, allow_unicode=True).splitlines()
    yb = yaml.safe_dump(pb.model_dump(mode="json"), sort_keys=False, allow_unicode=True).splitlines()
    diff = difflib.unified_diff(ya, yb, fromfile=slug_a, tofile=slug_b, lineterm="")
    return "\n".join(diff)

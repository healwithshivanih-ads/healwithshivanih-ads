"""Filesystem storage for clients and plans.

Plans live OUTSIDE the catalogue repo. Default location is ~/fm-plans/,
overridable via FMDB_PLANS_DIR env var or --plans-dir CLI flag.

Directory layout:
    <plans_root>/
      clients/<client-id>.yaml
      drafts/<plan-slug>.yaml
      ready/<plan-slug>.yaml
      published/<plan-slug>-v<version>.yaml
      superseded/<plan-slug>-v<version>.yaml
      revoked/<plan-slug>-v<version>.yaml
      _audit.jsonl

A plan's CURRENT location reflects its `status` field. Moving a plan
between buckets happens at lifecycle transitions (transition() helper).
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import yaml

from ..enums import PlanStatus
from .models import Client, Plan, Session


# ---------------------------------------------------------------------------
# Locating the plans dir
# ---------------------------------------------------------------------------


def plans_root(override: str | Path | None = None) -> Path:
    """Resolve the plans root directory, in order:
       1. explicit override (CLI --plans-dir)
       2. FMDB_PLANS_DIR env var
       3. ~/fm-plans/ (default)
    """
    if override is not None:
        return Path(override).expanduser().resolve()
    env = os.environ.get("FMDB_PLANS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return (Path.home() / "fm-plans").resolve()


def ensure_layout(root: Path) -> None:
    """Create the standard subdirectories if missing.

    Also runs the legacy-flat-clients migration if any are detected — moves
    clients/<id>.yaml to clients/<id>/client.yaml with empty files/ + sessions/
    subdirs. Idempotent: safe to call on every app start.
    """
    for sub in ("clients", "drafts", "ready", "published", "superseded", "revoked"):
        (root / sub).mkdir(parents=True, exist_ok=True)
    _migrate_flat_clients(root)


def _migrate_flat_clients(root: Path) -> list[str]:
    """Move legacy clients/<id>.yaml → clients/<id>/client.yaml.

    Returns the list of client_ids migrated (for logging).
    """
    clients_root = root / "clients"
    if not clients_root.exists():
        return []
    migrated: list[str] = []
    for entry in list(clients_root.iterdir()):
        if entry.is_file() and entry.suffix == ".yaml":
            client_id = entry.stem
            new_dir = clients_root / client_id
            if new_dir.exists() and new_dir.is_dir():
                # already migrated, but old file lingered — drop it
                entry.unlink()
                continue
            new_dir.mkdir(parents=True, exist_ok=True)
            (new_dir / "files").mkdir(exist_ok=True)
            (new_dir / "sessions").mkdir(exist_ok=True)
            entry.rename(new_dir / "client.yaml")
            migrated.append(client_id)
    return migrated


_STATUS_DIR: dict[PlanStatus, str] = {
    PlanStatus.draft: "drafts",
    PlanStatus.ready_to_publish: "ready",
    PlanStatus.published: "published",
    PlanStatus.superseded: "superseded",
    PlanStatus.revoked: "revoked",
}


def _versioned_filename(slug: str, version: int) -> str:
    return f"{slug}-v{version}.yaml"


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------


def client_dir(root: Path, client_id: str) -> Path:
    return root / "clients" / client_id


def client_path(root: Path, client_id: str) -> Path:
    return client_dir(root, client_id) / "client.yaml"


def client_files_dir(root: Path, client_id: str) -> Path:
    return client_dir(root, client_id) / "files"


def client_sessions_dir(root: Path, client_id: str) -> Path:
    return client_dir(root, client_id) / "sessions"


def client_photo_path(root: Path, client_id: str, ext: str = "jpg") -> Path:
    return client_dir(root, client_id) / f"photo.{ext}"


def write_client(root: Path, client: Client) -> Path:
    ensure_layout(root)
    cdir = client_dir(root, client.client_id)
    cdir.mkdir(parents=True, exist_ok=True)
    (cdir / "files").mkdir(exist_ok=True)
    (cdir / "sessions").mkdir(exist_ok=True)
    p = client_path(root, client.client_id)
    p.write_text(yaml.safe_dump(client.model_dump(mode="json"), sort_keys=False, allow_unicode=True))
    return p


def load_client(root: Path, client_id: str) -> Client:
    p = client_path(root, client_id)
    if not p.exists():
        raise FileNotFoundError(f"client not found: {client_id} (looked in {p})")
    return Client(**yaml.safe_load(p.read_text()))


def delete_client(root: Path, client_id: str) -> dict[str, Any]:
    """Permanently delete a client's directory (clients/<id>/) — including
    all files, sessions, and the client.yaml itself.

    Refuses if any non-revoked / non-superseded plan references this client.
    Returns a summary dict of what was deleted.
    """
    import shutil

    cdir = client_dir(root, client_id)
    if not cdir.exists():
        raise FileNotFoundError(f"client not found: {client_id} (looked in {cdir})")

    # Refuse if active plans exist for this client
    blocking_plans = []
    for status_dir in ("drafts", "ready", "published"):
        d = root / status_dir
        if not d.exists():
            continue
        for path in d.glob("*.yaml"):
            try:
                payload = yaml.safe_load(path.read_text())
                if payload and payload.get("client_id") == client_id:
                    blocking_plans.append(str(path.relative_to(root)))
            except Exception:
                continue
    if blocking_plans:
        raise RuntimeError(
            f"refusing to delete client {client_id!r}: still has active plans: "
            f"{blocking_plans}. Revoke or delete the plans first."
        )

    # Count what we're about to lose for the audit
    n_files = len(list((cdir / "files").glob("*"))) if (cdir / "files").exists() else 0
    n_sessions = len(list((cdir / "sessions").glob("*.yaml"))) if (cdir / "sessions").exists() else 0
    shutil.rmtree(cdir)
    return {
        "client_id": client_id,
        "deleted_dir": str(cdir),
        "files_deleted": n_files,
        "sessions_deleted": n_sessions,
    }


def list_clients(root: Path) -> list[Client]:
    """Walk clients/<id>/client.yaml — also runs migration on entry."""
    ensure_layout(root)
    d = root / "clients"
    if not d.exists():
        return []
    out = []
    for entry in sorted(d.iterdir()):
        if not entry.is_dir():
            continue
        cyaml = entry / "client.yaml"
        if not cyaml.exists():
            continue
        try:
            out.append(Client(**yaml.safe_load(cyaml.read_text())))
        except Exception as e:
            print(f"WARN: skipping {cyaml}: {e}")
    return out


# ---------------------------------------------------------------------------
# Files (lab reports, food journals, etc.) under clients/<id>/files/
# ---------------------------------------------------------------------------


def save_client_file(root: Path, client_id: str, filename: str, data: bytes) -> Path:
    """Write a binary file into the client's files/ dir, returning the path.
    If a file with the same name exists, appends a numeric suffix."""
    fdir = client_files_dir(root, client_id)
    fdir.mkdir(parents=True, exist_ok=True)
    target = fdir / filename
    if target.exists():
        stem, ext = target.stem, target.suffix
        n = 2
        while True:
            cand = fdir / f"{stem}-{n}{ext}"
            if not cand.exists():
                target = cand
                break
            n += 1
    target.write_bytes(data)
    return target


def list_client_files(root: Path, client_id: str) -> list[Path]:
    fdir = client_files_dir(root, client_id)
    if not fdir.exists():
        return []
    return sorted([p for p in fdir.iterdir() if p.is_file()])


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def write_session(root: Path, session: Session) -> Path:
    """Append a session record under clients/<id>/sessions/<session_id>.yaml.
    Refuses to overwrite — sessions are append-only."""
    sdir = client_sessions_dir(root, session.client_id)
    sdir.mkdir(parents=True, exist_ok=True)
    p = sdir / f"{session.session_id}.yaml"
    if p.exists():
        raise FileExistsError(f"session already exists: {p}")
    p.write_text(yaml.safe_dump(session.model_dump(mode="json"), sort_keys=False, allow_unicode=True))
    return p


def update_session(root: Path, session: Session) -> Path:
    """Overwrite an existing session — used for in-place updates like
    appending chat turns or recording a generated plan slug."""
    sdir = client_sessions_dir(root, session.client_id)
    sdir.mkdir(parents=True, exist_ok=True)
    p = sdir / f"{session.session_id}.yaml"
    p.write_text(yaml.safe_dump(session.model_dump(mode="json"), sort_keys=False, allow_unicode=True))
    return p


def load_session(root: Path, client_id: str, session_id: str) -> Session:
    p = client_sessions_dir(root, client_id) / f"{session_id}.yaml"
    if not p.exists():
        raise FileNotFoundError(f"session not found: {p}")
    return Session(**yaml.safe_load(p.read_text()))


def list_sessions(root: Path, client_id: str) -> list[Session]:
    """Sessions for one client, sorted oldest → newest."""
    sdir = client_sessions_dir(root, client_id)
    if not sdir.exists():
        return []
    out: list[Session] = []
    for p in sorted(sdir.glob("*.yaml")):
        if p.name.startswith("_"):
            continue
        try:
            out.append(Session(**yaml.safe_load(p.read_text())))
        except Exception as e:
            print(f"WARN: skipping {p}: {e}")
    out.sort(key=lambda s: (s.date, s.created_at))
    return out


def next_session_id(root: Path, client_id: str, when: date) -> str:
    """Compute the next monotonic session id for a client on a given date.
    Format: <client_id>-YYYY-MM-DD-NNN."""
    existing = list_sessions(root, client_id)
    same_day = [s for s in existing if s.date == when]
    next_num = len(same_day) + 1
    return f"{client_id}-{when.isoformat()}-{next_num:03d}"


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------


def _plan_candidate_paths(root: Path, slug: str) -> Iterable[Path]:
    """Possible locations for a plan with this slug, across all status buckets.

    Drafts and ready/ have one file per slug. Versioned buckets may have
    multiple files (slug-v1, slug-v2, ...) — return the highest-version.
    """
    # Unversioned (live) buckets first
    for bucket in ("drafts", "ready"):
        p = root / bucket / f"{slug}.yaml"
        if p.exists():
            yield p
    # Versioned buckets
    for bucket in ("published", "superseded", "revoked"):
        d = root / bucket
        if not d.exists():
            continue
        # find highest-version file matching slug-v<N>.yaml
        matches = sorted(d.glob(f"{slug}-v*.yaml"))
        if matches:
            yield matches[-1]


def find_plan_path(root: Path, slug: str) -> Path:
    """Locate the canonical file for a plan slug, regardless of status."""
    for p in _plan_candidate_paths(root, slug):
        return p
    raise FileNotFoundError(f"plan not found: {slug}")


def load_plan(root: Path, slug: str) -> Plan:
    return Plan(**yaml.safe_load(find_plan_path(root, slug).read_text()))


def list_plans(root: Path) -> list[Plan]:
    """All plans across all buckets. Latest-version wins for versioned buckets."""
    out: list[Plan] = []
    seen_slugs: set[str] = set()

    # drafts and ready first (single file per slug)
    for bucket in ("drafts", "ready"):
        d = root / bucket
        if not d.exists():
            continue
        for path in sorted(d.glob("*.yaml")):
            if path.name.startswith("_"):
                continue
            try:
                p = Plan(**yaml.safe_load(path.read_text()))
                if p.slug not in seen_slugs:
                    out.append(p)
                    seen_slugs.add(p.slug)
            except Exception as e:
                print(f"WARN: skipping {path.name}: {e}")

    # versioned buckets — group by slug, take highest version
    for bucket in ("published", "superseded", "revoked"):
        d = root / bucket
        if not d.exists():
            continue
        by_slug: dict[str, list[Path]] = {}
        for path in d.glob("*-v*.yaml"):
            stem = path.stem
            if "-v" not in stem:
                continue
            slug = stem.rsplit("-v", 1)[0]
            by_slug.setdefault(slug, []).append(path)
        for slug, paths in by_slug.items():
            if slug in seen_slugs:
                continue
            paths.sort()
            try:
                p = Plan(**yaml.safe_load(paths[-1].read_text()))
                out.append(p)
                seen_slugs.add(p.slug)
            except Exception as e:
                print(f"WARN: skipping {paths[-1].name}: {e}")

    return out


def write_plan(root: Path, plan: Plan) -> Path:
    """Write a plan to the bucket matching its current status. Idempotent."""
    ensure_layout(root)
    bucket = _STATUS_DIR[plan.status]
    if plan.status in (PlanStatus.draft, PlanStatus.ready_to_publish):
        p = root / bucket / f"{plan.slug}.yaml"
    else:
        p = root / bucket / _versioned_filename(plan.slug, plan.version)
    plan.updated_at = datetime.now(timezone.utc)
    p.write_text(yaml.safe_dump(plan.model_dump(mode="json"), sort_keys=False, allow_unicode=True))
    return p


def delete_plan(root: Path, slug: str) -> Path:
    """Remove the live (drafts/) file for a plan. Refuses if not in drafts."""
    p = root / "drafts" / f"{slug}.yaml"
    if not p.exists():
        raise FileNotFoundError(
            f"plan {slug!r} is not a draft (or doesn't exist). "
            "Only drafts can be deleted; published plans must be revoked instead."
        )
    p.unlink()
    return p

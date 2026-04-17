"""
event_utils.py — Shared helpers for multi-event support
────────────────────────────────────────────────────────
Import this in every script that needs per-event config.

Usage pattern in any script:

    import sys
    from event_utils import early_load_event, EVENT_SLUG

    early_load_event()   # call BEFORE any os.getenv() reads
    WEBINAR_NAME = os.getenv("WEBINAR_NAME", "Workshop")
    ...

    def main():
        parser = argparse.ArgumentParser()
        parser.add_argument("--event", default=EVENT_SLUG)
        args = parser.parse_args()
        # args.event is the slug for DB queries
"""

import os, sys
from pathlib import Path
from dotenv import load_dotenv

BASE = Path(__file__).parent


def _peek_event_slug() -> str:
    """Read --event value from sys.argv without argparse (called at import time)."""
    for i, arg in enumerate(sys.argv[:-1]):
        if arg == "--event":
            return sys.argv[i + 1]
    return os.getenv("EVENT_SLUG", "")   # also accept env var (for GitHub Actions)


# Module-level slug — available as event_utils.EVENT_SLUG
EVENT_SLUG: str = _peek_event_slug()


def early_load_event(slug: str = "") -> str:
    """
    Load base responder.env then overlay events/{slug}/event.env.
    Call this BEFORE any os.getenv() calls that need event-specific values.
    Returns the effective slug.
    """
    load_dotenv(BASE / ".env")
    load_dotenv(BASE / "responder.env")

    effective = slug or EVENT_SLUG
    if effective:
        ev_path = BASE / "events" / effective / "event.env"
        if ev_path.exists():
            load_dotenv(ev_path, override=True)
        else:
            import logging
            logging.getLogger("event_utils").warning(
                f"event.env not found for '{effective}' — run: python3 setup_event.py {effective}"
            )
    return effective


def list_active_events() -> list[str]:
    """Return slugs of all events that have a generated event.env file."""
    events_dir = BASE / "events"
    if not events_dir.exists():
        return []
    return sorted(
        d.name for d in events_dir.iterdir()
        if d.is_dir() and (d / "event.env").exists()
    )


def event_yaml_path(slug: str) -> Path:
    return BASE / "events" / slug / "event.yaml"


def event_env_path(slug: str) -> Path:
    return BASE / "events" / slug / "event.env"

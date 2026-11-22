"""Courses given in a client's own app (`courses`, e.g. Calm Gut).

Same two halves as `app_shell` (test_app_shell_field.py): the model declares
the field so a record carrying it loads, and app-staging-action.py projects
it to Fly, where the client app is served. The rules for what the app shows
live in fm-database-web/src/lib/fmdb/client-courses.ts.
"""

from __future__ import annotations

import yaml

from fmdb.plan.models import Client

from tests.test_app_shell_field import _BASE, _staging_keys


def test_a_record_with_a_course_loads():
    doc = yaml.safe_load("client_id: cl-999\ncourses:\n- slug: calm-gut\n  started_on: '2026-11-22'\n")
    c = Client(**_BASE, **doc)
    assert c.courses == [{"slug": "calm-gut", "started_on": "2026-11-22"}]


def test_a_record_without_it_loads():
    c = Client(**_BASE, client_id="cl-999")
    assert c.courses is None


def test_it_reaches_fly():
    assert "courses" in _staging_keys(), (
        "courses must be in _APP_CLIENT_KEYS, or the switch set on the Mac never "
        "reaches the app on Fly"
    )

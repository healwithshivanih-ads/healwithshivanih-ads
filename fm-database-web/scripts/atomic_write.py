"""Atomic text-write helper for shims (audit Phase-1b / M1).

Write to a temp file in the same directory, then os.replace onto the target —
atomic on the same filesystem — so a crash or a concurrent write mid-write can
never leave a truncated / unparseable PHI file. Does NOT provide locking
(lost-update protection across processes is a separate concern), only crash-safe
single writes.
"""

from __future__ import annotations

import os
from pathlib import Path


def write_text_atomic(path, text: str) -> None:
    path = Path(path)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def write_bytes_atomic(path, data: bytes) -> None:
    path = Path(path)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)

#!/usr/bin/env python3
"""Merge fragmented WhatsApp-thread session files for one client into a single
rolling-thread session, ordered by each segment's actual timestamp.

Reads multiple session YAMLs, splits their `presenting_complaints` on `---`,
extracts a timestamp per segment (from `Received: …` for inbound, falls back
to the file's `updated_at`/`created_at` for outbound), sorts globally, writes
back into the EARLIEST session file with the current canonical marker
(passed as --marker), removes the source files (and writes them to a .bak/ dir).
"""
import sys
import re
import shutil
import yaml
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional

INBOUND_RECEIVED_RE = re.compile(
    r"Received:\s*(\d{1,2})/(\d{1,2})/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)",
    re.IGNORECASE,
)

def parse_received(text):  # type: (str) -> Optional[datetime]
    m = INBOUND_RECEIVED_RE.search(text)
    if not m:
        return None
    day, month, year, hh, mm, ss, ampm = m.groups()
    hh = int(hh)
    if ampm.lower() == "pm" and hh != 12:
        hh += 12
    elif ampm.lower() == "am" and hh == 12:
        hh = 0
    return datetime(int(year), int(month), int(day), hh, int(mm), int(ss),
                    tzinfo=timezone.utc).replace(tzinfo=None)

def main():
    if len(sys.argv) < 4:
        print("usage: merge-whatsapp-thread.py <canonical-marker> <out.yaml> <session1.yaml> [<session2.yaml> ...]")
        sys.exit(2)
    canonical_marker = sys.argv[1]
    out_path = Path(sys.argv[2])
    in_paths = [Path(p) for p in sys.argv[3:]]

    segments = []  # list[ (datetime, raw_segment_text) ]
    canonical_session = None  # keep oldest session as base
    for p in sorted(in_paths, key=lambda x: x.stat().st_mtime):
        data = yaml.safe_load(p.read_text())
        complaints = str(data.get("presenting_complaints") or "")
        file_fallback_dt = datetime.fromisoformat(
            (data.get("updated_at") or data.get("created_at"))
            .replace("Z", "+00:00")
        ).replace(tzinfo=None)
        if canonical_session is None:
            canonical_session = data
        # Split on \n---\n (allow surrounding whitespace lines)
        raw_segs = re.split(r"\n\s*---\s*\n", complaints)
        prev_dt = None
        for idx, seg in enumerate(raw_segs):
            seg = seg.strip()
            if not seg:
                continue
            dt = parse_received(seg)
            if dt is None:
                # Outbound: use file's updated_at + per-position offset
                # (1-second gaps so they sort distinctly).
                dt = file_fallback_dt
                # If we already have a previous segment in this file with
                # the same fallback timestamp, nudge forward a millisecond.
                if prev_dt is not None and dt <= prev_dt:
                    from datetime import timedelta
                    dt = prev_dt + timedelta(milliseconds=1)
            # Drop the SESSION-LEVEL [session_type: ...] prefix on
            # non-first segments — only the canonical first segment keeps it.
            seg_normalised = re.sub(r"\[session_type:\s*[^\]]+\]\s*", "", seg, count=1).strip()
            segments.append((dt, seg_normalised))
            prev_dt = dt

    # Sort globally by timestamp
    segments.sort(key=lambda t: t[0])

    # Reattach the session_type tag onto the very first segment
    first_dt, first_text = segments[0]
    if "[session_type:" not in first_text:
        first_text = f"[session_type: quick_note]\n{first_text}"

    # Replace markers in each segment with the canonical one
    def replace_marker(text: str) -> str:
        # Strip any pre-existing [plan: ...] [window: ...] from the head,
        # then prepend the canonical marker.
        text = re.sub(r"\[plan:\s*[^\]]+\]\s*", "", text)
        text = re.sub(r"\[window:\s*[^\]]+\]\s*", "", text).lstrip()
        # Sub-source/template tags + body follow. Prepend canonical marker.
        return f"{canonical_marker} {text}"

    fixed_segments = []
    for i, (dt, text) in enumerate(segments):
        if i == 0:
            text = first_text
        text = replace_marker(text)
        fixed_segments.append(text)

    merged = "\n\n---\n\n".join(fixed_segments)
    canonical_session["presenting_complaints"] = merged
    canonical_session["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Write to out_path
    out_path.write_text(yaml.dump(canonical_session, sort_keys=False,
                                  default_flow_style=False, allow_unicode=True,
                                  width=120))
    print(f"[merge] wrote {out_path}  segments={len(segments)}")

if __name__ == "__main__":
    main()

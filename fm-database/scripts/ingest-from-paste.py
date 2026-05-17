#!/usr/bin/env python3
"""
ingest-from-paste — receive a ChatGPT/Claude.ai ingest output, save the
YAML files to disk, run validation, and print a clean go/no-go report.

Usage
─────
  # Pipe from clipboard
  pbpaste | python scripts/ingest-from-paste.py

  # Or from a file
  python scripts/ingest-from-paste.py < /tmp/claude_ingest.md

  # Default mode writes to canonical (data/<entity>/<slug>.yaml).
  # Pass --staging <batch-id> to drop into data/staging/<batch-id>/ instead
  # (safer for big batches — review via `fmdb review <batch-id>` first).

What it does
────────────
1. Extracts every fenced ```yaml block whose first content line is
   `# path: data/<entity>/<slug>.yaml` (or a comment that contains a path).
2. Writes each file to its declared path (creating parent dirs).
3. Parses the optional `missing_dependencies:` block at the end of the
   paste and lists slugs to stub before approving.
4. Runs `fmdb validate` and `fmdb pending-refs` and prints a summary.

Output is colour-coded:
  ✓ green  = clean write
  ⚠ yellow = warning (e.g. missing source, forward reference)
  ✗ red    = error — file written but catalogue still inconsistent

Exits non-zero on errors so a wrapper script (or git commit hook) can
gate further action.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────
# Repo + path resolution
# ─────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent  # fm-database/
DATA_DIR = REPO_ROOT / "data"
VENV_PY = REPO_ROOT / ".venv/bin/python"

VALID_KINDS = {
    "sources", "topics", "mechanisms", "symptoms", "claims",
    "supplements", "cooking_adjustments", "home_remedies", "mindmaps",
    # v0.74 — medications + biomarkers as first-class entities
    "drug_depletions", "lab_tests",
    # Also accept these existing-on-disk entity dirs that the paste-ingest
    # path was previously rejecting. Validator already knows them.
    "protocols", "titration_protocols", "lab_panels",
}

# ─────────────────────────────────────────────────────────────────────
# Tiny ANSI helpers — avoids pulling in a colour lib
# ─────────────────────────────────────────────────────────────────────
def _isatty() -> bool:
    return sys.stdout.isatty()

def green(s: str) -> str:  return f"\x1b[32m{s}\x1b[0m" if _isatty() else s
def yellow(s: str) -> str: return f"\x1b[33m{s}\x1b[0m" if _isatty() else s
def red(s: str) -> str:    return f"\x1b[31m{s}\x1b[0m" if _isatty() else s
def dim(s: str) -> str:    return f"\x1b[2m{s}\x1b[0m" if _isatty() else s
def bold(s: str) -> str:   return f"\x1b[1m{s}\x1b[0m" if _isatty() else s


# ─────────────────────────────────────────────────────────────────────
# Extract YAML blocks from the AI's paste
# ─────────────────────────────────────────────────────────────────────
#
# We accept either:
#   ```yaml
#   # path: data/topics/foo.yaml
#   slug: foo
#   ...
#   ```
#
# OR the older variant where path is on the closing fence's line.
# We're permissive about whitespace + language tag (yaml | yml | y).
# Need the start index so we can also look at the LINE before the fence
# for path declarations (AI often puts "# path: data/..." above the fence
# rather than inside it).
BLOCK_RE = re.compile(
    # ` characters: backtick fences (3+) OR tilde fences (3+) — both
    # are valid markdown.
    r"(?:`{3,}|~{3,})"
    # Optional language tag: yaml | yml | y | YAML — case-insensitive.
    # We also accept "yaml" prefixed with anything (eg "yaml-heredoc")
    # to be forgiving of variants we haven't seen yet.
    r"(?:[^\n]*)?\n"
    r"(?P<body>.*?)"
    r"\n(?:`{3,}|~{3,})",
    re.DOTALL | re.IGNORECASE,
)

# Tolerant of the variants we see in the wild:
#   # path: data/topics/foo.yaml
#   ## path: data/topics/foo.yaml
#   # Path: data/topics/foo.yaml
#   # file: data/topics/foo.yaml
#   # File: data/topics/foo.yaml
# Plus the YAML-style "path: data/..." as a bare key (no comment marker)
# which a few AI replies have used despite the spec.
PATH_RE = re.compile(
    r"^\s*(?:#+\s*)?(?:path|file)\s*:\s*(?P<path>[^\s\n]+)",
    re.MULTILINE | re.IGNORECASE,
)

# Last-resort recovery: a raw "data/<entity>/<slug>.yaml" mention,
# either as a bare comment in the block, in the line immediately
# preceding the fence (markdown heading style), or as the YAML's first
# line. Catches "# data/topics/foo.yaml" and **path:** data/... markdown.
BARE_PATH_RE = re.compile(
    r"data/(?P<entity>[a-z_]+)/(?P<slug>[a-z0-9][a-z0-9\-]*?)\.ya?ml",
    re.IGNORECASE,
)


def _path_from_body(body: str, preamble: str) -> str | None:
    """Try every known marker style + a last-resort bare-path regex.

    `preamble` is the text immediately before the fence (~3 lines) — AI
    chats sometimes put "**path: data/...**" as a markdown heading
    rather than inside the fence. We accept either location."""
    m = PATH_RE.search(body)
    if m:
        return m.group("path").strip().rstrip(",;")
    # Try the preamble for a path-marker line
    m = PATH_RE.search(preamble)
    if m:
        return m.group("path").strip().rstrip(",;")
    # Last resort: bare "data/<kind>/<slug>.yaml" anywhere in the block
    # or the preamble.
    m = BARE_PATH_RE.search(body) or BARE_PATH_RE.search(preamble)
    if m:
        return m.group(0)
    return None


def extract_blocks(paste: str) -> list[tuple[str, str]]:
    """Returns [(target_path, yaml_body), ...]. Skips blocks without a path."""
    out: list[tuple[str, str]] = []
    for m in BLOCK_RE.finditer(paste):
        body = m.group("body")
        # Grab the ~150 chars preceding the fence so we can pick up a
        # markdown-heading-style path declaration like
        # "**path:** data/topics/foo.yaml" on its own line above ```yaml.
        preamble_start = max(0, m.start() - 200)
        preamble = paste[preamble_start:m.start()]

        path = _path_from_body(body, preamble)
        if not path:
            continue
        # Strip ANY path-marker line we matched inside the body so the
        # writer doesn't emit it as a stray "# path:" inside the YAML.
        body_clean = PATH_RE.sub("", body, count=1).lstrip("\n").rstrip() + "\n"
        # Also strip a leading bare "# data/..." comment line if present.
        body_clean = re.sub(
            r"^\s*#\s*data/[^\n]+\n",
            "",
            body_clean,
            count=1,
        ).lstrip("\n")
        out.append((path, body_clean))

    # ── Fence-less fallback ──────────────────────────────────────────────
    # If we found zero fenced blocks but the paste contains multiple
    # path declarations, the user has likely copy-pasted from a rendered
    # Claude.ai / ChatGPT message — the visual code blocks render fine
    # but copying them STRIPS THE BACKTICKS. What lands in the textarea
    # looks like:
    #
    #   yaml# path: data/sources/foo.yaml
    #   id: foo
    #   …
    #   yaml# path: data/topics/bar.yaml
    #   slug: bar
    #   …
    #
    # (The language tag "yaml" leaks through as a glued prefix to the
    # next line.) Split on each "[yaml]# path:" / "[yaml]## path:"
    # boundary and treat each chunk as a block. Same logic for tilde
    # fences and bare path lines.
    if not out:
        # Boundary marker: optional "yaml" / "yml" prefix (case-insensitive)
        # immediately followed by a "# path:" or "## path:" declaration,
        # OR a "path:" / "file:" key at the start of a line. We accept
        # either form so AIs that drop the # work too.
        boundary_re = re.compile(
            r"^[ \t]*(?:yaml|yml|y)?[ \t]*"
            r"(?:#+\s*)?(?:path|file)\s*:\s*(?P<path>data/[a-z_]+/[a-z0-9][a-z0-9\-]*\.ya?ml)",
            re.MULTILINE | re.IGNORECASE,
        )
        boundaries: list[tuple[int, int, str]] = []
        for m in boundary_re.finditer(paste):
            boundaries.append((m.start(), m.end(), m.group("path").strip()))
        for i, (_, end, path) in enumerate(boundaries):
            body_start = end
            body_end = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(paste)
            body = paste[body_start:body_end].strip("\n")
            # Strip trailing fence remnants if the AI sometimes ended
            # with ``` or ~~~ but the opening fence was stripped.
            body = re.sub(r"\n[`~]{3,}\s*$", "", body)
            # Trim any trailing markdown like "---" separators between
            # entities the AI inserted.
            body = re.sub(r"\n[-]{3,}\s*$", "", body)
            body = body.rstrip() + "\n"
            if body.strip():
                out.append((path, body))

    return out


def extract_missing_deps(paste: str) -> dict[str, list[str]]:
    """Pull the `missing_dependencies:` block from the end of the paste."""
    m = re.search(
        r"missing_dependencies\s*:\s*\n(?P<body>(?:\s{2,}\w[^\n]*\n?)+)",
        paste,
    )
    if not m:
        return {}
    body = m.group("body")
    deps: dict[str, list[str]] = {}
    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        # `topics: [foo, bar]` or `topics: ["foo", "bar"]` or `topics: []`
        cm = re.match(r"^(\w+)\s*:\s*\[(.*)\]\s*$", line)
        if cm:
            kind = cm.group(1)
            items = [
                t.strip().strip('"').strip("'")
                for t in cm.group(2).split(",")
                if t.strip()
            ]
            if items:
                deps[kind] = items
    return deps


# ─────────────────────────────────────────────────────────────────────
# Write + validate
# ─────────────────────────────────────────────────────────────────────
def _normalise_path(declared: str, staging_batch: str | None) -> Path:
    # AI sometimes prefixes with "fm-database/" or "./" — strip it.
    declared = re.sub(r"^(?:fm-database/|\./)", "", declared)
    p = Path(declared)
    # Re-route to staging if requested.
    if staging_batch and p.parts[:1] == ("data",) and len(p.parts) >= 3:
        # data/<entity>/<slug>.yaml → data/staging/<batch>/<entity>/<slug>.yaml
        new_parts = ("data", "staging", staging_batch) + p.parts[1:]
        p = Path(*new_parts)
    return REPO_ROOT / p


# Shape-normalisers — auto-correct common AI shape mistakes BEFORE
# writing to disk. Parsed YAML round-trip (rather than regex over the
# raw text) so we don't break multi-line string continuations or nested
# structures. Each fix is documented inline — these are mismatches
# between what the AI produces and what the Pydantic models accept.

def _normalise_yaml_body(body: str) -> str:
    """Apply field-name fixes to one entity's YAML body before writing.

    Uses PyYAML to parse + re-dump. If parsing fails (e.g. malformed
    YAML), returns the original body unchanged so we don't make things
    worse — the validator will surface the real syntax error later.
    """
    # Strip leaked "yaml…" prefix artifacts from backtick-stripped paste
    # boundaries BEFORE parsing — they aren't valid YAML and would crash
    # the load.
    cleaned = re.sub(r"^yaml#\s*[^\n]*\n", "", body, flags=re.MULTILINE)
    cleaned = re.sub(
        r"^yaml(missing_dependencies|version|status):",
        r"\1:",
        cleaned,
        flags=re.MULTILINE,
    )

    try:
        import yaml as _yaml
        data = _yaml.safe_load(cleaned)
    except Exception:
        return cleaned  # leave it; let approval surface the parse error
    if not isinstance(data, dict):
        return cleaned

    changed = False

    # 1. interactions.{medications, supplements, foods}
    #    → interactions.{with_medications, with_supplements, with_foods}
    inter = data.get("interactions")
    if isinstance(inter, dict):
        for old, new in (
            ("medications", "with_medications"),
            ("supplements", "with_supplements"),
            ("foods", "with_foods"),
        ):
            if old in inter and new not in inter:
                inter[new] = inter.pop(old)
                changed = True

    # 2. contraindications: flat list → {conditions: [...], medications: [],
    #    life_stages: []}. Pydantic model uses the dict form.
    contra = data.get("contraindications")
    if isinstance(contra, list):
        data["contraindications"] = {
            "conditions": [str(x) for x in contra if x is not None],
            "medications": [],
            "life_stages": [],
        }
        changed = True

    # 3. Drop the `missing_dependencies` key if the AI accidentally
    #    embedded it inside a single entity (it belongs at the very end
    #    of the whole paste, not on each entity).
    if "missing_dependencies" in data:
        data.pop("missing_dependencies")
        changed = True

    # 3b. Topic-specific: rename `linked_to_mechanisms` → `key_mechanisms`.
    #     Topic model uses `key_mechanisms`; symptoms/supplements/claims
    #     use `linked_to_mechanisms`. AI conflates them. Three sub-cases:
    #       - Topic file with only `linked_to_mechanisms` → rename.
    #       - Topic file with BOTH (AI emitted both): merge values into
    #         `key_mechanisms`, drop the wrong key.
    #       - Topic file with empty `linked_to_mechanisms: []` (AI
    #         emitted both as defensive empty stubs): drop the extra key.
    is_topic = any(k in data for k in ("common_symptoms", "coaching_scope_notes", "red_flags", "key_mechanisms"))
    if is_topic and "linked_to_mechanisms" in data:
        extra = data.pop("linked_to_mechanisms") or []
        existing = data.get("key_mechanisms") or []
        merged = list(dict.fromkeys([*existing, *extra]))  # preserve order, dedup
        if merged:
            data["key_mechanisms"] = merged
        changed = True

    # 4. Enum value remaps — the AI sometimes uses stale or fuzzy names.
    #    Map to the closest valid enum value rather than failing the
    #    whole batch.
    _supp_cat_map = {"nutraceutical": "other", "antioxidant": "other"}
    _take_food_map = {"empty_stomach": "avoid", "anytime": "optional"}
    _timing_map = {
        "early_morning": "on_waking",
        "empty_stomach": "on_empty_stomach",
        "afternoon": "mid_afternoon",
        "anytime": "with_breakfast",   # fall-back to a slot the schedule renderer handles
        "bedtime_or_evening": "bedtime",
    }
    _supp_form_map = {"sublingual": "lozenge", "softgel": "capsule", "topical": "other"}

    if data.get("category") in _supp_cat_map:
        data["category"] = _supp_cat_map[data["category"]]
        changed = True
    if data.get("take_with_food") in _take_food_map:
        data["take_with_food"] = _take_food_map[data["take_with_food"]]
        changed = True
    if isinstance(data.get("timing_options"), list):
        new_timings: list[str] = []
        for t in data["timing_options"]:
            mapped = _timing_map.get(t, t)
            if mapped not in new_timings:
                new_timings.append(mapped)
        if new_timings != data["timing_options"]:
            data["timing_options"] = new_timings
            changed = True
    if isinstance(data.get("forms_available"), list):
        new_forms: list[str] = []
        for f in data["forms_available"]:
            mapped = _supp_form_map.get(f, f)
            if mapped == "other":
                continue  # drop unmappable forms entirely
            if mapped not in new_forms:
                new_forms.append(mapped)
        if new_forms != data["forms_available"]:
            data["forms_available"] = new_forms
            changed = True
    # typical_dose_range keys must match forms_available — drop any
    # form-specific dose entries for forms we just dropped.
    if isinstance(data.get("typical_dose_range"), dict) and isinstance(data.get("forms_available"), list):
        allowed = set(data["forms_available"])
        cleaned_doses = {k: v for k, v in data["typical_dose_range"].items() if k in allowed}
        if cleaned_doses != data["typical_dose_range"]:
            data["typical_dose_range"] = cleaned_doses
            changed = True

    if not changed:
        return cleaned

    # Re-dump preserving as much of the original style as possible. We
    # use default_flow_style=False + sort_keys=False so blocks stay
    # readable and the original field order survives.
    import yaml as _yaml
    return _yaml.dump(data, sort_keys=False, default_flow_style=False, allow_unicode=True, width=120)


def write_blocks(blocks: list[tuple[str, str]], staging_batch: str | None) -> list[tuple[Path, str, bool]]:
    """Write each YAML block. Returns (path, declared, ok)."""
    out: list[tuple[Path, str, bool]] = []
    for declared, body in blocks:
        target = _normalise_path(declared, staging_batch)
        ok = True
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            body_fixed = _normalise_yaml_body(body)
            target.write_text(body_fixed, encoding="utf-8")
        except Exception as e:
            print(red(f"✗ failed to write {target}: {e}"), file=sys.stderr)
            ok = False
        out.append((target, declared, ok))
    return out


def run_cli(args: list[str]) -> tuple[int, str, str]:
    py = str(VENV_PY) if VENV_PY.exists() else sys.executable
    proc = subprocess.run(
        [py, "-m", "fmdb.cli", *args],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout, proc.stderr


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────
def main() -> int:
    # ── Parse args ──
    staging_batch: str | None = None
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("-h", "--help"):
            print(__doc__)
            return 0
        if a == "--staging":
            i += 1
            if i >= len(args):
                print(red("✗ --staging needs a batch-id"), file=sys.stderr)
                return 2
            staging_batch = args[i]
        i += 1

    # ── Slurp stdin ──
    paste = sys.stdin.read()
    if not paste.strip():
        print(red("✗ no input on stdin. Pipe the AI's reply, e.g.:\n"
                  "  pbpaste | python scripts/ingest-from-paste.py"),
              file=sys.stderr)
        return 2

    # ── Extract blocks ──
    blocks = extract_blocks(paste)
    if not blocks:
        # Diagnose: WHY did we find zero blocks? Coach sees this in the
        # raw log so she can fix the AI prompt or the paste rather than
        # staring at a generic error.
        fence_count = len(list(BLOCK_RE.finditer(paste)))
        path_count = len(list(PATH_RE.finditer(paste)))
        bare_path_count = len(list(BARE_PATH_RE.finditer(paste)))
        paste_len = len(paste)
        head_snippet = paste[:400].replace("\n", "\\n")
        print(red("✗ no fenced YAML blocks with a # path: header found."),
              file=sys.stderr)
        print(dim(
            f"hint: receiver looked for ```yaml (or ```, ~~~, ```YAML) "
            f"blocks containing `# path: data/<entity>/<slug>.yaml`."
        ), file=sys.stderr)
        print(dim(
            f"  paste size: {paste_len} chars  ·  "
            f"fenced blocks detected: {fence_count}  ·  "
            f"`# path:` markers detected: {path_count}  ·  "
            f"bare `data/.../foo.yaml` mentions: {bare_path_count}"
        ), file=sys.stderr)
        if fence_count == 0 and bare_path_count > 1:
            print(yellow(
                "  → No fences detected but multiple `data/.../foo.yaml` "
                "paths are present. This usually means you copy-pasted "
                "from a RENDERED Claude.ai / ChatGPT message — the visual "
                "code blocks copy as plain text and the backticks get "
                "stripped (you may see `yaml# path:` glued together at "
                "block boundaries). The fence-less fallback should have "
                "caught this; if you're seeing this error, the boundary "
                "regex didn't match — check the first-chars snippet "
                "below and report to dev."
            ), file=sys.stderr)
        elif fence_count == 0:
            print(yellow(
                "  → No fenced code blocks at all. The AI replied as plain "
                "prose. Re-prompt: 'wrap each entity in a ```yaml … ``` block "
                "with `# path: data/<entity>/<slug>.yaml` as the first line.'"
            ), file=sys.stderr)
        elif fence_count > 0 and path_count == 0 and bare_path_count == 0:
            print(yellow(
                "  → Fences were found but no path declaration. The AI "
                "forgot the path header. Re-prompt: 'every fenced YAML "
                "block must start with `# path: data/<entity>/<slug>.yaml`.'"
            ), file=sys.stderr)
        elif fence_count > 0 and bare_path_count > 0:
            print(yellow(
                "  → Path-like strings exist but didn't parse. Likely the "
                "AI put the path OUTSIDE the fence, or the fence used an "
                "unrecognised syntax. Check the raw log for the format."
            ), file=sys.stderr)
        print(dim(f"  first 400 chars of paste: {head_snippet}"),
              file=sys.stderr)
        return 2

    deps = extract_missing_deps(paste)

    # ── Write ──
    print(bold(f"\n→ Writing {len(blocks)} YAML file(s)"))
    if staging_batch:
        print(dim(f"  routing into data/staging/{staging_batch}/"))
    results = write_blocks(blocks, staging_batch)
    all_ok = True
    for target, declared, ok in results:
        rel = target.relative_to(REPO_ROOT)
        if ok:
            print(f"  {green('✓')} {rel}  {dim(f'(declared: {declared})') if str(rel) != declared else ''}")
        else:
            print(f"  {red('✗')} {rel}")
            all_ok = False

    # ── Write the _meta.json manifest in staging mode ──
    # fmdb approve <batch> reads this manifest to know which (entity, slug)
    # tuples to promote. Paste-ingest used to skip this, which meant
    # staged batches were invisible to `fmdb approve` — coach could see
    # the files on disk but the dashboard's Approve button (and the CLI)
    # returned "batch not found". This block restores parity with the
    # fmdb-ingest pipeline.
    if staging_batch:
        from datetime import datetime, timezone
        entries = []
        for target, declared, ok in results:
            if not ok:
                continue
            # data/staging/<batch>/<entity>/<slug>.yaml → entity, slug
            rel = target.relative_to(REPO_ROOT)
            parts = rel.parts  # ("fm-database","data","staging",<batch>,<entity>,<slug>.yaml)
            try:
                stage_idx = parts.index("staging")
                entity = parts[stage_idx + 2]
                slug = parts[stage_idx + 3].removesuffix(".yaml")
            except (ValueError, IndexError):
                continue
            entries.append({
                "entity": entity,
                "slug": slug,
                "status": "new",
                "source": "paste-ingest",
                "declared_path": declared,
            })
        manifest = {
            "batch_id": staging_batch,
            "source_id": "paste-ingest",
            "source_title": staging_batch,
            "source_type": "llm_synthesis",
            "doc_hash": None,
            "doc_chars": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": "shivani",
            "usage": {},
            "entries": entries,
        }
        meta_path = REPO_ROOT / "data" / "staging" / staging_batch / "_meta.json"
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps(manifest, indent=2))
        print(dim(f"  → wrote manifest with {len(entries)} entries → "
                  f"data/staging/{staging_batch}/_meta.json"))

    # ── Missing dependencies ──
    if deps:
        print(bold("\n→ Forward references the AI flagged (stub before approving):"))
        for kind, items in deps.items():
            print(f"  {yellow('⚠')} {kind}: {', '.join(items)}")

    # ── Validate ──
    # `fmdb validate` exits 0 on warnings-only. We trust the exit code, not
    # string-matching on the output (the "No errors. Warnings are
    # non-blocking" footer string contains the word "errors" and tripped
    # an earlier naive substring check).
    print(bold("\n→ Running fmdb validate"))
    rc, out, err = run_cli(["validate"])
    text = (out + err).strip()
    if rc == 0:
        warn_match = re.search(r"(\d+)\s*warning", text, re.IGNORECASE)
        warns = warn_match.group(1) if warn_match else "0"
        print(f"  {green('✓ catalogue valid')} ({warns} warnings — non-blocking)")
    else:
        print(red(f"  ✗ validation failed (exit {rc}):"))
        for line in text.splitlines()[:30]:
            print(f"    {line}")
        all_ok = False

    # ── Pending refs ──
    # pending-refs lists every unresolved cross-reference IN THE WHOLE
    # CATALOGUE, not just from this ingest. Treat as informational, not as
    # an ingest failure. We surface a count + the first few names so the
    # coach knows the backlog exists, but it doesn't flip ok→fail.
    print(bold("\n→ Running fmdb pending-refs"))
    rc2, out2, err2 = run_cli(["pending-refs"])
    pend = (out2 + err2).strip()
    if not pend or "no unresolved" in pend.lower():
        print(f"  {green('✓ no unresolved cross-references')}")
    else:
        # Approximate the count from non-indented header lines.
        lines = [ln for ln in pend.splitlines() if ln.strip()]
        ref_lines = [ln for ln in lines if not ln.startswith(" ") and "←" not in ln]
        print(f"  {dim(f'(catalogue-wide backlog: ~{len(ref_lines)} pending refs — informational, not from this ingest)')}")
        for line in lines[:6]:
            print(f"  {yellow('⚠')} {line}")
        if len(lines) > 6:
            print(dim(f"  … +{len(lines) - 6} more (see `fmdb pending-refs` for full list)"))

    # ── Summary ──
    print()
    if all_ok:
        print(green(bold("✓ Ingest complete.")))
        if staging_batch:
            print(dim(f"  Next: review with `fmdb review {staging_batch}` then "
                      f"`fmdb approve {staging_batch} --update`"))
        else:
            print(dim("  Next: `git diff data/` to inspect, then `git add` + commit."))
    else:
        print(red(bold("✗ Ingest had errors — see above.")))
        print(dim("  Files are written. Fix issues and re-run validate, or"))
        print(dim("  `git checkout -- data/` to revert all writes."))
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())

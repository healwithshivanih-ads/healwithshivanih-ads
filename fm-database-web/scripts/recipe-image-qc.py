#!/usr/bin/env python3
"""Weekly recipe-image quality check — NO Anthropic API.

Scans every catalogue recipe for a *shown* photo and repairs the gaps:

  A recipe shows a photo in the client app only when it has an `image.file`
  whose `rights_status` != "none" AND that file exists on disk under
  fm-database-web/public/recipe-images/. Anything else renders a plain
  gradient tile. This mirrors client-app.ts / recipe-image-coverage-action.ts
  exactly (a pure field+file check — no dish-name resolver, so no drift risk).

For each gap it auto-sources a CC-licensed photo via source-recipe-images.py
(Openverse image search + `sips` crop, --no-qc --force) and — if anything was
added — commits ONLY the touched files and deploys to Fly so clients see them.

NO API: sourcing uses Openverse (free, no key) + sips; the Haiku vision QC is
never invoked. That means auto-sourced photos are UNVERIFIED — occasionally
the wrong dish. They land as `web_reference_uncleared`; the coach swaps a bad
one from the coach UI (paste an image URL). This is the tradeoff the coach
signed off on for a hands-off weekly refresh.

Usage:
  recipe-image-qc.py [--max N] [--dry-run] [--no-commit] [--no-deploy]

Writes a JSON summary to stdout. Safe to run by hand any time; idempotent
(a recipe that already shows a photo is skipped).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

import yaml

SCRIPTS_DIR = Path(__file__).resolve().parent
WEB_ROOT = SCRIPTS_DIR.parent                       # fm-database-web
REPO_ROOT = WEB_ROOT.parent                          # repo root (has fly.toml)
RECIPES_DIR = REPO_ROOT / "fm-database" / "data" / "_recipes"
PUBLIC_DIR = WEB_ROOT / "public" / "recipe-images"
WEB_IMG_REL = "images/web"                            # under PUBLIC_DIR

FLYCTL = os.environ.get("FLYCTL") or str(Path.home() / ".fly" / "bin" / "flyctl")
FLY_APP = os.environ.get("FLY_APP") or "theochretree-coach"
GIT = os.environ.get("GIT") or "git"


def scan_gaps() -> list[dict]:
    """Every recipe that would NOT show a photo, with the reason."""
    gaps: list[dict] = []
    for f in sorted(glob.glob(str(RECIPES_DIR / "*.yaml"))):
        base = os.path.basename(f)
        if base.startswith("_"):
            continue
        try:
            r = yaml.safe_load(open(f, encoding="utf-8"))
        except Exception:
            continue  # one malformed file never breaks the scan
        if not r or not r.get("name"):
            continue
        slug = r.get("slug") or base[:-5]
        name = r["name"]
        img = r.get("image") or {}
        file = img.get("file") or ""
        if not file:
            gaps.append({"slug": slug, "name": name, "reason": "no_image_block"})
        elif img.get("rights_status") == "none":
            gaps.append({"slug": slug, "name": name, "reason": "rights_none"})
        elif not (PUBLIC_DIR / file).exists():
            gaps.append({"slug": slug, "name": name, "reason": "file_missing"})
    return gaps


def source_photos(gaps: list[dict]) -> list[str]:
    """Run source-recipe-images.py once over all gap recipes (no QC, force).
    Returns the slugs that got a photo."""
    dishlist = [{"slug": g["slug"], "dish": g["name"], "query": g["name"]} for g in gaps]
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(dishlist, f)
        dl = f.name
    rep = dl + ".report.json"
    try:
        subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "source-recipe-images.py"), dl,
             "--only", ",".join(g["slug"] for g in gaps),
             "--recipes-only", "--force", "--report", rep],
            capture_output=True, text=True, timeout=len(gaps) * 60 + 120,
        )
        data = json.loads(Path(rep).read_text()) if Path(rep).exists() else {}
        return [d["slug"] for d in data.get("done", [])]
    finally:
        for p in (dl, rep):
            try:
                os.unlink(p)
            except OSError:
                pass


def _git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.setdefault("GIT_AUTHOR_NAME", "Shivani Hari")
    env.setdefault("GIT_AUTHOR_EMAIL", "shivanihari@gmail.com")
    env.setdefault("GIT_COMMITTER_NAME", "Shivani Hari")
    env.setdefault("GIT_COMMITTER_EMAIL", "shivanihari@gmail.com")
    return subprocess.run([GIT, *args], cwd=str(REPO_ROOT), env=env,
                          capture_output=True, text=True, timeout=120, check=check)


def commit_touched(slugs: list[str]) -> dict:
    """Stage ONLY the recipe YAMLs + web images for the given slugs, commit,
    and best-effort push. Never `git add -A` — the coach may have other WIP."""
    paths = []
    for s in slugs:
        paths.append(str((RECIPES_DIR / f"{s}.yaml").relative_to(REPO_ROOT)))
        paths.append(f"fm-database-web/public/recipe-images/{WEB_IMG_REL}/{s}.jpg")
    _git("add", "--", *paths)
    # Anything actually staged?
    if _git("diff", "--cached", "--quiet", check=False).returncode == 0:
        return {"committed": False, "reason": "nothing staged"}
    msg = (f"chore(recipes): auto-source photos for {len(slugs)} recipe(s) "
           f"[recipe-image-qc {date.today().isoformat()}]\n\n"
           + "\n".join(f"- {s}" for s in slugs))
    _git("commit", "-m", msg)
    push = _git("push", "origin", "HEAD", check=False)
    return {"committed": True, "pushed": push.returncode == 0,
            "push_error": None if push.returncode == 0 else (push.stderr or "").strip()[:300]}


def deploy() -> dict:
    try:
        r = subprocess.run([FLYCTL, "deploy", "--remote-only", "-a", FLY_APP],
                           cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=1800)
        ok = r.returncode == 0
        return {"deployed": ok,
                "error": None if ok else (r.stderr or r.stdout or "").strip()[-400:]}
    except Exception as e:  # noqa: BLE001
        return {"deployed": False, "error": f"{type(e).__name__}: {e}"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=25,
                    help="cap recipes sourced per run (backstop against a bad batch)")
    ap.add_argument("--dry-run", action="store_true", help="scan + report only; no writes")
    ap.add_argument("--no-commit", action="store_true", help="source but don't git commit")
    ap.add_argument("--no-deploy", action="store_true", help="commit but don't fly deploy")
    args = ap.parse_args()

    out: dict = {"ok": True, "ts": date.today().isoformat()}
    gaps = scan_gaps()
    out["scanned_gaps"] = len(gaps)
    out["gaps"] = gaps[: args.max]

    if args.dry_run or not gaps:
        out["dry_run"] = bool(args.dry_run)
        print(json.dumps(out))
        return 0

    batch = gaps[: args.max]
    out["capped"] = len(gaps) > args.max
    sourced = source_photos(batch)
    out["sourced"] = sourced
    out["failed"] = [g["slug"] for g in batch if g["slug"] not in sourced]

    if not sourced:
        out["note"] = "no photos found this run"
        print(json.dumps(out))
        return 0

    if not args.no_commit:
        out["git"] = commit_touched(sourced)
        if out["git"].get("committed") and not args.no_deploy:
            out["fly"] = deploy()

    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 — always emit a parseable summary
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)

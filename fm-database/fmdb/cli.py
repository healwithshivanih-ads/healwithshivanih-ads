import argparse
import sys
from pathlib import Path

from .loader import load_supplement, load_supplements
from .validator import validate_all

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def cmd_validate(args: argparse.Namespace) -> None:
    count, errors = validate_all(DATA_DIR)
    print(f"Checked {count} supplement(s)")
    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print("All checks passed.")


def cmd_list(args: argparse.Namespace) -> None:
    supps = load_supplements(DATA_DIR)
    if not supps:
        print("(no supplements)")
        return
    for s in supps:
        print(f"  {s.slug:30s}  {s.display_name:30s}  [{s.evidence_tier.value}]")


def cmd_show(args: argparse.Namespace) -> None:
    s = load_supplement(DATA_DIR, args.slug)
    print(f"{s.display_name}  ({s.slug})  v{s.version}  [{s.status.value}]")
    print(f"  Category:        {s.category.value}")
    print(f"  Forms:           {', '.join(f.value for f in s.forms_available)}")
    print("  Dose ranges:")
    for form, dr in s.typical_dose_range.items():
        print(f"    - {form}: {dr.min}-{dr.max} {dr.unit.value}")
    print(f"  Timing options:  {', '.join(t.value for t in s.timing_options)}")
    print(f"  Take with food:  {s.take_with_food.value}")
    print(f"  Evidence tier:   {s.evidence_tier.value}")
    print(f"  Topics linked:   {', '.join(s.linked_to_topics) or '(none)'}")
    if s.interactions.with_supplements:
        print("  Supplement interactions:")
        for i in s.interactions.with_supplements:
            spacing = f" ({i.hours}h apart)" if i.hours else ""
            print(f"    - {i.slug}: {i.type.value}{spacing} - {i.reason or ''}")
    if any([
        s.contraindications.conditions,
        s.contraindications.medications,
        s.contraindications.life_stages,
    ]):
        print("  Contraindications:")
        for c in s.contraindications.conditions:
            print(f"    - condition: {c}")
        for m in s.contraindications.medications:
            print(f"    - medication: {m}")
        for ls in s.contraindications.life_stages:
            print(f"    - life stage: {ls}")
    if s.notes_for_coach:
        print(f"  Notes for coach: {s.notes_for_coach.strip()}")
    if s.sources:
        print("  Sources:")
        for src in s.sources:
            quote = f' — "{src.quote}"' if src.quote else ""
            loc = f" [{src.location}]" if src.location else ""
            print(f"    - {src.id}{loc}{quote}")
    print(f"  Updated: {s.updated_at} by {s.updated_by}")


def main() -> None:
    p = argparse.ArgumentParser(prog="fmdb")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("validate", help="check all entries").set_defaults(func=cmd_validate)
    sub.add_parser("list", help="list all supplements").set_defaults(func=cmd_list)

    show = sub.add_parser("show", help="show one supplement")
    show.add_argument("slug")
    show.set_defaults(func=cmd_show)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

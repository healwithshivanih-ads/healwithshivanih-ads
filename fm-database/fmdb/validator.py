from pathlib import Path

from pydantic import ValidationError as PydanticValidationError

from .enums import InteractionType
from .loader import load_supplements


def validate_all(data_dir: Path) -> tuple[int, list[str]]:
    errors: list[str] = []
    supplements_dir = data_dir / "supplements"
    if not supplements_dir.exists():
        return 0, [f"data dir missing: {supplements_dir}"]

    supplements = []
    import yaml
    for path in sorted(supplements_dir.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        try:
            with path.open() as f:
                raw = yaml.safe_load(f)
            from .models import Supplement
            supplements.append(Supplement(**raw))
        except PydanticValidationError as e:
            errors.append(f"{path.name}: {e}")
        except Exception as e:
            errors.append(f"{path.name}: {e}")

    seen_slugs: dict[str, int] = {}
    for s in supplements:
        seen_slugs[s.slug] = seen_slugs.get(s.slug, 0) + 1
    for slug, count in seen_slugs.items():
        if count > 1:
            errors.append(f"duplicate slug across files: {slug} ({count} entries)")

    for s in supplements:
        if not s.forms_available:
            errors.append(f"{s.slug}: forms_available is empty")
        for form in s.forms_available:
            if form.value not in s.typical_dose_range:
                errors.append(
                    f"{s.slug}: form {form.value!r} in forms_available "
                    f"but missing from typical_dose_range"
                )
        for inter in s.interactions.with_supplements:
            if inter.type == InteractionType.space_by_hours and inter.hours is None:
                errors.append(
                    f"{s.slug}: interaction with {inter.slug} is space_by_hours "
                    f"but no hours specified"
                )
        for inter in s.interactions.with_foods:
            if inter.type == InteractionType.space_by_hours and inter.hours is None:
                errors.append(
                    f"{s.slug}: food interaction with {inter.food_slug} is space_by_hours "
                    f"but no hours specified"
                )
        if not s.sources:
            errors.append(f"{s.slug}: no sources cited")

    return len(supplements), errors

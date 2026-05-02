import argparse
import os
import sys
from pathlib import Path

# Auto-load .env from the fm-database project root so ANTHROPIC_API_KEY,
# FMDB_EXTRACTOR, FMDB_USER, etc. are available without requiring the user
# to `source .env` before every command. Silent no-op if dotenv isn't installed.
try:
    from dotenv import load_dotenv

    # override=True so .env wins over stale shell exports (e.g. an empty
    # ANTHROPIC_API_KEY left over from another project's setup script).
    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)
except ImportError:
    pass

from .ingest import audit, staging
from .ingest.extractor import get_extractor
from .ingest.loaders import ATTACHMENT_EXTENSIONS, load_document, mime_for
from .ingest.types import IngestRequest
from .plan import storage as plan_storage
from .plan import transitions as plan_transitions
from .plan.checker import check_plan
from .plan.models import (
    CatalogueSnapshot,
    Client,
    EducationModule,
    HypothesizedDriver,
    Plan,
    SupplementItem,
)
from .loader import (
    load_claim,
    load_claims,
    load_cooking_adjustment,
    load_cooking_adjustments,
    load_home_remedies,
    load_home_remedy,
    load_mechanism,
    load_mechanisms,
    load_source,
    load_sources,
    load_supplement,
    load_supplements,
    load_symptom,
    load_symptoms,
    load_topic,
    load_topics,
)
from .validator import validate_all

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def cmd_validate(args: argparse.Namespace) -> None:
    count, errors, warnings = validate_all(DATA_DIR)
    print(f"Checked {count} supplement(s)")
    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(f"  - {e}")
    if warnings:
        print(f"\n{len(warnings)} warning(s) — unresolved cross-refs (use `fmdb pending-refs` for full list):")
        for w in warnings[: 10 if not args.verbose else len(warnings)]:
            print(f"  ~ {w.render()}")
        if not args.verbose and len(warnings) > 10:
            print(f"  ... +{len(warnings) - 10} more (rerun with -v to see all)")
    if errors:
        sys.exit(1)
    if args.strict and warnings:
        print("\n--strict: warnings treated as errors.")
        sys.exit(1)
    if not errors and not warnings:
        print("All checks passed.")
    elif not errors:
        print("\nNo errors. Warnings are non-blocking.")


def cmd_pending_refs(args: argparse.Namespace) -> None:
    _, _, warnings = validate_all(DATA_DIR)
    xrefs = [w for w in warnings if w.is_xref]
    if not xrefs:
        print("(no unresolved cross-references)")
        return
    # Group by target so the user sees "what stubs am I owed?"
    by_target: dict = {}
    for w in xrefs:
        by_target.setdefault((w.target_kind, w.target_slug), []).append(w)
    for (kind, slug), refs in sorted(by_target.items()):
        print(f"\n{kind} {slug!r}  (referenced by {len(refs)})")
        for w in refs:
            print(f"  ← {w.source_entity} {w.source_slug}.{w.field}")


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


def cmd_sources(args: argparse.Namespace) -> None:
    sources = load_sources(DATA_DIR)
    if not sources:
        print("(no sources)")
        return
    for src in sources:
        print(f"  {src.id:35s}  {src.source_type.value:22s}  [{src.quality.value}]  {src.title}")


def cmd_show_source(args: argparse.Namespace) -> None:
    src = load_source(DATA_DIR, args.id)
    print(f"{src.title}  ({src.id})  v{src.version}  [{src.status.value}]")
    print(f"  Type:        {src.source_type.value}")
    print(f"  Quality:     {src.quality.value}")
    if src.authors:
        print(f"  Authors:     {', '.join(src.authors)}")
    if src.year:
        print(f"  Year:        {src.year}")
    if src.publisher:
        print(f"  Publisher:   {src.publisher}")
    if src.url:
        print(f"  URL:         {src.url}")
    if src.doi:
        print(f"  DOI:         {src.doi}")
    if src.internal_path:
        print(f"  Path:        {src.internal_path}")
    if src.notes:
        print(f"  Notes:       {src.notes.strip()}")
    print(f"  Updated:     {src.updated_at} by {src.updated_by}")


def cmd_topics(args: argparse.Namespace) -> None:
    topics = load_topics(DATA_DIR)
    if not topics:
        print("(no topics)")
        return
    for t in topics:
        print(f"  {t.slug:25s}  {t.display_name:30s}  [{t.evidence_tier.value}]")


def cmd_show_topic(args: argparse.Namespace) -> None:
    t = load_topic(DATA_DIR, args.slug)
    print(f"{t.display_name}  ({t.slug})  v{t.version}  [{t.status.value}]")
    if t.aliases:
        print(f"  Aliases:         {', '.join(t.aliases)}")
    print(f"  Evidence tier:   {t.evidence_tier.value}")
    print(f"  Summary:         {t.summary.strip()}")
    if t.common_symptoms:
        print("  Common symptoms:")
        for sym in t.common_symptoms:
            print(f"    - {sym}")
    if t.red_flags:
        print("  Red flags (refer out):")
        for rf in t.red_flags:
            print(f"    - {rf}")
    if t.related_topics:
        print(f"  Related topics:  {', '.join(t.related_topics)}")
    if t.key_mechanisms:
        print(f"  Mechanisms:      {', '.join(t.key_mechanisms)}")
    if t.coaching_scope_notes:
        print(f"  Coaching scope:  {t.coaching_scope_notes.strip()}")
    if t.clinician_scope_notes:
        print(f"  Clinician scope: {t.clinician_scope_notes.strip()}")
    if t.sources:
        print("  Sources:")
        for src in t.sources:
            quote = f' — "{src.quote}"' if src.quote else ""
            loc = f" [{src.location}]" if src.location else ""
            print(f"    - {src.id}{loc}{quote}")
    print(f"  Updated: {t.updated_at} by {t.updated_by}")


def cmd_claims(args: argparse.Namespace) -> None:
    claims = load_claims(DATA_DIR)
    if not claims:
        print("(no claims)")
        return
    for c in claims:
        topics = ",".join(c.linked_to_topics) or "-"
        print(f"  {c.slug:40s}  [{c.evidence_tier.value:20s}]  topics: {topics}")


def cmd_show_claim(args: argparse.Namespace) -> None:
    c = load_claim(DATA_DIR, args.slug)
    print(f"{c.slug}  v{c.version}  [{c.status.value}]  [{c.evidence_tier.value}]")
    print(f"  Statement:    {c.statement.strip()}")
    print(f"  Rationale:    {c.rationale.strip()}")
    if c.coaching_translation:
        print(f"  In session:   {c.coaching_translation.strip()}")
    if c.out_of_scope_notes:
        print(f"  Out of scope: {c.out_of_scope_notes.strip()}")
    if c.caveats:
        print("  Caveats:")
        for cv in c.caveats:
            print(f"    - {cv}")
    if c.linked_to_topics:
        print(f"  Topics:       {', '.join(c.linked_to_topics)}")
    if c.linked_to_mechanisms:
        print(f"  Mechanisms:   {', '.join(c.linked_to_mechanisms)}")
    if c.linked_to_supplements:
        print(f"  Supplements:  {', '.join(c.linked_to_supplements)}")
    if c.sources:
        print("  Sources:")
        for src in c.sources:
            quote = f' — "{src.quote}"' if src.quote else ""
            loc = f" [{src.location}]" if src.location else ""
            print(f"    - {src.id}{loc}{quote}")
    print(f"  Updated: {c.updated_at} by {c.updated_by}")


def cmd_mechanisms(args: argparse.Namespace) -> None:
    mechs = load_mechanisms(DATA_DIR)
    if not mechs:
        print("(no mechanisms)")
        return
    for m in mechs:
        nalias = f"+{len(m.aliases)}a" if m.aliases else "    "
        print(f"  {m.slug:40s}  {m.category.value:14s} {nalias}  [{m.evidence_tier.value}]  {m.display_name}")


def cmd_show_mechanism(args: argparse.Namespace) -> None:
    m = load_mechanism(DATA_DIR, args.slug)
    print(f"{m.display_name}  ({m.slug})  v{m.version}  [{m.status.value}]")
    print(f"  Category:        {m.category.value}")
    print(f"  Evidence tier:   {m.evidence_tier.value}")
    if m.aliases:
        print(f"  Aliases:         {', '.join(m.aliases)}")
    print(f"  Summary:         {m.summary.strip()}")
    if m.upstream_drivers:
        print("  Upstream drivers:")
        for d in m.upstream_drivers:
            print(f"    - {d}")
    if m.downstream_effects:
        print("  Downstream effects:")
        for d in m.downstream_effects:
            print(f"    - {d}")
    if m.related_mechanisms:
        print(f"  Related:         {', '.join(m.related_mechanisms)}")
    if m.linked_to_topics:
        print(f"  Topics:          {', '.join(m.linked_to_topics)}")
    if m.sources:
        print("  Sources:")
        for src in m.sources:
            quote = f' — "{src.quote}"' if src.quote else ""
            loc = f" [{src.location}]" if src.location else ""
            print(f"    - {src.id}{loc}{quote}")
    print(f"  Updated: {m.updated_at} by {m.updated_by}")


def cmd_symptoms(args: argparse.Namespace) -> None:
    syms = load_symptoms(DATA_DIR)
    if not syms:
        print("(no symptoms)")
        return
    for s in syms:
        nalias = f"+{len(s.aliases)}a" if s.aliases else "    "
        print(f"  {s.slug:30s}  {s.category.value:14s} {s.severity.value:11s} {nalias}  {s.display_name}")


def cmd_show_symptom(args: argparse.Namespace) -> None:
    sym = load_symptom(DATA_DIR, args.slug)
    print(f"{sym.display_name}  ({sym.slug})  v{sym.version}  [{sym.status.value}]")
    print(f"  Category:        {sym.category.value}")
    print(f"  Severity:        {sym.severity.value}")
    if sym.aliases:
        print(f"  Aliases:         {', '.join(sym.aliases)}")
    print(f"  Description:     {sym.description.strip()}")
    if sym.when_to_refer:
        print(f"  When to refer:   {sym.when_to_refer.strip()}")
    if sym.linked_to_topics:
        print(f"  Topics:          {', '.join(sym.linked_to_topics)}")
    if sym.linked_to_mechanisms:
        print(f"  Mechanisms:      {', '.join(sym.linked_to_mechanisms)}")
    if sym.sources:
        print("  Sources:")
        for src in sym.sources:
            quote = f' — "{src.quote}"' if src.quote else ""
            loc = f" [{src.location}]" if src.location else ""
            print(f"    - {src.id}{loc}{quote}")
    print(f"  Updated: {sym.updated_at} by {sym.updated_by}")


def cmd_cooking_adjustments(args: argparse.Namespace) -> None:
    items = load_cooking_adjustments(DATA_DIR)
    if not items:
        print("(no cooking adjustments)")
        return
    for ca in items:
        print(f"  {ca.slug:35s}  {ca.category.value:14s}  [{ca.evidence_tier.value}]  {ca.display_name}")


def cmd_show_cooking_adjustment(args: argparse.Namespace) -> None:
    ca = load_cooking_adjustment(DATA_DIR, args.slug)
    print(f"{ca.display_name}  ({ca.slug})  v{ca.version}  [{ca.status.value}]")
    print(f"  Category:        {ca.category.value}")
    print(f"  Evidence tier:   {ca.evidence_tier.value}")
    if ca.aliases:
        print(f"  Aliases:         {', '.join(ca.aliases)}")
    print(f"  Summary:         {ca.summary.strip()}")
    if ca.benefits:
        print("  Benefits:")
        for b in ca.benefits:
            print(f"    - {b}")
    if ca.swap_from:
        print(f"  Replaces:        {', '.join(ca.swap_from)}")
    if ca.how_to_use:
        print(f"  How to use:      {ca.how_to_use.strip()}")
    if ca.cautions:
        print("  Cautions:")
        for c in ca.cautions:
            print(f"    - {c}")
    if ca.linked_to_topics:
        print(f"  Topics:          {', '.join(ca.linked_to_topics)}")
    if ca.linked_to_mechanisms:
        print(f"  Mechanisms:      {', '.join(ca.linked_to_mechanisms)}")
    if ca.sources:
        print("  Sources:")
        for s in ca.sources:
            quote = f' — "{s.quote}"' if s.quote else ""
            loc = f" [{s.location}]" if s.location else ""
            print(f"    - {s.id}{loc}{quote}")
    print(f"  Updated: {ca.updated_at} by {ca.updated_by}")


def cmd_home_remedies(args: argparse.Namespace) -> None:
    items = load_home_remedies(DATA_DIR)
    if not items:
        print("(no home remedies)")
        return
    for hr in items:
        print(f"  {hr.slug:35s}  {hr.category.value:18s}  [{hr.evidence_tier.value}]  {hr.display_name}")


def cmd_show_home_remedy(args: argparse.Namespace) -> None:
    hr = load_home_remedy(DATA_DIR, args.slug)
    print(f"{hr.display_name}  ({hr.slug})  v{hr.version}  [{hr.status.value}]")
    print(f"  Category:        {hr.category.value}")
    print(f"  Evidence tier:   {hr.evidence_tier.value}")
    if hr.aliases:
        print(f"  Aliases:         {', '.join(hr.aliases)}")
    print(f"  Summary:         {hr.summary.strip()}")
    if hr.indications:
        print(f"  Indications:     {', '.join(hr.indications)}")
    if hr.contraindications:
        print(f"  Contraindications: {', '.join(hr.contraindications)}")
    if hr.preparation:
        print(f"  Preparation:     {hr.preparation.strip()}")
    if hr.typical_dose:
        print(f"  Typical dose:    {hr.typical_dose.strip()}")
    if hr.duration:
        print(f"  Duration:        {hr.duration.strip()}")
    if hr.timing_notes:
        print(f"  Timing notes:    {hr.timing_notes.strip()}")
    if hr.linked_to_topics:
        print(f"  Topics:          {', '.join(hr.linked_to_topics)}")
    if hr.linked_to_mechanisms:
        print(f"  Mechanisms:      {', '.join(hr.linked_to_mechanisms)}")
    if hr.sources:
        print("  Sources:")
        for s in hr.sources:
            quote = f' — "{s.quote}"' if s.quote else ""
            loc = f" [{s.location}]" if s.location else ""
            print(f"    - {s.id}{loc}{quote}")
    print(f"  Updated: {hr.updated_at} by {hr.updated_by}")


def cmd_ingest(args: argparse.Namespace) -> None:
    path = Path(args.path).expanduser().resolve()
    if not path.exists():
        print(f"file not found: {path}", file=sys.stderr)
        sys.exit(2)

    import base64 as _b64
    doc_text = load_document(path)
    # If this is a PDF/image, also attach the raw bytes so the AnthropicExtractor
    # can pass them as document/image content blocks (Claude reads them natively).
    attachments: list[dict] = []
    if path.suffix.lower() in ATTACHMENT_EXTENSIONS:
        data = path.read_bytes()
        attachments.append({
            "filename": path.name,
            "mime_type": mime_for(path),
            "data_b64": _b64.b64encode(data).decode("ascii"),
        })
    extra: dict = {}
    if args.url:
        extra["url"] = args.url
    if args.doi:
        extra["doi"] = args.doi
    if args.internal_path:
        extra["internal_path"] = args.internal_path
    if args.author:
        extra["authors"] = list(args.author)
    if args.year:
        extra["year"] = args.year

    req = IngestRequest(
        document_text=doc_text,
        source_id=args.source_id,
        source_title=args.source_title or args.source_id,
        source_type=args.source_type,
        source_quality=args.source_quality,
        source_extra=extra,
        instructions=args.instructions or "",
        attachments=attachments,
    )

    extractor = get_extractor(args.extractor)
    backend = type(extractor).__name__
    print(f"Ingesting {path.name} ({len(doc_text)} chars) via {backend}...")
    result = extractor.extract(req)

    batch_id = staging.make_batch_id(req, doc_text)
    manifest = staging.stage(
        req, result, data_dir=DATA_DIR,
        batch_id=batch_id, updated_by=args.updated_by, doc_text=doc_text,
    )

    audit.append(
        DATA_DIR, "ingest",
        batch_id=batch_id, source_id=req.source_id,
        backend=backend, doc_path=str(path),
        n_entries=len(manifest["entries"]),
        usage=result.usage,
    )

    print(f"Batch: {batch_id}")
    if result.usage:
        u = result.usage
        print(
            f"  usage: in={u.get('input_tokens')} out={u.get('output_tokens')} "
            f"cache_w={u.get('cache_creation_input_tokens')} cache_r={u.get('cache_read_input_tokens')} "
            f"stop={u.get('stop_reason')}"
        )
    counts: dict = {}
    for e in manifest["entries"]:
        counts[(e["entity"], e["status"])] = counts.get((e["entity"], e["status"]), 0) + 1
    for (entity, status), n in sorted(counts.items()):
        print(f"  {entity:12s}  {status:10s}  {n}")
    print(f"\nReview with:  fmdb review {batch_id}")


def cmd_review(args: argparse.Namespace) -> None:
    if args.batch_id:
        manifest = staging.load_batch(DATA_DIR, args.batch_id)
        print(f"Batch {manifest['batch_id']}")
        print(f"  source: {manifest['source_id']}  ({manifest['source_title']})")
        print(f"  doc:    {manifest['doc_chars']} chars, hash {manifest['doc_hash']}")
        print(f"  by:     {manifest['updated_by']}  at {manifest['created_at']}")
        print("  entries:")
        for e in manifest["entries"]:
            line = f"    [{e['status']:10s}]  {e['entity']:12s}  {e.get('slug') or '?'}"
            if e["status"] == "rejected":
                line += f"  ({e.get('reason', '')})"
            print(line)
        return
    batches = staging.list_batches(DATA_DIR)
    if not batches:
        print("(no staged batches)")
        return
    for m in batches:
        new = sum(1 for e in m["entries"] if e["status"] == "new")
        conflict = sum(1 for e in m["entries"] if e["status"] == "conflict")
        rejected = sum(1 for e in m["entries"] if e["status"] == "rejected")
        print(
            f"  {m['batch_id']:55s}  src={m['source_id']:30s}  "
            f"new={new} conflict={conflict} rejected={rejected}"
        )


def _parse_only(only: str | None) -> tuple[str, str] | None:
    if not only:
        return None
    if "/" not in only:
        raise SystemExit("--only must be ENTITY/SLUG (e.g. topics/insomnia)")
    e, s = only.split("/", 1)
    return (e, s)


def cmd_approve(args: argparse.Namespace) -> None:
    only = _parse_only(args.only)
    promoted, errors, warnings = staging.approve(
        DATA_DIR, args.batch_id, only=only, update=args.update, overwrite=args.overwrite,
    )
    for p in promoted:
        print(f"  promoted: {p}")
    for e in errors:
        print(f"  ERROR:    {e}", file=sys.stderr)
    audit.append(
        DATA_DIR, "approve",
        batch_id=args.batch_id, only=args.only,
        promoted=promoted, errors=errors,
        n_warnings=len(warnings),
    )
    if errors:
        sys.exit(1)
    if warnings:
        print(f"\n{len(warnings)} warning(s) introduced — unresolved cross-refs (non-blocking):")
        for w in warnings[:10]:
            print(f"  ~ {w.render()}")
        if len(warnings) > 10:
            print(f"  ... +{len(warnings) - 10} more (see `fmdb pending-refs`)")
    print("\nApproval committed atomically; no post-state errors.")


def cmd_reject(args: argparse.Namespace) -> None:
    only = _parse_only(args.only)
    removed = staging.reject(DATA_DIR, args.batch_id, only=only)
    for r in removed:
        print(f"  removed: {r}")
    audit.append(
        DATA_DIR, "reject",
        batch_id=args.batch_id, only=args.only, removed=removed,
    )


def cmd_audit(args: argparse.Namespace) -> None:
    events = audit.tail(DATA_DIR, n=args.n)
    if not events:
        print("(no audit log yet)")
        return
    for ev in events:
        extras = " ".join(f"{k}={v}" for k, v in ev.items() if k not in ("ts", "event"))
        print(f"  {ev['ts']}  {ev['event']:8s}  {extras}")


# ---------------------------------------------------------------------------
# Client commands
# ---------------------------------------------------------------------------


def _plans_root(args: argparse.Namespace):
    return plan_storage.plans_root(getattr(args, "plans_dir", None))


def cmd_client_new(args: argparse.Namespace) -> None:
    from datetime import datetime as _dt, timezone as _tz, date as _date
    root = _plans_root(args)
    plan_storage.ensure_layout(root)
    now = _dt.now(_tz.utc)
    client = Client(
        client_id=args.client_id,
        display_name=args.display_name or "",
        intake_date=_date.fromisoformat(args.intake_date),
        age_band=args.age_band,
        sex=args.sex,
        active_conditions=list(args.condition or []),
        current_medications=list(args.medication or []),
        known_allergies=list(args.allergy or []),
        goals=list(args.goal or []),
        notes=args.notes or "",
        created_at=now,
        updated_at=now,
        updated_by=args.updated_by,
    )
    p = plan_storage.write_client(root, client)
    print(f"created client: {p}")


def cmd_client_show(args: argparse.Namespace) -> None:
    root = _plans_root(args)
    c = plan_storage.load_client(root, args.client_id)
    print(f"{c.client_id}  ({c.display_name or '<no display name>'})  v{c.version}  [{c.status.value}]")
    print(f"  Intake date:        {c.intake_date}")
    print(f"  Age band / sex:     {c.age_band} / {c.sex}")
    if c.active_conditions:
        print(f"  Active conditions:  {', '.join(c.active_conditions)}")
    if c.current_medications:
        print(f"  Medications:        {', '.join(c.current_medications)}")
    if c.known_allergies:
        print(f"  Allergies:          {', '.join(c.known_allergies)}")
    if c.goals:
        print("  Goals:")
        for g in c.goals:
            print(f"    - {g}")
    if c.notes:
        print(f"  Notes:              {c.notes.strip()}")
    print(f"  Updated:            {c.updated_at} by {c.updated_by}")


def cmd_client_list(args: argparse.Namespace) -> None:
    root = _plans_root(args)
    clients = plan_storage.list_clients(root)
    if not clients:
        print(f"(no clients in {root})")
        return
    for c in clients:
        name = c.display_name or "—"
        conds = ", ".join(c.active_conditions[:3]) or "—"
        print(f"  {c.client_id:15s}  {name:25s}  intake {c.intake_date}  "
              f"{c.age_band:6s} {c.sex}  conds: {conds}")


def cmd_client_edit(args: argparse.Namespace) -> None:
    """Open the client YAML in $EDITOR for direct editing."""
    import subprocess
    root = _plans_root(args)
    p = plan_storage.client_path(root, args.client_id)
    if not p.exists():
        print(f"client not found: {args.client_id}", file=sys.stderr)
        sys.exit(2)
    editor = os.environ.get("EDITOR", "nano")
    subprocess.call([editor, str(p)])
    # Re-validate after edit
    try:
        c = plan_storage.load_client(root, args.client_id)
        print(f"validated: {c.client_id} v{c.version}")
    except Exception as e:
        print(f"WARN: file failed to validate after edit:\n  {e}", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Plan commands
# ---------------------------------------------------------------------------


def cmd_plan_new(args: argparse.Namespace) -> None:
    from datetime import datetime as _dt, timezone as _tz, date as _date, timedelta
    root = _plans_root(args)
    plan_storage.ensure_layout(root)

    # Verify client exists (helpful early-fail)
    plan_storage.load_client(root, args.client_id)

    now = _dt.now(_tz.utc)
    start = _date.fromisoformat(args.start) if args.start else _date.today()
    weeks = args.weeks
    recheck = start + timedelta(weeks=weeks)

    plan = Plan(
        slug=args.slug,
        client_id=args.client_id,
        plan_period_start=start,
        plan_period_weeks=weeks,
        plan_period_recheck_date=recheck,
        catalogue_snapshot=CatalogueSnapshot(snapshot_date=_date.today()),
        created_at=now,
        updated_at=now,
        updated_by=args.updated_by,
    )
    p = plan_storage.write_plan(root, plan)
    print(f"created plan: {p}")
    print(f"  → edit with: fmdb plan edit {plan.slug}")
    print(f"  → check with: fmdb plan check {plan.slug}")


def cmd_plan_list(args: argparse.Namespace) -> None:
    root = _plans_root(args)
    plans = plan_storage.list_plans(root)
    if not plans:
        print(f"(no plans in {root})")
        return
    if args.client:
        plans = [p for p in plans if p.client_id == args.client]
    if args.status:
        plans = [p for p in plans if p.status.value == args.status]
    for p in sorted(plans, key=lambda x: (x.client_id, x.plan_period_start), reverse=True):
        prim = ",".join(p.primary_topics) or "—"
        print(f"  {p.slug:50s}  {p.client_id:12s}  "
              f"{p.status.value:18s}  {p.plan_period_start}  topics: {prim}")


def cmd_plan_show(args: argparse.Namespace) -> None:
    root = _plans_root(args)
    p = plan_storage.load_plan(root, args.slug)
    print(f"{p.slug}  v{p.version}  [{p.status.value}]")
    print(f"  Client:                 {p.client_id}")
    print(f"  Plan period:            {p.plan_period_start} → {p.plan_period_recheck_date} "
          f"({p.plan_period_weeks} weeks)")
    print(f"  Primary topics:         {', '.join(p.primary_topics) or '—'}")
    print(f"  Contributing topics:    {', '.join(p.contributing_topics) or '—'}")
    print(f"  Presenting symptoms:    {', '.join(p.presenting_symptoms) or '—'}")
    if p.hypothesized_drivers:
        print("  Hypothesized drivers:")
        for hd in p.hypothesized_drivers:
            print(f"    - {hd.mechanism}: {hd.reasoning}")
    if p.lifestyle_practices:
        print("  Lifestyle practices:")
        for pr in p.lifestyle_practices:
            extra = f" — {pr.details}" if pr.details else ""
            print(f"    - {pr.name} ({pr.cadence}){extra}")
    if p.nutrition.pattern or p.nutrition.add or p.nutrition.reduce:
        print(f"  Nutrition pattern:      {p.nutrition.pattern or '—'}")
        if p.nutrition.add:
            print(f"    Add:                  {', '.join(p.nutrition.add)}")
        if p.nutrition.reduce:
            print(f"    Reduce:               {', '.join(p.nutrition.reduce)}")
        if p.nutrition.meal_timing:
            print(f"    Meal timing:          {p.nutrition.meal_timing}")
        if p.nutrition.cooking_adjustments:
            print(f"    Cooking adjustments:  {', '.join(p.nutrition.cooking_adjustments)}")
        if p.nutrition.home_remedies:
            print(f"    Home remedies:        {', '.join(p.nutrition.home_remedies)}")
    if p.education:
        print("  Education modules:")
        for em in p.education:
            print(f"    - {em.target_kind}/{em.target_slug}")
    if p.supplement_protocol:
        print("  Supplement protocol:")
        for sp in p.supplement_protocol:
            bits = []
            if sp.form: bits.append(sp.form)
            if sp.dose: bits.append(sp.dose)
            if sp.timing: bits.append(sp.timing)
            if sp.duration_weeks: bits.append(f"{sp.duration_weeks}wk")
            print(f"    - {sp.supplement_slug}: {' / '.join(bits) or '(no params)'}")
            if sp.coach_rationale:
                print(f"        rationale: {sp.coach_rationale}")
    if p.lab_orders:
        print("  Lab orders:")
        for lo in p.lab_orders:
            print(f"    - {lo.test} — {lo.reason}")
    if p.referrals:
        print("  Referrals:")
        for r in p.referrals:
            print(f"    - to {r.to} ({r.urgency.value}): {r.reason}")
    if p.tracking.habits or p.tracking.symptoms_to_monitor:
        print("  Tracking:")
        for h in p.tracking.habits:
            print(f"    habit: {h.name} ({h.cadence})")
        if p.tracking.symptoms_to_monitor:
            print(f"    symptoms: {', '.join(p.tracking.symptoms_to_monitor)}")
        if p.tracking.recheck_questions:
            print("    recheck questions:")
            for q in p.tracking.recheck_questions:
                print(f"      - {q}")
    if p.notes_for_coach:
        print(f"  Coach notes:            {p.notes_for_coach.strip()}")
    print(f"  Catalogue snapshot:     {p.catalogue_snapshot.snapshot_date}"
          f" (sha: {p.catalogue_snapshot.git_sha or '—'})")
    print(f"  Updated:                {p.updated_at} by {p.updated_by}")


def cmd_plan_edit(args: argparse.Namespace) -> None:
    import subprocess
    root = _plans_root(args)
    p_path = plan_storage.find_plan_path(root, args.slug)
    if "drafts" not in str(p_path) and not args.force:
        print(f"refusing to edit non-draft plan: {p_path}", file=sys.stderr)
        print("  pass --force to edit anyway (NOT recommended for published plans)")
        sys.exit(2)
    editor = os.environ.get("EDITOR", "nano")
    subprocess.call([editor, str(p_path)])
    # Re-validate
    try:
        plan = plan_storage.load_plan(root, args.slug)
        print(f"validated: {plan.slug} v{plan.version} [{plan.status.value}]")
    except Exception as e:
        print(f"WARN: file failed to validate after edit:\n  {e}", file=sys.stderr)
        sys.exit(1)


def cmd_plan_check(args: argparse.Namespace) -> None:
    """Run deterministic plan checks against the catalogue."""
    from .validator import load_all
    root = _plans_root(args)
    plan = plan_storage.load_plan(root, args.slug)
    try:
        client = plan_storage.load_client(root, plan.client_id)
    except FileNotFoundError:
        print(f"WARN: client {plan.client_id!r} not found — skipping client-specific checks", file=sys.stderr)
        client = None
    catalogue = load_all(DATA_DIR)
    findings = check_plan(plan, client, catalogue)

    if not findings:
        print(f"plan {args.slug}: 0 findings — clean.")
        return

    counts = {"CRITICAL": 0, "WARNING": 0, "INFO": 0}
    for f in findings:
        counts[f.severity] += 1
    print(f"plan {args.slug}: {counts['CRITICAL']} CRITICAL, "
          f"{counts['WARNING']} WARNING, {counts['INFO']} INFO\n")
    for f in findings:
        print(f"  {f.render()}")
    if counts["CRITICAL"]:
        sys.exit(1)


def cmd_plan_add_supplement(args: argparse.Namespace) -> None:
    from datetime import datetime as _dt, timezone as _tz
    root = _plans_root(args)
    plan = plan_storage.load_plan(root, args.slug)
    if plan.status.value != "draft":
        print(f"plan is {plan.status.value!r}, can only add to drafts", file=sys.stderr)
        sys.exit(2)
    plan.supplement_protocol.append(SupplementItem(
        supplement_slug=args.supplement_slug,
        form=args.form or "",
        dose=args.dose or "",
        timing=args.timing or "",
        take_with_food=args.take_with_food or "",
        duration_weeks=args.duration_weeks,
        titration=args.titration or "",
        coach_rationale=args.rationale or "",
    ))
    plan.updated_by = args.updated_by
    plan_storage.write_plan(root, plan)
    print(f"added supplement {args.supplement_slug} to {args.slug}")


def cmd_plan_add_topic(args: argparse.Namespace) -> None:
    root = _plans_root(args)
    plan = plan_storage.load_plan(root, args.slug)
    if plan.status.value != "draft":
        print(f"plan is {plan.status.value!r}, can only add to drafts", file=sys.stderr)
        sys.exit(2)
    target_list = plan.contributing_topics if args.contributing else plan.primary_topics
    if args.topic_slug not in target_list:
        target_list.append(args.topic_slug)
    plan.updated_by = args.updated_by
    plan_storage.write_plan(root, plan)
    kind = "contributing" if args.contributing else "primary"
    print(f"added {kind} topic {args.topic_slug} to {args.slug}")


def cmd_plan_add_symptom(args: argparse.Namespace) -> None:
    root = _plans_root(args)
    plan = plan_storage.load_plan(root, args.slug)
    if plan.status.value != "draft":
        print(f"plan is {plan.status.value!r}, can only add to drafts", file=sys.stderr)
        sys.exit(2)
    target_list = plan.tracking.symptoms_to_monitor if args.monitor else plan.presenting_symptoms
    if args.symptom_slug not in target_list:
        target_list.append(args.symptom_slug)
    plan.updated_by = args.updated_by
    plan_storage.write_plan(root, plan)
    kind = "monitor" if args.monitor else "presenting"
    print(f"added {kind} symptom {args.symptom_slug} to {args.slug}")


def cmd_plan_submit(args: argparse.Namespace) -> None:
    """draft → ready_to_publish (requires plan-check clean)."""
    root = _plans_root(args)
    try:
        plan, _findings = plan_transitions.submit_plan(
            root, args.slug, by=args.updated_by,
            catalogue_dir=DATA_DIR, reason=args.reason or "",
        )
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)
    print(f"submitted: {args.slug} → ready_to_publish (v{plan.version})")
    print(f"  → publish with: fmdb plan-publish {args.slug}")


def cmd_plan_publish(args: argparse.Namespace) -> None:
    """ready_to_publish → published (irreversible; freezes catalogue snapshot)."""
    root = _plans_root(args)
    try:
        plan, written, sha = plan_transitions.publish_plan(
            root, args.slug, by=args.updated_by,
            catalogue_dir=DATA_DIR, reason=args.reason or "",
        )
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)
    print(f"published: {args.slug} v{plan.version}")
    print(f"  → file:    {written}")
    print(f"  → sha:     {sha or '(no git repo)'}")
    print(f"  → snapshot date: {plan.catalogue_snapshot.snapshot_date}")


def cmd_plan_revoke(args: argparse.Namespace) -> None:
    """published → revoked (requires reason)."""
    root = _plans_root(args)
    try:
        plan, written = plan_transitions.revoke_plan(
            root, args.slug, by=args.updated_by, reason=args.reason,
        )
    except (RuntimeError, ValueError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)
    print(f"revoked: {args.slug} v{plan.version} → {written}")


def cmd_plan_supersede(args: argparse.Namespace) -> None:
    """Publish a new plan that has supersedes=<old_slug>; flip old to superseded."""
    root = _plans_root(args)
    try:
        new_plan, old_plan, written = plan_transitions.supersede_plan(
            root, args.slug, by=args.updated_by,
            catalogue_dir=DATA_DIR, reason=args.reason or "",
        )
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)
    print(f"superseded: {old_plan.slug} v{old_plan.version} → superseded")
    print(f"published:  {new_plan.slug} v{new_plan.version} → {written}")


def cmd_plan_diff(args: argparse.Namespace) -> None:
    root = _plans_root(args)
    try:
        diff = plan_transitions.diff_plans(root, args.slug_a, args.slug_b)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(2)
    if not diff:
        print(f"(no diff between {args.slug_a} and {args.slug_b})")
        return
    print(diff)


def cmd_plan_delete(args: argparse.Namespace) -> None:
    root = _plans_root(args)
    if not args.yes:
        resp = input(f"delete draft plan {args.slug}? (yes/no): ")
        if resp.strip().lower() != "yes":
            print("aborted.")
            return
    p = plan_storage.delete_plan(root, args.slug)
    print(f"deleted: {p}")


def main() -> None:
    p = argparse.ArgumentParser(prog="fmdb")
    p.add_argument("--plans-dir", help="override plans root (default: $FMDB_PLANS_DIR or ~/fm-plans)")
    sub = p.add_subparsers(dest="cmd", required=True)

    val = sub.add_parser("validate", help="check all entries (errors + warnings)")
    val.add_argument("-v", "--verbose", action="store_true", help="show all warnings, not just first 10")
    val.add_argument("--strict", action="store_true", help="treat warnings as errors (exit 1 on any)")
    val.set_defaults(func=cmd_validate)
    sub.add_parser("pending-refs", help="list unresolved cross-references grouped by target").set_defaults(func=cmd_pending_refs)
    sub.add_parser("list", help="list all supplements").set_defaults(func=cmd_list)
    sub.add_parser("sources", help="list all sources").set_defaults(func=cmd_sources)
    sub.add_parser("topics", help="list all topics").set_defaults(func=cmd_topics)
    sub.add_parser("claims", help="list all claims").set_defaults(func=cmd_claims)
    sub.add_parser("mechanisms", help="list all mechanisms").set_defaults(func=cmd_mechanisms)
    sub.add_parser("symptoms", help="list all symptoms").set_defaults(func=cmd_symptoms)
    sub.add_parser("cooking-adjustments", help="list all cooking adjustments").set_defaults(func=cmd_cooking_adjustments)
    sub.add_parser("home-remedies", help="list all home remedies").set_defaults(func=cmd_home_remedies)

    show = sub.add_parser("show", help="show one supplement")
    show.add_argument("slug")
    show.set_defaults(func=cmd_show)

    show_src = sub.add_parser("show-source", help="show one source")
    show_src.add_argument("id")
    show_src.set_defaults(func=cmd_show_source)

    show_topic = sub.add_parser("show-topic", help="show one topic")
    show_topic.add_argument("slug")
    show_topic.set_defaults(func=cmd_show_topic)

    show_claim = sub.add_parser("show-claim", help="show one claim")
    show_claim.add_argument("slug")
    show_claim.set_defaults(func=cmd_show_claim)

    show_mech = sub.add_parser("show-mechanism", help="show one mechanism")
    show_mech.add_argument("slug")
    show_mech.set_defaults(func=cmd_show_mechanism)

    show_sym = sub.add_parser("show-symptom", help="show one symptom")
    show_sym.add_argument("slug")
    show_sym.set_defaults(func=cmd_show_symptom)

    show_ca = sub.add_parser("show-cooking-adjustment", help="show one cooking adjustment")
    show_ca.add_argument("slug")
    show_ca.set_defaults(func=cmd_show_cooking_adjustment)

    show_hr = sub.add_parser("show-home-remedy", help="show one home remedy")
    show_hr.add_argument("slug")
    show_hr.set_defaults(func=cmd_show_home_remedy)

    ing = sub.add_parser("ingest", help="extract candidates from a document")
    ing.add_argument("path", help="path to document (.md, .txt, ...)")
    ing.add_argument("--source-id", required=True, help="canonical source id (slug)")
    ing.add_argument("--source-title", help="human title (defaults to source-id)")
    ing.add_argument(
        "--source-type", required=True,
        choices=["internal_skill", "peer_reviewed_paper", "textbook",
                 "clinical_guideline", "expert_consensus", "book", "website",
                 "llm_synthesis", "other"],
    )
    ing.add_argument(
        "--source-quality", default="moderate", choices=["high", "moderate", "low"],
    )
    ing.add_argument("--url")
    ing.add_argument("--doi")
    ing.add_argument("--internal-path")
    ing.add_argument("--author", action="append", help="repeatable")
    ing.add_argument("--year", type=int)
    ing.add_argument("--instructions", help="extra hints to the extractor")
    ing.add_argument(
        "--extractor", default=None,
        help="stub|anthropic (defaults to FMDB_EXTRACTOR env or 'stub')",
    )
    ing.add_argument(
        "--updated-by", default=os.environ.get("FMDB_USER", "unknown"),
        help="author tag for staged entries",
    )
    ing.set_defaults(func=cmd_ingest)

    rev = sub.add_parser("review", help="list staged batches or show one")
    rev.add_argument("batch_id", nargs="?")
    rev.set_defaults(func=cmd_review)

    app = sub.add_parser("approve", help="promote staged batch to canonical")
    app.add_argument("batch_id")
    app.add_argument("--only", help="ENTITY/SLUG to approve a single file")
    app.add_argument("--update", action="store_true",
                     help="smart-merge into existing canonical (union lists, prefer non-empty new scalars; bumps version)")
    app.add_argument("--overwrite", action="store_true",
                     help="REPLACE existing canonical wholesale (destructive; bumps version). Prefer --update.")
    app.set_defaults(func=cmd_approve)

    rej = sub.add_parser("reject", help="discard staged batch or single file")
    rej.add_argument("batch_id")
    rej.add_argument("--only", help="ENTITY/SLUG to reject a single file")
    rej.set_defaults(func=cmd_reject)

    aud = sub.add_parser("audit", help="show recent audit log entries")
    aud.add_argument("-n", type=int, default=20)
    aud.set_defaults(func=cmd_audit)

    # ---- client commands ----
    cn = sub.add_parser("client-new", help="create a new client record")
    cn.add_argument("client_id", help="opaque id (lowercase-hyphen)")
    cn.add_argument("--display-name", help="for coach reference; can be a pseudonym")
    cn.add_argument("--intake-date", required=True, help="YYYY-MM-DD")
    cn.add_argument("--age-band", required=True, help="e.g. 45-50")
    cn.add_argument("--sex", required=True, choices=["F", "M", "other"])
    cn.add_argument("--condition", action="append", help="active condition (repeatable)")
    cn.add_argument("--medication", action="append", help="current medication (repeatable)")
    cn.add_argument("--allergy", action="append", help="known allergy (repeatable)")
    cn.add_argument("--goal", action="append", help="client goal (repeatable)")
    cn.add_argument("--notes", help="freeform")
    cn.add_argument("--updated-by", default=os.environ.get("FMDB_USER", "shivani"))
    cn.set_defaults(func=cmd_client_new)

    cs = sub.add_parser("client-show", help="show one client")
    cs.add_argument("client_id")
    cs.set_defaults(func=cmd_client_show)

    sub.add_parser("client-list", help="list all clients").set_defaults(func=cmd_client_list)

    ce = sub.add_parser("client-edit", help="open client YAML in $EDITOR")
    ce.add_argument("client_id")
    ce.set_defaults(func=cmd_client_edit)

    # ---- plan commands ----
    pn = sub.add_parser("plan-new", help="create a new draft plan")
    pn.add_argument("client_id")
    pn.add_argument("slug", help="plan slug, e.g. cl-12345-2026-04-29-peri-foundations")
    pn.add_argument("--start", help="plan start date YYYY-MM-DD (default: today)")
    pn.add_argument("--weeks", type=int, default=8)
    pn.add_argument("--updated-by", default=os.environ.get("FMDB_USER", "shivani"))
    pn.set_defaults(func=cmd_plan_new)

    pl = sub.add_parser("plan-list", help="list plans (filterable)")
    pl.add_argument("--client", help="filter by client_id")
    pl.add_argument("--status", help="filter by status")
    pl.set_defaults(func=cmd_plan_list)

    ps = sub.add_parser("plan-show", help="show one plan")
    ps.add_argument("slug")
    ps.set_defaults(func=cmd_plan_show)

    pe = sub.add_parser("plan-edit", help="open plan YAML in $EDITOR")
    pe.add_argument("slug")
    pe.add_argument("--force", action="store_true",
                    help="allow editing non-draft plans (NOT recommended)")
    pe.set_defaults(func=cmd_plan_edit)

    pc = sub.add_parser("plan-check", help="run deterministic plan checks against catalogue")
    pc.add_argument("slug")
    pc.set_defaults(func=cmd_plan_check)

    pas = sub.add_parser("plan-add-supplement", help="add a supplement to a draft plan")
    pas.add_argument("slug", help="plan slug")
    pas.add_argument("supplement_slug")
    pas.add_argument("--form")
    pas.add_argument("--dose")
    pas.add_argument("--timing")
    pas.add_argument("--take-with-food")
    pas.add_argument("--duration-weeks", type=int)
    pas.add_argument("--titration")
    pas.add_argument("--rationale")
    pas.add_argument("--updated-by", default=os.environ.get("FMDB_USER", "shivani"))
    pas.set_defaults(func=cmd_plan_add_supplement)

    pat = sub.add_parser("plan-add-topic", help="add a topic to a draft plan's assessment")
    pat.add_argument("slug")
    pat.add_argument("topic_slug")
    pat.add_argument("--contributing", action="store_true",
                     help="add to contributing_topics instead of primary_topics")
    pat.add_argument("--updated-by", default=os.environ.get("FMDB_USER", "shivani"))
    pat.set_defaults(func=cmd_plan_add_topic)

    pasy = sub.add_parser("plan-add-symptom", help="add a symptom to a draft plan")
    pasy.add_argument("slug")
    pasy.add_argument("symptom_slug")
    pasy.add_argument("--monitor", action="store_true",
                      help="add to tracking.symptoms_to_monitor instead of presenting_symptoms")
    pasy.add_argument("--updated-by", default=os.environ.get("FMDB_USER", "shivani"))
    pasy.set_defaults(func=cmd_plan_add_symptom)

    psub = sub.add_parser("plan-submit", help="draft → ready_to_publish (requires plan-check clean)")
    psub.add_argument("slug")
    psub.add_argument("--reason", default="")
    psub.add_argument("--updated-by", default=os.environ.get("FMDB_USER", "shivani"))
    psub.set_defaults(func=cmd_plan_submit)

    ppub = sub.add_parser("plan-publish", help="ready_to_publish → published (irreversible)")
    ppub.add_argument("slug")
    ppub.add_argument("--reason", default="")
    ppub.add_argument("--updated-by", default=os.environ.get("FMDB_USER", "shivani"))
    ppub.set_defaults(func=cmd_plan_publish)

    prev = sub.add_parser("plan-revoke", help="published → revoked (requires reason)")
    prev.add_argument("slug")
    prev.add_argument("--reason", required=True, help="why this plan is being revoked")
    prev.add_argument("--updated-by", default=os.environ.get("FMDB_USER", "shivani"))
    prev.set_defaults(func=cmd_plan_revoke)

    psup = sub.add_parser("plan-supersede",
                          help="publish a new plan that replaces an old one (new plan must have supersedes=<old> set)")
    psup.add_argument("slug", help="slug of the NEW plan (must be ready_to_publish + supersedes set)")
    psup.add_argument("--reason", default="")
    psup.add_argument("--updated-by", default=os.environ.get("FMDB_USER", "shivani"))
    psup.set_defaults(func=cmd_plan_supersede)

    pdf = sub.add_parser("plan-diff", help="textual diff between two plans (current versions)")
    pdf.add_argument("slug_a")
    pdf.add_argument("slug_b")
    pdf.set_defaults(func=cmd_plan_diff)

    pd = sub.add_parser("plan-delete", help="delete a draft plan (irreversible)")
    pd.add_argument("slug")
    pd.add_argument("--yes", action="store_true", help="skip confirmation")
    pd.set_defaults(func=cmd_plan_delete)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

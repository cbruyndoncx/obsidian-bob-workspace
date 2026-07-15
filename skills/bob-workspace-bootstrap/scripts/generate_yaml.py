#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Generate a single YAML schema source file for one entity, deduped and validated.

Reads vault frontmatter census for the named entity, infers fields, appends baseline
system fields (status / created / tags), then DEDUPES by field name before writing —
this prevents the BOB Workspace plugin's `regenerateSchemaOutputs` from failing with
'duplicate field' errors when a baseline field name (e.g. `status`) collides with an
observed enum field of the same name.

Usage:
    uv run generate_yaml.py --vault <path> --entity <slug> [--location-pattern <p>]
                            [--label <l>] [--domain <d>] [--type-value <tv>]
                            [--output <path>] [--no-baseline]
"""
import argparse
import sys
from collections import OrderedDict
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from frontmatter_census import census  # noqa: E402

BASELINE_FIELDS = [
    {"name": "type", "type": "string", "required": True},
    {"name": "status", "type": "string", "enum": ["draft", "review", "final", "archived"]},
    {"name": "created", "type": "string", "format": "date", "required": True},
    {"name": "tags", "type": "array"},
]


def schema_type(kind: str) -> str:
    if kind in ("integer", "number", "boolean"):
        return kind
    if kind in ("array", "array<wikilink>"):
        return "array"
    return "string"


def field_from_census(name: str, info: dict) -> dict:
    f = {"name": name, "type": schema_type(info["kind"])}
    if info["kind"] == "date":
        f["format"] = "date"
    if info["kind"] == "enum" and info.get("distinct_values"):
        vals = sorted(v for v in info["distinct_values"] if v and v != "None")
        if vals:
            f["enum"] = vals
    if info.get("required"):
        f["required"] = True
    return f


def dedupe(fields: list[dict]) -> list[dict]:
    """First occurrence wins; required-flag is merged in from any later duplicate."""
    seen: OrderedDict[str, dict] = OrderedDict()
    for f in fields:
        n = f["name"]
        if n not in seen:
            seen[n] = dict(f)
        elif f.get("required") and not seen[n].get("required"):
            seen[n]["required"] = True
    return list(seen.values())


def build_schema(
    vault: Path,
    entity: str,
    type_value: str,
    label: str,
    location_pattern: str,
    domain: str | None,
    include_baseline: bool,
) -> dict:
    cen = census(vault, min_count=1)
    ent = cen["entities"].get(entity, {})
    observed = ent.get("fields", {})

    fields: list[dict] = []
    # Observed first (preserves enums + presence-derived required flags)
    SYS = {"type", "tags"}  # baseline rewrites these
    sorted_obs = sorted(observed.items(), key=lambda kv: (-kv[1]["presence_ratio"], kv[0]))
    for fname, finfo in sorted_obs:
        if fname.startswith("_"):
            continue
        if fname in SYS and include_baseline:
            continue
        fields.append(field_from_census(fname, finfo))

    if include_baseline:
        fields = BASELINE_FIELDS + fields

    fields = dedupe(fields)

    # Pick a real display/title field as the primary. The plugin uses
    # key_fields[0] (else the first field) as the primary/basename — without this
    # the baseline `status` field would become the record title. Prefer an
    # obvious name/title field; fall back to the first non-baseline field.
    field_names = [f["name"] for f in fields]
    preferred = [
        "name", "title", "label", "subject",
        f"{entity}_name", f"{entity}_id", f"{entity}_title",
    ]
    primary = next((p for p in preferred if p in field_names), None)
    if not primary:
        primary = next(
            (n for n in field_names if n not in ("type", "status", "tags", "created")),
            field_names[0] if field_names else None,
        )

    schema = {
        "entity": entity,
        "label": label,
        "type_value": type_value,
        "location_pattern": location_pattern,
        "description": f"{label} entity inferred from vault census ({len(fields)} fields).",
    }
    if primary:
        schema["key_fields"] = [primary]
    if domain:
        schema["domain"] = domain
    schema["fields"] = fields
    return schema


def main() -> int:
    p = argparse.ArgumentParser(
        description="Generate one canonical YAML schema source file for a BOB Workspace entity.",
        epilog=(
            "Example: uv run generate_yaml.py --vault . --entity issue "
            "--label Issue --location-pattern 20-COMPANY/01-QMS/audits/ --domain quality"
        ),
    )
    p.add_argument("--vault", required=True, help="Absolute path to vault root")
    p.add_argument("--entity", required=True, help="Entity slug (kebab-case, matches filename)")
    p.add_argument("--type-value", help="Frontmatter `type:` value (default: same as --entity)")
    p.add_argument("--label", help="Display label (default: Title Case of entity)")
    p.add_argument("--location-pattern", required=True, help="Canonical folder pattern (e.g. 30-CLIENTS/{client-id}/00-PROFILE/)")
    p.add_argument("--domain", help="Annotation for downstream composition (optional)")
    p.add_argument("--output", help="Path to write YAML (default: <vault>/00-CORE/Schemas/source/<entity>.yaml)")
    p.add_argument("--no-baseline", action="store_true", help="Skip baseline status/created/tags fields")
    p.add_argument("--force", action="store_true", help="Overwrite existing file")
    args = p.parse_args()

    vault = Path(args.vault).resolve()
    if not vault.is_dir():
        print(f"ERROR: not a directory: {vault}", file=sys.stderr)
        return 2

    type_value = args.type_value or args.entity
    label = args.label or " ".join(w.capitalize() for w in args.entity.split("-"))
    out = Path(args.output) if args.output else (vault / "00-CORE/Schemas/source" / f"{args.entity}.yaml")

    if out.exists() and not args.force:
        print(f"ERROR: file exists (use --force to overwrite): {out}", file=sys.stderr)
        return 1

    schema = build_schema(
        vault=vault,
        entity=args.entity,
        type_value=type_value,
        label=label,
        location_pattern=args.location_pattern,
        domain=args.domain,
        include_baseline=not args.no_baseline,
    )

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        yaml.dump(schema, sort_keys=False, default_flow_style=False, allow_unicode=True),
        encoding="utf-8",
    )
    n_fields = len(schema["fields"])
    print(f"Wrote {out.name}: {n_fields} fields (deduped), domain={args.domain or '(none)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Per-entity decision analyzer for the `guided-optimize` route.

For one entity, emits the three decision proposals as JSON:
  A. Field expansion — fields present on ≥30% of notes, not in YAML
  B. Enum tightening — string fields whose value distribution now suggests an enum
  C. Required promotion — fields with ≥95% presence not marked required

The agent reads this JSON, presents one decision at a time to the user, and applies the
accepted changes back to the YAML source via --apply mode.

Usage:
    uv run guided_optimize.py --vault <path> --entity <slug> --analyze
    uv run guided_optimize.py --vault <path> --entity <slug> --apply \\
        --add-fields fieldA,fieldB --add-enum status --mark-required client_id
"""
import argparse
import json
import sys
from collections import OrderedDict
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from frontmatter_census import census  # noqa: E402

ENUM_MAX_CARDINALITY = 12
ENUM_DISTINCT_RATIO = 0.15
REQUIRED_PROMOTE_RATIO = 0.95


def load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text()) or {}


def write_yaml(path: Path, data: dict) -> None:
    path.write_text(
        yaml.dump(data, sort_keys=False, default_flow_style=False, allow_unicode=True),
        encoding="utf-8",
    )


def analyze(vault: Path, entity: str) -> dict:
    src = vault / "00-CORE/Schemas/source" / f"{entity}.yaml"
    if not src.exists():
        return {"error": f"no YAML source for entity '{entity}' at {src}"}

    schema = load_yaml(src)
    declared: dict[str, dict] = {}
    for f in schema.get("fields", []) or []:
        if isinstance(f, dict) and "name" in f:
            declared[f["name"]] = f

    cen = census(vault, min_count=1)
    ent = cen["entities"].get(entity, {})
    observed = ent.get("fields", {})
    note_count = ent.get("count", 0)

    # Decision A — field expansion
    expansion = []
    for fname, finfo in observed.items():
        if fname.startswith("_") or fname in {"type", "tags", "modified"}:
            continue
        if fname not in declared and finfo["presence_ratio"] >= 0.30:
            expansion.append({
                "name": fname,
                "presence_ratio": finfo["presence_ratio"],
                "kind": finfo["kind"],
                "rationale": (
                    f"present on {finfo['presence']}/{note_count} notes "
                    f"({int(finfo['presence_ratio']*100)}%); not declared in YAML"
                ),
            })
    expansion.sort(key=lambda x: -x["presence_ratio"])

    # Decision B — enum tightening
    enum_proposals = []
    for fname, fdecl in declared.items():
        if fdecl.get("enum"):
            continue
        finfo = observed.get(fname)
        if not finfo or finfo["kind"] != "string":
            continue
        distinct = finfo.get("distinct_values") or []
        if not distinct:
            continue
        total = finfo["presence"]
        if total > 0 and len(distinct) <= ENUM_MAX_CARDINALITY and (len(distinct) / total) < ENUM_DISTINCT_RATIO:
            enum_proposals.append({
                "name": fname,
                "proposed_enum": sorted(v for v in distinct if v),
                "rationale": f"{len(distinct)} distinct values over {total} notes",
            })

    # Decision C — required promotion
    required_proposals = []
    for fname, fdecl in declared.items():
        if fdecl.get("required"):
            continue
        finfo = observed.get(fname)
        if not finfo:
            continue
        if finfo["presence_ratio"] >= REQUIRED_PROMOTE_RATIO:
            required_proposals.append({
                "name": fname,
                "presence_ratio": finfo["presence_ratio"],
                "rationale": f"{int(finfo['presence_ratio']*100)}% presence — effectively universal",
            })

    return {
        "entity": entity,
        "note_count": note_count,
        "declared_field_count": len(declared),
        "decisions": {
            "expansion": expansion,
            "enum_tightening": enum_proposals,
            "required_promotion": required_proposals,
        },
        "yaml_path": str(src),
    }


def apply(
    vault: Path,
    entity: str,
    add_fields: list[str],
    add_enum: list[str],
    mark_required: list[str],
) -> dict:
    src = vault / "00-CORE/Schemas/source" / f"{entity}.yaml"
    if not src.exists():
        return {"error": f"no YAML source for entity '{entity}'"}

    schema = load_yaml(src)
    fields = schema.get("fields", []) or []
    by_name: OrderedDict[str, dict] = OrderedDict()
    for f in fields:
        if isinstance(f, dict) and "name" in f:
            by_name[f["name"]] = f

    cen = census(vault, min_count=1)
    observed = cen["entities"].get(entity, {}).get("fields", {})

    actions = {"added": [], "enum_added": [], "required_promoted": []}

    # Add new fields
    for fname in add_fields:
        if fname in by_name:
            continue
        info = observed.get(fname)
        if not info:
            continue
        f = {"name": fname}
        if info["kind"] == "date":
            f["type"] = "string"; f["format"] = "date"
        elif info["kind"] in ("integer", "number", "boolean"):
            f["type"] = info["kind"]
        elif info["kind"] in ("array", "array<wikilink>"):
            f["type"] = "array"
        else:
            f["type"] = "string"
        if info["kind"] == "enum" and info.get("distinct_values"):
            f["enum"] = sorted(v for v in info["distinct_values"] if v)
        by_name[fname] = f
        actions["added"].append(fname)

    # Add enum to existing field
    for fname in add_enum:
        if fname not in by_name:
            continue
        info = observed.get(fname)
        if not info or not info.get("distinct_values"):
            continue
        by_name[fname]["enum"] = sorted(v for v in info["distinct_values"] if v)
        actions["enum_added"].append(fname)

    # Promote to required
    for fname in mark_required:
        if fname not in by_name:
            continue
        by_name[fname]["required"] = True
        actions["required_promoted"].append(fname)

    schema["fields"] = list(by_name.values())
    write_yaml(src, schema)
    return {"entity": entity, "actions": actions, "yaml_path": str(src)}


def main() -> int:
    p = argparse.ArgumentParser(
        description="Guided-optimize per-entity helper: analyze proposals OR apply accepted decisions to YAML.",
        epilog=(
            "Example: uv run guided_optimize.py --vault . --entity client --analyze\n"
            "         uv run guided_optimize.py --vault . --entity client --apply "
            "--add-fields next_review_date --mark-required client_id"
        ),
    )
    p.add_argument("--vault", required=True, help="Absolute path to vault root")
    p.add_argument("--entity", required=True, help="Entity slug (must have an existing YAML source file)")
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--analyze", action="store_true", help="Emit decision proposals as JSON")
    mode.add_argument("--apply", action="store_true", help="Apply accepted decisions to YAML source")
    p.add_argument("--add-fields", default="", help="Comma-separated field names to add (Decision A)")
    p.add_argument("--add-enum", default="", help="Comma-separated existing-field names to convert to enum (Decision B)")
    p.add_argument("--mark-required", default="", help="Comma-separated existing-field names to mark required (Decision C)")
    args = p.parse_args()

    vault = Path(args.vault).resolve()
    if not vault.is_dir():
        print(f"ERROR: not a directory: {vault}", file=sys.stderr)
        return 2

    if args.analyze:
        result = analyze(vault, args.entity)
        print(json.dumps(result, indent=2, default=str))
        return 0 if "error" not in result else 1

    if args.apply:
        add = [s.strip() for s in args.add_fields.split(",") if s.strip()]
        enum = [s.strip() for s in args.add_enum.split(",") if s.strip()]
        req = [s.strip() for s in args.mark_required.split(",") if s.strip()]
        if not (add or enum or req):
            print("ERROR: --apply needs at least one of --add-fields / --add-enum / --mark-required", file=sys.stderr)
            return 2
        result = apply(vault, args.entity, add, enum, req)
        print(json.dumps(result, indent=2))
        return 0 if "error" not in result else 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Recursively scan a vault, group notes by `type:` frontmatter value, build per-type field inventory.

Infers field types using value sampling. Detects enum candidates via distinct/total ratio.

Usage:
    uv run frontmatter_census.py --vault <path> [--output <json>] [--min-count N]
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")
SKIP_DIRS = {".obsidian", ".git", "node_modules", "99-TMP", "_archive"}

# Enum heuristic
ENUM_MAX_CARDINALITY = 12
ENUM_DISTINCT_RATIO = 0.15
REQUIRED_THRESHOLD = 0.90


def extract_frontmatter(path: Path) -> dict | None:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None
    m = FM_RE.match(text)
    if not m:
        return None
    try:
        return yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return None


def value_kind(value) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, list):
        if all(isinstance(x, str) and x.startswith("[[") for x in value if x):
            return "array<wikilink>"
        return "array"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, str):
        if DATE_RE.match(value):
            return "date"
        if value.startswith("[[") and value.endswith("]]"):
            return "wikilink"
    return "string"


def walk_vault(vault: Path):
    for p in vault.rglob("*.md"):
        parts = set(p.relative_to(vault).parts)
        if parts & SKIP_DIRS:
            continue
        if p.name.startswith("_") and p.name != "_index.md":
            continue
        yield p


def census(vault: Path, min_count: int = 3) -> dict:
    notes_by_type: dict[str, list[dict]] = defaultdict(list)
    folder_by_type: dict[str, Counter] = defaultdict(Counter)
    total_notes = 0
    untyped = 0

    for md in walk_vault(vault):
        fm = extract_frontmatter(md)
        total_notes += 1
        if not fm or "type" not in fm:
            untyped += 1
            continue
        t = str(fm["type"]).strip()
        if not t:
            untyped += 1
            continue
        notes_by_type[t].append({"path": str(md.relative_to(vault)), "fm": fm})
        parent = str(md.relative_to(vault).parent)
        folder_by_type[t][parent] += 1

    # Build per-type inventory
    entities = {}
    for t, notes in notes_by_type.items():
        count = len(notes)
        if count < min_count:
            entities[t] = {"count": count, "below_threshold": True, "skip": True}
            continue

        # Field inventory
        field_presence: Counter = Counter()
        field_values: dict[str, list] = defaultdict(list)
        field_kinds: dict[str, Counter] = defaultdict(Counter)

        for n in notes:
            for k, v in n["fm"].items():
                if k == "type":
                    continue
                field_presence[k] += 1
                if len(field_values[k]) < 50:
                    field_values[k].append(v)
                field_kinds[k][value_kind(v)] += 1

        fields = {}
        for k, presence in field_presence.items():
            kind = field_kinds[k].most_common(1)[0][0]
            samples = field_values[k]
            # Enum detection
            scalar_samples = [str(s) for s in samples if not isinstance(s, (list, dict))]
            distinct = set(scalar_samples)
            is_enum = (
                kind == "string"
                and len(distinct) <= ENUM_MAX_CARDINALITY
                and len(scalar_samples) > 0
                and (len(distinct) / len(scalar_samples)) < ENUM_DISTINCT_RATIO
            )
            fields[k] = {
                "kind": "enum" if is_enum else kind,
                "presence": presence,
                "presence_ratio": round(presence / count, 2),
                "required": (presence / count) >= REQUIRED_THRESHOLD,
                "distinct_values": sorted(distinct) if is_enum else None,
            }

        # Dominant folder
        dominant_folder, dominant_n = folder_by_type[t].most_common(1)[0]

        entities[t] = {
            "count": count,
            "below_threshold": False,
            "dominant_folder": dominant_folder,
            "dominant_folder_share": round(dominant_n / count, 2),
            "folder_distribution": dict(folder_by_type[t].most_common(5)),
            "fields": fields,
        }

    return {
        "vault": str(vault),
        "total_notes": total_notes,
        "untyped_notes": untyped,
        "typed_notes": total_notes - untyped,
        "distinct_types": len(notes_by_type),
        "entities_above_threshold": sum(1 for e in entities.values() if not e.get("skip")),
        "min_count_threshold": min_count,
        "entities": entities,
    }


def main() -> int:
    p = argparse.ArgumentParser(
        description="Census all notes in a vault, group by frontmatter `type:`, infer field shapes per entity.",
        epilog="Example: uv run frontmatter_census.py --vault /home/me/my-vault --output /tmp/census.json",
    )
    p.add_argument("--vault", required=True, help="Absolute path to the vault root")
    p.add_argument("--output", help="Path to write JSON output; stdout if omitted")
    p.add_argument("--min-count", type=int, default=3, help="Minimum note count to treat a type as an entity (default 3)")
    args = p.parse_args()

    vault = Path(args.vault).resolve()
    if not vault.is_dir():
        print(f"ERROR: not a directory: {vault}", file=sys.stderr)
        return 2

    result = census(vault, min_count=args.min_count)
    out = json.dumps(result, indent=2, default=str)
    if args.output:
        Path(args.output).write_text(out, encoding="utf-8")
        print(
            f"Wrote census: {result['entities_above_threshold']} entities (≥{args.min_count} notes) "
            f"from {result['typed_notes']} typed notes → {args.output}"
        )
    else:
        print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())

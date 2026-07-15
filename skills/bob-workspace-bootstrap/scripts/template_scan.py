#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Scan a templates folder and extract per-template frontmatter shapes.

Usage:
    uv run template_scan.py --templates-dir <path> [--output <json>]
"""
import argparse
import json
import re
import sys
from pathlib import Path

import yaml

FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def extract_frontmatter(path: Path) -> dict | None:
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return None
    m = FM_RE.match(text)
    if not m:
        return None
    try:
        return yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return None


def infer_field_type(value) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, str):
        if re.match(r"^\d{4}-\d{2}-\d{2}", value):
            return "date"
        if value.startswith("[[") and value.endswith("]]"):
            return "wikilink"
    return "string"


def scan(templates_dir: Path) -> dict:
    templates = {}
    for md in templates_dir.rglob("*.md"):
        if md.name.startswith("_") or md.name.startswith("."):
            continue
        fm = extract_frontmatter(md)
        if not fm:
            continue
        fields = {}
        for k, v in fm.items():
            fields[k] = {
                "type": infer_field_type(v),
                "default": v if not isinstance(v, (dict, list)) else None,
            }
        templates[md.stem] = {
            "path": str(md),
            "type_declared": fm.get("type"),
            "fields": fields,
        }
    return {"templates_dir": str(templates_dir), "count": len(templates), "templates": templates}


def main() -> int:
    p = argparse.ArgumentParser(
        description="Scan templates folder and extract per-template frontmatter shapes.",
        epilog="Example: uv run template_scan.py --templates-dir 00-CORE/Templates --output /tmp/templates.json",
    )
    p.add_argument("--templates-dir", required=True, help="Path to templates folder (e.g. 00-CORE/Templates)")
    p.add_argument("--output", help="Path to write JSON output; stdout if omitted")
    args = p.parse_args()

    templates_dir = Path(args.templates_dir)
    if not templates_dir.is_dir():
        print(f"ERROR: not a directory: {templates_dir}", file=sys.stderr)
        return 2

    result = scan(templates_dir)
    out = json.dumps(result, indent=2, default=str)
    if args.output:
        Path(args.output).write_text(out, encoding="utf-8")
        print(f"Wrote {result['count']} templates → {args.output}")
    else:
        print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())

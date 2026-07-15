#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Executable for the `extend` route.

Two modes:
  --propose : detect coverage gap (vault entities vs existing YAML source), write a markdown
              merge report to 99-TMP/OUTPUT/. No writes elsewhere.
  --execute : write YAML source files for the entities listed in --entities. Refuses to
              overwrite existing YAML. Does NOT touch workspace.json — UI composition is
              owned by the bob-workspace-compose skill / the plugin's Apply-template command.

Folder-to-domain mapping uses references/domain_detection.md heuristic (numbered BOB
folders → domain slug).

Usage:
    uv run extend.py --vault <path> --propose
    uv run extend.py --vault <path> --execute --entities entityA,entityB \
        --location-pattern entityA=20-COMPANY/X/,entityB=30-CLIENTS/{client-id}/Y/
"""
import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from frontmatter_census import census  # noqa: E402

DOMAIN_PREFIXES = [
    ("20-COMPANY/06-FINANCE", "finance"),
    ("20-COMPANY/55-LEADS", "sales"),
    ("20-COMPANY/60-SALES", "sales"),
    ("20-COMPANY/50-MARKETING", "marketing-content"),
    ("20-COMPANY/05-HR", "hr"),
    ("20-COMPANY/35-PARTNERS", "partners"),
    ("20-COMPANY/30-SUPPLIERS", "suppliers"),
    ("20-COMPANY/01-QMS", "quality"),
    ("20-COMPANY/02-DECISIONS", "decisions"),
    ("20-COMPANY/03-PROCESSES", "processes"),
    ("20-COMPANY/04-LEGAL", "legal"),
    ("20-COMPANY/07-KNOWLEDGE-BASE", "knowledge-base"),
    ("20-COMPANY/40-PRODUCTS", "products"),
    ("20-COMPANY/80-MANAGEMENT", "management"),
    ("30-CLIENTS/", "clients-delivery"),
    ("40-RESOURCES/", "knowledge-base"),
    ("10-ME/", "personal"),
    ("00-CORE/TaskNotes", "tasks"),
]


def domain_for(folder: str) -> str:
    for prefix, dom in DOMAIN_PREFIXES:
        if folder.startswith(prefix):
            return dom
    return "general"


def load_existing_yaml(src_dir: Path) -> dict[str, dict]:
    out = {}
    for f in src_dir.glob("*.yaml"):
        try:
            d = yaml.safe_load(f.read_text()) or {}
            if "entity" in d:
                out[d["entity"]] = {
                    "type_value": d.get("type_value", d["entity"]),
                    "fields": {fld["name"] for fld in d.get("fields", []) if isinstance(fld, dict)},
                    "path": str(f),
                }
        except Exception as e:
            print(f"WARN: cannot parse {f}: {e}", file=sys.stderr)
    return out


def bucket(n: int) -> str:
    if n >= 100:
        return "high-volume"
    if n >= 20:
        return "medium"
    if n >= 10:
        return "low"
    if n >= 3:
        return "marginal"
    return "tiny"


def propose(vault: Path, output: Path) -> dict:
    src = vault / "00-CORE/Schemas/source"
    existing = load_existing_yaml(src) if src.is_dir() else {}
    existing_types = set()
    for ent, info in existing.items():
        existing_types.add(ent)
        existing_types.add(info["type_value"])

    cen = census(vault, min_count=1)
    detected = {t: e for t, e in cen["entities"].items() if e.get("count", 0) >= 3}

    covered = sorted(t for t in detected if t in existing_types)
    uncovered = sorted(
        (t for t in detected if t not in existing_types),
        key=lambda t: -detected[t]["count"],
    )

    # Field drift on covered entities
    drift = {}
    for t in covered:
        ent_info = existing.get(t) or existing.get(detected[t].get("type_value", t))
        if not ent_info:
            continue
        declared = ent_info["fields"]
        observed = {f for f, finfo in detected[t]["fields"].items() if finfo["presence_ratio"] >= 0.30}
        new_fields = sorted(observed - declared)
        if new_fields:
            drift[t] = new_fields

    # Bucket uncovered
    buckets: dict[str, list[tuple[str, int, str]]] = {
        "high-volume": [], "medium": [], "low": [], "marginal": [],
    }
    for t in uncovered:
        e = detected[t]
        buckets[bucket(e["count"])].append((t, e["count"], e["dominant_folder"]))

    date = dt.date.today().isoformat()
    lines = [
        "---",
        "type: research",
        "research_type: extend-merge",
        f"research_date: {date}",
        f"created: {date}",
        "status: draft",
        "tags: [bob-workspace, extend, merge]",
        f"title: \"BOB Workspace Extend — Merge Report {date}\"",
        "---",
        "",
        "# BOB Workspace Extend — Merge Report",
        "",
        f"**Vault**: `{vault}`",
        f"**Existing YAML source files**: {len(existing)}",
        f"**Covered entities** (YAML + ≥3 notes): {len(covered)}",
        f"**Uncovered entities** (≥3 notes, no YAML): {len(uncovered)}",
        f"**Field drift on covered** (≥30% presence, missing from YAML): {len(drift)}",
        "",
        "## Action map",
        "",
        "| Bucket | Count | Default |",
        "|--------|-------|---------|",
    ]
    for b in ("high-volume", "medium", "low", "marginal"):
        action = {"high-volume": "write YAML", "medium": "write YAML",
                  "low": "review", "marginal": "likely skip"}[b]
        lines.append(f"| {b} (note thresholds) | {len(buckets[b])} | {action} |")

    for b, label in [("high-volume", "High-volume (≥100 notes)"),
                     ("medium", "Medium (20-99)"),
                     ("low", "Low (10-19)"),
                     ("marginal", "Marginal (3-9)")]:
        if not buckets[b]:
            continue
        lines += ["", f"## Uncovered — {label}", "",
                  "| type | notes | dominant folder | proposed domain |",
                  "|------|-------|-----------------|-----------------|"]
        for t, n, f in buckets[b]:
            lines.append(f"| `{t}` | {n} | `{f}` | {domain_for(f)} |")

    if drift:
        lines += ["", "## Field drift on covered entities (advisory — run guided-optimize)", "",
                  "| entity | new fields seen in notes |", "|--------|--------------------------|"]
        for t, fs in sorted(drift.items()):
            lines.append(f"| `{t}` | {', '.join('`'+f+'`' for f in fs)} |")

    lines += ["", "## Next step",
              "",
              "After review, run --execute with --entities listing the slugs you want YAML for. ",
              "Defaults to high-volume + medium when the agent invokes it without explicit selection."]

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")
    return {
        "report": str(output),
        "covered": len(covered),
        "uncovered_by_bucket": {b: len(v) for b, v in buckets.items()},
        "drift_entities": len(drift),
    }


def execute(vault: Path, entities: list[str], location_overrides: dict[str, str]) -> dict:
    src = vault / "00-CORE/Schemas/source"
    src.mkdir(parents=True, exist_ok=True)
    cen = census(vault, min_count=1)
    generate_script = Path(__file__).parent / "generate_yaml.py"

    written = []
    skipped = []
    for ent in entities:
        if (src / f"{ent}.yaml").exists():
            skipped.append((ent, "exists"))
            continue
        e = cen["entities"].get(ent)
        if not e:
            skipped.append((ent, "not in census"))
            continue
        loc = location_overrides.get(ent) or e.get("dominant_folder", "").rstrip("/") + "/"
        domain = domain_for(e.get("dominant_folder", ""))
        label = " ".join(w.capitalize() for w in ent.split("-"))
        cmd = [
            "uv", "run", str(generate_script),
            "--vault", str(vault),
            "--entity", ent,
            "--label", label,
            "--location-pattern", loc,
            "--domain", domain,
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0:
            written.append(ent)
        else:
            skipped.append((ent, r.stderr.strip().splitlines()[-1] if r.stderr else "error"))
    return {"written": written, "skipped": skipped}


def parse_overrides(s: str) -> dict[str, str]:
    out = {}
    if not s:
        return out
    for part in s.split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def main() -> int:
    p = argparse.ArgumentParser(
        description="Extend route: propose coverage gap report OR execute YAML writes for selected uncovered entities.",
        epilog=(
            "Example: uv run extend.py --vault . --propose\n"
            "         uv run extend.py --vault . --execute --entities issue,skill-doc"
        ),
    )
    p.add_argument("--vault", required=True, help="Absolute path to vault root")
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--propose", action="store_true", help="Write merge report to 99-TMP/OUTPUT/; no other writes")
    mode.add_argument("--execute", action="store_true", help="Write YAML for the listed entities via generate_yaml.py")
    p.add_argument("--entities", help="Comma-separated entity slugs to write (required with --execute)")
    p.add_argument(
        "--location-pattern",
        dest="location_patterns",
        help="Override location patterns. Format: entityA=20-COMPANY/X/,entityB=30-CLIENTS/{client-id}/Y/",
    )
    p.add_argument("--output", help="Output path for --propose (default: 99-TMP/OUTPUT/bob-workspace-bootstrap-merge.md)")
    args = p.parse_args()

    vault = Path(args.vault).resolve()
    if not vault.is_dir():
        print(f"ERROR: not a directory: {vault}", file=sys.stderr)
        return 2

    if args.propose:
        out = Path(args.output) if args.output else vault / "99-TMP/OUTPUT/bob-workspace-bootstrap-merge.md"
        result = propose(vault, out)
        print(json.dumps(result, indent=2))
        return 0

    if args.execute:
        if not args.entities:
            print("ERROR: --execute requires --entities", file=sys.stderr)
            return 2
        ents = [e.strip() for e in args.entities.split(",") if e.strip()]
        overrides = parse_overrides(args.location_patterns or "")
        result = execute(vault, ents, overrides)
        print(json.dumps(result, indent=2))
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())

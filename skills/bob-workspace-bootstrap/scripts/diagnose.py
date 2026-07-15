#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Compare vault reality against the current BOB Workspace UI state. Write a priority-tiered gap report.

Read-only — writes nothing outside 99-TMP/OUTPUT/.

Usage:
    uv run diagnose.py --vault <path> [--output <md>]
"""
import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

import yaml

# Reuse census logic
sys.path.insert(0, str(Path(__file__).parent))
from frontmatter_census import census  # noqa: E402

FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def load_workspace_json(vault: Path) -> dict | None:
    p = vault / ".obsidian" / "plugins" / "bob-workspace" / "workspace.json"
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def load_fileclasses(vault: Path) -> dict[str, dict]:
    out = {}
    for base in (
        vault / ".obsidian" / "plugins" / "metadata-menu" / "fileClasses",
        vault / "00-CORE" / "Schemas" / "fileClasses",
    ):
        if not base.is_dir():
            continue
        for md in base.glob("*.md"):
            text = md.read_text(encoding="utf-8", errors="replace")
            m = FM_RE.match(text)
            if not m:
                continue
            try:
                fm = yaml.safe_load(m.group(1)) or {}
            except yaml.YAMLError:
                continue
            field_names = set()
            for f in fm.get("fields") or []:
                if isinstance(f, dict) and "name" in f:
                    field_names.add(f["name"])
            out[md.stem] = {"path": str(md), "fields": field_names}
    return out


def diagnose(vault: Path) -> dict:
    cen = census(vault, min_count=1)
    ws = load_workspace_json(vault)
    fcs = load_fileclasses(vault)

    findings = []
    ws_types = set()
    ws_domains = []
    if ws:
        for d in ws.get("domains", []):
            ws_domains.append(d.get("id"))
            for e in d.get("entries", []):
                if "type" in e:
                    ws_types.add(e["type"])

    typed_entities = {t: e for t, e in cen["entities"].items() if not e.get("skip")}

    # P1: entity in vault, missing from UI
    for t, e in typed_entities.items():
        if ws is not None and t not in ws_types:
            findings.append({
                "tier": "P1",
                "category": "entity_missing_from_ui",
                "entity": t,
                "detail": f"{e['count']} notes, dominant folder `{e['dominant_folder']}`",
                "remediation": "run bob-workspace-bootstrap extend",
            })

    # P2: field in notes, missing from fileClass
    for t, e in typed_entities.items():
        if t not in fcs:
            continue
        declared = fcs[t]["fields"]
        for fname, finfo in e["fields"].items():
            if fname not in declared and finfo["presence_ratio"] >= 0.30:
                findings.append({
                    "tier": "P2",
                    "category": "field_missing_from_fileclass",
                    "entity": t,
                    "field": fname,
                    "detail": f"present on {finfo['presence']}/{e['count']} notes ({int(finfo['presence_ratio']*100)}%)",
                    "remediation": "run guided-optimize to accept the field",
                })

    # P3: UI entry, no data
    if ws is not None:
        for t in ws_types:
            if t not in cen["entities"] or cen["entities"][t].get("count", 0) == 0:
                findings.append({
                    "tier": "P3",
                    "category": "ui_entry_no_data",
                    "entity": t,
                    "detail": "workspace.json exposes type, vault has 0 matching notes",
                    "remediation": "remove entry from workspace.json or backfill notes",
                })

    # P3: unused fileClass field
    for t, fc in fcs.items():
        if t not in typed_entities:
            continue
        observed = set(typed_entities[t]["fields"].keys())
        for declared in fc["fields"]:
            if declared not in observed:
                findings.append({
                    "tier": "P3",
                    "category": "unused_fileclass_field",
                    "entity": t,
                    "field": declared,
                    "detail": "declared in fileClass, set on 0 notes",
                    "remediation": "delete from fileClass or document why it's reserved",
                })

    findings.sort(key=lambda f: (f["tier"], f["category"], f.get("entity", "")))
    summary = {
        "P1": sum(1 for f in findings if f["tier"] == "P1"),
        "P2": sum(1 for f in findings if f["tier"] == "P2"),
        "P3": sum(1 for f in findings if f["tier"] == "P3"),
    }
    return {
        "vault": str(vault),
        "workspace_present": ws is not None,
        "fileclasses_count": len(fcs),
        "entities_count": len(typed_entities),
        "summary": summary,
        "findings": findings,
    }


def render_markdown(report: dict) -> str:
    date = dt.date.today().isoformat()
    s = report["summary"]
    lines = [
        "---",
        "type: research",
        "research_type: workspace-diagnostic",
        f"research_date: {date}",
        "status: final",
        "tags: [bob-workspace, diagnostic]",
        f"title: \"BOB Workspace Diagnostic — {date}\"",
        f"created: {date}",
        "---",
        "",
        "# BOB Workspace — Coverage Diagnostic",
        "",
        f"**Vault**: `{report['vault']}`",
        f"**workspace.json present**: {'yes' if report['workspace_present'] else 'no'}",
        f"**fileClasses found**: {report['fileclasses_count']}",
        f"**Entities (≥1 note)**: {report['entities_count']}",
        "",
        "## Summary",
        f"- P1 findings: {s['P1']} (data invisible to user)",
        f"- P2 findings: {s['P2']} (declared but drifted)",
        f"- P3 findings: {s['P3']} (cleanup)",
        "",
    ]
    for tier in ("P1", "P2", "P3"):
        tier_findings = [f for f in report["findings"] if f["tier"] == tier]
        if not tier_findings:
            continue
        label = {"P1": "Data invisible to user", "P2": "Declared but drifted", "P3": "Cleanup"}[tier]
        lines.append(f"## {tier} — {label} ({len(tier_findings)})")
        lines.append("")
        for f in tier_findings:
            head = f["entity"]
            if "field" in f:
                head += f".{f['field']}"
            lines.append(f"### `{head}` — {f['category'].replace('_', ' ')}")
            lines.append(f"- {f['detail']}")
            lines.append(f"- Remediation: `{f['remediation']}`")
            lines.append("")
    return "\n".join(lines)


def main() -> int:
    p = argparse.ArgumentParser(
        description="Compare vault reality vs BOB Workspace UI state; emit priority-tiered gap report.",
        epilog="Example: uv run diagnose.py --vault /home/me/my-vault --output 99-TMP/OUTPUT/diagnose.md",
    )
    p.add_argument("--vault", required=True, help="Absolute path to the vault root")
    p.add_argument("--output", help="Output markdown path; defaults to 99-TMP/OUTPUT/bob-workspace-diagnose-{date}.md")
    args = p.parse_args()

    vault = Path(args.vault).resolve()
    if not vault.is_dir():
        print(f"ERROR: not a directory: {vault}", file=sys.stderr)
        return 2

    report = diagnose(vault)
    md = render_markdown(report)

    if args.output:
        out_path = Path(args.output)
    else:
        date = dt.date.today().isoformat()
        out_path = vault / "99-TMP" / "OUTPUT" / f"bob-workspace-diagnose-{date}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(md, encoding="utf-8")

    s = report["summary"]
    print(f"{s['P1']+s['P2']+s['P3']} findings (P1: {s['P1']}, P2: {s['P2']}, P3: {s['P3']}). Report at {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

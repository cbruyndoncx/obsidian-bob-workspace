#!/usr/bin/env python3
"""Restore missing Base files recorded by a BOB template-switch journal.

The plugin writes ``template-switch-*.json`` before archiving outgoing assets.
It seeds the new template's schemas and regenerates derived schema output.
This helper needs no brncx-skills vault scripts, context pack, or Python packages.

Usage:
    python3 recover_after_apply.py --vault /path/to/vault --dry-run
    python3 recover_after_apply.py --vault /path/to/vault
"""

import argparse
import json
import shutil
from pathlib import Path


def inside_vault(vault: Path, relative: str) -> Path:
    path = Path(relative)
    if path.is_absolute():
        raise ValueError(f"expected a vault-relative path: {relative}")
    resolved = (vault / path).resolve()
    if not resolved.is_relative_to(vault):
        raise ValueError(f"journal path leaves vault: {relative}")
    return resolved


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", required=True, help="Obsidian vault root")
    parser.add_argument("--journal", help="Specific template-switch journal (defaults to latest)")
    parser.add_argument("--dry-run", action="store_true", help="show missing Bases without copying")
    args = parser.parse_args()

    vault = Path(args.vault).resolve()
    plugin_dir = vault / ".obsidian/plugins/bob-workspace"
    if not plugin_dir.is_dir():
        parser.error("BOB Workspace plugin folder is missing from the selected vault")
    journals = sorted(plugin_dir.glob("template-switch-*.json"), key=lambda p: p.stat().st_mtime)
    journal = Path(args.journal).resolve() if args.journal else (journals[-1] if journals else None)
    if not journal or not journal.is_file() or not journal.is_relative_to(plugin_dir.resolve()):
        parser.error("no valid template-switch journal found in the plugin folder")

    data = json.loads(journal.read_text(encoding="utf-8"))
    moves = data.get("moves") or []
    if not isinstance(moves, list):
        parser.error("journal moves must be an array")
    restored = 0
    for move in moves:
        if not isinstance(move, dict):
            continue
        from_name, to_name = move.get("from"), move.get("to")
        if not isinstance(from_name, str) or not isinstance(to_name, str) or not from_name.lower().endswith(".base"):
            continue
        target = inside_vault(vault, from_name)
        archived = inside_vault(vault, to_name)
        if target.exists() or not archived.is_file():
            continue
        print(f"{'Would restore' if args.dry_run else 'Restoring'} {target.relative_to(vault)} from {archived.relative_to(vault)}")
        if not args.dry_run:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(archived, target)
        restored += 1
    print(f"{restored} missing Base file(s) {'found' if args.dry_run else 'restored'} from {journal.name}")
    if restored and not args.dry_run:
        print("Reload BOB Workspace. Use its Data model > Regenerate action if schema outputs also need repair.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Recover the vault after a BOB Workspace template apply.

Applying a workspace template (Settings -> BOB Workspace -> "Apply workspace
template...") ARCHIVES the live `00-CORE/Bases/` and `00-CORE/Schemas/` dirs to
`00-CORE/Bases-archive-bob-workspace-<ts>/` and does NOT regenerate them. That
empties them and breaks every base-backed widget + frontmatter validation
vault-wide until restored. This script restores both:

  - Bases   : copies missing .base files from the newest non-empty Bases archive
  - Schemas : regenerates source/json-schema/fileClasses from DATAMODEL-FULL.md

Idempotent: if Bases/Schemas are already healthy it changes nothing (just reports).
Run it after any template apply, or whenever base widgets show "not found".

Usage:
  uv run recover_after_apply.py --vault .            # restore
  uv run recover_after_apply.py --vault . --dry-run  # report only
"""
from __future__ import annotations
import argparse
import subprocess
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Restore Bases + Schemas after a BOB Workspace template apply.",
        epilog="Example: uv run recover_after_apply.py --vault . --dry-run")
    ap.add_argument("--vault", default=".", help="vault root (default: current dir)")
    ap.add_argument("--dry-run", action="store_true", help="report only; change nothing")
    args = ap.parse_args()
    V = Path(args.vault).resolve()

    bases = V / "00-CORE" / "Bases"
    live_n = len(list(bases.glob("*.base"))) if bases.exists() else 0
    print(f"Live 00-CORE/Bases/: {live_n} .base file(s)")

    archives = sorted(
        (d for d in (V / "00-CORE").glob("Bases-archive-bob-workspace-*")
         if d.is_dir() and any(d.glob("*.base"))),
        key=lambda d: d.name, reverse=True)

    if not archives:
        if live_n:
            print("  No archive found and Bases populated -> nothing to restore (healthy).")
        else:
            print("  WARNING: Bases empty and NO archive to restore from -> "
                  "re-run bob-workspace-bootstrap to regenerate from the datamodel.")
    else:
        src = archives[0]
        missing = [p for p in src.glob("*.base") if not (bases / p.name).exists()]
        print(f"  Newest archive: {src.name} ({len(list(src.glob('*.base')))} .base)")
        print(f"  {'would restore' if args.dry_run else 'restoring'} "
              f"{len(missing)} missing .base file(s)")
        if not args.dry_run and missing:
            bases.mkdir(parents=True, exist_ok=True)
            for p in missing:
                (bases / p.name).write_bytes(p.read_bytes())
            print(f"  restored {len(missing)} file(s) to 00-CORE/Bases/")

    js = V / "00-CORE" / "Schemas" / "json-schema"
    js_n = len(list(js.glob("*.json"))) if js.exists() else 0
    print(f"Live 00-CORE/Schemas/json-schema/: {js_n} schema(s)")
    regen = V / "00-CORE" / "Schemas" / "regenerate.py"
    if regen.exists():
        cmd = ["uv", "run", str(regen),
               "--bootstrap-from-datamodel", "--write-source", "--write"]
        if args.dry_run:
            print("  would regenerate schemas: regenerate.py --bootstrap-from-datamodel "
                  "--write-source --write")
        else:
            print("  regenerating schemas from DATAMODEL-FULL...")
            r = subprocess.run(cmd, cwd=str(V), capture_output=True, text=True)
            tail = (r.stdout.strip().splitlines() or ["(no output)"])[-1]
            print(f"    {tail}")
    else:
        print("  WARNING: 00-CORE/Schemas/regenerate.py not found.")

    print("\nDone. Reload Obsidian; base-backed widgets and validation should resolve.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

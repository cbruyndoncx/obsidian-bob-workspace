#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Safely replace a BOB Workspace `workspace.json` with new content.

The single mutation path for the bob-workspace-compose skill. Guarantees the
non-negotiable safety contract: VALIDATE new content -> TIMESTAMP-BACKUP the
target -> ATOMIC write -> RE-VALIDATE on disk. If the new content fails
validation the target is never touched, so a broken compose can never clobber a
working, hand-tuned workspace.json.

The caller (the skill / agent) is responsible for producing the merged new
content as a complete workspace.json object. This script does NOT merge — it
only writes safely. Merge-preserving is enforced by the workflow, written here.

Usage:
    uv run safe_write.py --target <workspace.json> --source <new-content.json>
    uv run safe_write.py --target <workspace.json> --source - < new.json   # stdin
    uv run safe_write.py --target <path> --source <new.json> --strict   # reject on warnings too

Exit codes: 0 = written, 1 = validation failed (target untouched), 2 = bad args.
"""
import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

VALIDATOR = Path(__file__).with_name("validate_workspace.py")


def _validate(path: Path, strict: bool) -> tuple[bool, str]:
    cmd = ["uv", "run", str(VALIDATOR), str(path)]
    if strict:
        cmd.append("--strict")
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout + r.stderr).strip()


def main() -> int:
    p = argparse.ArgumentParser(
        description="Validate, timestamp-backup, and atomically write a new "
                    "workspace.json. The only safe mutation path for the skill.",
        epilog="Example: uv run safe_write.py "
               "--target /vault/.obsidian/plugins/bob-workspace/workspace.json "
               "--source /tmp/merged.json",
    )
    p.add_argument("--target", required=True,
                   help="Path to the workspace.json to replace")
    p.add_argument("--source", required=True,
                   help="Path to the new complete workspace.json content "
                        "('-' to read from stdin)")
    p.add_argument("--strict", action="store_true",
                   help="Reject on validator warnings too (default: warnings are "
                        "advisory and permitted; only ERRORS — including the "
                        "render-safety guard's unreachable-nav check — block the "
                        "write). The live workspace.json carries advisory warnings, "
                        "so strict-by-default would block every live edit.")
    p.add_argument("--no-backup", action="store_true",
                   help="Skip the timestamped backup (NOT recommended)")
    args = p.parse_args()

    target = Path(args.target)

    # 1. Read + parse new content.
    raw = sys.stdin.read() if args.source == "-" else Path(args.source).read_text(
        encoding="utf-8")
    try:
        new_obj = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"ERROR: new content is not valid JSON: {e}", file=sys.stderr)
        return 1

    # 2. Validate new content via a temp file BEFORE touching the target.
    tmp = target.with_suffix(f".tmp-{int(time.time()*1000)}")
    tmp.write_text(json.dumps(new_obj, indent=2, ensure_ascii=False),
                   encoding="utf-8")
    ok, out = _validate(tmp, args.strict)
    if not ok:
        tmp.unlink(missing_ok=True)
        print("ERROR: new content failed validation — target left untouched.\n"
              + out, file=sys.stderr)
        return 1

    # 3. Timestamp-backup the existing target.
    if target.exists() and not args.no_backup:
        ts = time.strftime("%Y%m%d-%H%M%S")
        backup = target.with_name(f"{target.name}.bak-compose-{ts}")
        shutil.copy2(target, backup)
        print(f"Backed up: {backup}")

    # 4. Atomic replace (tmp is already on the same filesystem).
    tmp.replace(target)

    # 5. Re-validate on disk.
    ok2, out2 = _validate(target, args.strict)
    status = "VALID" if ok2 else "WARNINGS/ERRORS"
    print(f"Wrote {target} — post-write check: {status}")
    if not ok2:
        print(out2, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

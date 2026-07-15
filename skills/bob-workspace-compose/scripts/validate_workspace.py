#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Validate a BOB Workspace `workspace.json` against the full composition schema.

Authoritative pass/fail checker for the bob-workspace-compose skill. Covers all
top-level sections (dashboards, navigation, workbookGroups, bases, settings,
schemas) — not just dashboards. Philosophy: structurally STRICT, vocabulary
ENUM-PERMISSIVE. Unknown widget kinds / source strings / accents WARN; only
genuine structural breakage (wrong JSON type, missing load-bearing key, malformed
layout) is an ERROR. A validator that false-rejects a config the plugin renders
fine is worse than no validator.

RENDER-SAFETY GUARD (the 2026-06-17 fix)
========================================
Schema validity is necessary but NOT sufficient: a structurally-valid
workspace.json can still produce a dead/broken screen in Obsidian. The decisive,
config-determinable, NON-RECOVERABLE failure mode is an **unreachable nav item**.

The plugin's `render()` dispatches the active nav id (`this.mode`) through a fixed
precedence (confirmed by reading the plugin's main.js, not the minified bundle):
  1. resolveSurfaceConfig(mode) — `dashboards[mode]`, or `planner[mode]` for a
     `planner.*` id (a `dashboards["planner.*"]` entry is migrated into `planner`
     on load, so it counts).
  2. route[mode]            — a hardcoded built surface (BUILT_SURFACES).
  3. SECONDARY_TABS[mode]   — a `navigation.secondaryTabs` parent with ≥1 tab.
  4. active.entityKey       — the nav item carries an `entityKey`.
  5. else → renderComingSoon() — a DEAD "coming soon" screen the user cannot use.

A nav item that hits branch 5 renders a dead screen with NO renderer fallback —
that is the render bug schema validity misses, so it is an ERROR.

By contrast, base-widget references DO have a renderer fallback: an unmapped
`entity` (no `bases{}`/`settings.baseFiles{}` entry) and a `base: {"view": …}`
object with no `file` both resolve at runtime from the built-in
`ENTITIES[entityKey].baseView` (proven: the shipped crm template has zero `bases`
and renders `base-link` widgets fine). So those are WARNINGS, never errors — a
dangling base ref looks empty but does not break the panel, and flagging it hard
would false-reject an owner-shipped template.

Acceptance contract: this script must report 0 errors on the live workspace.json
and all four plugin templates (minimal/crm/bob/cadence) — render guard included.

Usage:
    uv run validate_workspace.py <path-to-workspace.json>
    uv run validate_workspace.py <path> --strict   # treat warnings as failure
    uv run validate_workspace.py <path> --json      # machine-readable report
    uv run validate_workspace.py <path> --no-render-check  # skip the render guard

Exit codes: 0 = valid (errors==0), 1 = errors found (or warnings under --strict),
2 = bad invocation / file not found / invalid JSON.
"""
import argparse
import json
import sys
from pathlib import Path

# Known vocabulary — used ONLY to emit advisory warnings, never to fail.
KNOWN_WIDGET_KINDS = {
    # read-only
    "list", "metric", "gauge", "progress", "heatmap", "bar-chart",
    "kanban", "selector", "date-range", "markdown", "actions",
    "base-link", "base-embed", "base-view", "merge",
    # interactive / utility (write back to notes)
    "task-list", "quick-add", "date-hero", "note-section",
}  # absent "kind" == default record-list widget (always valid)
KNOWN_SOURCE_STRINGS = {
    "recent", "recent-open", "recent-all", "due", "due-open", "due-soon",
    "overdue", "all",
}
# Dashboard ids that are special built-in surfaces — exempt from title/layout.
SPECIAL_DASHBOARDS = {"planner"}

# Nav ids the plugin's render() route map dispatches DIRECTLY to a specialized
# renderer (no entityKey needed). This is the current, narrow route map — the
# entity surfaces (crm.contacts, finance.invoices, client-work.*, prm.partners,
# tax.overview, ai.*, etc.) were removed from the route map and now render via
# their `entityKey` (branch 4) or a `secondaryTabs` parent (branch 3). So a nav
# item with one of THOSE ids is reachable ONLY if it carries an entityKey or is a
# secondaryTabs parent — not merely by being a "known" surface id.
BUILT_SURFACES = {
    "home",
    "planner.inbox", "planner.today", "planner.calendar", "planner.projects",
    "crm.dashboard", "crm.pipeline",
    "prm.analytics",
    "reports.pipeline", "reports.sales", "reports.partners", "reports.activity",
    "reports.productivity",
    "client-work.overview",
    "team", "settings", "misc.dashboard-editor", "misc.canvases", "misc.export", "misc.import",
}
# Widget kinds that resolve an Obsidian .base file via bases{}/baseFiles{}.
BASE_WIDGET_KINDS = {"base-embed", "base-link", "base-view"}


def _is_obj(x):
    return isinstance(x, dict)


def validate(data, render_check: bool = True) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if not _is_obj(data):
        return ["root must be a JSON object"], warnings

    # ---- schemas -------------------------------------------------------
    sch = data.get("schemas")
    if sch is not None and not _is_obj(sch):
        errors.append("`schemas` must be an object")

    # ---- navigation ----------------------------------------------------
    nav = data.get("navigation")
    if nav is not None:
        if not _is_obj(nav):
            errors.append("`navigation` must be an object")
        else:
            groups = nav.get("groups")
            if groups is not None and not isinstance(groups, list):
                errors.append("`navigation.groups` must be an array")
            for gi, g in enumerate(groups or []):
                if not _is_obj(g):
                    errors.append(f"navigation.groups[{gi}] must be an object")
                    continue
                if "id" not in g:
                    errors.append(f"navigation.groups[{gi}] missing required: id")
                items = g.get("items")
                if items is not None and not isinstance(items, list):
                    errors.append(f"navigation.groups[{gi}].items must be an array")
                for ii, it in enumerate(items or []):
                    if not _is_obj(it):
                        errors.append(
                            f"navigation.groups[{gi}].items[{ii}] must be an object")
                    else:
                        # The plugin's validateWorkspaceConfig requires BOTH id and
                        # label on every nav item and rejects the whole file if
                        # either is missing.
                        for req in ("id", "label"):
                            if req not in it:
                                errors.append(
                                    f"navigation.groups[{gi}].items[{ii}] missing required: {req}")

    # ---- workbookGroups ------------------------------------------------
    wbg = data.get("workbookGroups")
    if wbg is not None:
        if not isinstance(wbg, list):
            errors.append("`workbookGroups` must be an array")
        else:
            for i, g in enumerate(wbg):
                if not _is_obj(g):
                    errors.append(f"workbookGroups[{i}] must be an object")
                    continue
                if "id" not in g:
                    errors.append(f"workbookGroups[{i}] missing required: id")
                ek = g.get("entityKeys")
                if ek is not None and not isinstance(ek, list):
                    errors.append(f"workbookGroups[{i}].entityKeys must be an array")

    # ---- bases ---------------------------------------------------------
    bases = data.get("bases")
    if bases is not None:
        if not _is_obj(bases):
            errors.append("`bases` must be an object")
        else:
            for k, v in bases.items():
                if not _is_obj(v) or "file" not in v:
                    errors.append(f"bases['{k}'] must be an object with a `file` key")

    # ---- settings ------------------------------------------------------
    st = data.get("settings")
    if st is not None and not _is_obj(st):
        errors.append("`settings` must be an object")

    # ---- dashboards ----------------------------------------------------
    dashboards = data.get("dashboards")
    if dashboards is not None:
        if not _is_obj(dashboards):
            errors.append("`dashboards` must be an object")
        else:
            for did, dash in dashboards.items():
                _validate_dashboard(did, dash, errors, warnings)

    if not any(k in data for k in ("dashboards", "navigation")):
        warnings.append(
            "config has neither `dashboards` nor `navigation` — UI panel will be empty")

    # ---- render-safety guard (beyond structural schema validity) -------
    if render_check:
        _render_safety(data, errors, warnings)

    return errors, warnings


def _nav_items(data):
    """Yield (group_index, item_index, item) for every navigation item."""
    nav = data.get("navigation")
    if not _is_obj(nav):
        return
    for gi, g in enumerate(nav.get("groups") or []):
        if not _is_obj(g):
            continue
        for ii, it in enumerate(g.get("items") or []):
            if _is_obj(it):
                yield gi, ii, it


def _render_safety(data, errors, warnings):
    """Catch structurally-valid-but-non-rendering configs the schema misses.

    The one NON-RECOVERABLE failure (ERROR): a nav item that reaches the dead
    "coming soon" screen — i.e. its id matches none of the renderer's six
    dispatch branches. Everything else here is advisory (the renderer has a
    fallback), so it WARNs.
    """
    dashboards = data.get("dashboards")
    dash_keys = set(dashboards.keys()) if _is_obj(dashboards) else set()
    planner = data.get("planner")
    planner_keys = set(planner.keys()) if _is_obj(planner) else set()
    nav = data.get("navigation") if _is_obj(data.get("navigation")) else {}
    sec = nav.get("secondaryTabs")
    sec_parents = {k for k, v in sec.items() if v} if _is_obj(sec) else set()
    settings = data.get("settings") if _is_obj(data.get("settings")) else {}
    modules = settings.get("modules") if _is_obj(settings.get("modules")) else {}
    bases = data.get("bases") if _is_obj(data.get("bases")) else {}
    base_files = settings.get("baseFiles") if _is_obj(settings.get("baseFiles")) else {}

    def _reachable(nav_id, item):
        nid = str(nav_id or "")
        # 1. resolveSurfaceConfig: dashboards[id] (or planner[id] for planner.*).
        #    A dashboards["planner.*"] entry is migrated into planner on load, so
        #    either container counts for a planner.* id.
        if nid.startswith("planner."):
            if nid in planner_keys or nid in dash_keys:
                return True
        elif nid in dash_keys:
            return True
        # 2. built route surface
        if nid in BUILT_SURFACES:
            return True
        # 3. secondaryTabs parent with >=1 tab
        if nid in sec_parents:
            return True
        # 4. carries an entityKey -> entity list
        if item.get("entityKey"):
            return True
        return False

    for gi, ii, it in _nav_items(data):
        nid = it.get("id")
        loc = f"navigation.groups[{gi}].items[{ii}] (id='{nid}')"
        if not _reachable(nid, it):
            errors.append(
                f"{loc} is unreachable — its id is not a directly-routed surface, "
                f"a `dashboards`/`planner` key, a `secondaryTabs` parent, and it "
                f"has no `entityKey`. It renders a dead 'coming soon' screen. Fix: "
                f"give it an `entityKey`, register it under "
                f"`navigation.secondaryTabs`, add a matching `dashboards` entry, or "
                f"use a directly-routed surface id.")
            continue
        # advisory: bound to a module that is explicitly disabled -> hidden
        mod = it.get("module")
        if mod and modules.get(mod) is False:
            warnings.append(
                f"{loc} is bound to module '{mod}' which is off in "
                f"settings.modules — the item will be hidden until the module is "
                f"enabled.")

    # advisory: base widgets whose entity has no .base mapping (renderer falls
    # back to the built-in entity baseView, so empty-not-broken).
    if _is_obj(dashboards):
        for did, dash in dashboards.items():
            if not _is_obj(dash):
                continue
            for ri, row in enumerate(dash.get("layout") or []):
                if not isinstance(row, list):
                    continue
                for ci, cell in enumerate(row):
                    cells = cell if isinstance(cell, list) else [cell]
                    for w in cells:
                        if not _is_obj(w) or w.get("kind") not in BASE_WIDGET_KINDS:
                            continue
                        loc = f"dashboards['{did}'].layout[{ri}][{ci}]"
                        ent = w.get("entity")
                        b = w.get("base")
                        inline_file = _is_obj(b) and any(
                            b.get(k) for k in ("file", "base", "path", "basePath"))
                        mapped = (
                            (ent in bases and _is_obj(bases[ent]) and bases[ent].get("file"))
                            or ent in base_files)
                        if _is_obj(b) and not inline_file and not (mapped or ent):
                            warnings.append(
                                f"{loc} {w.get('kind')} has a `base` object with no "
                                f"`file` and no `entity` to resolve from — the path "
                                f"stringifies to '[object Object]'. Pass "
                                f"`base.file` or an `entity` mapped in `bases`/"
                                f"`settings.baseFiles`.")
                        elif not inline_file and not mapped and ent:
                            warnings.append(
                                f"{loc} {w.get('kind')} entity '{ent}' is not mapped "
                                f"in `bases`/`settings.baseFiles` and the widget has "
                                f"no inline `base.file` — relies on the built-in "
                                f"entity baseView fallback; set a `bases['{ent}']` "
                                f"mapping for an explicit Base.")


def _validate_dashboard(did, dash, errors, warnings):
    if not _is_obj(dash):
        errors.append(f"dashboards['{did}'] must be an object")
        return
    special = did in SPECIAL_DASHBOARDS or dash.get("kind")
    if not special:
        if "title" not in dash:
            errors.append(f"dashboards['{did}'] missing required: title")
        if "layout" not in dash:
            warnings.append(
                f"dashboards['{did}'] has no `layout` — nothing renders in the body")
    layout = dash.get("layout")
    if layout is not None and not isinstance(layout, list):
        errors.append(f"dashboards['{did}'].layout must be a 2D array")
        return
    for ri, row in enumerate(layout or []):
        if not isinstance(row, list):
            errors.append(f"dashboards['{did}'].layout[{ri}] must be an array (row)")
            continue
        for ci, cell in enumerate(row):
            cells = cell if isinstance(cell, list) else [cell]
            for w in cells:
                _validate_widget(did, ri, ci, w, errors, warnings)
    for si, s in enumerate(dash.get("stats") or []):
        if not _is_obj(s):
            errors.append(f"dashboards['{did}'].stats[{si}] must be an object")


def _validate_widget(did, ri, ci, w, errors, warnings):
    loc = f"dashboards['{did}'].layout[{ri}][{ci}]"
    if not _is_obj(w):
        errors.append(f"{loc} widget must be an object")
        return
    kind = w.get("kind")
    if kind is not None and kind not in KNOWN_WIDGET_KINDS:
        warnings.append(
            f"{loc} unknown widget kind '{kind}' (renderer may ignore it)")
    # default record-list widget (no kind) should name a data origin:
    # entity, source, or a merge[] of sub-sources are all valid.
    if kind is None and not any(k in w for k in ("entity", "source", "merge")):
        warnings.append(
            f"{loc} default-list widget has no `entity`, `source`, or `merge`")
    src = w.get("source")
    if isinstance(src, str) and src not in KNOWN_SOURCE_STRINGS:
        warnings.append(
            f"{loc} unknown source string '{src}' (expected one of "
            f"{sorted(KNOWN_SOURCE_STRINGS)} or an object)")
    elif src is not None and not isinstance(src, (str, dict)):
        errors.append(f"{loc}.source must be a string or object")


def main() -> int:
    p = argparse.ArgumentParser(
        description="Validate a BOB Workspace workspace.json against the full "
                    "composition schema (all sections, structural-strict, "
                    "enum-permissive).",
        epilog="Example: uv run validate_workspace.py "
               "/vault/.obsidian/plugins/bob-workspace/workspace.json --strict",
    )
    p.add_argument("path", help="Absolute path to the workspace.json to validate")
    p.add_argument("--strict", action="store_true",
                   help="Treat warnings as failures (exit 1 if any warning)")
    p.add_argument("--json", action="store_true",
                   help="Emit a machine-readable JSON report instead of text")
    p.add_argument("--no-render-check", action="store_true",
                   help="Skip the render-safety guard (schema-only check)")
    args = p.parse_args()

    path = Path(args.path)
    if not path.is_file():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        return 2
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"ERROR: invalid JSON: {e}", file=sys.stderr)
        return 2

    errors, warnings = validate(data, render_check=not args.no_render_check)
    n_dash = len(data.get("dashboards") or {}) if _is_obj(data) else 0

    if args.json:
        print(json.dumps({
            "path": str(path), "dashboards": n_dash,
            "errors": errors, "warnings": warnings,
            "ok": not errors and (not warnings or not args.strict),
        }, indent=2))
    else:
        for w in warnings:
            print(f"  WARN: {w}", file=sys.stderr)
        if errors:
            print(f"INVALID — {len(errors)} error(s), {len(warnings)} warning(s) "
                  f"across {n_dash} dashboards:", file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
        else:
            print(f"OK — workspace.json valid ({n_dash} dashboards, "
                  f"{len(warnings)} warning(s))")

    if errors:
        return 1
    if warnings and args.strict:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

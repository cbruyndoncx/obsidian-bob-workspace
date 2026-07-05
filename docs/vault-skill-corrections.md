# Vault skill corrections — `bob-workspace-bootstrap` & `bob-workspace-compose`

Actionable checklist for updating the two vault skills at
`/mnt/d/OBS/brncx-skills/00-CORE/Agents/skills/` so they match the current plugin
code. Derived from a code cross-check on 2026-07-05. Each item: what's wrong, the
correct behavior, and where to change it. Plugin source of truth:
`obsidian-bob-workspace/src/` — and `docs/installing-into-existing-vault.md` for
the canonical install sequence.

Both skills are **architecturally correct** (bootstrap owns schema YAML; compose
owns `workspace.json`; gating and safe-write logic are sound). These are drift
fixes, not rewrites.

---

## `bob-workspace-bootstrap`

- [ ] **1. Required-fields shape in SKILL.md is wrong.**
  SKILL.md (~lines 167-185) marks `type_value`/`label` as *optional* and omits
  `location_pattern`. The plugin's `validateSourceSchemaDefinition`
  (`src/schema-designer.ts`) **requires** `entity`, `label`, `location_pattern`,
  ≥1 field, and `type_value` (unless the entity is filename-backed).
  → Fix the SKILL.md inline example to match `references/yaml_source_schema.md`
  (which is already correct).

- [ ] **2. "Read `data.json` for the configured schema folder" is stale** (SKILL.md ~line 242).
  `schemasFolder`/`useSchemas` are in `WORKSPACE_OWNED_SETTING_KEYS`, stripped
  from `data.json` and written to `workspace.json.settings`; top-level
  `workspace.json.schemas.folder` wins over all.
  → Read `workspace.json`: top-level `schemas.folder`, else `settings.schemasFolder`
  (default `00-CORE/Schemas/source`). Not `data.json`.

- [ ] **3. `format` is not validated; the real checks are undocumented.**
  `references/yaml_source_schema.md` (~72-80) and Verification #2 claim regen
  checks `format`. It does not — it validates field `type ∈
  {string,number,integer,boolean,array}` only (no `date` type; dates are strings).
  It *does* check: no duplicate field keys, every `key_fields` entry is a defined
  field, a field `default` is one of its `enum` options and matches its type,
  `co_required`, and `field_aliases` conflicts.
  → Remove the `format` claim; document the checks that actually run.

- [ ] **4. `generate_yaml.py` produces a poor primary field.**
  It emits no `key_fields` and prepends a baseline `type` field. `fieldsFromSchema`
  filters `type` out, and with no `key_fields` the primary derives from the first
  remaining field — often `status`, making it the display/basename field.
  → Emit `key_fields: [<name-ish field>]`, or don't prepend `type`.

---

## `bob-workspace-compose`

- [ ] **5. The `custom.<entityKey>` render branch no longer exists.**
  SKILL.md (~211, 251), `references/workspace_schema.md` (~45), and
  `validate_workspace.py` `_reachable` (~246-247) list a branch 5
  `custom.<entityKey>` → entity list. The current `render()` dispatch
  (`src/views/app-view.ts`) has no such branch — a `custom.*` nav id with no other
  binding renders **"coming soon"**, but the validator marks it reachable
  → **false PASS**.
  → Remove the `custom.*` reachability branch from the validator, schema ref, and
  SKILL.md.

- [ ] **6. Widget catalog is stale — "nine kinds" is now ~19.**
  `PURE_DASHBOARD_WIDGET_TYPES` (`src/dashboards.ts`) / `dashboardWidgetSchema`
  (`src/workspace-config.ts`) define: metric, list, bar-chart, gauge, progress,
  heatmap, kanban, base-link, base-embed, base-view, markdown, actions, selector,
  date-range, merge, **task-list, quick-add, date-hero, note-section**.
  `references/widget_catalog.md` and `validate_workspace.py` `KNOWN_WIDGET_KINDS`
  omit the four new interactive/utility widgets plus gauge/progress/heatmap/
  date-range/base-view/merge/metric — so valid widgets get spurious
  "unknown widget kind" warnings.
  → Update the catalog and `KNOWN_WIDGET_KINDS` to the full 19; add `base-view`
  to `BASE_WIDGET_KINDS`. Note the new widgets' shapes: `task-list` (source =
  built-in/entity/base, interactive checkboxes), `quick-add` (`placeholder`),
  `date-hero` (`eyebrow`), `note-section` (`section`); their schemas set
  `allowSourceOnly`/no source required except `task-list`.

- [ ] **7. Validator is looser than the plugin on nav `label`.**
  `validate_workspace.py` (~138) checks only `id`; `validateWorkspaceConfig`
  (`src/workspace-config.ts`) throws if a nav item lacks `id` **or** `label` and
  rejects the whole `workspace.json` at load. This is the exact
  structurally-valid-but-renderer-rejected class the skill meant to close.
  → Require both `id` and `label` on nav items in the validator.

- [ ] **8. `BUILT_SURFACES` ≠ "always reachable."**
  The validator (~78-95) treats the full `BUILT_SURFACES` set (crm.contacts,
  finance.invoices, all client-work.*, …) as reachable, but the real dispatch
  renders those entity surfaces **only** via `active.entityKey`. A nav item with
  such an id but no `entityKey` passes the validator yet renders "coming soon."
  → Treat entity surfaces as reachable only when they carry an `entityKey` (or a
  dashboards/planner/secondaryTabs binding). Low impact (shipped templates always
  set `entityKey`) but the documented render model is wrong.

- [ ] **9. Destructive-archive warning is overstated — it's SWITCH-ONLY.**
  SKILL.md Gotcha (~205), dev-issues, and `recover_after_apply.py` state
  unconditionally that *applying a template* archives `00-CORE/Bases/` + Schemas
  and doesn't regenerate. Ground truth (`src/workspace-templates.ts`):
  `archiveTemplateAssets` runs **only when switching** (`prevKey && newKey &&
  prevKey !== newKey`). First install (no `activeWorkspaceTemplate`) archives
  nothing; re-applying the same template archives nothing. On a switch, schemas
  **do** regenerate (`regenerateSchemaOutputs` when `bootstrap.count ||
  assets.schemas`) — only `.base` files are not auto-regenerated.
  → Reword: "*Switching* to a different template archives the outgoing schemas +
  bases; schemas regenerate automatically, **bases do not** (restore or re-run
  bootstrap). A first install and same-template re-apply are safe (no archive)."

---

## Cross-cutting

- [ ] Point both skills at `docs/installing-into-existing-vault.md` (in the plugin
  repo) as the canonical first-install sequence, so future drift is caught in one
  place.
- [ ] Re-run each skill's objective test (0 errors on live `workspace.json` + all
  bundled templates) after the widget-kind and nav-label validator fixes — those
  two change what the validator accepts/warns on.

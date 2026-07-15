# workspace.json — Full Composition Schema

The BOB Workspace plugin reads `.obsidian/plugins/bob-workspace/workspace.json` to compose the entire visible UI. This is the authoritative guide to its six top-level sections. The machine-checkable contract is [`workspace.schema.json`](workspace.schema.json); the authoritative pass/fail checker is [`../scripts/validate_workspace.py`](../scripts/validate_workspace.py). Widget-level detail lives in [`widget_catalog.md`](widget_catalog.md).

**Philosophy:** structurally strict, vocabulary enum-permissive. Validate JSON types and load-bearing keys; do NOT lock open vocabularies (widget `kind`, `accent`, `source` strings) that the renderer accepts beyond what is observable in the minified bundle.

## Top-level shape

```json
{
  "_comment": "free text",
  "schemas":        { "enabled": true, "folder": "00-CORE/Schemas/source" },
  "navigation":     { "groups": [ ... ], "secondaryTabs": {} },
  "workbookGroups": [ { "id": "...", "label": "...", "entityKeys": [ ... ] } ],
  "dashboards":     { "<dashboard-id>": { ... } },
  "bases":          { "<entity>": { "file": "00-CORE/Bases/People.base" } },
  "settings":       { "modules": { ... }, "currency": "EUR", ... }
}
```

Templates additionally carry a `_template` block (`id`, `label`, `description`, `order`); the cadence template carries an `entities` override block. All are tolerated. `additionalProperties` is true everywhere for forward compatibility (e.g. the live file's special `planner` key).

## 1. `schemas`

Toggles schema-driven rendering and points at the YAML source folder owned by [[bob-workspace-bootstrap]].

```json
{ "enabled": true, "folder": "00-CORE/Schemas/source" }
```

When `enabled: true`, entity field types / enums / status lifecycles come from the schemas (parsed from DATAMODEL-FULL.md), so this file does not re-declare them.

## 2. `navigation`

The left sidebar. `groups[]` each contain `items[]`. A nav item binds to an entity (`entityKey`), a folder (`folderKey`), or a built-in surface (by `id`).

### Navigation render model (CRITICAL — read before adding any nav item)

A nav item only renders real content if its `id`/shape matches one of the renderer's dispatch branches. Verified against the plugin's `render()` in `main.js` (readable source, not minified), the dispatch order is:

1. **Config surface** — `resolveSurfaceConfig(id)` returns a config: for a `planner.*` id, `planner[id]`; otherwise `dashboards[id]`. (A `dashboards["planner.*"]` entry is migrated into `planner` on load, so it counts.) → renders that config via `renderConfigDashboard`.
2. **Directly-routed surface id** — the `id` is one of the plugin's narrow specialized route ids (see list below) → renders that surface (e.g. `home`, `crm.dashboard`, `crm.pipeline`, `reports.*`, `client-work.overview`, `team`, `settings`). NOTE: entity surfaces (`crm.contacts`, `finance.invoices`, all `client-work.*` children, `prm.partners`, `tax.overview`, `ai.*`, …) are NOT in this route map — they render via branch 3 or 4.
3. **`secondaryTabs` parent** — the `id` is a key in `navigation.secondaryTabs` with ≥1 tab → renders a tabbed entity view.
4. **`entityKey` item** — the item has `entityKey` pointing at a registered entity → renders that entity's list (with a built-in `+ New <entity>` button).
5. **Otherwise → `renderComingSoon()`** — a dead "coming soon" placeholder screen with no fallback.

**The trap (corrected):** the dead screen happens when an `id` matches **none** of branches 1–4. A free-form `id` that DOES have a matching `dashboards{}` entry **does render** (branch 1) — that is why the live config's free-form `workspace.base-links` nav id works. The genuine bug is a free-form `id` with **no** `dashboards`/`planner` entry, not a built surface, not a `secondaryTabs` parent, and no `entityKey`: that falls through to `renderComingSoon()`. The render-safety guard in `validate_workspace.py` flags exactly this case as an ERROR.

**The `soon` badge is separate from the dead screen.** The badge logic shows `soon` whenever `id ∉ BUILT_SURFACES` AND the item has no `entityKey` — so a working free-form-id-backed-by-`dashboards` item still wears a cosmetic `soon` badge even though it renders. The badge is cosmetic; the dead screen is the real failure. To avoid both, prefer `entityKey` items or a built surface id; use a free-form `dashboards`-backed id only when you accept the badge.

**So, to surface YOUR vault's entities in nav, use one of:**
- **`entityKey` item** — one nav item per entity → full list view + create button. Idiomatic for single entities.
- **`secondaryTabs` parent** — group several entities under one nav item as tabs:
  ```json
  "navigation": {
    "groups": [ { "id": "human", "label": "Human", "items": [
      { "id": "human", "label": "Human", "icon": "user", "desc": "PARA records" } ] } ],
    "secondaryTabs": {
      "human": [ { "label": "Tasks", "entityKey": "task" },
                 { "label": "Projects", "entityKey": "project" } ]
    }
  }
  ```
  (Each tab is `{ "label", "entityKey" }` or `{ "label", "route" }`. Registering the parent id in `secondaryTabs` also clears the `soon` badge.)
- **Built route id** — reuse a built surface and let its config drive it (only `home` is safely config-driven for arbitrary content; the rest have semantic renderers).

**Built route surface ids** (safe nav `id`s, no `soon`): `home`, `planner.inbox`, `planner.today`, `planner.calendar`, `planner.projects`, `team`, `settings`, plus the domain built-ins `crm.dashboard|pipeline|contacts|leads|campaigns|sequences|clients|companies|activities`, `client-work.*`, `procurement.*`, `finance.*`, `tax.overview`, `prm.*`, `reports.*`, `ai.playbooks`, `ai.skills`, `misc.dashboard-editor|export|import`.

**Planner is `planner.today` / `planner.inbox` / `planner.calendar` / `planner.projects`** — there is no bare `planner` nav surface. A nav item with `id: "planner"` renders coming-soon. (The `dashboards.planner` *key* is separate — it's config the planner renderer reads, not a nav target.)

```json
{
  "groups": [
    { "id": "home_group", "label": "", "items": [
      { "id": "home", "label": "Home", "icon": "home", "desc": "Command centre." }
    ] },
    { "id": "crm", "label": "CRM", "module": "crm", "items": [
      { "id": "records.deal", "label": "Deals", "icon": "trending-up",
        "entityKey": "deal", "desc": "Deal records" }
    ] }
  ],
  "secondaryTabs": {}
}
```

Item fields: `id` (required), `label`, `icon` (Lucide name), `desc`, `entityKey`, `folderKey`, `module`, `navLevel`, `parent` (for nested items). A nav item only appears if its `module` is enabled in `settings.modules`.

## 3. `workbookGroups`

Groups of entities surfaced together as a "workbook" (multi-entity record explorer).

```json
[ { "id": "crm-core", "label": "CRM", "entityKeys": ["contact", "company", "deal"] } ]
```

## 4. `dashboards`

The heart of the UI. A map of `<dashboard-id>` → dashboard object.

**A `dashboards` entry renders when the active nav id (`this.mode`) equals its key** — branch 1 of the dispatch (`resolveSurfaceConfig`) returns `dashboards[mode]` for any mode, built or free-form. So `dashboards["crm.dashboard"]` renders under the built `crm.dashboard` surface, AND `dashboards["workspace.base-links"]` renders under a free-form nav item with `id: "workspace.base-links"` (exactly how the live config does it). The dead-screen case is a nav item whose id has **no** matching `dashboards`/`planner` entry and no other branch — see § Navigation render model. To surface your own *entities* idiomatically (with a `+ New` button), prefer `entityKey` nav items or `secondaryTabs` (§2); use a free-form `dashboards`-keyed nav id when you want a custom widget layout (it renders, but wears a cosmetic `soon` badge). Dashboard ids are dotted (`crm.campaigns.overview`, `clients.overview`).

```json
{
  "title": "Campaigns",
  "subtitle": "Campaign and outbound sequence overview",
  "stats": [ <stat-card>, ... ],
  "layout": [ [ <widget>, <widget> ], [ <widget> ] ]
}
```

- `title` (required for normal dashboards), `subtitle`.
- `stats[]` — top-row number tiles (see widget_catalog § Stat cards).
- `layout[][]` — 2D widget grid (see widget_catalog).
- Optional advanced keys observed in the live file: `contextFilter`, `conditionalRows`, `legend`, `controls`, `kind`.
- **Special surface:** the `planner` dashboard id has neither `title` nor `layout` — it is a built-in renderer. The validator exempts it (and any dashboard carrying a `kind`).

## 5. `bases`

Maps an entity to its Obsidian `.base` file. This is where composition delegates the tabular/grid layer to the Obsidian **Bases** standard rather than re-implementing tables.

```json
{ "contact": { "file": "00-CORE/Bases/People.base" } }
```

Authoring `.base` files themselves is out of scope — use the [[obsidian-bases]] skill. This section only wires an existing `.base` to an entity for `base-link` / `base-embed` widgets.

## 6. `settings`

Plugin behaviour: `modules` (which nav modules are on), `currency`, `taskMode`, `baseFiles`, `baseViews`, `useSchemas`, folder overrides (`folderLeads`, `folderProjects`, …), `dailyNoteFolder`, `pinnedSurfaces`, `reminders`. Treated as a loose object — preserve unknown keys verbatim.

## Live file is a superset

The live `workspace.json` is the broadest known-good example: 24 dashboards, 49 `bases`, 17 settings, plus the special `planner` key. The schema and validator must accept the **union** of all observed shapes — never narrow to one template. The objective acceptance test: validator reports 0 errors on the live file AND all bundled `workspace-*.json` templates.

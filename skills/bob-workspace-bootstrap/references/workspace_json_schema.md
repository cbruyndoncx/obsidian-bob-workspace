> **This skill no longer writes `workspace.json`.** UI composition (including any baseline) is owned entirely by the **[[bob-workspace-compose]]** skill and the plugin's native `Apply workspace template…` command. This file is retained only as a historical/background sketch of the `dashboards` shape; the authoritative, full-coverage schema (all six sections, nine widget kinds, the machine-checkable JSON Schema, and the validator) lives in compose — see `00-CORE/Agents/skills/bob-workspace-compose/references/workspace_schema.md`. Do not expand this file or write `workspace.json` from this skill.

# workspace.json — Background Sketch (not written by this skill)

The BOB Workspace plugin reads `.obsidian/plugins/bob-workspace/workspace.json` to compose the visible UI. Without entries there the plugin panel is empty even after a successful Regenerate. This skill produces only the datamodel (YAML source); the UI is created afterward via [[bob-workspace-compose]] or the plugin's `Apply workspace template…` command. The shape below is reference context for that downstream step, not an output of this skill.

## Top-level shape

```json
{
  "_comment": "This file controls no-code workspace composition. Entity-backed items render generic record lists; existing built-in surface IDs keep their specialized renderers.",
  "dashboards": {
    "<dashboard-id>": { ... },
    "<dashboard-id>": { ... }
  }
}
```

## Dashboard shape

```json
{
  "title": "Campaigns",
  "subtitle": "Campaign and outbound sequence overview",
  "stats": [ <stat-card>, ... ],
  "layout": [
    [ <widget>, <widget> ],
    [ <widget> ]
  ]
}
```

- `stats[]` — top-row stat cards. Baseline leaves empty.
- `layout[][]` — 2D grid of widgets (outer = rows, inner = columns).

## Widget shape (baseline list widget)

```json
{
  "title": "ACTIVE CAMPAIGNS",
  "empty": "No active campaigns.",
  "entity": "campaign",
  "source": "recent-open",
  "titleFields": ["campaign_name", "title"],
  "metaFields": ["status", "campaign_type", "launch_date"]
}
```

| Field | Notes |
|-------|-------|
| `title` | Section header in the dashboard |
| `empty` | Message when there are zero records |
| `entity` | The `type_value` (or `entity` if not aliased) — must match a YAML source file |
| `source` | `recent-open` shows non-closed records, recency-sorted; other values include `recent-all`, `due-soon`, `overdue` |
| `titleFields` | Ordered fallback list — first non-empty field becomes the row title |
| `metaFields` | Compact fields shown below the title (status pill + dates) |

## Stat card shape (guided-optimize only)

```json
{
  "label": "ACTIVE CAMPAIGNS",
  "entity": "campaign",
  "count": "open",
  "sub": { "entity": "campaign", "count": "all", "suffix": "total" },
  "accent": "sky"
}
```

| Field | Notes |
|-------|-------|
| `count` | `open` / `all` / status value |
| `accent` | `sky`, `mint`, `warn`, `pink` — color hint |
| `sub` | Optional sub-count line under the main number |

This skill does NOT write stat cards in `minimum`; they're optimization.

## Baseline generation rules (this skill, `minimum` route)

1. One dashboard per detected domain. Dashboard id format: `<domain-slug>.overview`.
2. Dashboard `title` = domain label; `subtitle` = "Entities in this domain"; `stats: []`; `layout` = one row containing one widget per entity in that domain.
3. Widget per entity:
   - `entity` = type_value
   - `source` = `recent-open`
   - `titleFields` = `["title", "name", "<entity>_name"]` filtered to those actually present in the YAML
   - `metaFields` = `["status"]` if status field exists in YAML, plus `"created"` or `"date"` if present
4. **Merge with existing**: preserve every existing dashboard key verbatim; add only new dashboards for domains not yet present.

## Merge example

Existing workspace.json:
```json
{ "dashboards": { "crm.campaigns.overview": { /* user's hand-tuned */ } } }
```

This skill detects domains: `crm`, `clients`, `finance`. It writes:
```json
{
  "dashboards": {
    "crm.campaigns.overview": { /* preserved verbatim */ },
    "clients.overview": { /* new baseline */ },
    "finance.overview": { /* new baseline */ }
  }
}
```

No touch to `crm.campaigns.overview`. Composition the user already built is sacred.

## What the plugin does NOT use here

The plugin's own data files (`data.json`, `entities.json`) and the regen output folders (`fileClasses/`, `json-schema/`) are not part of `workspace.json`. This skill never touches them — the regen pipeline owns those.

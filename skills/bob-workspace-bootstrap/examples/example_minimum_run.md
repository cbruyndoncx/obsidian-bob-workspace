# Example — Minimum Route on a Small Consulting Vault

End-to-end walkthrough of `minimum` route on a representative Obsidian vault. Demonstrates detection output, proposal report, YAML writes, plugin Regenerate, and the resulting UI state.

## Starting vault

```
my-vault/
├── .obsidian/
│   ├── plugins/
│   │   └── bob-workspace/
│   │       ├── manifest.json     (v0.14.x)
│   │       ├── workspace.json    (empty or absent)
│   │       └── data.json
│   └── templates.json             ({"folder": "Templates"})
├── Templates/
│   ├── client.md          (frontmatter: type, client_name, status, regions)
│   ├── meeting.md         (frontmatter: type, date, attendees, client_id)
│   └── invoice.md         (frontmatter: type, amount, currency, due_date)
├── Clients/
│   ├── acme/
│   │   ├── profile.md     (type: client, 1 note)
│   │   ├── meetings/      (type: meeting, 14 notes)
│   │   └── invoices/      (type: invoice, 8 notes)
│   └── ...               (23 client folders total)
└── Inbox/
    └── ...                (47 untyped daily notes)
```

## Invocation

```
User: set up BOB Workspace on my vault at /home/me/my-vault
```

## Phase 1 — Detection (no writes)

```bash
uv run scripts/template_scan.py --templates-dir my-vault/Templates --output /tmp/templates.json
uv run scripts/frontmatter_census.py --vault my-vault --min-count 3 --output /tmp/census.json
```

Reported:

```
Templates folder: Templates/ (from .obsidian/templates.json)
BOB Workspace plugin: v0.14.4 → useSchemas: true
Schemas folder: 00-CORE/Schemas/source (default)
Existing YAML source files: 0
Existing workspace.json: empty

Detected entities (≥3 notes):
  client    23 notes  dominant folder: Clients/{slug}/
  meeting   89 notes  dominant folder: Clients/{slug}/meetings/
  invoice   31 notes  dominant folder: Clients/{slug}/invoices/

Inferred fields (client):
  client_name  string  required (100%)
  status       enum [prospect, active, inactive] (3 distinct / 23 → enum)
  regions      array (list values → Multi)
  created      date    optional (74%)

Domain mapping (from folder):
  Clients/ → "Clients & Delivery"
```

## Phase 2 — Proposal (writes only to 99-TMP/OUTPUT/)

```bash
# Agent constructs proposal report from detection JSON
```

Report at `99-TMP/OUTPUT/bob-workspace-bootstrap-proposal.md`:

```markdown
# BOB Workspace Bootstrap — Proposal

## Detected entity types (3 above ≥3-note threshold)
| type | count | dominant folder | enum candidates |
|------|-------|-----------------|-----------------|
| client  | 23 | Clients/{slug}/         | status (3 values) |
| meeting | 89 | Clients/{slug}/meetings/| (none)            |
| invoice | 31 | Clients/{slug}/invoices/| currency (2)      |

## Files to be written
- 00-CORE/Schemas/source/client.yaml  (new)
- 00-CORE/Schemas/source/meeting.yaml (new)
- 00-CORE/Schemas/source/invoice.yaml (new)
- .obsidian/plugins/bob-workspace/workspace.json (new — 1 dashboard)

## Next step after confirmation
Open Obsidian → Settings → BOB Workspace → click Regenerate. The plugin will:
- Read 00-CORE/Schemas/source/*.yaml
- Write 00-CORE/Schemas/fileClasses/*.md (Metadata Menu)
- Write 00-CORE/Schemas/json-schema/*.schema.json (frontmatter validation)
- Update DATAMODEL.md and DATAMODEL-FULL.md generated blocks
```

User replies: `proceed`

## Phase 3 — Write YAML source

```bash
for ent in client meeting invoice; do
  uv run scripts/generate_yaml.py --vault my-vault --entity $ent \
    --label "$(label-for $ent)" --location-pattern "Clients/{slug}/..." \
    --domain clients-delivery
done
```

Each YAML follows the canonical shape:

```yaml
entity: client
label: Client
type_value: client
location_pattern: Clients/{slug}/
description: Client entity inferred from vault census (5 fields).
domain: clients-delivery
fields:
  - name: type
    type: string
    required: true
  - name: client_name
    type: string
    required: true
  - name: status
    type: string
    enum: [prospect, active, inactive]
  - name: regions
    type: array
  - name: created
    type: string
    format: date
  - name: tags
    type: array
```

No `workspace.json` is written here — that is the UI half, owned by [[bob-workspace-compose]] and the plugin's `Apply workspace template…` command. The `domain: clients-delivery` annotation on each YAML source is what compose later uses to group these three entities into one dashboard.

## Phase 4 — Plugin Regenerate (user action)

Settings → BOB Workspace → click **Regenerate**.

Plugin output:
```
Schemas regenerated: 3 fileClasses + 3 JSON schemas; updated 2 DATAMODEL section(s).
```

Vault state after regen:
```
00-CORE/Schemas/
  source/{client,meeting,invoice}.yaml
  fileClasses/{client,meeting,invoice}.md       (plugin-generated)
  json-schema/{client,meeting,invoice}.schema.json   (plugin-generated)
DATAMODEL.md            (entity types table updated between markers)
DATAMODEL-FULL.md       (entity definitions section updated between markers)
```

## Phase 5 — Verification

1. `00-CORE/Schemas/fileClasses/{client,meeting,invoice}.md` and matching JSON schemas now exist (plugin-generated).
2. DATAMODEL.md / DATAMODEL-FULL.md updated between the generated markers.
3. No `.base` files created — Bases come from the `bases` route (separate invocation).
4. No frontmatter on existing notes modified — bootstrap is config-only.
5. `workspace.json` unchanged by this skill — the UI is created in Phase 6.

## Phase 6 — Get a UI (next skill / plugin command)

The datamodel exists but the panel is still empty. To render it:
- Run the plugin command **"Apply workspace template…"** for a starter layout (replaces `workspace.json`, keeps one rolling `workspace.backup.json`), or
- Use the **[[bob-workspace-compose]]** skill to compose/add dashboards (durable timestamped backups, surgical add/update).

## Common failures and fixes

- **"Schema validation failed: duplicate field"** → ran inline generation instead of `generate_yaml.py`; rerun with the script.
- **"Schema validation failed: location_pattern required"** → YAML missing `location_pattern:` field; older versions of the skill missed this. Add it.
- **Plugin panel empty after regen** → expected — the UI is a separate step. Apply a template or run [[bob-workspace-compose]] (Phase 6).

## What the user does next

- Get a UI via [[bob-workspace-compose]] or the plugin's `Apply workspace template…` command, then
- Run `bases` route to materialize `.base` files per entity (table + curated views), or
- Run `guided-optimize` to tighten enums and promote required fields after data accumulates.

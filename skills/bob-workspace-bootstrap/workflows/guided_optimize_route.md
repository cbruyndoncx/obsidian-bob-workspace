# Guided-Optimize Route Workflow

Conversational pass after `minimum` has shipped YAML source and the user has clicked "Regenerate" once. Walks per-domain-then-per-entity, proposing improvements to YAML source files only.

## Executable

`scripts/guided_optimize.py` analyzes one entity at a time and applies accepted decisions:

```bash
# Analyze — emits decision proposals as JSON
uv run scripts/guided_optimize.py --vault <path> --entity <slug> --analyze

# Apply — write accepted decisions back to YAML
uv run scripts/guided_optimize.py --vault <path> --entity <slug> --apply \
    --add-fields fieldA,fieldB --add-enum status --mark-required client_id
```

Agent drives the loop: pick next entity in current domain → analyze → present each decision in `expansion` / `enum_tightening` / `required_promotion` lists one at a time → apply user's accepted subset → mark entity complete → next entity in same domain → next domain.

## Pre-condition

- `00-CORE/Schemas/source/*.yaml` files exist
- User has run the plugin's "Regenerate" at least once successfully

## Pacing rule

Per domain → per entity within domain → per decision per entity. Never cross domains until current is closed. State log at `99-TMP/OUTPUT/bob-workspace-optimize-state.md`.

## Steps

### 1. Load state

Initialize or resume:
```yaml
domain_order: [Sales, Clients & Delivery, Finance, ...]
current_domain: Sales
current_entity: lead
completed_entities: []
completed_domains: []
```

### 2. Per-entity loop — three decisions

#### Decision A — Field expansion

1. Re-census the entity's notes.
2. Identify fields present on ≥ 30% of notes but NOT declared in YAML source.
3. Propose each candidate one at a time with presence ratio + inferred type.
4. User accepts / declines per field.
5. On accept: append to the entity's YAML source (merge-as-additive). Do NOT remove existing fields.

#### Decision B — Enum tightening

1. For each `string` field in YAML without `enum:`, re-check distinct/total ratio.
2. If now < 0.15 AND distinct ≤ 12 (e.g. the user has been consistent for a while), propose adding `enum: [...]`.
3. User accepts / declines.
4. On accept: edit YAML to add `enum: [...]` field constraint.

#### Decision C — Required promotion

1. For each field without `required: true`, check presence ratio.
2. If ≥ 95% (effectively universal), propose `required: true`.
3. User accepts / declines.
4. On accept: edit YAML.

### 3. Entity completion

Mark entity complete in state log. Tell user: "Lead YAML updated. Click Regenerate in plugin settings to apply, or continue with next entity."

### 4. Domain completion

After all entities in current domain processed, prompt: "Sales domain done. Click Regenerate now, then continue with Clients & Delivery."

### 5. Loop

Continue until all domains complete or user stops. State preserved for resume.

## Done When

- Per-domain pacing enforced; no cross-domain interleaving
- Decisions A/B/C closed for each entity in each domain
- All accepted changes written into existing YAML source (additive merge only)
- User reminded to click Regenerate after each domain
- Zero writes outside `00-CORE/Schemas/source/` and `99-TMP/OUTPUT/`

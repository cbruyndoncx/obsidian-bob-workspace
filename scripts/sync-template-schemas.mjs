#!/usr/bin/env node
// Sync the schema YAML embedded in templates/workspace-bob.json from the canonical
// schema source folder of a BOB vault (00-CORE/Schemas/source).
//
// Why: the template's `_assets.schemas` is what `writeTemplateAssets()` writes into a
// vault's schema folder when the template is applied and a file is missing. If the
// embedded copy is older than the canonical data model, applying the template to a
// vault whose YAML has not arrived yet (for example a sync that carried only markdown)
// seeds stale schema files, and the regenerated JSON Schemas/FileClasses follow them.
// That happened on 2026-09-17: 74 stale entity files replaced the canonical ones.
//
// The embedded bodies are the canonical files' text, verbatim, so a vault seeded from
// the template regenerates byte-identically to one built from the canonical source.
// The set of embedded entities is unchanged by a sync — only their bodies are refreshed;
// adding or dropping an entity from the template is a deliberate edit.
//
// Usage:
//   node scripts/sync-template-schemas.mjs [--source DIR] [--template FILE] [--check]
//
//   --source    canonical schema folder; default $BOB_CANONICAL_SCHEMAS
//   --template  template to update; default templates/workspace-bob.json
//   --check     report drift and exit 1 if any body differs; write nothing
//
// Exit codes: 0 in sync (or written), 1 drift found with --check, 2 bad input.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CANONICAL_SOURCE = '';

export function canonicalSource(explicit) {
  return explicit || process.env.BOB_CANONICAL_SCHEMAS || '';
}

// Compare (and optionally refresh) every embedded schema against <source>/<entity>.yaml.
// Returns { drift: [entity...], missing: [entity...], template } without writing.
export function diffTemplateSchemas(template, source) {
  const schemas = template?._assets?.schemas;
  if (!schemas || typeof schemas !== 'object') throw new Error('template has no _assets.schemas');
  const drift = [];
  const missing = [];
  const refreshed = {};
  for (const [entity, body] of Object.entries(schemas)) {
    const file = path.join(source, `${entity}.yaml`);
    if (!fs.existsSync(file)) { missing.push(entity); refreshed[entity] = body; continue; }
    const canonical = fs.readFileSync(file, 'utf8');
    if (body !== canonical) drift.push(entity);
    refreshed[entity] = canonical;
  }
  return { drift, missing, refreshed };
}

function parseArgs(argv) {
  const args = { check: false, source: '', template: path.join(ROOT, 'templates', 'workspace-bob.json') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--source') args.source = argv[++i] || '';
    else if (a === '--template') args.template = path.resolve(argv[++i] || '');
    else { console.error(`unknown argument: ${a}`); process.exit(2); }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = canonicalSource(args.source);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    console.error(`canonical schema folder not found: ${source} (pass --source or set BOB_CANONICAL_SCHEMAS)`);
    process.exit(2);
  }
  const raw = fs.readFileSync(args.template, 'utf8');
  const template = JSON.parse(raw);
  // The file must round-trip at 2-space indent, or a rewrite would reformat unrelated lines.
  if (`${JSON.stringify(template, null, 2)}\n` !== raw) {
    console.error(`${args.template} is not 2-space normalized JSON; refusing to rewrite it`);
    process.exit(2);
  }
  const { drift, missing, refreshed } = diffTemplateSchemas(template, source);
  if (missing.length) {
    console.error(`no canonical file for embedded schema(s): ${missing.join(', ')} — rename or remove them in the template first`);
    process.exit(2);
  }
  const total = Object.keys(refreshed).length;
  if (!drift.length) {
    console.log(`in sync: ${total} embedded schemas match ${source}`);
    return;
  }
  if (args.check) {
    console.error(`DRIFT: ${drift.length} of ${total} embedded schemas differ from ${source}: ${drift.join(', ')}`);
    console.error('run: npm run sync-schemas');
    process.exit(1);
  }
  template._assets.schemas = refreshed;
  fs.writeFileSync(args.template, `${JSON.stringify(template, null, 2)}\n`);
  console.log(`refreshed ${drift.length} of ${total} embedded schemas from ${source}: ${drift.join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

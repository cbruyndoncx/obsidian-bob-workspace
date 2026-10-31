#!/usr/bin/env node
// Sync vendor/context-default.json from the context-pack skill's framework default pack
// (assets/default-context.yaml). The plugin parses the embedded text at runtime to resolve
// the context-pack keys that canonical schema location_patterns use ({client.profile-root}/),
// so a vault without its own context.yaml, or one that `extends: default`, still maps every
// schema to its folders. The text is stored verbatim, like the template's embedded schemas.
//
// Usage:
//   node scripts/sync-context-default.mjs [--source FILE] [--check]
//
//   --source  default-context.yaml; default $BOB_CONTEXT_DEFAULT
//   --check   report drift and exit 1 if the embedded text differs; write nothing
//
// Exit codes: 0 in sync (or written), 1 drift found with --check, 2 bad input.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'vendor', 'context-default.json');
const args = process.argv.slice(2);
const check = args.includes('--check');
const sourceIdx = args.indexOf('--source');
const source = sourceIdx >= 0 ? args[sourceIdx + 1] : process.env.BOB_CONTEXT_DEFAULT;

if (!source) {
  console.error('No source: pass --source <default-context.yaml> or set BOB_CONTEXT_DEFAULT.');
  process.exit(2);
}
if (!fs.existsSync(source)) {
  console.error(`Source not found: ${source}`);
  process.exit(2);
}
const yaml = fs.readFileSync(source, 'utf8');
const current = fs.existsSync(TARGET) ? JSON.parse(fs.readFileSync(TARGET, 'utf8')) : {};
if (current.yaml === yaml) {
  console.log(`In sync: vendor/context-default.json matches ${source}`);
  process.exit(0);
}
if (check) {
  console.log(`DRIFT: vendor/context-default.json differs from ${source}\nrun: npm run sync-context`);
  process.exit(1);
}
const out = {
  origin: 'context-pack skill, assets/default-context.yaml (synced verbatim by scripts/sync-context-default.mjs)',
  yaml,
};
fs.writeFileSync(TARGET, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote vendor/context-default.json from ${source}`);

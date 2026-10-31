/* Context pack — where a BOB vault keeps each kind of note.
 *
 * Canonical schema `location_pattern` values name folders through context-pack
 * keys (`{client.profile-root}/`, `{partner.commissions}/`) instead of literal
 * paths, so the same schemas describe any workspace layout. A workspace states
 * its layout in `context.yaml` at the vault root; most write `extends: default`
 * and list only what differs from the framework default pack, whose text is
 * embedded below (vendor/context-default.json, synced verbatim from the
 * context-pack skill's assets/default-context.yaml by `npm run sync-context`).
 *
 * Merge rules mirror context-pack's own loader (references/manifest-schema.md →
 * `extends`): a child root wins and, when it moves a root, every inherited key
 * path under the old folder moves with it; a child key's path is used as
 * written; a manifest without `extends` stands alone. */
import contextDefault from '../vendor/context-default.json';
import * as obsidian from 'obsidian';
import type { App } from 'obsidian';

export interface ContextPack {
  roots: Record<string, string>;
  /** Logical key → path as written in the manifest, e.g. `30-CLIENTS/{id}/00-PROFILE/`. */
  keys: Record<string, string>;
}

type Manifest = { extends?: unknown; roots?: unknown; keys?: unknown } | null | undefined;

const trimSlash = (value: string) => value.replace(/\/+$/, '');

export function contextPackFromManifest(manifest: Manifest, base: ContextPack | null = null): ContextPack {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const ownRoots: Record<string, string> = {};
  if (m.roots && typeof m.roots === 'object') {
    Object.entries(m.roots as Record<string, unknown>).forEach(([name, folder]) => {
      if (typeof folder === 'string' && folder.trim()) ownRoots[name] = trimSlash(folder.trim());
    });
  }
  const ownKeys: Record<string, string> = {};
  if (m.keys && typeof m.keys === 'object') {
    Object.entries(m.keys as Record<string, unknown>).forEach(([key, spec]) => {
      const path = spec && typeof spec === 'object' ? (spec as { path?: unknown }).path : spec;
      if (typeof path === 'string' && path.trim()) ownKeys[key] = path.trim();
    });
  }
  if (!base || m.extends !== 'default') return { roots: ownRoots, keys: ownKeys };

  // A moved root carries every inherited key path that is the old folder or sits under it.
  const moves = Object.entries(ownRoots)
    .filter(([name, folder]) => base.roots[name] && trimSlash(base.roots[name]) !== folder && trimSlash(base.roots[name]) !== '.')
    .map(([name, folder]) => [trimSlash(base.roots[name]), folder] as const);
  const rebase = (path: string) => {
    for (const [from, to] of moves) {
      if (path === from || path === `${from}/`) return path.replace(from, to);
      if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
    }
    return path;
  };
  const keys: Record<string, string> = {};
  Object.entries(base.keys).forEach(([key, path]) => { keys[key] = rebase(path); });
  Object.assign(keys, ownKeys);
  return { roots: { ...base.roots, ...ownRoots }, keys };
}

/* Replace each `{scope.key}` (or `{~scope.key}`) token in one location
   alternative with that key's path. Tokens without a dot (`{id}`, `{client-id}`)
   are record placeholders, not keys, and stay as they are. Returns null when the
   alternative names a key the pack does not declare: guessing a folder for it
   would file notes in the wrong place. */
export function resolveContextKeys(pattern: string, pack: ContextPack | null): string | null {
  let unresolved = false;
  const out = String(pattern || '').replace(/\{~?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\}/gi, (_whole, key: string) => {
    const path = pack?.keys[key];
    if (typeof path !== 'string') { unresolved = true; return ''; }
    return trimSlash(path);
  });
  return unresolved ? null : out;
}

/* Folders a schema's location_pattern points at, as prefix folders the entity
   scan can match. Handles ` or `-joined alternatives, context-pack keys and
   record placeholders:
     "30-CLIENTS/{client-id}/00-PROFILE/"            -> ["30-CLIENTS"]
     "10-ME/10-PEOPLE/ or 30-CLIENTS/{id}/10-PEOPLE/" -> ["10-ME/10-PEOPLE", "30-CLIENTS"]
     "{company.decisions}/ or {client.decisions}/"    -> ["20-COMPANY/02-DECISIONS", "30-CLIENTS"] */
export function foldersFromLocationPattern(locationPattern: string, pack: ContextPack | null): string[] {
  const folders = String(locationPattern || '')
    .split(/\s+or\s+/i)
    .map((alternative) => {
      const literal = String(alternative || '').trim().replace(/^['"]|['"]$/g, '');
      const resolved = resolveContextKeys(literal, pack);
      if (resolved == null) return '';
      let base = resolved.split('{')[0].replace(/\/$/, '').trim();
      // A location that names one file (books-profile: `.../06-FINANCE/ENTITY.md`) matches
      // as its folder; used as a prefix folder the file path would match nothing.
      if (/\.[a-z0-9]+$/i.test(base.split('/').pop() || '')) base = base.split('/').slice(0, -1).join('/');
      // Only prefix folders can be matched; skip wildcard or suffix patterns such as "*/20-MEETINGS/".
      if (!base || base.includes('*') || base.includes(',')) return '';
      return base;
    })
    .filter(Boolean);
  return [...new Set(folders)];
}

/* A location_pattern rewritten for creating a note: each context-pack key is
   replaced by its path, and the path's generic `{id}` becomes the key's scope id
   (`{client.meetings}` -> `30-CLIENTS/{client-id}/20-MEETINGS`), the record
   placeholder form the create-folder resolver fills from the new note's
   `client_id`. Alternatives naming an undeclared key are dropped; '' when none
   is left, so creation falls back to the entity's folder. */
export function locationPatternForCreate(locationPattern: string, pack: ContextPack | null): string {
  return String(locationPattern || '')
    .split(/\s+or\s+/i)
    .map((alternative) => {
      let unresolved = false;
      const literal = String(alternative || '').trim().replace(/^['"]|['"]$/g, '');
      const out = literal.replace(/\{~?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\}/gi, (_whole, key: string) => {
        const path = pack?.keys[key];
        if (typeof path !== 'string') { unresolved = true; return ''; }
        const scope = key.split('.')[0];
        return trimSlash(path).replace(/\{id\}/g, `{${scope}-id}`);
      });
      return unresolved ? '' : out;
    })
    .filter(Boolean)
    .join(' or ');
}

let _defaultPack: ContextPack | null = null;
export function defaultContextPack(): ContextPack {
  if (!_defaultPack) {
    try {
      _defaultPack = contextPackFromManifest(obsidian.parseYaml(String((contextDefault as { yaml?: string }).yaml || '')));
    } catch (_) {
      _defaultPack = { roots: {}, keys: {} };
    }
  }
  return _defaultPack;
}

/* The active pack for a vault: its root `context.yaml` merged over the embedded
   default (or standing alone when it does not extend it); the default when the
   vault has no context.yaml or it cannot be read. */
export async function loadContextPack(app: App): Promise<ContextPack> {
  const base = defaultContextPack();
  try {
    if (!await app.vault.adapter.exists('context.yaml')) return base;
    const manifest = obsidian.parseYaml(await app.vault.adapter.read('context.yaml'));
    return contextPackFromManifest(manifest, base);
  } catch (e) {
    new obsidian.Notice(`BOB Workspace: cannot read context.yaml (${e instanceof Error ? e.message : String(e)}); using the default layout.`);
    return base;
  }
}

import { SECONDARY_TABS } from './nav';
import type { NavGroup, NavSurface, SecondaryTab } from './types';

/* The shared types miss a few runtime keys navigation actually carries:
   tabs can nest `children` tab groups and seed `icon`/`desc` for generated
   surfaces; surfaces promoted from tabs carry a `placement` marker. Extend
   locally until types.ts models them. */
export interface NavTab extends SecondaryTab {
  children?: NavTab[];
  icon?: string;
  desc?: string;
}
export interface NavSurfaceItem extends NavSurface {
  placement?: string;
}

/** Settings key under `modules` that switches a nav group on/off.
 *
 *  This is the group id. Groups used to carry a separate `module` field naming
 *  one of a fixed set of shipped modules (crm, finance, …), but it never held
 *  anything other than the group's own id, and groups authored later in a
 *  vault's workspace.json simply omitted it — leaving them with no entry in
 *  `modules` and therefore no way to be hidden at all. Keying on the id, which
 *  every group has and which is unique within navigation.groups, gives builtin
 *  and vault-authored groups the same capabilities.
 *
 *  Item-level `module` is a different, still-live concept and is untouched: a
 *  surface can name the module whose data it depends on (reports.pipeline →
 *  crm), so disabling CRM drops that report from the Reports group without
 *  hiding the group. See the item filter in AppView._visibleNavGroups.
 *
 *  Legacy group-level `module` keys are migrated onto the id in
 *  BobPlugin.loadSettings, so a pre-existing hidden group stays hidden. */
export function navGroupModuleKey(group: { id?: string } | null | undefined): string {
  if (!group) return '';
  return String(group.id || '').trim();
}

export function surfaceMatchesTab(surface: NavSurface | null | undefined, tab: SecondaryTab | null | undefined) {
  return !!surface && !!tab && (
    (tab.entityKey && surface.entityKey === tab.entityKey) ||
    (tab.route && surface.id === tab.route)
  );
}

export function isTabBackedSurface(surface: NavSurfaceItem | null | undefined, tabsByParent: Record<string, NavTab[]> = SECONDARY_TABS): boolean {
  if (!surface?.parent) return false;
  return (tabsByParent[surface.parent] || []).some((tab) =>
    surfaceMatchesTab(surface, tab) ||
    (tab.children || []).some((child) => surfaceMatchesTab(surface, child))
  );
}

export function makeNavigationSurfacePrimary(surface: NavSurfaceItem | null | undefined): void {
  if (!surface) return;
  delete surface.navLevel;
  delete surface.parent;
  delete surface.placement;
}

export function normalizeStandaloneNavigationSurfaces(groups: NavGroup[] | null | undefined, tabsByParent: Record<string, NavTab[]> = SECONDARY_TABS, normalizeSetup = false): boolean {
  let changed = false;
  (groups || []).forEach((group) => {
    (group.items || []).forEach((surface) => {
      const canNormalizeLevel = surface.navLevel === 'secondary' ||
        (normalizeSetup && surface.navLevel === 'setup');
      if (canNormalizeLevel && surface.parent &&
          !isTabBackedSurface(surface, tabsByParent)) {
        makeNavigationSurfacePrimary(surface);
        changed = true;
      }
    });
  });
  return changed;
}

export function navigationSurfaceFromTab(parentId: string, tab: NavTab, existingSurfaces: NavSurface[] = []): NavSurfaceItem {
  const match = existingSurfaces.find((surface) =>
    surfaceMatchesTab(surface, tab)
  );
  if (match) {
    return Object.assign({}, match, {
      navLevel: 'secondary',
      parent: parentId,
      placement: 'navigation',
    });
  }
  const seed = tab.entityKey || tab.route || tab.label || 'tab';
  const slug = String(seed).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tab';
  return {
    id: tab.route || `${parentId}.${slug}`,
    label: tab.label,
    icon: tab.icon || 'file-text',
    entityKey: tab.entityKey,
    navLevel: 'secondary',
    parent: parentId,
    placement: 'navigation',
    desc: tab.desc || `${tab.label} records`,
  };
}

export function removeSurfaceFromGroups(groups: NavGroup[], surfaceId: string): NavSurface | null {
  for (const group of groups) {
    const index = (group.items || []).findIndex((surface) => surface.id === surfaceId);
    if (index >= 0) return group.items.splice(index, 1)[0];
  }
  return null;
}

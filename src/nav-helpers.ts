import { SECONDARY_TABS } from './nav';
export function surfaceMatchesTab(surface, tab) {
  return !!surface && !!tab && (
    (tab.entityKey && surface.entityKey === tab.entityKey) ||
    (tab.route && surface.id === tab.route)
  );
}

export function isTabBackedSurface(surface, tabsByParent = SECONDARY_TABS) {
  if (!surface?.parent) return false;
  return (tabsByParent[surface.parent] || []).some((tab) =>
    surfaceMatchesTab(surface, tab) ||
    (tab.children || []).some((child) => surfaceMatchesTab(surface, child))
  );
}

export function makeNavigationSurfacePrimary(surface) {
  if (!surface) return;
  delete surface.navLevel;
  delete surface.parent;
  delete surface.placement;
}

export function normalizeStandaloneNavigationSurfaces(groups, tabsByParent = SECONDARY_TABS, normalizeSetup = false) {
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

export function navigationSurfaceFromTab(parentId, tab, existingSurfaces: any[] = []) {
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

export function removeSurfaceFromGroups(groups, surfaceId) {
  for (const group of groups) {
    const index = (group.items || []).findIndex((surface) => surface.id === surfaceId);
    if (index >= 0) return group.items.splice(index, 1)[0];
  }
  return null;
}


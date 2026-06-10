import { resetEntityRegistry } from './bases-config';
import { applyBaseOverrides, applyConfiguredBaseOverrides } from './bases-parse';
import { NAV_GROUPS, SECONDARY_TABS, WORKBOOK_EXPORT_GROUPS, applyWorkspaceRegistries, rebuildSurfaceLookups, resetWorkspaceRegistries } from './nav';
import { bootstrapCanonicalSchemaSourcesIfMissing, regenerateSchemaOutputs } from './schema-designer';
import { SCHEMA_FOLDER_DEFAULT, applySchemas } from './schemas';
import { WORKSPACE_CONFIG, effectiveSchemaSettings, loadWorkspaceConfig, workspaceOwnedSettings } from './workspace-config';
export async function reloadEntityConfiguration(app, settings: any = {}) {
  resetWorkspaceRegistries();
  await loadWorkspaceConfig(app);
  resetEntityRegistry(settings);
  applyWorkspaceRegistries(WORKSPACE_CONFIG);
  const effectiveSettings = effectiveSchemaSettings(settings);
  if (effectiveSettings.useSchemas) {
    const bootstrap = await bootstrapCanonicalSchemaSourcesIfMissing(app, effectiveSettings);
    if (bootstrap.count) {
      await regenerateSchemaOutputs(app, effectiveSettings);
    }
    await applySchemas(app, effectiveSettings);
  }
  await applyConfiguredBaseOverrides(app, settings);
  await applyBaseOverrides(app, settings);
  rebuildSurfaceLookups();
}


export function workspaceConfigTemplate(settings: any = {}) {
  const bases = {};
  Object.entries<any>(settings.baseFiles || {}).forEach(([entityKey, file]) => {
    if (!file) return;
    bases[entityKey] = { file };
    if ((settings.baseViews || {})[entityKey]) bases[entityKey].view = settings.baseViews[entityKey];
  });
  return JSON.stringify({
    _comment: 'This file controls no-code workspace composition. Canonical entity definitions are in schema YAML; dashboards, navigation, and exports are configured here rather than hardcoded in the plugin.',
    settings: workspaceOwnedSettings(settings),
    schemas: {
      enabled: !!settings.useSchemas,
      folder: settings.schemasFolder || SCHEMA_FOLDER_DEFAULT,
    },
    bases,
    planner: WORKSPACE_CONFIG.planner || {},
    dashboards: WORKSPACE_CONFIG.dashboards || {},
    templates: WORKSPACE_CONFIG.templates || {},
    navigation: {
      groups: NAV_GROUPS,
      secondaryTabs: SECONDARY_TABS,
      actions: {},
    },
    workbookGroups: WORKBOOK_EXPORT_GROUPS,
  }, null, 2);
}


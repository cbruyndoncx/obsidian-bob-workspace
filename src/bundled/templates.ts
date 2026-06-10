/*
 * Workspace starter templates, bundled into main.js at build time.
 *
 * Why bundled: Obsidian's plugin installer only delivers main.js /
 * manifest.json / styles.css — the templates/ folder is NOT shipped, and
 * fs/__dirname reads don't work in the plugin runtime.
 *
 * templates/workspace-*.json are the editable sources of truth; esbuild's
 * native JSON loader inlines them here. When adding a new shipped template,
 * add its import below (keys are the original file names — template lookup
 * and workspaceTemplateKey() depend on them).
 */
import workspaceBob from '../../templates/workspace-bob.json';
import workspaceCadence from '../../templates/workspace-cadence.json';
import workspaceCrm from '../../templates/workspace-crm.json';
import workspaceEmai from '../../templates/workspace-emai.json';
import workspaceMinimal from '../../templates/workspace-minimal.json';

export const BUNDLED_WORKSPACE_TEMPLATES: Record<string, any> = {
  'workspace-bob.json': workspaceBob,
  'workspace-cadence.json': workspaceCadence,
  'workspace-crm.json': workspaceCrm,
  'workspace-emai.json': workspaceEmai,
  'workspace-minimal.json': workspaceMinimal,
};

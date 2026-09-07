const esbuild = require('esbuild');
const vm = require('vm');
const path = require('path');

// Real module graph, including imported bindings; only host APIs are mocked.
function loadReviewModules(obsidian, globals = {}) {
  const result = esbuild.buildSync({
    stdin: { contents: `
      export * as fields from './src/field-values';
      export * as schemas from './src/schemas';
      export * as entities from './src/entities';
      export * as files from './src/entity-files';
      export * as workbook from './src/workbook';
      export * as config from './src/workspace-config';
      export * as templates from './src/workspace-templates';
      export * as storage from './src/canvas-storage';
      export * as notes from './src/notes';
      export { BobAppView } from './src/views/app-view';
    `, resolveDir: path.resolve(__dirname, '..') },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2021', external: ['obsidian'], logLevel: 'silent',
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module, exports: module.exports, require: (name) => name === 'obsidian' ? obsidian : require(name),
    console, setTimeout, clearTimeout, Date, navigator: { language: 'en' }, ...globals,
  });
  return module.exports;
}
module.exports = { loadReviewModules };

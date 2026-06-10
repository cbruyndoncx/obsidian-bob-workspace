const assert = require('assert');
const path = require('path');
const Module = require('module');

/*
 * Smoke test: the built main.js must evaluate end-to-end (catches module
 * initialization-order/TDZ regressions from the src/ split) and export the
 * plugin class the way Obsidian's loader consumes it.
 */

class StubComponent {
  constructor() {}
  load() {}
  unload() {}
  addChild() {}
  registerEvent() {}
  registerInterval() {}
}
class StubPlugin extends StubComponent {}
class StubModal { constructor() {} open() {} close() {} }
class StubSuggestModal extends StubModal { setPlaceholder() {} }
class StubItemView extends StubComponent { constructor() { super(); } }
class StubPluginSettingTab { constructor() {} }

const obsidianStub = new Proxy({
  Plugin: StubPlugin,
  Modal: StubModal,
  SuggestModal: StubSuggestModal,
  ItemView: StubItemView,
  PluginSettingTab: StubPluginSettingTab,
  Notice: class Notice { constructor() {} },
  Component: StubComponent,
  TFile: class TFile {},
  TFolder: class TFolder {},
  BasesView: undefined,
  setIcon: () => {},
  parseYaml: () => ({}),
  stringifyYaml: () => '',
  normalizePath: (p) => p,
}, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop !== 'string') return undefined;
    // Unanticipated obsidian API member: serve a permissive stand-in class.
    return class GenericStub { constructor() {} };
  },
});

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'obsidian') return obsidianStub;
  return origLoad.apply(this, arguments);
};

try {
  const mainPath = path.join(__dirname, '..', 'main.js');
  delete require.cache[require.resolve(mainPath)];
  const mod = require(mainPath);
  const PluginClass = mod.default ?? mod;
  assert.strictEqual(typeof PluginClass, 'function', 'main.js exports a plugin class (default export)');
  assert.strictEqual(typeof PluginClass.prototype.onload, 'function', 'plugin class has onload()');
  assert.strictEqual(typeof PluginClass.prototype.loadSettings, 'function', 'plugin class has loadSettings()');
} finally {
  Module._load = origLoad;
}

console.log('plugin-load.test.js: ok');

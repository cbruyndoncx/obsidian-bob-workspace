// A rejected async assertion (some test files use `(async () => {...})()` IIFEs)
// must fail loudly and non-zero, never hide behind the success line below.
process.on('unhandledRejection', (err) => { console.error(err); process.exit(1); });

require('./base-filter.test');
require('./bases.test');
require('./dashboard-config.test');
require('./dashboard-state.test');
require('./pinned-surfaces.test');
require('./project-note.test');
require('./template-bundle.test');
require('./template-validate.test');
require('./xlsx-bundle.test');
require('./export-view-filter.test');
require('./canvas.test');
require('./entity-files-filter.test');
require('./workbook.test');
require('./widget-source.test');
require('./workspace-config.test');
require('./plugin-load.test');
require('./build-freshness.test');
// Print success only once the event loop drains — i.e. after async IIFE tests
// have settled — so it can never precede an async failure.
process.on('beforeExit', () => console.log('all tests passed'));

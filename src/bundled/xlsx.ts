/*
 * SheetJS (mini) — vendor/xlsx.mini.min.js bundled into main.js at build time.
 *
 * Why bundled: Obsidian's installer delivers only main.js / manifest.json /
 * styles.css — vendor/ is NOT shipped, and require() against plugin paths is
 * unreliable in the runtime.
 *
 * The require() below is a lazy seam, not a Node dependency: esbuild inlines
 * the vendored CommonJS module wrapped in a __commonJS closure that executes
 * only on the first call, so V8 compiles the library lazily on first
 * getXLSX() use and there is no eval for the store reviewer to flag.
 */
export function loadBundledXLSX(): any {
  return require('../../vendor/xlsx.mini.min.js');
}

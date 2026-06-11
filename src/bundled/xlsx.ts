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
/** A worksheet as exposed by SheetJS — cell map plus bookkeeping keys. */
export type XlsxWorksheet = Record<string, unknown>;

export interface XlsxWorkbook {
  SheetNames: string[];
  Sheets: Record<string, XlsxWorksheet>;
}

/** Minimal surface of the SheetJS (mini) library actually used by the plugin. */
export interface XlsxLib {
  utils: {
    book_new(): XlsxWorkbook;
    json_to_sheet(rows: Record<string, unknown>[], opts?: { header?: string[] }): XlsxWorksheet;
    book_append_sheet(wb: XlsxWorkbook, ws: XlsxWorksheet, name?: string): void;
    sheet_to_json(ws: XlsxWorksheet, opts?: { defval?: unknown; raw?: boolean; header?: number | string | string[] }): Record<string, unknown>[];
    sheet_to_csv(ws: XlsxWorksheet, opts?: Record<string, unknown>): string;
  };
  write(wb: XlsxWorkbook, opts?: { bookType?: string; type?: string }): ArrayBuffer;
  read(data: ArrayBuffer | Uint8Array, opts?: { type?: string; cellDates?: boolean }): XlsxWorkbook;
}

export function loadBundledXLSX(): XlsxLib {
  return require('../../vendor/xlsx.mini.min.js');
}

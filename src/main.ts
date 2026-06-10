/*
 * BOB Workspace — plugin entry point.
 * Obsidian loads the compiled main.js (built by esbuild from this tree) and
 * instantiates the default export.
 */
import { CadencePlugin } from './plugin';

export default CadencePlugin;

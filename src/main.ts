/*
 * BOB Workspace — plugin entry point.
 * Obsidian loads the compiled main.js (built by esbuild from this tree) and
 * instantiates the default export.
 */
import { BobPlugin } from './plugin';

export default BobPlugin;

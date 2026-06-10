import esbuild from 'esbuild';
import process from 'process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildOptions } = require('./esbuild.shared.cjs');

const prod = process.argv[2] === 'production';

const context = await esbuild.context({
  ...buildOptions(),
  sourcemap: prod ? false : 'inline',
  logLevel: 'info',
  outfile: 'main.js',
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}

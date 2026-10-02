import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({
  entryPoints: [fileURLToPath(new URL('./collector.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/collector.cjs', import.meta.url)),
  bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true,
});

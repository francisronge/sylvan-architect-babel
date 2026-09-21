import { inlineWorkerPlugin } from './inlineWorkerPlugin.mjs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';

// Both published Orchard pages load identical artifacts. Build from the same
// TreeVisualizer and styles used by the app; cards provide data and chrome only.
await build({
  plugins: [inlineWorkerPlugin()],
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['docs/design/visual-relations-current-lab.tsx'],
  outfile: 'docs/design/visual-relations-current-lab.production-only-audit.r96.bundle.js',
  bundle: true, format: 'iife', jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' }
});
await copyFile(
  new URL('../docs/design/visual-relations-current-lab.production-only-audit.r96.bundle.js', import.meta.url),
  new URL('../docs/research/relation-orchard/relation-orchard.bundle.js', import.meta.url)
);

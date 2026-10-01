import { inlineWorkerPlugin } from './inlineWorkerPlugin.mjs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

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

// A new published drawing must not reuse an older cached bundle or source layout.
for (const page of [
  '../docs/design/babel-visual-relations-research.production-only-audit.html',
  '../docs/research/relation-orchard/orchard.html'
]) {
  const location = new URL(page, import.meta.url);
  const html = await readFile(location, 'utf8');
  let updated = html;
  for (const match of html.matchAll(/(?:src|href)="([^"?]+(?:\.bundle\.js|source-citations\.css))(?:\?[^\"]*)?"/g)) {
    const bytes = await readFile(new URL(match[1], location));
    const version = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    updated = updated.replace(match[0], match[0].replace(/=".*"$/, `="${match[1]}?v=${version}"`));
  }
  await writeFile(location, updated);
}

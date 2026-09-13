import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const auditHtml = path.join(repoRoot, 'docs/design/babel-visual-relations-research.production-only-audit.html');
const reviewCss = path.join(repoRoot, 'docs/design/visual-relations-tier2-review.production.css');

const html = fs.readFileSync(auditHtml, 'utf8');
const relationStyles = fs.readFileSync(path.join(repoRoot, 'docs/research/relation-orchard/relation-visuals.css'), 'utf8');
const productionStyles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gu)]
  .map((match) => match[1].trim())
  .filter(Boolean);

if (productionStyles.length === 0) {
  throw new Error('The production Orchard audit contains no inline renderer styles.');
}

fs.writeFileSync(
  reviewCss,
  `/* Generated from babel-visual-relations-research.production-only-audit.html. */\n${relationStyles}\n${productionStyles.join('\n\n')}\n`,
  'utf8'
);

await build({
  entryPoints: [path.join(repoRoot, 'docs/design/visual-relations-tier2-review.tsx')],
  bundle: true,
  format: 'iife',
  globalName: 'BabelTier2VisualReview',
  outfile: path.join(repoRoot, 'docs/design/visual-relations-tier2-review.bundle.js'),
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  logLevel: 'info'
});

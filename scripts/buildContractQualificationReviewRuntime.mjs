import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { inlineWorkerPlugin } from './inlineWorkerPlugin.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const buildQualificationReviewRuntime = async () => {
  const workerInputs = new Set();
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: ['contractQualification/reviewApp.tsx'],
    bundle: true, write: false, outfile: 'review.js', format: 'iife',
    jsx: 'automatic', minify: true, metafile: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl' },
    plugins: [inlineWorkerPlugin({ onInputs: inputs => inputs.forEach(input => workerInputs.add(input)) }), { name: 'production-styles', setup(builder) {
      builder.onLoad({ filter: /styles\.css$/ }, async ({ path: file }) => {
        const css = await fs.readFile(file, 'utf8');
        const processed = await postcss([tailwindcss({ config: path.join(repoRoot, 'tailwind.config.cjs') })])
          .process(css, { from: file });
        return { contents: processed.css, loader: 'css', resolveDir: path.dirname(file) };
      });
    } }]
  });
  const logo = await fs.readFile(path.join(repoRoot, 'public/babellogo.png'));
  const js = `window.__BABEL_LOGO_SRC__="data:image/png;base64,${logo.toString('base64')}";\n`
    + result.outputFiles.find((file) => file.path.endsWith('.js')).text;
  const css = result.outputFiles.find((file) => file.path.endsWith('.css')).text;
  const sources = [];
  for (const file of [...new Set([...Object.keys(result.metafile.inputs), ...workerInputs, 'tailwind.config.cjs', 'public/babellogo.png'])].sort()) {
    if (file.startsWith('node_modules/')) continue;
    sources.push({ path: file, sha256: sha256(await fs.readFile(path.join(repoRoot, file))) });
  }
  return { js, css, metadata: {
    kind: 'production-tree-visualizer', jsSha256: sha256(js), cssSha256: sha256(css), sources
  } };
};

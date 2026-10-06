import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { inlineWorkerPlugin } from './inlineWorkerPlugin.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(import.meta.url);

export const buildQualificationReviewRuntime = async ({ root = repoRoot, entrySource } = {}) => {
  root = path.resolve(root);
  const config = require(path.join(root, 'tailwind.config.cjs'));
  const content = Array.isArray(config.content) ? { files: config.content } : config.content;
  // PR comparisons build two checkouts in one process. Each stylesheet must scan
  // its own checkout, regardless of the process's working directory.
  const stylesConfig = { ...config, content: { ...content, files: content.files.map(file => {
    if (typeof file !== 'string') return file;
    const negated = file.startsWith('!');
    return (negated ? '!' : '') + path.resolve(root, negated ? file.slice(1) : file);
  }) } };
  const workerInputs = new Set();
  const result = await build({
    absWorkingDir: root,
    ...(entrySource ? { stdin: { contents: entrySource, resolveDir: root, loader: 'tsx' } }
      : { entryPoints: ['contractQualification/reviewApp.tsx'] }),
    bundle: true, write: false, outfile: 'review.js', format: 'iife',
    jsx: 'automatic', minify: true, metafile: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.woff': 'dataurl', '.woff2': 'dataurl' },
    plugins: [inlineWorkerPlugin({ onInputs: inputs => inputs.forEach(input => workerInputs.add(input)) }), { name: 'production-styles', setup(builder) {
      builder.onLoad({ filter: /styles\.css$/ }, async ({ path: file }) => {
        const css = await fs.readFile(file, 'utf8');
        const processed = await postcss([tailwindcss(stylesConfig)])
          .process(css, { from: file });
        return { contents: processed.css, loader: 'css', resolveDir: path.dirname(file) };
      });
    } }]
  });
  const logo = await fs.readFile(path.join(root, 'public/babellogo.png'));
  const js = `window.__BABEL_LOGO_SRC__="data:image/png;base64,${logo.toString('base64')}";\n`
    + result.outputFiles.find((file) => file.path.endsWith('.js')).text;
  const css = result.outputFiles.find((file) => file.path.endsWith('.css')).text;
  const sources = [];
  for (const file of [...new Set([...Object.keys(result.metafile.inputs), ...workerInputs, 'tailwind.config.cjs', 'public/babellogo.png'])].sort()) {
    if (file.startsWith('node_modules/') || file === '<stdin>') continue;
    sources.push({ path: file, sha256: sha256(await fs.readFile(path.join(root, file))) });
  }
  return { js, css, metadata: {
    kind: 'production-tree-visualizer', jsSha256: sha256(js), cssSha256: sha256(css), sources
  } };
};

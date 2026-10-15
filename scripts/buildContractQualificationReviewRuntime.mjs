import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { inlineWorkerPlugin, sourceSnapshotPlugin } from './inlineWorkerPlugin.mjs';
import { createRuntimeProvenance, resolveStyleContent, runtimeBuildTools, sha256 } from './reviewRuntimeProvenance.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

export const buildQualificationReviewRuntime = async ({ root = repoRoot, entrySource } = {}) => {
  root = await fs.realpath(path.resolve(root));
  const consumedSources = new Map();
  const recordSource = (file, bytes) => {
    const digest = sha256(bytes), before = consumedSources.get(file);
    if (before && before !== digest) throw new Error(`Build input changed during compilation: ${file}`);
    consumedSources.set(file, digest);
  };
  for (const file of ['tailwind.config.cjs', 'package-lock.json']) {
    const absolute = path.join(root, file);
    recordSource(absolute, await fs.readFile(absolute));
  }
  const tools = await runtimeBuildTools();
  delete require.cache[require.resolve(path.join(root, 'tailwind.config.cjs'))];
  const config = require(path.join(root, 'tailwind.config.cjs'));
  const content = Array.isArray(config.content) ? { files: config.content } : config.content;
  const styleContent = await resolveStyleContent(root, content.files);
  for (const file of styleContent.files) {
    const absolute = path.join(root, file);
    recordSource(absolute, await fs.readFile(absolute));
  }
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
    plugins: [inlineWorkerPlugin({ onInputs: inputs => inputs.forEach(input => workerInputs.add(input)), onSource: recordSource }), { name: 'production-styles', setup(builder) {
      builder.onLoad({ filter: /styles\.css$/ }, async ({ path: file }) => {
        const css = await fs.readFile(file, 'utf8');
        recordSource(file, css);
        const processed = await postcss([tailwindcss(stylesConfig)])
          .process(css, { from: file });
        return { contents: processed.css, loader: 'css', resolveDir: path.dirname(file) };
      });
    } }, sourceSnapshotPlugin({ onSource: recordSource })]
  });
  const logo = await fs.readFile(path.join(root, 'public/babellogo.png'));
  recordSource(path.join(root, 'public/babellogo.png'), logo);
  const js = `window.__BABEL_LOGO_SRC__="data:image/png;base64,${logo.toString('base64')}";\n`
    + result.outputFiles.find((file) => file.path.endsWith('.js')).text;
  const css = result.outputFiles.find((file) => file.path.endsWith('.css')).text;
  const metadata = await createRuntimeProvenance({ root, entrySource, js, css, tools, styleContent, consumedSources,
    bundleInputFiles: [...Object.keys(result.metafile.inputs), ...workerInputs],
    inputFiles: [...Object.keys(result.metafile.inputs), ...workerInputs, 'tailwind.config.cjs', 'public/babellogo.png'] });
  if (JSON.stringify(await runtimeBuildTools()) !== JSON.stringify(tools)) throw new Error('Runtime build tools changed during compilation.');
  return { js, css, metadata };
};

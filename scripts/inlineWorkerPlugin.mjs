import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const sourceLoader = file => {
  const extension = path.extname(file).slice(1);
  return ['cjs', 'mjs'].includes(extension) ? 'js' : ['cts', 'mts'].includes(extension) ? 'ts' : extension;
};

/** Record the exact local bytes esbuild consumes, including a worker's separate build. */
export const sourceSnapshotPlugin = ({ onSource }) => ({
  name: 'snapshot-babel-build-inputs',
  setup(builder) {
    builder.onLoad({ filter: /\.(?:[cm]?[jt]sx?|css|json)$/ }, async ({ path: file }) => {
      if (file.includes('node_modules')) return;
      const contents = await fs.readFile(file, 'utf8');
      onSource(file, contents);
      return { contents, loader: sourceLoader(file) };
    });
  }
});

/** Keep standalone review bundles on the same worker entry points as Vite. */
export const inlineWorkerPlugin = ({ onInputs = () => {}, onSource } = {}) => ({
  name: 'inline-babel-workers',
  setup(builder) {
    builder.onLoad({ filter: /\.[jt]sx?$/ }, async ({ path: file }) => {
      if (file.includes('node_modules')) return;
      let contents = await fs.readFile(file, 'utf8');
      onSource?.(file, contents);
      const pattern = /new Worker\(new URL\('([^']+\.worker\.ts)', import\.meta\.url\), \{ type: 'module' \}\)/g;
      const matches = [...contents.matchAll(pattern)];
      if (!matches.length) return onSource ? { contents, loader: sourceLoader(file) } : undefined;
      for (const match of matches) {
        const worker = await build({ absWorkingDir: builder.initialOptions.absWorkingDir,
          entryPoints: [path.resolve(path.dirname(file), match[1])], bundle: true,
          write: false, format: 'iife', minify: true, metafile: true,
          plugins: onSource ? [sourceSnapshotPlugin({ onSource })] : [] });
        onInputs(Object.keys(worker.metafile.inputs));
        const source = JSON.stringify(worker.outputFiles[0].text);
        contents = contents.replace(match[0], () => `(() => {
          const url = URL.createObjectURL(new Blob([${source}], { type: 'text/javascript' }));
          let released = false;
          const release = () => {
            if (!released) { released = true; URL.revokeObjectURL(url); }
          };
          try {
            const worker = new Worker(url);
            // WebKit may fetch the script after construction returns. Keep its
            // URL until the job responds, fails, or is explicitly cancelled.
            for (const event of ['message', 'error', 'messageerror']) {
              worker.addEventListener(event, release, { once: true });
            }
            const terminate = worker.terminate.bind(worker);
            worker.terminate = () => { try { terminate(); } finally { release(); } };
            return worker;
          } catch (error) { release(); throw error; }
        })()`);
      }
      return { contents, loader: file.endsWith('tsx') ? 'tsx' : 'ts' };
    });
  }
});

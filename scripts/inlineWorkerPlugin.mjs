import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

/** Keep standalone review bundles on the same worker entry points as Vite. */
export const inlineWorkerPlugin = ({ onInputs = () => {} } = {}) => ({
  name: 'inline-babel-workers',
  setup(builder) {
    builder.onLoad({ filter: /\.[jt]sx?$/ }, async ({ path: file }) => {
      if (file.includes('node_modules')) return;
      let contents = await fs.readFile(file, 'utf8');
      const pattern = /new Worker\(new URL\('([^']+\.worker\.ts)', import\.meta\.url\), \{ type: 'module' \}\)/g;
      const matches = [...contents.matchAll(pattern)];
      if (!matches.length) return;
      for (const match of matches) {
        const worker = await build({ absWorkingDir: builder.initialOptions.absWorkingDir,
          entryPoints: [path.resolve(path.dirname(file), match[1])], bundle: true,
          write: false, format: 'iife', minify: true, metafile: true });
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

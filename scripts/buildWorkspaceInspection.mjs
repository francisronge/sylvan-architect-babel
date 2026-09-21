import { inlineWorkerPlugin } from './inlineWorkerPlugin.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const repoRoot = path.resolve(import.meta.dirname, '..');
const [output, ...inputs] = process.argv.slice(2);
if (!output || !inputs.length) throw new Error('Usage: node scripts/buildWorkspaceInspection.mjs OUTPUT.html INSPECTION.json [...]');
const records = [];
for (const input of inputs) {
  const record = JSON.parse(await fs.readFile(input, 'utf8'));
  if (record.kind !== 'authored-workspace-inspection' || !Array.isArray(record.analyses)) {
    throw new Error(`Not a workspace inspection record: ${input}`);
  }
  records.push({ title: path.basename(input, '.json'), record });
}
const result = await build({
  absWorkingDir: repoRoot,
  entryPoints: ['contractQualification/WorkspaceInspection.tsx'],
  bundle: true, write: false, outfile: 'inspection.js', format: 'iife',
  jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl' },
  plugins: [inlineWorkerPlugin(), { name: 'production-styles', setup(builder) {
    builder.onLoad({ filter: /styles\.css$/ }, async ({ path: file }) => {
      const css = await fs.readFile(file, 'utf8');
      const processed = await postcss([tailwindcss()]).process(css, { from: file });
      return { contents: processed.css, loader: 'css', resolveDir: path.dirname(file) };
    });
  } }]
});
const js = result.outputFiles.find((file) => file.path.endsWith('.js')).text;
const css = result.outputFiles.find((file) => file.path.endsWith('.css')).text;
const data = JSON.stringify(records).replace(/</g, '\\u003c');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'"><title>Babel stage inspection</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script id="inspection-data" type="application/json">${data}</script><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
await fs.writeFile(path.resolve(output), html, { flag: 'wx' });
console.log(path.resolve(output));

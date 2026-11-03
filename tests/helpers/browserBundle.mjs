import { build } from 'esbuild';
import { inlineWorkerPlugin } from '../../scripts/inlineWorkerPlugin.mjs';

const repoRoot = new URL('../../', import.meta.url).pathname;

/**
 * Bundles one inline TSX entry, resolved from the repository root, into a
 * production IIFE for a browser test page. Workers are inlined as the app's
 * Vite build inlines them, so the page needs no server.
 */
export async function bundleTsxEntry(contents) {
  const compiled = await build({
    plugins: [inlineWorkerPlugin()], absWorkingDir: repoRoot,
    stdin: { contents, loader: 'tsx', resolveDir: repoRoot },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  return compiled.outputFiles[0].text;
}

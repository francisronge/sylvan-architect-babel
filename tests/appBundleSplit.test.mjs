import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build as viteBuild } from 'vite';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));

test('first load leaves Replay construction and the renderer to the lazily loaded tree view chunk', async () => {
  // The production build itself, in memory, so the check sees Rollup's real chunks.
  const result = await viteBuild({ root, configFile: `${root}vite.config.ts`, logLevel: 'silent', build: { write: false } });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(build => build.output).filter(output => output.type === 'chunk');
  const byName = new Map(outputs.map(chunk => [chunk.fileName, chunk]));
  const firstLoad = new Set();
  const visit = chunk => {
    if (firstLoad.has(chunk)) return;
    firstLoad.add(chunk);
    for (const name of chunk.imports) visit(byName.get(name));
  };
  visit(outputs.find(chunk => chunk.isEntry));
  const modules = [...firstLoad].flatMap(chunk => Object.entries(chunk.modules)
    .filter(([, module]) => module.renderedLength > 0).map(([id]) => path.relative(root, id)));
  assert(modules.includes('App.tsx'));
  for (const heavy of ['components/AsyncTreeVisualizer.tsx', 'components/TreeVisualizer.tsx', 'replay/replayCompiler.ts', 'replay/prepareReplay.ts']) {
    assert(!modules.includes(heavy), `${heavy} is in the first-load bundle`);
  }
  assert.deepEqual(modules.filter(id => id.startsWith('components/renderer/')), [], 'no renderer module loads first');
  const tree = outputs.find(chunk => chunk.isDynamicEntry
    && Object.keys(chunk.modules).some(id => path.relative(root, id) === 'components/AsyncTreeVisualizer.tsx'));
  assert(tree && !firstLoad.has(tree) && Object.keys(tree.modules).some(id => path.relative(root, id) === 'components/TreeVisualizer.tsx'),
    'the tree view builds as its own chunk');
});

test('the tree view shows the preparation status until its chunk loads, then mounts synchronously', async () => {
  const compiled = await build({
    stdin: { contents: "export { default, preloadTreeVisualizer } from './components/LazyTreeVisualizer.tsx';", resolveDir: root, loader: 'tsx' },
    bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'tree-stub', setup(builder) {
      builder.onResolve({ filter: /^\.\/AsyncTreeVisualizer$/ }, () => ({ path: 'tree', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: "import React from 'react'; export default ({ sentence }) => React.createElement('p', { 'data-tree': 'ready' }, sentence);",
        loader: 'tsx', resolveDir: root
      }));
      builder.onResolve({ filter: /^[^./]/ }, ({ path }) => ({ path: pathToFileURL(require.resolve(path)).href, external: true }));
    } }]
  });
  const { default: LazyTreeVisualizer, preloadTreeVisualizer } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
  const render = () => renderToStaticMarkup(React.createElement(LazyTreeVisualizer, { sentence: 'Mia laughed' }));
  assert.match(render(), /role="status" aria-label="Loading"/);
  assert.doesNotMatch(render(), /data-tree/);
  const first = preloadTreeVisualizer();
  assert.equal(preloadTreeVisualizer(), first, 'the chunk is requested once');
  await first;
  assert.equal(render(), '<p data-tree="ready">Mia laughed</p>', 'a loaded chunk renders on the first pass, with no loading flash');
});

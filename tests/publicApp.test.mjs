import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importClosure } from '../scripts/importGraph.mjs';
import { PUBLIC_GENERATION } from '../publicApp/publicGeneration.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('public Babel never reaches the research controls or the internal app', () => {
  const reached = importClosure(['publicApp/main.tsx'], root);
  for (const file of ['App.tsx', 'index.tsx', 'components/ModelControls.tsx', 'hooks/useModelSelection.ts',
    'server/babelParser/researchModelCatalog.js', 'components/DerivationNotesView.tsx']) {
    assert.ok(!reached.has(file), `public Babel must not import ${file}`);
  }
  assert.ok(reached.has('components/LazyTreeVisualizer.tsx'), 'public Babel shows Replay');
});

test('public Babel asks for Minimalism and makes no model choice the user sees', () => {
  assert.equal(PUBLIC_GENERATION.framework, 'minimalism');
  assert.equal(PUBLIC_GENERATION.modelId, 'openai:gpt-6.1-sol');
  assert.deepEqual({ ...PUBLIC_GENERATION.settings }, { 'reasoning.effort': 'high' });
});

test('the public first screen is the sentence box and Analyze, without the internal controls', async () => {
  const compiled = await build({
    entryPoints: [path.join(root, 'publicApp/PublicApp.tsx')],
    bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'local-test-dependencies', setup(builder) {
      builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
        path: pathToFileURL(require.resolve(specifier)).href, external: true
      }));
    } }]
  });
  const { default: PublicApp } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
  const html = renderToStaticMarkup(React.createElement(PublicApp));
  assert.match(html, /aria-label="Sentence to analyze"/);
  assert.match(html, /aria-label="Analyze sentence"/);
  assert.match(html, /Tree Bank \(0\)/);
  for (const absent of ['Arboretum Link', 'Constituent Glyphing', 'Minimalist Program', 'X-Bar Theory',
    'Save to Tree Bank', 'Reasoning', 'Hide Control Panel', 'Canopy', 'Notes', 'API Key']) {
    assert.ok(!html.includes(absent), `the public first screen shows no "${absent}"`);
  }
});

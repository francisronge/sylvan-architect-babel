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

const loadComponent = async (file) => {
  const compiled = await build({
    entryPoints: [path.join(root, file)],
    bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'local-test-dependencies', setup(builder) {
      builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
        path: pathToFileURL(require.resolve(specifier)).href, external: true
      }));
    } }]
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)).default;
};

test('the public first screen is the sentence box and Analyze, without the internal controls', async () => {
  const PublicApp = await loadComponent('publicApp/PublicApp.tsx');
  const html = renderToStaticMarkup(React.createElement(PublicApp));
  assert.match(html, /aria-label="Sentence to analyze"/);
  assert.match(html, /aria-label="Analyze sentence"/);
  assert.match(html, /aria-label="Tree Bank, 0 saved"/);
  assert.match(html, /aria-label="Babel, parse a new sentence"/, 'the logo returns to the sentence box');
  assert.match(html, /class="analyze-glyph /, 'Analyze shows the labelled tree');
  assert.ok(!html.includes('lucide-sparkles'), 'and no sparkles');
  for (const absent of ['Arboretum Link', 'Constituent Glyphing', 'Minimalist Program', 'X-Bar Theory',
    'Save to Tree Bank', 'Reasoning', 'Hide Control Panel', 'Canopy', 'Notes', 'API Key',
    'Fullscreen', 'neural synthesis', '<footer']) {
    assert.ok(!html.includes(absent), `the public first screen shows no "${absent}"`);
  }
});

test('the Tree Bank entry is a grove of up to five trees, with the count only in its spoken label', async () => {
  const TreeBankBranch = await loadComponent('components/workspace/TreeBankBranch.tsx');
  const render = (count, open = false) => renderToStaticMarkup(React.createElement(TreeBankBranch, { count, open, onToggle() {} }));
  const trees = (html) => html.match(/<g /g)?.length ?? 0;
  assert.equal(trees(render(0)), 1, 'an empty Tree Bank shows one tree');
  assert.match(render(0), /rgba\(255,255,255,0\.18\)/, 'and that tree is faint');
  assert.equal(trees(render(3)), 3);
  assert.equal(trees(render(12)), 5, 'the grove stops at five trees');
  assert.match(render(12), /aria-label="Tree Bank, 12 saved"/);
  assert.match(render(12, true), /aria-label="Tree Bank, open"/);
  for (const count of [0, 1, 12]) assert.ok(!/\btrees?\b/.test(render(count).replace(/<[^>]*>/g, ' ')), 'no count is printed');
});

test('Tailwind generates the classes only public Babel uses', () => {
  const { content } = require('../tailwind.config.cjs');
  assert.ok(content.includes('./publicApp/**/*.{ts,tsx}'), 'tailwind.config.cjs scans publicApp/');
});

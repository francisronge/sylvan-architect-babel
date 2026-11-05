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
    'server/babelParser/researchModelCatalog.js']) {
    assert.ok(!reached.has(file), `public Babel must not import ${file}`);
  }
  assert.ok(reached.has('components/LazyTreeVisualizer.tsx'), 'public Babel shows Replay');
});

test('public Babel asks for Minimalism and makes no model choice the user sees', () => {
  assert.equal(PUBLIC_GENERATION.framework, 'minimalism');
  assert.equal(PUBLIC_GENERATION.modelId, 'openai:gpt-6.1-sol');
  assert.deepEqual({ ...PUBLIC_GENERATION.settings }, { 'reasoning.effort': 'high' });
});

const loadModule = async (file) => {
  const compiled = await build({
    entryPoints: [path.join(root, file)],
    bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'local-test-dependencies', setup(builder) {
      builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
        path: pathToFileURL(require.resolve(specifier)).href, external: true
      }));
    } }]
  });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
};
const loadComponent = async (file) => (await loadModule(file)).default;

test('the public first screen is the sentence box and Analyze, without the internal controls', async () => {
  const PublicApp = await loadComponent('publicApp/PublicApp.tsx');
  const html = renderToStaticMarkup(React.createElement(PublicApp));
  assert.match(html, /aria-label="Sentence to analyze"/);
  assert.match(html, /aria-label="Analyze sentence"/);
  assert.match(html, /aria-label="Tree Bank, 0 saved"/);
  assert.match(html, /aria-label="Babel, parse a new sentence"/, 'the logo returns to the sentence box');
  assert.match(html, /class="analyze-glyph /, 'Analyze shows the labelled tree');
  assert.ok(!html.includes('lucide-sparkles'), 'and no sparkles');
  // An inline textarea leaves room below it for letter tails, which lowered the button beside it by 6px.
  assert.match(html, /<textarea[^>]*class="block /, 'the sentence box is a block, so Analyze lines up with it');
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

test('the waiting tree grows on the measured wait, bottom-up, and never completes before the analysis', async () => {
  const { waitingTreeProgress, branchDrawn, WAITING_TREE_BRANCHES } = await loadModule('components/workspace/WaitingTree.tsx');
  assert.equal(WAITING_TREE_BRANCHES.length, 14);
  assert.equal(waitingTreeProgress(0), 0);
  assert.equal(waitingTreeProgress(-500), 0, 'a clock behind the start shows no growth');
  // Median 2.4 min and 90th percentile 3.5 min (29 Oct 2026 batch).
  assert.ok(Math.abs(waitingTreeProgress(144_000) - 0.84) < 0.01);
  assert.ok(waitingTreeProgress(210_000) > 0.9);
  assert.ok(waitingTreeProgress(3_600_000) < 1, 'an hour on, the tree is still short of complete');
  const lastBranch = WAITING_TREE_BRANCHES.length - 1;
  assert.ok(branchDrawn(waitingTreeProgress(3_600_000), lastBranch) > 0.99);
  assert.ok(branchDrawn(waitingTreeProgress(144_000), lastBranch) === 0, 'at the median wait the root is not yet joined');
  // Merge builds upward: each branch starts at its daughter, and a mother joins only after her daughters' phrases.
  const order = WAITING_TREE_BRANCHES.map(branch => branch.mother);
  assert.equal(order.at(-1), 'r', 'the root is merged last');
  for (const branch of WAITING_TREE_BRANCHES) {
    const motherOfDaughter = WAITING_TREE_BRANCHES.findIndex(other => other.mother === branch.daughter);
    if (motherOfDaughter !== -1) assert.ok(motherOfDaughter < WAITING_TREE_BRANCHES.indexOf(branch), `${branch.daughter} is built before it joins ${branch.mother}`);
  }
});

test('the waiting screen shows the sentence, the tree and one line, with no timer', async () => {
  const WaitingTree = await loadComponent('components/workspace/WaitingTree.tsx');
  const html = renderToStaticMarkup(React.createElement(WaitingTree, { sentence: 'Mia <laughed>.', startedAt: Date.now() }));
  assert.match(html, /“Mia &lt;laughed&gt;\.”/);
  assert.equal((html.match(/<path /g) ?? []).length, 14);
  assert.match(html, /role="status"[^>]*>Usually about two minutes\. Switch tabs or get a coffee; your tree will be in your Tree Bank\.</);
  assert.ok(!/\d:\d\d/.test(html.replace(/<[^>]*>/g, ' ')), 'no timer');
  assert.ok(!html.includes('Synthesizing'), 'the old loading line is gone');
});

test('the Tree Bank links to the privacy notice in this repository, and the first screen does not', async () => {
  const { readFile, access } = await import('node:fs/promises');
  const source = await readFile(path.join(root, 'publicApp/PublicApp.tsx'), 'utf8');
  const url = source.match(/const PRIVACY_URL = '([^']+)'/)?.[1];
  assert.equal(url, 'https://github.com/francisronge/sylvan-architect-babel/blob/main/PRIVACY.md');
  await access(path.join(root, 'PRIVACY.md'));
  assert.equal((source.match(/PRIVACY_URL/g) ?? []).length, 2, 'declared once and used once, in the Tree Bank footer');
  assert.match(source, /<TreeBankView[\s\S]*?footer=\{[\s\S]*?href=\{PRIVACY_URL\}[\s\S]*?\/>/);
});

test('Vercel builds public Babel, never the internal app with its research controls', async () => {
  const { readFile } = await import('node:fs/promises');
  const vercel = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(vercel.buildCommand, 'npm run build:public');
});

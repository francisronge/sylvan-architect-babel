import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
import { findButton, findElement, installMinimalDom, invoke } from './helpers/minimalDom.mjs';
import { saveTreeBankEntry } from '../services/treeBankStore.ts';

// The real internal App opens saves from a real (in-memory) IndexedDB Tree
// Bank; the lazily loaded Replay renderer is a marker that shows the frame App
// asks it to start on, so no Replay worker starts.
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const stub = `
  import React from 'react';
  export default function Replay({ animated, initialReplayStep, autoPlay }) {
    return React.createElement('p', { 'data-view': animated ? 'replay' : 'static',
      'data-initial-step': String(initialReplayStep), 'data-autoplay': String(autoPlay) });
  }
  export const preloadTreeVisualizer = () => Promise.resolve(Replay);`;
const compiled = await build({
  stdin: { contents: `export { default as App } from './App.tsx';`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [{ name: 'app-reopen-test', setup(builder) {
    builder.onResolve({ filter: /^\.\/components\/LazyTreeVisualizer$/ }, ({ importer }) =>
      importer.endsWith('App.tsx') ? { path: 'replay', namespace: 'stub' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: stub, loader: 'tsx', resolveDir: root }));
    builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
      path: pathToFileURL(require.resolve(specifier)).href, external: true
    }));
  } }]
});
const container = installMinimalDom();
const React = require('react');
const { createRoot } = require('react-dom/client');
const { App } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const bundle = JSON.parse(readFileSync(new URL('../fixtures/normalized/mia-laughed.xbar.json', import.meta.url), 'utf8'));

const act = callback => React.act(async () => { await callback(); });
const replay = () => findElement(container, element => element.getAttribute('data-view') === 'replay');
const settle = async (ready) => {
  for (let tries = 0; tries < 50 && !ready(); tries++) await act(() => new Promise(resolve => setTimeout(resolve, 10)));
  assert.ok(ready(), 'the awaited state arrives');
};

test('the internal app opens every save in Replay: older Canopy and Notes saves paused on the finished tree', async () => {
  const saves = [['notes', null], ['tree', 2], ['derivation', 3], ['derivation', null]];
  for (const [index, [view, replayStep]] of saves.entries()) {
    const at = new Date(Date.UTC(2026, 9, 1 + index)).toISOString();
    await saveTreeBankEntry({ id: `save-${index}`, sentence: 'Mia laughed.', framework: 'xbar', activeParseIndex: 0,
      bundle, view, replayStep, createdAt: at, updatedAt: at });
  }
  const reactRoot = createRoot(container);
  await act(() => reactRoot.render(React.createElement(App)));
  try {
    // Newest first: the Replay saves, then the Canopy save, then the Notes save.
    const expected = [['null', 'true'], ['3', 'false'], [String(Number.MAX_SAFE_INTEGER), 'false'], [String(Number.MAX_SAFE_INTEGER), 'false']];
    for (const [position, [initialStep, autoPlay]] of expected.entries()) {
      await act(() => invoke(findButton(container, 'Tree Bank ('), 'onClick'));
      await settle(() => (container.textContent.match(/Open Tree/g) || []).length === saves.length);
      const openButtons = [];
      const visit = node => { for (const child of node.childNodes) if (child.nodeType === 1) {
        if (child.tagName === 'BUTTON' && child.textContent.includes('Open Tree')) openButtons.push(child);
        visit(child);
      } };
      visit(container);
      await act(() => invoke(openButtons[position], 'onClick'));
      await settle(() => replay());
      assert.equal(replay().getAttribute('data-initial-step'), initialStep === 'null' ? 'undefined' : initialStep,
        `save ${position + 1} starts on its frame`);
      assert.equal(replay().getAttribute('data-autoplay'), autoPlay, `save ${position + 1} ${autoPlay === 'true' ? 'plays' : 'is paused'}`);
      assert.equal(findElement(container, element => element.getAttribute('aria-label') === 'Sentence to analyze'), null,
        'a reopened save gives the whole workspace to its tree');
    }
  } finally {
    await act(() => reactRoot.unmount());
  }
});

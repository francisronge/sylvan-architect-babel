import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
import { findButton, findElement, installMinimalDom, invoke } from './helpers/minimalDom.mjs';

// The real App and root boundary run in React's client renderer. The lazily
// loaded Replay renderer is replaced by a marker, which a test can make throw
// while rendering, so no Replay worker starts.
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const entry = `
  import React from 'react';
  export { default as App } from './App.tsx';
  export { default as RootErrorBoundary } from './components/RootErrorBoundary.tsx';
`;
const stubs = {
  './components/LazyTreeVisualizer': `
    import React from 'react';
    export default function Replay({ sentence, animated }) {
      if (globalThis.__failReplay) throw new Error('Simulated Replay render failure');
      return React.createElement('p', { 'data-view': animated ? 'replay' : 'static' }, sentence);
    }
    export const preloadTreeVisualizer = () => Promise.resolve(Replay);`
};
const compiled = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' },
  define: { 'import.meta.env': '{"DEV":true}' },
  plugins: [{ name: 'app-boundary-test', setup(builder) {
    builder.onResolve({ filter: /^\.\/components\/LazyTreeVisualizer$/ }, ({ path, importer }) =>
      importer.endsWith('App.tsx') ? { path, namespace: 'stub' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: stubs[path], loader: 'tsx', resolveDir: root }));
    builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
      path: pathToFileURL(require.resolve(specifier)).href, external: true
    }));
  } }]
});
const container = installMinimalDom();
const React = require('react');
const { createRoot } = require('react-dom/client');
const { App, RootErrorBoundary } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const bundle = JSON.parse(readFileSync(new URL('../fixtures/normalized/mia-laughed.xbar.json', import.meta.url), 'utf8'));

const errors = [];
console.error = (...args) => errors.push(args.map(String).join(' '));
const act = callback => React.act(async () => { await callback(); });
const alert = () => findElement(container, element => element.getAttribute('role') === 'alert');
const view = name => findElement(container, element => element.getAttribute('data-view') === name);
const sentenceBox = () => findElement(container, element => element.getAttribute('aria-label') === 'Sentence to analyze');
const home = () => findElement(container, element => element.getAttribute('aria-label') === 'Babel, parse a new sentence');
// Each call is a new analysis, so the view boundary renders it afresh.
const showAnalysis = () => globalThis.__BABEL_DEV_SET_ANALYSIS__(structuredClone(bundle), { sentence: 'Mia laughed' });

test('a view that fails to render shows a retryable notice and keeps the analysis and header', async () => {
  const reactRoot = createRoot(container);
  await act(() => reactRoot.render(React.createElement(RootErrorBoundary, null, React.createElement(App))));
  await act(showAnalysis);
  assert.equal(view('replay')?.textContent, 'Mia laughed', 'an analysis opens in Replay');
  assert.equal(sentenceBox(), null, 'the tree screen gives the sentence bar\'s room to the tree');

  globalThis.__failReplay = true;
  await act(showAnalysis);
  assert.equal(alert()?.textContent, 'Could not display this view.');
  assert.match(container.textContent, /Your analysis is unchanged\./);
  assert.match(container.textContent, /Simulated Replay render failure/, 'the notice keeps the error details');
  assert.equal(view('replay'), null);
  assert(errors.some(message => message.includes('Babel view failed:')), 'the boundary reports the failure');
  assert(findElement(container, element => element.tagName === 'H1' && element.textContent === 'Sylvan Architect Babel'), 'the header stays');
  const save = findButton(container, 'Save to Tree Bank');
  assert.equal(save?.hasAttribute('disabled'), false, 'the analysis is still held, so it can still be saved');
  assert(home(), 'the logo still leads back to the sentence box');

  globalThis.__failReplay = false;
  await act(() => invoke(findButton(container, 'Retry view'), 'onClick'));
  assert.equal(alert(), null);
  assert.equal(view('replay')?.textContent, 'Mia laughed', 'retry shows the same analysis again');

  globalThis.__failReplay = true;
  await act(showAnalysis);
  assert.equal(alert()?.textContent, 'Could not display this view.');
  await act(() => invoke(home(), 'onClick'));
  assert.equal(alert(), null, 'leaving for the input screen clears the notice');
  assert(sentenceBox(), 'and shows the sentence bar');
  globalThis.__failReplay = false;
  await act(() => invoke(findButton(container, 'Tree Bank ('), 'onClick'));
  await act(() => invoke(findButton(container, 'Back to Arboretum'), 'onClick'));
  assert.equal(view('replay')?.textContent, 'Mia laughed', 'returning from the Tree Bank shows the analysis the app kept');

  await act(() => reactRoot.unmount());
});

test('a failure above every view replaces the page with a restart notice instead of a blank page', async () => {
  let fail = true;
  const Workspace = () => {
    if (fail) throw new Error('Simulated app failure');
    return React.createElement('p', { 'data-view': 'restarted' }, 'Babel');
  };
  const reactRoot = createRoot(container);
  await act(() => reactRoot.render(React.createElement(RootErrorBoundary, null, React.createElement(Workspace))));
  assert.equal(alert()?.textContent, 'Babel stopped displaying.');
  assert.match(container.textContent, /Your Tree Bank is saved in this browser and is unchanged\./);
  assert.match(container.textContent, /Simulated app failure/);

  fail = false;
  await act(() => invoke(findButton(container, 'Restart Babel'), 'onClick'));
  assert.equal(alert(), null);
  assert(view('restarted'));
  await act(() => reactRoot.unmount());
});

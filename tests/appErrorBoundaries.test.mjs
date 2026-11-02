import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import 'fake-indexeddb/auto';
import { findButton, findElement, installMinimalDom, invoke } from './helpers/minimalDom.mjs';

// The real App and root boundary run in React's client renderer. The Notes view
// is wrapped so a test can make it throw while rendering; the Canopy renderer is
// replaced by a marker so no Replay worker starts.
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const entry = `
  import React from 'react';
  export { default as App } from './App.tsx';
  export { default as RootErrorBoundary } from './components/RootErrorBoundary.tsx';
`;
const stubs = {
  './components/DerivationNotesView': `
    import * as Real from ${JSON.stringify(`${root}components/DerivationNotesView.tsx`)};
    export function DerivationNotesView(props) {
      if (globalThis.__failNotes) throw new Error('Simulated Notes render failure');
      return Real.DerivationNotesView(props);
    }`,
  './components/AsyncTreeVisualizer': `
    import React from 'react';
    export default function Canopy({ sentence, animated }) {
      return React.createElement('p', { 'data-view': animated ? 'replay' : 'canopy' }, sentence);
    }`
};
const compiled = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' },
  define: { 'import.meta.env': '{"DEV":true}' },
  plugins: [{ name: 'app-boundary-test', setup(builder) {
    builder.onResolve({ filter: /^\.\/components\/(DerivationNotesView|AsyncTreeVisualizer)$/ }, ({ path, importer }) =>
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
const notes = () => findElement(container, element => element.tagName === 'H2' && element.textContent === 'Derivational Notes');

test('a view that fails to render shows a retryable notice and keeps the analysis, header and view tabs', async () => {
  const reactRoot = createRoot(container);
  await act(() => reactRoot.render(React.createElement(RootErrorBoundary, null, React.createElement(App))));
  await act(() => globalThis.__BABEL_DEV_SET_ANALYSIS__(bundle, { sentence: 'Mia laughed' }));
  assert.equal(view('canopy')?.textContent, 'Mia laughed');

  globalThis.__failNotes = true;
  await act(() => invoke(findButton(container, 'Notes'), 'onClick'));
  assert.equal(alert()?.textContent, 'Could not display this view.');
  assert.match(container.textContent, /Your analysis is unchanged\./);
  assert.match(container.textContent, /Simulated Notes render failure/, 'the notice keeps the error details');
  assert.equal(notes(), null);
  assert(errors.some(message => message.includes('Babel view failed:')), 'the boundary reports the failure');
  assert(findElement(container, element => element.tagName === 'H1' && element.textContent === 'Sylvan Architect Babel'), 'the header stays');
  const save = findButton(container, 'Save to Tree Bank');
  assert.equal(save?.hasAttribute('disabled'), false, 'the analysis is still held, so it can still be saved');
  assert(findButton(container, 'Canopy'), 'the view tabs stay usable');
  assert(findElement(container, element => element.getAttribute('aria-label') === 'Sentence to analyze'), 'the sentence bar stays');

  globalThis.__failNotes = false;
  await act(() => invoke(findButton(container, 'Retry view'), 'onClick'));
  assert.equal(alert(), null);
  assert(notes(), 'retry shows the same analysis\'s Notes again');
  assert.match(container.textContent, /\[/, 'the analysis\'s bracketing is back');

  globalThis.__failNotes = true;
  await act(() => invoke(findButton(container, 'Canopy'), 'onClick'));
  await act(() => invoke(findButton(container, 'Notes'), 'onClick'));
  assert.equal(alert()?.textContent, 'Could not display this view.');
  await act(() => invoke(findButton(container, 'Canopy'), 'onClick'));
  assert.equal(alert(), null, 'choosing another view clears the notice');
  assert.equal(view('canopy')?.textContent, 'Mia laughed', 'and shows the analysis the app kept');
  globalThis.__failNotes = false;

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

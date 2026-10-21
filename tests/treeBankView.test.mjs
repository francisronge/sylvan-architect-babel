import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: [new URL('../components/TreeBankView.tsx', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'local-test-dependencies', setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
      path: pathToFileURL(require.resolve(specifier)).href, external: true
    }));
  } }]
});
const { TreeBankView } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const entries = count => Array.from({ length: count }, (_, index) => ({
  id: `work-${index}`, sentence: `Sentence ${index}`, framework: 'xbar', activeParseIndex: 0,
  createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z',
  analysisCount: 1, stageCount: 2, previewId: `preview:${index}`, legacy: false
}));
const render = list => renderToStaticMarkup(React.createElement(TreeBankView, {
  entries: list, loading: false, error: null, opening: false, onOpen: async () => {}, onDelete: () => {}
}));
const cards = html => (html.match(/>Open Tree</g) || []).length;

test('a large Tree Bank mounts one page of cards and counts the whole library', () => {
  const html = render(entries(1000));
  assert.equal(cards(html), 24);
  assert.match(html, />1000 Saved Trees</);
  assert.match(html, /Showing 24 of 1000 Saved Trees/);
  assert.match(html, />Show 24 More</);
  assert.match(html, /Sentence 23/);
  assert.doesNotMatch(html, /Sentence 24\b/);
});

test('a library within one page renders every card without a pager', () => {
  const html = render(entries(3));
  assert.equal(cards(html), 3);
  assert.doesNotMatch(html, /Show \d+ More/);
  assert.match(render(entries(30)), />Show 6 More</);
});

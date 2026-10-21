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
const { TreeBankView, TreeBankDeleteDialog } = await import(
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

test('the delete confirmation is a labelled native dialog around the unchanged overlay', () => {
  const html = renderToStaticMarkup(React.createElement(TreeBankDeleteDialog, {
    entry: entries(1)[0], onConfirm: async () => {}, onCancel: () => {}
  }));
  const dialog = /^<dialog [^>]*>/.exec(html)?.[0];
  assert.ok(dialog, 'the confirmation is a native dialog, opened modally on mount');
  const id = name => new RegExp(`${name}="([^"]+)"`).exec(dialog)?.[1];
  assert.ok(html.includes(`<h3 id="${id('aria-labelledby')}"`) && html.includes('>Delete saved tree?</h3>'));
  assert.ok(html.includes(`<p id="${id('aria-describedby')}"`));
  assert.match(html, /This will permanently remove <span class="italic">&quot;Sentence 0&quot;<\/span> from Tree Bank\./);
  assert.match(html, /<dialog [^>]*><div class="absolute inset-0 z-\[60\] bg-black\/80 backdrop-blur-sm flex items-center justify-center px-6">/);
  assert.match(dialog, /bg-transparent/);
  assert.match(dialog, /backdrop:bg-transparent/);
});

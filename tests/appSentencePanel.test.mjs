import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: [new URL('../App.tsx', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' },
  plugins: [{ name: 'local-test-dependencies', setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
      path: pathToFileURL(require.resolve(specifier)).href, external: true
    }));
  } }]
});
const { default: App } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
// App reads only the query string while it renders; showcase mode starts with the panel hidden.
const render = search => {
  globalThis.window = { location: { search } };
  try { return renderToStaticMarkup(React.createElement(App)); }
  finally { delete globalThis.window; }
};
const panel = html => /<div data-babel-tree-controls="bottom"[^>]*>/.exec(html)?.[0];

test('the hidden sentence panel is inert, so its controls leave the focus order', () => {
  const hidden = render('?showcase=1');
  assert.match(panel(hidden), /aria-hidden="true"/);
  assert.match(panel(hidden), /\binert=""/);
  assert.match(hidden, /title="Restore Arboretum Link"/, 'the restore control stays outside the inert panel');

  const shown = render('');
  assert.doesNotMatch(panel(shown), /\binert/);
  assert.doesNotMatch(shown, /\binert/, 'an expanded, visible panel leaves the sentence box reachable');
});

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
// App reads only the query string while it renders.
const render = search => {
  globalThis.window = { location: { search } };
  try { return renderToStaticMarkup(React.createElement(App)); }
  finally { delete globalThis.window; }
};

test('the first screen is the sentence bar, reachable, with no view tabs or bar controls', () => {
  const shown = render('');
  assert.match(shown, /aria-label="Sentence to analyze"/);
  assert.match(shown, /aria-label="Analyze sentence"/);
  assert.doesNotMatch(shown, /\binert/, 'nothing on the first screen is out of the focus order');
  for (const absent of ['Canopy', 'Notes', 'Derivation Replay', 'Arboretum Link', 'Collapse', 'Hide Control Panel',
    'Restore Arboretum Link', 'Expand Arbor Control', 'Labeled Bracketing', 'Miles Shang']) {
    assert.ok(!shown.includes(absent), `the internal app shows no "${absent}"`);
  }
});

test('icon and toggle controls expose their visible names and states to assistive technology', () => {
  const shown = render('');
  const button = text => new RegExp(`<button[^>]*>(?:(?!</button>).)*${text.replace(/[()]/g, '\\$&')}(?:(?!</button>).)*</button>`, 's').exec(shown)?.[0] ?? '';
  assert.match(button('Constituent Glyphing'), /aria-pressed="false"/);
  assert.match(shown, /<button[^>]*title="Parse a new sentence"[^>]*aria-label="Babel, parse a new sentence"/,
    'the logo is the way back to the sentence box, named for what it does');
  for (const kept of ['Minimalist Program', 'Save to Tree Bank', 'Tree Bank (0)', 'Fullscreen']) {
    assert.ok(button(kept), `the internal app keeps "${kept}"`);
  }
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: [new URL('../components/RootLogo.tsx', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'local-test-dependencies', setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
      path: pathToFileURL(require.resolve(specifier)).href, external: true
    }));
  } }]
});
const { default: RootLogo } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);

// index.html preloads the 271 kB logo at default priority (f243025), behind the
// render-blocking script and CSS; the rendered images must not raise it again.
test('the logo loads eagerly at the browser\'s default image priority', () => {
  const image = /<img [^>]*>/.exec(renderToStaticMarkup(React.createElement(RootLogo)))?.[0];
  assert.ok(image);
  assert.match(image, /src="\/babellogo\.png"/);
  assert.match(image, /loading="eager"/);
  assert.doesNotMatch(image, /fetchpriority/i);
  const preload = /<link rel="preload" as="image" href="\/babellogo\.png"[^>]*>/.exec(
    fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'))?.[0];
  assert.ok(preload, 'index.html still preloads the logo');
  assert.doesNotMatch(preload, /fetchpriority/i);
});

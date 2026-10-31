import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { copyTextToClipboard } from '../services/clipboard.ts';

const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: [new URL('../components/BracketingPanel.tsx', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'local-test-dependencies', setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
      path: pathToFileURL(require.resolve(specifier)).href, external: true
    }));
  } }]
});
const { BracketingPanel } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const notation = '[TP [DP Mia] [T’ [T ∅] [VP laughed]]]';
const render = copyStatus => renderToStaticMarkup(React.createElement(BracketingPanel, {
  id: 'babel-bracketing', notation, copyStatus, onCopy: () => {}, onClose: () => {}
}));

test('the bracketing panel offers one final-tree bracketing and does not claim derivation or movement indices', () => {
  const html = render('idle');
  assert.match(html, /^<div id="babel-bracketing" role="dialog" aria-label="Labeled Bracketing"/);
  assert.deepEqual([...html.matchAll(/<button[^>]*>(?:(?!<\/button>).)*<\/button>/gs)]
    .map(([button]) => /aria-label="([^"]+)"/.exec(button)?.[1] ?? button.replace(/<[^>]+>/g, '')),
  ['Close labeled bracketing', 'Copy Bracketing'], 'one close control and one copy');
  assert.equal(html.split(notation).length - 1, 1, 'the bracketing appears once');
  assert.match(html, /href="https:\/\/mshang\.ca\/syntree\/"/, 'the Miles Shang link stays with the bracketing');
  assert.match(html, /Final Tree · Miles Shang Notation/);
  assert.doesNotMatch(html, /Derivation Code|Movement Indexed|Copy Derivation/);
  assert.doesNotMatch(html, /role="alert"/);
});

test('the bracketing panel reports a confirmed copy and a refused one', () => {
  assert.match(render('copied'), />Copied to Soil</);
  const failed = render('failed');
  assert.doesNotMatch(failed, /Copied to Soil/);
  assert.match(failed, /role="alert"[^>]*>The browser blocked clipboard access/);
  assert.match(failed, />Copy Bracketing</, 'the copy stays available to retry');
});

test('clipboard copies succeed only once the browser accepts the text', async () => {
  let accept;
  const written = [];
  const pending = copyTextToClipboard('[N Mia]', {
    writeText: text => new Promise(resolve => { written.push(text); accept = resolve; })
  });
  let settled = false;
  pending.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'success waits for the write');
  accept();
  assert.equal(await pending, true);
  assert.deepEqual(written, ['[N Mia]']);
});

test('clipboard copies report refusal, synchronous failure and missing access', async () => {
  assert.equal(await copyTextToClipboard('x', { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) }), false);
  assert.equal(await copyTextToClipboard('x', { writeText: () => { throw new TypeError('Document is not focused'); } }), false);
  assert.equal(await copyTextToClipboard('x', undefined), false);
  assert.equal(await copyTextToClipboard('x', {}), false);
});

// The Relation Orchard's cards are examples of what Babel draws. Their page
// cannot load the app's stylesheet, so these checks keep the conditions a card
// paints under the same as the app's: the same font faces, a tree canvas sized
// like the app's, and a Replay that opens and is framed as Babel's is.
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const PAGES = ['docs/design/babel-visual-relations-research.production-only-audit.html',
  'docs/research/relation-orchard/orchard.html'];
const FONTS = 'docs/research/relation-orchard/fonts.css';
const faceKey = face => ['font-family', 'font-style', 'font-weight', 'unicode-range']
  .map(name => new RegExp(`${name}:\\s*([^;]+);`).exec(face)?.[1].replace(/["']/g, '').trim() ?? '').join(' | ');

test('the Orchard loads every font face the app loads', async () => {
  const appStyles = await read('styles.css');
  const imports = [...appStyles.matchAll(/@import '@fontsource\/([^']+\.css)';/g)].map(match => match[1]);
  assert(imports.length > 0);
  const expected = [];
  for (const entry of imports) {
    const css = await read(`node_modules/@fontsource/${entry}`);
    expected.push(...[...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map(([face]) => faceKey(face)));
  }
  const published = await read(FONTS).catch(() => '');
  const faces = [...published.matchAll(/@font-face\s*\{[^}]*\}/g)].map(([face]) => face);
  assert.deepEqual(faces.map(faceKey).sort(), expected.sort(), `${FONTS} differs from the app's faces; run npm run orchard:build`);
  for (const face of faces) {
    const file = /url\(([^)]+\.woff2)\)/.exec(face)[1];
    await access(new URL(file, new URL(FONTS, root)));
  }
  for (const page of PAGES) {
    const html = await read(page);
    const href = /<link rel="stylesheet" href="([^"?]*fonts\.css)(?:\?[^"]*)?">/.exec(html)?.[1];
    assert(href, `${page} does not load ${FONTS}`);
    assert.equal(new URL(href, new URL(page, root)).href, new URL(FONTS, root).href);
    assert.doesNotMatch(html, /@font-face/, `${page} declares its own font faces`);
  }
});

test('Orchard pages size only the tree canvas, not the nested svg of a scrolling plaque', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    assert.doesNotMatch(html, /\.babel-render-mount svg\s*\{/, page);
    assert.match(html, /\.babel-render-mount svg\[data-babel-tree="true"\]\s*\{\s*width: 100%;\s*height: 100%;/, page);
  }
});

test('a card opens on its last Replay frame as Babel restores one, and page scrolling cannot zoom it', async () => {
  const lab = await read('docs/design/visual-relations-current-lab.tsx');
  const visualizer = /<TreeVisualizer\b[^>]*\/>/.exec(lab)?.[0] ?? '';
  assert.match(visualizer, /autoPlay=\{false\}/);
  assert.match(visualizer, /initialReplayStep=\{FINAL_REPLAY_STEP\}/);
  assert.match(lab, /const FINAL_REPLAY_STEP = Number\.MAX_SAFE_INTEGER;/);
  assert.doesNotMatch(lab, /\.click\(\)/, 'the lab must not step Replay by clicking its controls');
  assert.match(lab, /addEventListener\('wheel', keepPageScroll, \{ capture: true, passive: true \}\)/);
  assert.match(lab, /if \(!event\.ctrlKey\) event\.stopPropagation\(\);/);
});

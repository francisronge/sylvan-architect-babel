import { inlineWorkerPlugin } from '../../scripts/inlineWorkerPlugin.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { readFile } from 'node:fs/promises';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { prepareReplay } from '../../replay/prepareReplay.ts';

// Decodes a screenshot in the page, so the test needs no image library.
const decodePixels = (page, png) => page.evaluate(async (source) => {
  const image = new Image();
  image.src = `data:image/png;base64,${source}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return { width: image.width, height: image.height, data: [...context.getImageData(0, 0, image.width, image.height).data] };
}, png.toString('base64'));

test('movement passes behind the letters of visible labels, continuous across a word, through zoom and Fit', async () => {
  const tree = { id: 'clause', label: 'TP', children: [
    { id: 'high', label: 'DP', lineageId: 'subject', children: [{ id: 'name', label: 'D', word: 'Mia', lineageId: 'subject' }] },
    { id: 'vp', label: 'VP', children: [{ id: 'v', label: 'V', word: 'left' },
      { id: 'low', label: 'DP', lineageId: 'subject', children: [
        { id: 'trace', label: 'D', word: 't1', silent: true, lineageId: 'subject' }
      ] }] }
  ] };
  const stages = [{ statement: 'A movement chain.', stageRecord: 'The chain has two occurrences.', workspaceForest: [tree],
    // The identity coindex gives "left" an index letter before the movement plays.
    relations: [{ relation: 'Identity', anchors: { occurrences: ['name', 'v'] }, values: { index: 'k' } },
      { relation: 'subject movement chain', anchors: { source: 'low', landing: 'high', traceWitness: 'trace' } }] }];
  const steps = prepareReplay({ sentence: 'Mia left', derivationStages: stages, includePlayback: true }).playbackSteps;
  const moment = steps.findLastIndex(step => step.replayRelationIdentity);
  const runtime = await buildQualificationReviewRuntime();
  const compiled = await build({
    plugins: [inlineWorkerPlugin()], absWorkingDir: new URL('../../', import.meta.url).pathname,
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import TreeVisualizer from './components/TreeVisualizer';
      createRoot(document.getElementById('root')).render(<TreeVisualizer data={${JSON.stringify(tree)}}
        derivationStages={${JSON.stringify(stages)}} sentence="Mia left" animated />);`,
    loader: 'tsx', resolveDir: new URL('../../', import.meta.url).pathname },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setContent(`<style>${runtime.css}</style><div id="root" style="height:900px"></div><script>${compiled.outputFiles[0].text}</script>`);
    const svg = page.locator('svg[data-babel-rendered-step]');
    await svg.waitFor();
    if (await page.getByRole('button', { name: 'Pause', exact: true }).count()) await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.locator('input[type=range]').fill(String(moment));
    await page.waitForFunction(i => document.querySelector('svg[data-babel-rendered-step]')?.getAttribute('data-babel-rendered-step') === String(i), moment);
    const inspect = () => page.evaluate(() => {
      const paths = [...document.querySelectorAll('.babel-trajectory-path, .babel-trajectory-path-shadow')];
      const masks = new Set(paths.map(path => path.getAttribute('mask')));
      const mask = document.getElementById([...masks][0].slice(5, -1));
      const shown = [...document.querySelectorAll('.node-group .category-label, .node-group .terminal-label')]
        .filter(label => label.closest('.node-group').getAttribute('opacity') !== '0');
      const copies = [...mask.querySelectorAll('text')];
      const layer = document.querySelector('.babel-trajectory-relation-layer');
      return {
        d: paths[0].getAttribute('d'), transform: document.querySelector('svg > g').getAttribute('transform'),
        masks: masks.size, copies: copies.length, labels: shown.length,
        placed: shown.every(label => copies.some(copy => copy.textContent === label.textContent
          && copy.parentNode.getAttribute('transform') === label.closest('.node-group').getAttribute('transform')
          && copy.getAttribute('x') === label.getAttribute('x') && copy.getAttribute('y') === label.getAttribute('y'))),
        // Every piece of a copy, index letters included, masks in black.
        lettersOnly: copies.flatMap(copy => [copy, ...copy.querySelectorAll('*')]).every(piece => getComputedStyle(piece).fill === 'rgb(0, 0, 0)'
          && getComputedStyle(piece).stroke === 'none' && !piece.hasAttribute('class')),
        indexed: copies.some(copy => copy.querySelector('tspan')),
        rects: [...mask.querySelectorAll('rect')].map(rect => rect.getAttribute('fill')),
        // The curve paints after the labels, so it lies over their dark outline.
        overLabels: shown.every(label => Boolean(label.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING))
      };
    });
    const check = state => {
      assert.equal(state.masks, 1, 'every movement path uses the label mask');
      assert.deepEqual(state.rects, ['white'], 'the curve shows everywhere except under letters: no rectangular holes');
      assert.equal(state.copies, state.labels, 'each visible label, and only those, masks the curve');
      assert.ok(state.placed, 'each mask copy sits exactly on its label');
      assert.ok(state.lettersOnly, 'mask copies hide the curve under the letters only, not under their dark outline');
      assert.ok(state.indexed, 'a word with an index letter is masked with its index');
      assert.ok(state.overLabels, 'the curve is painted after the labels');
    };
    const before = await inspect();
    check(before);
    await page.mouse.move(600, 300);
    await page.mouse.wheel(0, -220);
    await page.waitForFunction(t => document.querySelector('svg > g').getAttribute('transform') !== t, before.transform);
    const zoomed = await inspect();
    check(zoomed);
    assert.equal(zoomed.d, before.d, 'zoom and clearance preserve the accepted curve');
    await page.getByRole('button', { name: /fit/i }).click();
    await page.waitForFunction(t => document.querySelector('svg > g').getAttribute('transform') !== t, zoomed.transform);
    await page.waitForFunction(() => document.querySelector('.babel-trajectory-path')?.hasAttribute('mask'));
    const fitted = await inspect();
    check(fitted);

    // Lay the curve straight across the word "left" and repaint its mask, as a
    // zoom does. Glow is shared emphasis, not the curve: switch it off so the
    // pixels compare the curve itself.
    const word = await page.evaluate(() => {
      const label = [...document.querySelectorAll('.terminal-label')].find(candidate => candidate.textContent.startsWith('left'));
      const into = document.querySelector('.babel-trajectory-path').getCTM().inverse().multiply(label.getCTM());
      const box = label.getBBox();
      const a = new DOMPoint(box.x - 80, box.y + box.height / 2).matrixTransform(into);
      const b = new DOMPoint(box.x + box.width + 80, box.y + box.height / 2).matrixTransform(into);
      document.querySelectorAll('.babel-trajectory-path, .babel-trajectory-path-shadow').forEach(path => {
        path.setAttribute('d', `M ${a.x} ${a.y} L ${b.x} ${b.y}`);
        path.removeAttribute('marker-end');
      });
      document.querySelectorAll('.babel-trajectory-relation-layer .vr-item').forEach(host => host.style.setProperty('filter', 'none', 'important'));
      const rect = label.getBoundingClientRect();
      return { transform: document.querySelector('svg > g').getAttribute('transform'),
        x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(word.x, word.y);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(t => document.querySelector('svg > g').getAttribute('transform') !== t, word.transform);
    await page.mouse.move(2, 2);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const place = await page.evaluate(() => {
      const label = [...document.querySelectorAll('.terminal-label')].find(candidate => candidate.textContent.startsWith('left'));
      const rect = label.getBoundingClientRect();
      const path = document.querySelector('.babel-trajectory-path');
      const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM());
      return { x: Math.floor(rect.left), y: Math.floor(rect.top), width: Math.ceil(rect.width), height: Math.ceil(rect.height), lineY: point.y };
    });
    assert.ok(place.width > 20 && place.x >= 0 && place.y >= 0 && place.x + place.width <= 1200 && place.y + place.height <= 900,
      `the word must be on screen: ${JSON.stringify(place)}`);
    const clip = { x: place.x, y: place.y, width: place.width, height: place.height };
    const painted = await decodePixels(page, await page.screenshot({ clip }));
    await page.evaluate(() => document.querySelectorAll('.babel-trajectory-path, .babel-trajectory-path-shadow')
      .forEach(path => path.style.setProperty('visibility', 'hidden')));
    const bare = await decodePixels(page, await page.screenshot({ clip }));
    const at = (image, x, y) => image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3);
    const distance = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
    const row = Math.round(place.lineY - place.y);
    let crossed = 0;
    for (let x = 0; x < bare.width; x += 1) {
      if ([row - 1, row, row + 1].some(y => y >= 0 && y < bare.height && distance(at(painted, x, y), at(bare, x, y)) > 60)) crossed += 1;
    }
    // Before this contract a rectangle around the word hid the whole crossing.
    assert.ok(crossed >= bare.width * 0.2, `the curve stays visible across the word: ${crossed} of ${bare.width} columns`);
    const emerald = [16, 185, 129];
    let letters = 0; let changed = 0;
    for (let y = 0; y < bare.height; y += 1) for (let x = 0; x < bare.width; x += 1) {
      if (distance(at(bare, x, y), emerald) > 12) continue;
      letters += 1;
      if (distance(at(painted, x, y), at(bare, x, y)) > 12) changed += 1;
    }
    assert.ok(letters > 100, `the word's letters are measured: ${letters} pixels`);
    assert.equal(changed, 0, 'the curve never paints over a letter');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('cyclic ordering captions stay clear of Replay in desktop and narrow views', async () => {
  const orchardHtml = await readFile(new URL('../../docs/research/relation-orchard/orchard.html', import.meta.url), 'utf8');
  const orchardStyles = [...orchardHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
  const runtime = await buildQualificationReviewRuntime({ entrySource: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import TreeVisualizer from './components/TreeVisualizer';
    import {canonicalCases} from './docs/design/visual-relations-current-lab';
    import './styles.css';
    const item = canonicalCases.find(item => item.archetype.startsWith('H6.'));
    createRoot(document.getElementById('caption-test')).render(<TreeVisualizer data={item.data}
      derivationStages={item.rendererStages} sentence={item.sentence} animated autoPlay={false} initialReplayStep={Number.MAX_SAFE_INTEGER} />);
  ` });
  for (const [engine, browserType] of [['Chromium', chromium], ['WebKit', webkit]]) {
    const browser = await browserType.launch({ headless: true });
    try {
      const errors = [];
      for (const [width, height] of [[1280, 720], [390, 900]]) {
        const page = await browser.newPage({ viewport: { width, height } });
        page.on('pageerror', error => errors.push(String(error)));
        await page.setContent(`<style>${runtime.css}\n${orchardStyles}</style>
          <article class="babel-render-card babel-render-card--wide"><div id="caption-test" class="babel-render-mount"></div></article>
          <script>${runtime.js}</script>`);
        const timeline = page.locator('input[type=range]');
        await timeline.waitFor({ state: 'attached' });
        await page.evaluate(() => document.fonts.ready);
        const last = await timeline.getAttribute('max');
        const settled = () => page.waitForFunction(index => {
          const svg = document.querySelector('svg[data-babel-tree]');
          return svg?.getAttribute('data-babel-rendered-step') === index
            && svg.getAttribute('data-babel-camera-settled-step') === index
            && svg.querySelector('.babel-anchor-set-rail-label');
        }, last);
        await settled();
        await page.getByRole('button', { name: 'Fit tree', exact: true }).click();
        await settled();
        const clearance = await page.evaluate(() => {
          const svg = document.querySelector('svg[data-babel-tree]');
          const caption = svg.querySelector('.babel-anchor-set-rail-label');
          const label = caption.getBoundingClientRect();
          const canvas = svg.getBoundingClientRect();
          const panel = document.querySelector('[data-babel-replay-panel]').getBoundingClientRect();
          return { text: caption.textContent, bottom: panel.top - label.bottom,
            left: label.left - canvas.left, right: canvas.right - label.right };
        });
        assert.equal(clearance.text, 'Cyclic Linearization · order');
        assert.ok(clearance.bottom >= 15.9, `${engine} ${width}×${height}: caption needs 16px above Replay, got ${clearance.bottom}`);
        assert.ok(clearance.left >= 0 && clearance.right >= 0, `${engine}: caption must fit inside the canvas`);
        await page.close();
      }
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  }
});

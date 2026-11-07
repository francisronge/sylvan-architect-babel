import assert from 'node:assert/strict';
import test from 'node:test';
import { rawCases } from '../../docs/design/visual-relations-lab-cards.ts';
import { toRendererStages } from '../../docs/design/visual-relations-lab-adapter.ts';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { openCaptureSession } from '../../scripts/browserSession.mjs';
import { waitForReplayPaint } from '../../scripts/captureReadiness.mjs';

// The Orchard cards whose relation marks fell under the Replay controls or off
// the canvas, each in the canvas the app gives the tree at the window size
// where it did (measured in the app on 7 Nov 2026).
const CASES = [
  { code: 'H5.', mark: '.babel-pf-morphology-relation-layer', window: { width: 390, height: 844 }, canvas: { width: 386, height: 528 } },
  { code: 'G3.', mark: '.babel-argument-sharing-domain', window: { width: 1440, height: 900 }, canvas: { width: 1436, height: 718 } },
  { code: 'K.', mark: '.babel-trajectory-path', window: { width: 1600, height: 1200 }, canvas: { width: 1596, height: 1076 } },
  { code: 'E7.', mark: '.babel-analysis-verdict', window: { width: 390, height: 844 }, canvas: { width: 386, height: 528 } }
];

const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import TreeVisualizer from './components/AsyncTreeVisualizer'; import './styles.css';
const c=window.card;createRoot(document.getElementById('root')).render(<TreeVisualizer data={c.data}
 derivationStages={c.stages} sentence={c.sentence} animated autoPlay={false} initialReplayStep={Number.MAX_SAFE_INTEGER}/>);`;

/** Every painted shape of the tree canvas that leaves the canvas or reaches under the Replay panel. */
const outOfView = () => {
  const canvas = document.querySelector('svg[data-babel-tree]');
  const view = canvas.getBoundingClientRect();
  const panel = document.querySelector('[data-babel-replay-panel="true"]').getBoundingClientRect();
  const unpainted = value => !value || value === 'none' || value === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(value);
  const faults = [];
  for (const element of canvas.querySelectorAll('text, path, line, rect, circle, ellipse, polygon, polyline')) {
    if (element.closest('defs, clipPath, mask, marker, pattern, .vr-relation-hit-target')) continue;
    let hidden = false;
    for (let node = element; node && node !== canvas.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) hidden = true;
    }
    const style = getComputedStyle(element);
    if (hidden || (element.tagName !== 'text' && unpainted(style.fill) && unpainted(style.stroke))) continue;
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    const outside = Math.max(view.left - box.left, view.top - box.top, box.right - view.right, box.bottom - view.bottom);
    const under = Math.min(box.right - panel.left, panel.right - box.left, box.bottom - panel.top, panel.bottom - box.top);
    if (outside > 1 || under > 1) faults.push(`${element.getAttribute('class') || element.tagName}: ${Math.round(Math.max(outside, under))}px`);
  }
  return [...new Set(faults)];
};

test('relation marks stay between the Replay header and controls, inside the canvas', { timeout: 300_000 }, async t => {
  const runtime = await buildQualificationReviewRuntime({ entrySource: entry });
  for (const { code, mark, window: viewport, canvas } of CASES) await t.test(`${code} ${viewport.width}×${viewport.height}`, async () => {
    const card = rawCases.find(item => item.archetype.startsWith(code));
    const payload = { data: card.data, stages: toRendererStages(card.derivationStages), sentence: card.sentence };
    const session = await openCaptureSession({ viewport, timeout: 60_000 });
    try {
      const { page } = session;
      await page.setContent(`<meta charset="utf-8"><style>${runtime.css}html,body{margin:0}
        #root{width:${canvas.width}px;height:${canvas.height}px;position:relative}</style><div id="root"></div>
        <script>window.card=${JSON.stringify(payload).replaceAll('<', '\\u003c')}</script>
        <script>${runtime.js.replace(/<\/script/gi, '<\\/script')}</script>`);
      const slider = page.getByRole('slider', { name: 'Replay frame', exact: true });
      await slider.waitFor();
      const last = Number(await slider.getAttribute('max'));
      await waitForReplayPaint(page, last);
      // Relation marks are drawn on a later tick than the frame they belong to.
      await page.waitForFunction(selector => document.querySelector(selector), mark);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(await page.evaluate(outOfView), [], `${card.title}: marks out of view`);
      session.assertHealthy();
    } finally { await session.close(); }
  });
});

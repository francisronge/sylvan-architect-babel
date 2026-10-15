import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../../replay/prepareReplay.ts';
import { buildQualificationReviewRuntime } from '../../scripts/buildContractQualificationReviewRuntime.mjs';
import { openCaptureSession } from '../../scripts/browserSession.mjs';
import { waitForReplayPaint } from '../../scripts/captureReadiness.mjs';
import { inspectRenderedPlaques } from '../helpers/renderedPlaques.mjs';

const record = JSON.parse(readFileSync(new URL('../../fixtures/replay-regressions/native-plaque-footprints.json', import.meta.url)));
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import TreeVisualizer from './components/AsyncTreeVisualizer';
import {buildDerivationCanvasData} from './replay/replayCanvas.ts'; import './styles.css';
const r=window.record;createRoot(document.getElementById('root')).render(<TreeVisualizer
 data={buildDerivationCanvasData(r.derivationStages.at(-1).workspaceForest)} {...r} animated autoPlay={false}/>);`;

test('PF plates clear fixed shared-feature plaques through Replay, reverse scrubbing, zoom and Fit', async () => {
  const runtime = await buildQualificationReviewRuntime({ entrySource: entry });
  const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps;
  const moment = relation => steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 0
    && step.replayRelationIdentity.relationIndex === relation);
  assert(moment(1) >= 0 && moment(2) > moment(1));
  for (const engine of ['chromium', 'webkit']) for (const width of [1600, 390]) {
    const session = await openCaptureSession({ engine, viewport: { width, height: 1000 }, timeout: 30000 });
    try {
      const { page } = session;
      await page.setContent(`<meta charset="utf-8"><style>${runtime.css}html,body,#root{height:100%;margin:0}</style>
        <div id="root"></div><script>window.record=${JSON.stringify(record).replaceAll('<', '\\u003c')}</script><script>${runtime.js.replace(/<\/script/gi, '<\\/script')}</script>`);
      await waitForReplayPaint(page, 0);
      const seek = async index => {
        await page.getByRole('slider', { name: 'Replay frame', exact: true }).fill(String(index));
        await waitForReplayPaint(page, index);
        session.assertHealthy();
      };
      const fixedInk = () => page.locator('.babel-feature-sharing-vine,.babel-shared-feature-plaque rect')
        .evaluateAll(elements => elements.map(element => ({ tag: element.tagName,
          attributes: ['d','x','y','width','height'].map(key => element.getAttribute(key)) })));
      await seek(moment(1));
      const sharing = await fixedInk();
      assert(sharing.length >= 3, 'actual vines and their shared plaque are painted');
      await seek(moment(2));
      assert.deepEqual(await fixedInk(), sharing, 'the PF repair must not move existing connectors or the shared plaque');
      const introduced = await page.evaluate(inspectRenderedPlaques);
      assert.equal(introduced.shells.filter(shell => shell.className === 'babel-pf-plate-shell').length, 1,
        'the morphological PF claim must actually paint its plate');
      assert.equal(introduced.shells.filter(shell => shell.className === 'babel-feature-plaque-shell').length, 4,
        'the shared plaque and all three remaining lexical-feature plaques must paint');
      let inspected = 0;
      for (let index = moment(2); index < steps.length; index++) {
        await seek(index);
        const result = await page.evaluate(inspectRenderedPlaques);
        assert(result.shells.length > 0);
        assert.deepEqual(result.plaquePairs, [], `${engine} ${width}px frame ${index + 1}: plaque collision`);
        assert.deepEqual(result.labels, [], `${engine} ${width}px frame ${index + 1}: plaque obscures syntax`);
        inspected++;
      }
      assert.equal((await page.evaluate(inspectRenderedPlaques)).shells
        .filter(shell => shell.className === 'babel-pf-plate-shell').length, 2,
      'both persistent PF claims survive the complete derivation');
      assert(inspected > 20, 'all later attachment and movement states are checked');
      await seek(moment(2));
      const stable = await page.evaluate(inspectRenderedPlaques);
      await page.mouse.move(width / 2, 300); await page.mouse.wheel(0, -260);
      await page.getByRole('button', { name: 'Fit tree', exact: true }).click();
      await waitForReplayPaint(page, moment(2));
      const fitted = await page.evaluate(inspectRenderedPlaques);
      assert.deepEqual(fitted.plaquePairs, []);
      assert.deepEqual(fitted.labels, []);
      fitted.shells.forEach((shell, index) => {
        for (const key of ['x','y','width','height']) assert(Math.abs(shell.box[key] - stable.shells[index].box[key]) < 1e-6,
          'zoom/Fit preserves local plaque geometry');
      });
      session.assertHealthy();
    } finally { await session.close(); }
  }
});

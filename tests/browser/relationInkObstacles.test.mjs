import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { chromium } from 'playwright';

test('relation clearance measures a hidden review host and ignores invisible hit targets', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div id="host" style="visibility:hidden"><svg width="900" height="600">
      <g id="tree" transform="translate(20 40) scale(2)">
        <g data-vr-owner-refs="0:0">
          <path d="M 0 0 L 100 0 L 100 100" fill="none" stroke="green"/>
          <rect x="150" y="0" width="70" height="40" fill="green"/>
          <path class="vr-relation-hit-target" d="M -100 -100 L 500 500" fill="none" stroke="transparent" stroke-width="30"/>
          <g visibility="hidden"><rect width="700" height="500"/></g>
          <g style="display:none"><rect width="700" height="500"/></g>
          <g opacity="0"><rect width="700" height="500"/></g>
          <g class="vr-fallback-mark"><text>role label</text></g>
        </g>
      </g>
    </svg></div>`);
    const source = stripTypeScriptTypes(await fs.readFile(new URL('../../components/relationInkObstacles.ts', import.meta.url), 'utf8'));
    await page.addScriptTag({ type: 'module', content: source + '\nwindow.measureInk = measureRelationInkObstacles;' });
    await page.waitForFunction(() => typeof window.measureInk === 'function');
    const hidden = await page.evaluate(() => window.measureInk(document.querySelector('#tree')));
    assert(hidden.length > 2, 'both the bent path and filled plaque must reserve space');
    const visible = await page.evaluate(() => {
      document.querySelector('#host').style.visibility = 'visible';
      return window.measureInk(document.querySelector('#tree'));
    });
    assert.deepEqual(visible, hidden, 'the ready-state wrapper cannot change relation obstacles');
    const zoomed = await page.evaluate(() => {
      document.querySelector('#tree').setAttribute('transform', 'translate(-50 80) scale(4)');
      return window.measureInk(document.querySelector('#tree'));
    });
    assert.deepEqual(zoomed, visible, 'obstacles remain in tree coordinates through pan and zoom');
    const onlyInk = await page.evaluate(() => {
      document.querySelectorAll('.vr-relation-hit-target,[visibility="hidden"],[style="display:none"],[opacity="0"],.vr-fallback-mark').forEach(e => e.remove());
      return window.measureInk(document.querySelector('#tree'));
    });
    assert.deepEqual(onlyInk, visible, 'invisible geometry and role text never reserve relation ink');
  } finally {
    await browser.close();
  }
});

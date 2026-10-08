import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('render, effect and owned deferred failures preserve analysis and controls, clean up, and retry locally', async () => {
  const built = await build({
    absWorkingDir: path.resolve(import.meta.dirname, '../..'),
    entryPoints: ['tests/helpers/viewErrorBoundaryEntry.tsx'], bundle: true, write: false,
    format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const uncaught = [];
    const reported = [];
    page.on('pageerror', error => uncaught.push(error.message));
    page.on('console', event => { if (event.type() === 'error') reported.push(event.text()); });
    await page.setContent(`<div id="root"></div><script>${built.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
    await page.getByTestId('ready').waitFor();
    await page.getByRole('textbox', { name: 'Draft' }).fill('Keep my edits');
    const original = await page.getByTestId('original').textContent();
    for (const kind of ['render', 'effect', 'deferred']) {
      const cleanups = await page.locator('body').getAttribute('data-cleanups');
      await page.getByRole('button', { name: `Fail ${kind}`, exact: true }).click();
      await page.getByRole('alert').waitFor();
      await page.waitForFunction(previous => Number(document.body.dataset.cleanups || 0) > Number(previous || 0), cleanups);
      assert.equal(await page.getByRole('textbox', { name: 'Draft' }).inputValue(), 'Keep my edits');
      assert.equal(await page.getByTestId('original').textContent(), original);
      await page.getByText('Error details', { exact: true }).click();
      assert.match(await page.locator('details pre').textContent(), /Simulated .*failure/);
      assert.equal(await page.locator('details script').count(), 0);
      const ticks = await page.locator('body').getAttribute('data-ticks');
      await page.waitForTimeout(40);
      assert.equal(await page.locator('body').getAttribute('data-ticks'), ticks, 'failed view timers stop');
      await page.getByRole('button', { name: 'Stop simulated fault' }).click();
      assert.equal(await page.getByRole('alert').count(), 1, 'unrelated parent updates do not retry a failed view');
      await page.getByRole('button', { name: 'Retry view', exact: true }).click();
      await page.getByTestId('ready').waitFor();
    }
    await page.getByRole('button', { name: 'Fail render', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: 'Switch analysis' }).click();
    await page.getByTestId('ready').waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await page.getByRole('textbox', { name: 'Draft' }).inputValue(), 'Keep my edits');
    assert.deepEqual(uncaught, []);
    assert(reported.some(message => message.includes('Babel view failed:')));
    assert(reported.some(message => message.includes('Babel view callback failed:')));
  } finally { await browser.close(); }
});

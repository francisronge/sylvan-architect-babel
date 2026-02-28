import { test } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:5177/';

const CASES = [
  { name: 'simple', sentence: 'The farmer eats the pig' },
  { name: 'negative', sentence: 'The farmer did not eat the pig' },
  { name: 'conditional', sentence: 'If the teacher arrives, the class starts' },
  { name: 'relative', sentence: 'The child that the teacher praised smiled' }
];

const waitForParseToSettle = async (page) => {
  await page.waitForSelector('text=Synthesizing Neural Roots...', { state: 'hidden', timeout: 180000 });
  await page.waitForTimeout(1200);
};

test('capture canopy screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1117 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  for (const c of CASES) {
    const textarea = page.locator('textarea').first();
    await textarea.click();
    await textarea.fill(c.sentence);
    await page.locator('button[type="submit"]').click();
    await waitForParseToSettle(page);
    await page.screenshot({
      path: `.artifacts/canopy-${c.name}.png`,
      fullPage: true
    });
  }
});

const { chromium } = require('/Users/francisronge/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');

const BASE_URL = 'http://127.0.0.1:5177/';
const CASES = [
  { name: 'tree-simple', sentence: 'The farmer eats the pig' },
  { name: 'tree-negative', sentence: 'The farmer did not eat the pig' },
  { name: 'tree-conditional', sentence: 'If the teacher arrives, the class starts' }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForParseDone(page) {
  const loadingText = page.locator('text=Synthesizing Neural Roots...');
  try {
    await loadingText.waitFor({ state: 'visible', timeout: 3000 });
  } catch {}
  await loadingText.waitFor({ state: 'hidden', timeout: 180000 }).catch(() => {});
  await sleep(1200);
}

async function hasCanopyError(page) {
  const err = page.locator('text=The canopy is noisy right now. Please plant your sentence again in a moment.');
  return await err.isVisible().catch(() => false);
}

async function hasTree(page) {
  const cp = page.locator('text=CP').first();
  return await cp.isVisible().catch(() => false);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  const outputs = [];

  for (const c of CASES) {
    const textarea = page.locator('textarea').first();
    await textarea.click();
    await textarea.fill(c.sentence);

    let captured = false;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await page.locator('button[type="submit"]').click();
      await waitForParseDone(page);

      if (await hasCanopyError(page)) {
        await sleep(800);
        continue;
      }

      if (await hasTree(page)) {
        const path = `.artifacts/${c.name}.png`;
        await page.screenshot({ path, fullPage: true });
        outputs.push(path);
        captured = true;
        break;
      }
      await sleep(800);
    }

    if (!captured) {
      const path = `.artifacts/${c.name}-failed.png`;
      await page.screenshot({ path, fullPage: true });
      outputs.push(path);
    }
  }

  await browser.close();
  console.log(outputs.join('\n'));
})();

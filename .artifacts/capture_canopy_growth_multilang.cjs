const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/Users/francisronge/.npm/_npx/e41f203b7505f1fb/node_modules/playwright'));
}

const BASE_URL = process.env.BABEL_BASE_URL || 'http://127.0.0.1:5202/';
const CASES = [
  { name: 'spanish', sentence: 'El granjero come el cerdo' },
  { name: 'french', sentence: 'Le fermier mange le cochon' },
  { name: 'german', sentence: 'Der Bauer isst das Schwein' },
  { name: 'italian', sentence: 'Il contadino mangia il maiale' }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForParseDone(page) {
  const loadingText = page.locator('text=Synthesizing Neural Roots...');
  try {
    await loadingText.waitFor({ state: 'visible', timeout: 4000 });
  } catch {
    // no-op
  }
  await loadingText.waitFor({ state: 'hidden', timeout: 180000 }).catch(() => {});
  await sleep(1200);
}

async function isCanopyErrorVisible(page) {
  const err = page.locator('text=The canopy is noisy right now.').first();
  return err.isVisible().catch(() => false);
}

async function ensureCanopyTab(page) {
  const canopyTab = page.locator('button:has-text("Canopy")').first();
  if ((await canopyTab.count()) > 0) {
    await canopyTab.click();
    await sleep(400);
  }
}

async function switchToGrowthTab(page) {
  const growthTab = page.locator('button:has-text("Growth Simulation")').first();
  if ((await growthTab.count()) > 0) {
    await growthTab.click();
    await sleep(500);
    return;
  }
  const rightButtons = page.locator('div.absolute.right-8 button');
  if ((await rightButtons.count()) >= 2) {
    await rightButtons.nth(1).click();
    await sleep(500);
  }
}

async function advanceGrowthToFinal(page) {
  const nextButton = page.locator('button:has-text("NEXT")').first();
  if ((await nextButton.count()) === 0) {
    await sleep(1000);
    return;
  }

  for (let i = 0; i < 120; i += 1) {
    if ((await nextButton.count()) === 0) break;
    const disabled = await nextButton.isDisabled().catch(() => true);
    if (disabled) break;
    await nextButton.click().catch(() => {});
    await sleep(180);
  }
  await sleep(600);
}

async function hasTreeVisible(page) {
  const cp = page.locator('text=CP').first();
  return cp.isVisible().catch(() => false);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  const outputPaths = [];

  for (const entry of CASES) {
    const textarea = page.locator('textarea').first();
    await textarea.click();
    await textarea.fill(entry.sentence);

    let parsed = false;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await page.locator('button[type="submit"]').click();
      await waitForParseDone(page);

      if (await isCanopyErrorVisible(page)) {
        await sleep(900);
        continue;
      }
      if (await hasTreeVisible(page)) {
        parsed = true;
        break;
      }
      await sleep(700);
    }

    if (!parsed) {
      const failedPath = path.resolve(`.artifacts/${entry.name}-failed.png`);
      await page.screenshot({ path: failedPath, fullPage: true });
      outputPaths.push(failedPath);
      continue;
    }

    await ensureCanopyTab(page);
    const canopyPath = path.resolve(`.artifacts/${entry.name}-canopy.png`);
    await page.screenshot({ path: canopyPath, fullPage: true });
    outputPaths.push(canopyPath);

    await switchToGrowthTab(page);
    await advanceGrowthToFinal(page);
    const growthPath = path.resolve(`.artifacts/${entry.name}-growth-final.png`);
    await page.screenshot({ path: growthPath, fullPage: true });
    outputPaths.push(growthPath);

    await ensureCanopyTab(page);
  }

  await browser.close();
  process.stdout.write(`${outputPaths.join('\n')}\n`);
})();

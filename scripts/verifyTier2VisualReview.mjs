import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { createReviewFileHandler } from './reviewFileServer.mjs';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const reviewHtml = path.join(repoRoot, 'docs/design/visual-relations-tier2-review.html');
const reviewBundle = path.join(repoRoot, 'docs/design/visual-relations-tier2-review.bundle.js');
const outDir = path.join(repoRoot, '.artifacts/tier2-task10-visual-review');

if (!fs.existsSync(reviewBundle)) {
  throw new Error('Build the review surface first with npm run tier2:review:build.');
}

fs.mkdirSync(outDir, { recursive: true });

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const server = http.createServer(createReviewFileHandler({ root: repoRoot }));
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Visual review server did not bind.');

let browser;
const consoleProblems = [];
const responseProblems = [];

async function captureAtFixedOrigin(locator, { width, height }) {
  const previousStyle = await locator.getAttribute('style');
  await locator.evaluate((element, fixedSize) => {
    Object.assign(element.style, {
      position: 'fixed',
      inset: '0 auto auto 0',
      width: `${fixedSize.width}px`,
      height: `${fixedSize.height}px`,
      background: '#00110c',
      zIndex: '10000'
    });
  }, { width, height });
  try {
    return await locator.screenshot();
  } finally {
    await locator.evaluate((element, style) => {
      if (style === null) element.removeAttribute('style');
      else element.setAttribute('style', style);
    }, previousStyle);
  }
}

async function captureBlankAtFixedOrigin(page, size) {
  const locator = page.locator('[data-compare-blank="true"]');
  await page.evaluate(({ width, height }) => {
    const blank = document.createElement('div');
    blank.dataset.compareBlank = 'true';
    Object.assign(blank.style, {
      position: 'fixed',
      inset: '0 auto auto 0',
      width: `${width}px`,
      height: `${height}px`,
      background: '#00110c',
      zIndex: '10000'
    });
    document.body.append(blank);
  }, size);
  try {
    return await locator.screenshot();
  } finally {
    await locator.evaluate((element) => element.remove());
  }
}

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 1
  });
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) responseProblems.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(
    `http://127.0.0.1:${address.port}/docs/design/visual-relations-tier2-review.html`,
    { waitUntil: 'load' }
  );
  try {
    await page.waitForFunction(
      () => document.documentElement.dataset.tier2ReviewReady === 'true',
      undefined,
      { timeout: 10_000 }
    );
  } catch (error) {
    const pageState = await page.evaluate(() => ({
      mountPresent: Boolean(document.getElementById('babel-tier2-visual-review')),
      ready: document.documentElement.dataset.tier2ReviewReady || null,
      scripts: [...document.scripts].map((script) => ({ src: script.src, type: script.type }))
    }));
    throw new Error(
      `Visual review did not become ready. page=${JSON.stringify(pageState)} `
      + `console=${JSON.stringify(consoleProblems)} responses=${JSON.stringify(responseProblems)}`,
      { cause: error }
    );
  }
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.addStyleTag({ content: '* { animation: none !important; transition: none !important; }' });
  await page.waitForTimeout(250);

  const pairs = page.locator('.tier2-review-pair');
  const pairCount = await pairs.count();
  if (pairCount !== 69) throw new Error(`Expected 69 distinct primitive pairs; found ${pairCount}.`);

  const stackingFixture = page.locator('[data-stacking-fixture="true"]');
  const stackingPass = await stackingFixture.getAttribute('data-non-overlap') === 'true';
  const stackingPath = path.join(outDir, 'stacking-persistence.png');
  await stackingFixture.screenshot({ path: stackingPath });
  if (!stackingPass) throw new Error('The multi-stage same-anchor stacking fixture overlaps.');

  const results = [];
  const blankRasters = new Map();
  for (let index = 0; index < pairCount; index += 1) {
    const pair = pairs.nth(index);
    const primitive = await pair.getAttribute('data-primitive');
    const tier1Ink = pair.locator(
      '[data-tier="1"] [data-compare-ink="true"] svg, '
      + '[data-tier="1"] [data-compare-ink="true"] canvas'
    );
    const tier2Ink = pair.locator(
      '[data-tier="2"] [data-compare-ink="true"] svg, '
      + '[data-tier="2"] [data-compare-ink="true"] canvas'
    );
    const size = await tier1Ink.evaluate((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    });
    if (!(size.width > 0 && size.height > 0)) {
      throw new Error(`${primitive || `Primitive ${index + 1}`} has zero-sized Tier-1 ink.`);
    }
    const tier2Size = await tier2Ink.evaluate((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    });
    if (tier2Size.width !== size.width || tier2Size.height !== size.height) {
      throw new Error(`${primitive || `Primitive ${index + 1}`} has mismatched Tier-1/Tier-2 ink dimensions.`);
    }
    const tier1 = await captureAtFixedOrigin(tier1Ink, size);
    const tier2 = await captureAtFixedOrigin(tier2Ink, size);
    const blankKey = `${size.width}x${size.height}`;
    if (!blankRasters.has(blankKey)) {
      blankRasters.set(blankKey, await captureBlankAtFixedOrigin(page, size));
    }
    const blank = blankRasters.get(blankKey);
    const tier1Nonblank = !tier1.equals(blank);
    const tier2Nonblank = !tier2.equals(blank);
    const identical = tier1.equals(tier2);
    results.push({
      primitive,
      identical,
      tier1Nonblank,
      tier2Nonblank,
      tier1Sha256: sha256(tier1),
      tier2Sha256: sha256(tier2)
    });
    if (!identical) {
      const stem = String(primitive || `primitive-${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
      fs.writeFileSync(path.join(outDir, `${stem}.tier1.png`), tier1);
      fs.writeFileSync(path.join(outDir, `${stem}.tier2.png`), tier2);
    }
  }

  const sheetSize = 14;
  const sheetPaths = [];
  for (let start = 0; start < pairCount; start += sheetSize) {
    const end = Math.min(start + sheetSize - 1, pairCount - 1);
    const sheetPath = path.join(
      outDir,
      `review-${String(start + 1).padStart(2, '0')}-${String(end + 1).padStart(2, '0')}.png`
    );
    await pairs.evaluateAll((elements, range) => {
      elements.forEach((element, index) => {
        element.style.display = index >= range.start && index <= range.end ? '' : 'none';
      });
    }, { start, end });
    await page.locator('.tier2-review-grid').screenshot({ path: sheetPath });
    sheetPaths.push(path.relative(repoRoot, sheetPath));
  }
  await pairs.evaluateAll((elements) => elements.forEach((element) => element.style.removeProperty('display')));

  const mismatches = results.filter(({ identical }) => !identical);
  const blankCaptures = results.filter(({ tier1Nonblank, tier2Nonblank }) => (
    !tier1Nonblank || !tier2Nonblank
  ));
  const report = {
    status: mismatches.length === 0
        && blankCaptures.length === 0
        && consoleProblems.length === 0
        && responseProblems.length === 0
      ? 'passed'
      : 'failed',
    page: path.relative(repoRoot, reviewHtml),
    primitivePairs: pairCount,
    identicalPairs: pairCount - mismatches.length,
    mismatches,
    blankCaptures,
    consoleProblems,
    responseProblems,
    stackingFixture: {
      nonOverlapping: stackingPass,
      screenshot: path.relative(repoRoot, stackingPath)
    },
    sheets: sheetPaths,
    results
  };
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );

  if (report.status !== 'passed') {
    throw new Error(
      `Tier-2 visual review failed: ${mismatches.length} raster mismatch(es), `
      + `${blankCaptures.length} blank capture(s), `
      + `${consoleProblems.length} console problem(s), ${responseProblems.length} response problem(s).`
    );
  }
  console.log(`Tier-2 visual review passed: ${pairCount}/${pairCount} raster-identical pairs.`);
  console.log(path.relative(repoRoot, path.join(outDir, 'report.json')));
} finally {
  if (browser) await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

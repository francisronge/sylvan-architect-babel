const fs = require('node:fs');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/Users/francisronge/.npm/_npx/e41f203b7505f1fb/node_modules/playwright'));
}

const BASE_URL = process.env.BABEL_BASE_URL || 'http://127.0.0.1:5177/';
const OUT_DIR = path.resolve('.artifacts/flavor-mixed10');
const CHROME_BIN = '/Users/francisronge/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const CASES = [
  { id: 'min_it_wh', framework: 'minimalism', language: 'Italian', sentence: 'Quale articolo ha letto Giulia?' },
  { id: 'min_ja_decl', framework: 'minimalism', language: 'Japanese (romanized)', sentence: 'Taro ga hon o yonda.' },
  { id: 'min_ro_yesno', framework: 'minimalism', language: 'Romanian', sentence: 'A citit Maria cartea?' },
  { id: 'min_hi_wh', framework: 'minimalism', language: 'Hindi (romanized)', sentence: 'Kaunsi kitaab Ravi ne kharidi?' },
  { id: 'min_tr_decl', framework: 'minimalism', language: 'Turkish', sentence: 'Ayse kitabi okudu.' },
  { id: 'xbar_ga_embed', framework: 'xbar', language: 'Irish', sentence: 'Gheall se go bhfillfeadh se ar an bhaile.' },
  { id: 'xbar_de_embed', framework: 'xbar', language: 'German', sentence: 'Peter sagte dass Maria das Buch kaufte.' },
  { id: 'xbar_fr_decl', framework: 'xbar', language: 'French', sentence: 'Marie a vu le film.' },
  { id: 'xbar_nl_embed', framework: 'xbar', language: 'Dutch', sentence: 'Jan denkt dat Marie komt.' },
  { id: 'xbar_es_embed', framework: 'xbar', language: 'Spanish', sentence: 'La profesora dijo que volveria manana.' }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureOut = () => fs.mkdirSync(OUT_DIR, { recursive: true });

const sanitizeText = (value) => String(value || '').replace(/\r/g, '').trim();

function cleanReplayPanelText(panelText) {
  const drop = new Set(['PREV', 'PLAY', 'PAUSE', 'NEXT', 'REPLAY']);
  return sanitizeText(panelText)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !drop.has(line))
    .join('\n');
}

async function setFramework(page, framework) {
  const toggle = page.locator('button').filter({ hasText: /X-Bar Theory|Minimalist Program/ }).first();
  await toggle.waitFor({ timeout: 10000 });
  const label = sanitizeText(await toggle.innerText().catch(() => ''));
  const wantsXbar = framework === 'xbar';
  const onXbar = /X-Bar Theory/i.test(label);
  if ((wantsXbar && !onXbar) || (!wantsXbar && onXbar)) {
    await toggle.click();
    await sleep(500);
  }
}

async function switchTab(page, label) {
  const tab = page.locator(`button:has-text("${label}")`).first();
  if ((await tab.count()) === 0) return;
  if (await tab.isDisabled().catch(() => false)) return;
  await tab.click();
  await sleep(700);
}

async function waitParseDone(page) {
  const loading = page.locator('text=Synthesizing Neural Roots...');
  try {
    await loading.waitFor({ state: 'visible', timeout: 5000 });
  } catch {}
  await loading.waitFor({ state: 'hidden', timeout: 240000 }).catch(() => {});
  await sleep(1000);
}

async function parseSentence(page, sentence) {
  const area = page.locator('textarea').first();
  await area.click();
  await area.fill(sentence);

  const submit = page.locator('button[type="submit"]').first();
  const respPromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/parse') && resp.request().method() === 'POST',
    { timeout: 240000 }
  );
  await submit.click();
  const resp = await respPromise;
  let payload = null;
  try {
    payload = await resp.json();
  } catch {}
  await waitParseDone(page);
  return { status: resp.status(), payload };
}

async function visibleArrowCount(page) {
  return page.evaluate(() => {
    const arrows = Array.from(document.querySelectorAll('path.movement-arrow'));
    return arrows.filter((el) => {
      const style = window.getComputedStyle(el);
      const opacity = Number(style.opacity || el.getAttribute('opacity') || '0');
      return Number.isFinite(opacity) && opacity > 0.15 && style.display !== 'none' && style.visibility !== 'hidden';
    }).length;
  });
}

function dedupeReplayFrames(frames) {
  const out = [];
  let lastKey = '';
  frames.forEach((frame) => {
    const panelText = cleanReplayPanelText(frame.panelText);
    const key = `${panelText}__${frame.arrows}`;
    if (!panelText || key === lastKey) return;
    lastKey = key;
    out.push({
      stepNumber: out.length + 1,
      panelText,
      arrows: frame.arrows
    });
  });
  return out;
}

async function replayToEnd(page) {
  const nextBtn = page.locator('button:has-text("Next")').first();
  const panel = page.locator('div.absolute.left-10.bottom-28').first();
  const frames = [];

  for (let i = 0; i < 360; i += 1) {
    const panelText = sanitizeText(await panel.innerText().catch(() => ''));
    const arrows = await visibleArrowCount(page).catch(() => 0);
    frames.push({ idx: i, panelText, arrows });
    const disabled = await nextBtn.isDisabled().catch(() => true);
    if (disabled) break;
    await nextBtn.click().catch(() => {});
    await sleep(150);
  }

  const steps = dedupeReplayFrames(frames);
  const maxVisibleArrows = frames.reduce((m, s) => Math.max(m, s.arrows || 0), 0);
  const movementFrames = frames.filter((s) => s.arrows > 0).length;
  return { totalFrames: frames.length, maxVisibleArrows, movementFrames, steps };
}

async function extractNotesText(page) {
  return sanitizeText(
    await page
      .locator('h2:has-text("Structural Geneology")')
      .first()
      .locator('xpath=ancestor::div[contains(@class,"glass-dark")]')
      .first()
      .innerText()
      .catch(() => '')
  );
}

function writeReplayText(item, replay) {
  const replayPath = path.join(OUT_DIR, `${item.id}-replay.txt`);
  const lines = [
    `Case: ${item.id}`,
    `Framework: ${item.framework}`,
    `Language: ${item.language}`,
    `Sentence: ${item.sentence}`,
    ''
  ];
  replay.steps.forEach((step) => {
    lines.push(`Step ${step.stepNumber}`);
    lines.push(step.panelText);
    lines.push(`Visible arrows: ${step.arrows}`);
    lines.push('');
  });
  fs.writeFileSync(replayPath, `${lines.join('\n').trim()}\n`);
  return replayPath;
}

async function runCase(page, item) {
  await setFramework(page, item.framework);
  await switchTab(page, 'Canopy');

  const startedAt = Date.now();
  const parsed = await parseSentence(page, item.sentence);
  const elapsedMs = Date.now() - startedAt;

  if (parsed.status !== 200) {
    const failedShot = path.join(OUT_DIR, `${item.id}-failed.png`);
    await page.screenshot({ path: failedShot, fullPage: true });
    return { ...item, ok: false, status: parsed.status, elapsedMs, failedShot };
  }

  const analysis = parsed.payload?.analyses?.[0] || {};

  await switchTab(page, 'Growth Simulation');
  const replay = await replayToEnd(page);
  const growthShot = path.join(OUT_DIR, `${item.id}-growth-final.png`);
  await page.screenshot({ path: growthShot, fullPage: true });

  await switchTab(page, 'Notes');
  const notesShot = path.join(OUT_DIR, `${item.id}-notes-final.png`);
  await page.screenshot({ path: notesShot, fullPage: true });
  const notesText = await extractNotesText(page);
  const replayTextPath = writeReplayText(item, replay);

  return {
    ...item,
    ok: true,
    status: parsed.status,
    elapsedMs,
    analysis,
    movementEventsCount: Array.isArray(analysis.movementEvents) ? analysis.movementEvents.length : 0,
    derivationStepsCount: Array.isArray(analysis.derivationSteps) ? analysis.derivationSteps.length : 0,
    replay,
    replayTextPath,
    notesText,
    screenshots: {
      growth: growthShot,
      notes: notesShot
    }
  };
}

(async () => {
  ensureOut();
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_BIN
  });
  const context = await browser.newContext({ viewport: { width: 1832, height: 1142 } });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(1200);

  const results = [];
  for (const item of CASES) {
    try {
      results.push(await runCase(page, item));
    } catch (error) {
      const failedShot = path.join(OUT_DIR, `${item.id}-exception.png`);
      await page.screenshot({ path: failedShot, fullPage: true }).catch(() => {});
      results.push({
        ...item,
        ok: false,
        status: 'exception',
        error: String(error?.message || error),
        failedShot
      });
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
      await sleep(1200);
    }
  }

  await browser.close();

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    caseCount: CASES.length,
    results
  };
  const outPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${outPath}\n`);
})();

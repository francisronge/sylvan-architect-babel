const fs = require('node:fs');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/Users/francisronge/.npm/_npx/e41f203b7505f1fb/node_modules/playwright'));
}

const BASE_URL = process.env.BABEL_BASE_URL || 'http://127.0.0.1:5177/';
const SEED = Number(process.env.BABEL_SWEEP_SEED || Date.now());
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = path.resolve(`.artifacts/random20-dual-showcase-${RUN_STAMP}`);
const CHROME_BIN = '/Users/francisronge/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const XBAR_POOL = [
  { language: 'English', phenomenon: 'relative-clause', sentence: 'The editor that Naomi interviewed laughed.' },
  { language: 'English', phenomenon: 'embedded-question', sentence: 'The analyst wondered whether the market had recovered.' },
  { language: 'German', phenomenon: 'wh-question', sentence: 'Welches Buch hat Lara gekauft?' },
  { language: 'German', phenomenon: 'yes-no-question', sentence: 'Hat Maria den Brief gelesen?' },
  { language: 'Dutch', phenomenon: 'relative-clause', sentence: 'De man die Emma zag lachte.' },
  { language: 'French', phenomenon: 'embedded-clause', sentence: 'Marie a dit que Paul partirait.' },
  { language: 'Spanish', phenomenon: 'passive', sentence: 'El informe fue revisado por Carla.' },
  { language: 'Portuguese', phenomenon: 'wh-question', sentence: 'Que pintura comprou Teresa?' },
  { language: 'Romanian', phenomenon: 'passive', sentence: 'A fost inchisa usa de vant.' },
  { language: 'Irish', phenomenon: 'embedded-vso', sentence: 'Gheall se go bhfillfeadh se ar an bhaile.' },
  { language: 'Turkish', phenomenon: 'embedded-clause', sentence: 'Ayse biliyor ki Deniz gelecek.' },
  { language: 'Japanese (romanized)', phenomenon: 'embedded-complement', sentence: 'Yuki-wa Ken-ga kuru to shinjiteiru.' },
  { language: 'Polish', phenomenon: 'embedded-clause', sentence: 'Jan powiedzial ze Maria przyjdzie jutro.' },
  { language: 'Swedish', phenomenon: 'yes-no-question', sentence: 'Har Lina skrivit brevet?' }
];

const MINIMALISM_POOL = [
  { language: 'English', phenomenon: 'wh-question', sentence: 'Which violin did Nora borrow?' },
  { language: 'English', phenomenon: 'long-distance-wh', sentence: 'Which article do you think Clara said Mateo published?' },
  { language: 'French', phenomenon: 'passive', sentence: 'Les lettres ont ete envoyees hier.' },
  { language: 'German', phenomenon: 'embedded-declarative', sentence: 'Ich glaube dass Anna morgen abreist.' },
  { language: 'Spanish', phenomenon: 'yes-no-question', sentence: 'Ha leido Marta la novela?' },
  { language: 'Italian', phenomenon: 'wh-question', sentence: 'Quale quadro ha venduto Paolo?' },
  { language: 'Polish', phenomenon: 'passive', sentence: 'List zostal napisany przez Anne.' },
  { language: 'Romanian', phenomenon: 'wh-question', sentence: 'Ce profesor a laudat Andrei?' },
  { language: 'Japanese (romanized)', phenomenon: 'simple-transitive', sentence: 'Naoki-ga keeki-o tabeta.' },
  { language: 'Hungarian', phenomenon: 'focus-inversion', sentence: 'Melyik konyvet vette meg Anna?' },
  { language: 'Dutch', phenomenon: 'wh-question', sentence: 'Welke foto heeft Ruben genomen?' },
  { language: 'Hindi (romanized)', phenomenon: 'yes-no-question', sentence: 'Kya Anu ne chai banayi?' },
  { language: 'Norwegian', phenomenon: 'wh-question', sentence: 'Hvilken bok leste Nora?' },
  { language: 'Finnish', phenomenon: 'wh-question', sentence: 'Mika kirja Anna osti?' }
];

const TRACE_RE = /^(?:t|trace|t\d+|trace\d+|t[_-][a-z0-9]+|trace[_-][a-z0-9]+|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\}|∅|Ø|ε|null|epsilon)$/i;
const MOVEMENT_RE = /\b(move(?:ment|d|s|ing)?|internal\s*merge|head[\s-]*move(?:ment)?|rais(?:e|es|ed|ing)|lower(?:ing|ed)|trace|copy|a-?bar|a-?move|wh-?move|front(?:ing|ed)?|displac(?:e|ed|ement|ing)|spec(?:ifier)?[, ]*(?:cp|tp|inflp|ip)|epp)\b/i;
const HEDGE_RE = /\b(or|may|can|possibly|might|perhaps|alternatively)\b/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sanitizeText = (value) => String(value || '').replace(/\r/g, '').trim();
const ensureOut = () => fs.mkdirSync(OUT_DIR, { recursive: true });

const normalizeToken = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^<|>$/g, '')
  .replace(/^⟨|⟩$/g, '')
  .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

const tokenize = (sentence) => sanitizeText(sentence)
  .split(/\s+/)
  .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
  .filter(Boolean);

const slugify = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffle = (items, rng) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const pickUniqueCases = (pool, count, rng) => shuffle(pool, rng).slice(0, count);

const PAIRED_CASES = (() => {
  const rng = mulberry32(SEED);
  const xbarCases = pickUniqueCases(XBAR_POOL, 5, rng).map((item, index) => ({
    ...item,
    framework: 'xbar',
    caseId: `xbar-${String(index + 1).padStart(2, '0')}-${slugify(item.language)}-${slugify(item.phenomenon)}`
  }));
  const minimalismCases = pickUniqueCases(MINIMALISM_POOL, 5, rng).map((item, index) => ({
    ...item,
    framework: 'minimalism',
    caseId: `minimalism-${String(index + 1).padStart(2, '0')}-${slugify(item.language)}-${slugify(item.phenomenon)}`
  }));
  return [...xbarCases, ...minimalismCases];
})();

const CASES = [
  ...PAIRED_CASES.map((item) => ({ ...item, route: 'pro', runId: `pro-${item.caseId}` })),
  ...PAIRED_CASES.map((item) => ({ ...item, route: 'flash-lite', runId: `flash-lite-${item.caseId}` }))
];

function sameSeq(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (normalizeToken(left[i]) !== normalizeToken(right[i])) return false;
  }
  return true;
}

function collectLeaves(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) {
    const surface = String(node.word || node.label || '').trim();
    const span = Array.isArray(node.surfaceSpan) ? node.surfaceSpan : [];
    if (surface && !TRACE_RE.test(surface)) {
      out.push({ surface, span });
    }
    return out;
  }
  children.forEach((child) => collectLeaves(child, out));
  return out;
}

function countTokens(tokens) {
  const counts = new Map();
  tokens.forEach((token) => {
    const normalized = normalizeToken(token);
    if (!normalized) return;
    counts.set(normalized, Number(counts.get(normalized) || 0) + 1);
  });
  return counts;
}

function sameCounts(left, right) {
  const a = countTokens(left);
  const b = countTokens(right);
  if (a.size !== b.size) return false;
  for (const [token, count] of a.entries()) {
    if (Number(b.get(token) || 0) !== count) return false;
  }
  return true;
}

async function waitForParseDone(page) {
  const loading = page.locator('text=Synthesizing Neural Roots...');
  try {
    await loading.waitFor({ state: 'visible', timeout: 5000 });
  } catch {}
  await loading.waitFor({ state: 'hidden', timeout: 240000 }).catch(() => {});
  await sleep(1000);
}

async function setFramework(page, framework) {
  const toggle = page.locator('button').filter({ hasText: /X-Bar Theory|Minimalist Program/ }).first();
  await toggle.waitFor({ timeout: 10000 });
  const label = sanitizeText(await toggle.innerText().catch(() => ''));
  const wantsXbar = framework === 'xbar';
  const onXbar = /X-Bar Theory/i.test(label);
  if ((wantsXbar && !onXbar) || (!wantsXbar && onXbar)) {
    await toggle.click();
    await sleep(600);
  }
}

async function setRoute(page, route) {
  const toggle = page.locator('button').filter({ hasText: /Gemini 3\.1 Flash Lite|Gemini 3\.1 Pro/ }).first();
  await toggle.waitFor({ timeout: 10000 });
  const label = sanitizeText(await toggle.innerText().catch(() => ''));
  const wantsPro = route === 'pro';
  const onPro = /Gemini 3\.1 Pro/i.test(label);
  if ((wantsPro && !onPro) || (!wantsPro && onPro)) {
    await toggle.click();
    await sleep(700);
  }
}

async function switchToTab(page, label) {
  const tab = page.locator(`button:has-text("${label}")`).first();
  if ((await tab.count()) === 0) return;
  if (await tab.isDisabled().catch(() => false)) return;
  await tab.click();
  await sleep(800);
}

async function parseViaUi(page, sentence) {
  const textarea = page.locator('textarea').first();
  await textarea.click();
  await textarea.fill(sentence);

  const submit = page.locator('button[type="submit"]').first();
  const responsePromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/parse') && resp.request().method() === 'POST',
    { timeout: 260000 }
  );
  await submit.click();
  const response = await responsePromise;
  const bodyText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(bodyText);
  } catch {}
  await waitForParseDone(page);
  return { status: response.status(), payload, bodyText };
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

function cleanReplayPanelText(panelText) {
  const drop = new Set(['PREV', 'PLAY', 'PAUSE', 'NEXT', 'REPLAY']);
  return sanitizeText(panelText)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !drop.has(line))
    .join('\n');
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
  const nextBtn = page.locator('button:has-text("NEXT"), button:has-text("Next")').first();
  const panel = page.locator('div.absolute.left-10.bottom-28').first();
  const frames = [];

  for (let i = 0; i < 420; i += 1) {
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

function inferRouteFromModel(modelUsed) {
  const value = String(modelUsed || '').toLowerCase();
  return value.includes('flash-lite') ? 'flash-lite' : value.includes('pro') ? 'pro' : 'unknown';
}

function analyzeCase(item, payload, notesText, replay) {
  const analysis = payload?.analyses?.[0] || {};
  const sentenceTokens = tokenize(item.sentence);
  const leaves = collectLeaves(analysis.tree)
    .sort((a, b) => {
      const left = Array.isArray(a.span) && Number.isInteger(a.span[0]) ? a.span[0] : Number.MAX_SAFE_INTEGER;
      const right = Array.isArray(b.span) && Number.isInteger(b.span[0]) ? b.span[0] : Number.MAX_SAFE_INTEGER;
      return left - right;
    })
    .map((entry) => entry.surface);
  const surfaceOrder = Array.isArray(analysis.surfaceOrder) ? analysis.surfaceOrder : [];
  const movementEvents = Array.isArray(analysis.movementEvents) ? analysis.movementEvents : [];
  const issues = [];
  const noMovementExplanation = /no movement is posited|no displacement operation is encoded/i.test(notesText);

  if (!sameSeq(leaves, sentenceTokens)) issues.push('LEAVES_NE_SENTENCE');
  if (!sameSeq(surfaceOrder, sentenceTokens)) issues.push('SURFACE_NE_SENTENCE');
  if (!sameSeq(leaves, surfaceOrder)) issues.push('LEAVES_NE_SURFACE');
  if (!sameCounts(leaves, sentenceTokens)) issues.push('LEAF_INVENTORY_NE_SENTENCE');
  if (movementEvents.length > 0 && replay.maxVisibleArrows === 0) issues.push('MOVEMENT_EVENTS_WITHOUT_ARROWS');
  if (movementEvents.length === 0 && replay.maxVisibleArrows > 0) issues.push('ARROWS_WITHOUT_MOVEMENT_EVENTS');
  if (movementEvents.length > 0 && !MOVEMENT_RE.test(notesText)) issues.push('MOVEMENT_MISSING_FROM_NOTES');
  if (movementEvents.length === 0 && MOVEMENT_RE.test(notesText) && !noMovementExplanation) {
    issues.push('NOTES_MOVEMENT_WITHOUT_EVENTS');
  }
  if (HEDGE_RE.test(notesText)) issues.push('HEDGING_IN_NOTES');

  return {
    analysis,
    notesText,
    replay,
    checks: {
      ok: issues.length === 0,
      issues,
      leaves,
      surfaceOrder,
      movementEventsCount: movementEvents.length,
      replayFrames: replay.totalFrames,
      replayMovementFrames: replay.movementFrames,
      replayMaxVisibleArrows: replay.maxVisibleArrows
    }
  };
}

async function runCase(page, item) {
  await setFramework(page, item.framework);
  await setRoute(page, item.route);

  const startedAt = Date.now();
  const parsed = await parseViaUi(page, item.sentence);
  const elapsedMs = Date.now() - startedAt;
  const prefix = item.runId;

  if (parsed.status !== 200) {
    const failed = path.join(OUT_DIR, `${prefix}-failed.png`);
    await page.screenshot({ path: failed, fullPage: true });
    return {
      ...item,
      ok: false,
      elapsedMs,
      status: parsed.status,
      error: parsed.payload?.error || parsed.bodyText || 'Unknown error',
      screenshots: { failed }
    };
  }

  const modelUsed = parsed.payload?.modelUsed || '';
  const actualRoute = inferRouteFromModel(modelUsed);
  const analysisPath = path.join(OUT_DIR, `${prefix}-analysis.json`);
  fs.writeFileSync(analysisPath, JSON.stringify(parsed.payload, null, 2));

  await switchToTab(page, 'Canopy');
  const canopy = path.join(OUT_DIR, `${prefix}-canopy.png`);
  await page.screenshot({ path: canopy, fullPage: true });

  await switchToTab(page, 'Growth Simulation');
  const replay = await replayToEnd(page);
  const growth = path.join(OUT_DIR, `${prefix}-growth-final.png`);
  await page.screenshot({ path: growth, fullPage: true });

  await switchToTab(page, 'Notes');
  const notes = path.join(OUT_DIR, `${prefix}-notes.png`);
  await page.screenshot({ path: notes, fullPage: true });
  const notesText = await extractNotesText(page);

  const analysisSummary = analyzeCase(item, parsed.payload, notesText, replay);

  return {
    ...item,
    ok: true,
    elapsedMs,
    status: parsed.status,
    analysisPath,
    modelUsed,
    actualRoute,
    fallbackUsed: Boolean(parsed.payload?.fallbackUsed),
    movementDecision: analysisSummary.analysis.movementDecision || null,
    movementEventsCount: analysisSummary.checks.movementEventsCount,
    derivationStepsCount: Array.isArray(analysisSummary.analysis.derivationSteps)
      ? analysisSummary.analysis.derivationSteps.length
      : 0,
    surfaceOrder: analysisSummary.analysis.surfaceOrder || [],
    notesText,
    checks: analysisSummary.checks,
    screenshots: { canopy, growth, notes }
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
  for (const [index, item] of CASES.entries()) {
    console.error(`[random20-dual] ${index + 1}/${CASES.length} ${item.route} ${item.framework} ${item.language} :: ${item.sentence}`);
    try {
      const result = await runCase(page, item);
      results.push(result);
      console.error(`[random20-dual] completed ${item.runId} ok=${result.ok} status=${result.status} actualRoute=${result.actualRoute || 'n/a'} fallback=${result.fallbackUsed ? 'yes' : 'no'}`);
    } catch (error) {
      const failed = path.join(OUT_DIR, `${item.runId}-exception.png`);
      await page.screenshot({ path: failed, fullPage: true }).catch(() => {});
      results.push({
        ...item,
        ok: false,
        status: 'exception',
        error: String(error?.message || error),
        screenshots: { failed }
      });
      console.error(`[random20-dual] exception ${item.runId}: ${String(error?.message || error)}`);
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
      await sleep(1200);
    }
  }

  await browser.close();

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    structurallyClean: results.filter((r) => r.ok && r.checks?.ok).length,
    byRoute: {
      pro: results.filter((r) => r.route === 'pro' && r.ok).length,
      flashLite: results.filter((r) => r.route === 'flash-lite' && r.ok).length
    },
    byFrameworkAndRoute: {
      proXbar: results.filter((r) => r.route === 'pro' && r.framework === 'xbar' && r.ok).length,
      proMinimalism: results.filter((r) => r.route === 'pro' && r.framework === 'minimalism' && r.ok).length,
      flashLiteXbar: results.filter((r) => r.route === 'flash-lite' && r.framework === 'xbar' && r.ok).length,
      flashLiteMinimalism: results.filter((r) => r.route === 'flash-lite' && r.framework === 'minimalism' && r.ok).length
    }
  };

  const report = {
    generatedAt: new Date().toISOString(),
    seed: SEED,
    baseUrl: BASE_URL,
    outDir: OUT_DIR,
    pairedCases: PAIRED_CASES,
    summary,
    results
  };

  const outPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${outPath}\n`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

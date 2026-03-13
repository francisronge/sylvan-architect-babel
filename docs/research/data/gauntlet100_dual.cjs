const fs = require('node:fs');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/Users/francisronge/.npm/_npx/e41f203b7505f1fb/node_modules/playwright'));
}

const {
  normalizeSurfaceToken,
  tokenizeSentenceSurfaceOrder,
  sameSeq
} = require('./helpers/surfaceTokens.cjs');

const BASE_URL = process.env.BABEL_BASE_URL || 'http://127.0.0.1:5177/';
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RESUME_DIR = String(process.env.BABEL_RESUME_DIR || '').trim();
const OUT_DIR = RESUME_DIR
  ? path.resolve(RESUME_DIR)
  : path.resolve(`.artifacts/gauntlet100-${RUN_STAMP}`);
const DEFAULT_ROUTES = ['pro', 'flash-lite'];
const ROUTES = String(process.env.BABEL_ROUTES || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const ACTIVE_ROUTES = ROUTES.length > 0 ? ROUTES : DEFAULT_ROUTES;
const ACTIVE_FRAMEWORKS = new Set(
  String(process.env.BABEL_FRAMEWORKS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
);
const CASE_ID_FILTER = new Set(
  String(process.env.BABEL_CASE_IDS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
);
const CASE_LIMIT = Number(process.env.BABEL_CASE_LIMIT || 0);
const CHROME_BIN = '/Users/francisronge/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const TRACE_RE = /^(?:t|trace|t\d+|trace\d+|(?:t|trace)(?:_[a-z0-9]+)+|[a-z]+_trace(?:_[a-z0-9]+)*|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\}|∅|Ø|ε|null|epsilon)$/i;
const MOVEMENT_RE = /\b(move(?:ment|d|s|ing)?|internal\s*merge|head[\s-]*move(?:ment)?|raising|raised|lower(?:ing|ed)|trace|copy|a-?bar|a-?move|wh-?move|front(?:ing|ed)?|displac(?:e|ed|ement|ing)|spec(?:ifier)?[, ]*(?:cp|tp|inflp|ip)|epp|focus|topic)\b/i;
const NO_MOVEMENT_RE = /\b(no movement is posited|no displacement operation is encoded)\b/i;
const HEDGE_RE = /\b(or|may|can|possibly|might|perhaps|alternatively)\b/i;
const HARD_FAILURE_CODES = new Set(['BAD_MODEL_RESPONSE', 'API_KEY_MISSING', 'INVALID_REQUEST']);

function withShowcaseParam(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('showcase', '1');
  return url.toString();
}

const CAPTURE_URL = withShowcaseParam(BASE_URL);

const XBAR_CASES = [
  { id: 'x_en_relative', framework: 'xbar', language: 'English', phenomenon: 'relative-clause', sentence: 'The editor who praised the article resigned.' },
  { id: 'x_en_raising', framework: 'xbar', language: 'English', phenomenon: 'raising-like-clause', sentence: 'It seems that the guests have departed.' },
  { id: 'x_de_wh', framework: 'xbar', language: 'German', phenomenon: 'wh-question', sentence: 'Welches Gemälde hat Lara gekauft?' },
  { id: 'x_de_embed_perfect', framework: 'xbar', language: 'German', phenomenon: 'embedded-perfect', sentence: 'Der Lehrer sagte, dass die Schülerin das Buch gelesen hat.' },
  { id: 'x_fr_passive', framework: 'xbar', language: 'French', phenomenon: 'passive', sentence: 'Le rapport a été publié hier.' },
  { id: 'x_fr_embed', framework: 'xbar', language: 'French', phenomenon: 'embedded-clause', sentence: 'Marie a dit que Paul viendra.' },
  { id: 'x_es_yesno', framework: 'xbar', language: 'Spanish', phenomenon: 'yes-no-question', sentence: '¿Ha comprado Ana el libro?' },
  { id: 'x_es_complement', framework: 'xbar', language: 'Spanish', phenomenon: 'complement-clause', sentence: 'El médico dijo que la paciente llegó temprano.' },
  { id: 'x_it_subjunctive', framework: 'xbar', language: 'Italian', phenomenon: 'embedded-subjunctive', sentence: 'Gianni pensa che Lucia parta domani.' },
  { id: 'x_pt_wh', framework: 'xbar', language: 'Portuguese', phenomenon: 'wh-question', sentence: 'Que poema escreveu Sofia?' },
  { id: 'x_nl_relative', framework: 'xbar', language: 'Dutch', phenomenon: 'relative-clause', sentence: 'De man die Emma zag lachte.' },
  { id: 'x_nl_embed', framework: 'xbar', language: 'Dutch', phenomenon: 'embedded-declarative', sentence: 'Milan zegt dat Sara morgen belt.' },
  { id: 'x_ga_vso', framework: 'xbar', language: 'Irish', phenomenon: 'vso-declarative', sentence: 'Chonaic Seán an madra.' },
  { id: 'x_ga_embed', framework: 'xbar', language: 'Irish', phenomenon: 'embedded-complement', sentence: 'Gheall sé go bhfillfeadh sé ar an bhaile.' },
  { id: 'x_ro_passive', framework: 'xbar', language: 'Romanian', phenomenon: 'passive', sentence: 'A fost închisă ușa de vânt.' },
  { id: 'x_ro_embed_q', framework: 'xbar', language: 'Romanian', phenomenon: 'embedded-question', sentence: 'Profesorul a întrebat dacă studenții au venit.' },
  { id: 'x_ru_embed', framework: 'xbar', language: 'Russian', phenomenon: 'embedded-clause', sentence: 'Учитель сказал, что ученица прочитала книгу.' },
  { id: 'x_el_wh', framework: 'xbar', language: 'Greek', phenomenon: 'wh-question', sentence: 'Ποιο βιβλίο διάβασε η Μαρία;' },
  { id: 'x_he_embed', framework: 'xbar', language: 'Hebrew', phenomenon: 'embedded-clause', sentence: 'דנה אמרה שיואב יגיע מחר.' },
  { id: 'x_ar_embed', framework: 'xbar', language: 'Arabic', phenomenon: 'embedded-clause', sentence: 'قالت مريم إن بول سيغادر غداً.' },
  { id: 'x_hi_embed', framework: 'xbar', language: 'Hindi', phenomenon: 'embedded-clause', sentence: 'शिक्षक ने कहा कि छात्रा जल्दी आई।' },
  { id: 'x_bn_embed', framework: 'xbar', language: 'Bengali', phenomenon: 'embedded-clause', sentence: 'শিক্ষক বললেন যে ছাত্রী বইটি পড়েছে।' },
  { id: 'x_sr_embed', framework: 'xbar', language: 'Serbian', phenomenon: 'embedded-clause', sentence: 'Професор је рекао да су студенти дошли рано.' },
  { id: 'x_tr_embed', framework: 'xbar', language: 'Turkish', phenomenon: 'embedded-clause', sentence: 'Doktor hastanın erken geldiğini söyledi.' },
  { id: 'x_pl_embed', framework: 'xbar', language: 'Polish', phenomenon: 'embedded-clause', sentence: 'Nauczyciel powiedział, że uczennica przeczytała książkę.' }
];

const MIN_CASES = [
  { id: 'm_en_long_wh', framework: 'minimalism', language: 'English', phenomenon: 'long-distance-wh', sentence: 'Which article do you think Clara said Mateo published?' },
  { id: 'm_en_passive', framework: 'minimalism', language: 'English', phenomenon: 'passive', sentence: 'The letters were delivered yesterday.' },
  { id: 'm_de_yesno', framework: 'minimalism', language: 'German', phenomenon: 'yes-no-question', sentence: 'Hat der Fahrer den Wagen verkauft?' },
  { id: 'm_de_wh', framework: 'minimalism', language: 'German', phenomenon: 'wh-question', sentence: 'Welches Foto hat Maria gesehen?' },
  { id: 'm_fr_wh', framework: 'minimalism', language: 'French', phenomenon: 'wh-question', sentence: 'Quel roman a choisi Élise ?' },
  { id: 'm_es_wh', framework: 'minimalism', language: 'Spanish', phenomenon: 'wh-question', sentence: '¿Qué cuadro pintó Elena?' },
  { id: 'm_it_wh', framework: 'minimalism', language: 'Italian', phenomenon: 'wh-question', sentence: 'Quale sonata ha eseguito Marta?' },
  { id: 'm_pt_wh', framework: 'minimalism', language: 'Portuguese', phenomenon: 'wh-question', sentence: 'Que relatório revisou Sofia?' },
  { id: 'm_nl_wh', framework: 'minimalism', language: 'Dutch', phenomenon: 'wh-question', sentence: 'Welke student heeft Emma gezien?' },
  { id: 'm_pl_wh', framework: 'minimalism', language: 'Polish', phenomenon: 'wh-question', sentence: 'Którą gazetę kupił Marek?' },
  { id: 'm_ro_wh', framework: 'minimalism', language: 'Romanian', phenomenon: 'wh-question', sentence: 'Ce film a văzut Irina?' },
  { id: 'm_hu_focus', framework: 'minimalism', language: 'Hungarian', phenomenon: 'focus-inversion', sentence: 'Melyik könyvet vette meg Anna?' },
  { id: 'm_cs_wh', framework: 'minimalism', language: 'Czech', phenomenon: 'wh-question', sentence: 'Kterou knihu koupil Marek?' },
  { id: 'm_ru_wh', framework: 'minimalism', language: 'Russian', phenomenon: 'wh-question', sentence: 'Какую книгу купила Маша?' },
  { id: 'm_el_wh', framework: 'minimalism', language: 'Greek', phenomenon: 'wh-question', sentence: 'Ποιο βιβλίο διάβασε η Μαρία;' },
  { id: 'm_he_wh', framework: 'minimalism', language: 'Hebrew', phenomenon: 'wh-question', sentence: 'איזה ספר קנתה נועה?' },
  { id: 'm_ar_wh', framework: 'minimalism', language: 'Arabic', phenomenon: 'wh-question', sentence: 'أي كتاب اشترت ليلى ؟' },
  { id: 'm_hi_yesno', framework: 'minimalism', language: 'Hindi', phenomenon: 'yes-no-question', sentence: 'क्या रवि ने चिट्ठी लिखी ?' },
  { id: 'm_hi_wh', framework: 'minimalism', language: 'Hindi', phenomenon: 'wh-question', sentence: 'कौन सी किताब मीरा ने खरीदी ?' },
  { id: 'm_bn_wh', framework: 'minimalism', language: 'Bengali', phenomenon: 'wh-question', sentence: 'কোন বইটা রিমা কিনেছে ?' },
  { id: 'm_sr_wh', framework: 'minimalism', language: 'Serbian', phenomenon: 'wh-question', sentence: 'Коју књигу је Ана купила?' },
  { id: 'm_tr_wh', framework: 'minimalism', language: 'Turkish', phenomenon: 'wh-question', sentence: 'Hangi kitabı Ayşe okudu?' },
  { id: 'm_ga_wh', framework: 'minimalism', language: 'Irish', phenomenon: 'wh-question', sentence: 'Cén leabhar a cheannaigh Máire?' },
  { id: 'm_fi_wh', framework: 'minimalism', language: 'Finnish', phenomenon: 'wh-question', sentence: 'Minkä kirjan Anna osti?' },
  { id: 'm_bg_wh', framework: 'minimalism', language: 'Bulgarian', phenomenon: 'wh-question', sentence: 'Коя книга прочете Мария?' }
];

const CASES = [...XBAR_CASES, ...MIN_CASES];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function selectCases(allCases) {
  let filtered = allCases.slice();
  if (ACTIVE_FRAMEWORKS.size > 0) {
    filtered = filtered.filter((item) => ACTIVE_FRAMEWORKS.has(item.framework));
  }
  if (CASE_ID_FILTER.size > 0) {
    filtered = filtered.filter((item) => CASE_ID_FILTER.has(item.id));
  }
  if (Number.isInteger(CASE_LIMIT) && CASE_LIMIT > 0) {
    filtered = filtered.slice(0, CASE_LIMIT);
  }
  return filtered;
}

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function sanitizeText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function resolveLeafSurface(node) {
  const word = String(node?.word || '').trim();
  if (word) return word;
  const children = Array.isArray(node?.children) ? node.children : [];
  if (children.length > 0) return '';
  return String(node?.label || '').trim();
}

function collectLeaves(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) {
    const surface = resolveLeafSurface(node);
    const span = Array.isArray(node.surfaceSpan) ? node.surfaceSpan : [];
    if (surface && !TRACE_RE.test(surface)) out.push({ surface, span });
    return out;
  }
  children.forEach((child) => collectLeaves(child, out));
  return out;
}

function countTokens(tokens) {
  const counts = new Map();
  tokens.forEach((token) => {
    const normalized = normalizeSurfaceToken(token);
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

function collectNodeIds(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  const id = String(node.id || '').trim();
  if (id) out.add(id);
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child) => collectNodeIds(child, out));
  return out;
}

function countMoveSteps(steps) {
  const moveOps = new Set(['Move', 'InternalMerge', 'HeadMove', 'A-Move', 'AbarMove']);
  return (Array.isArray(steps) ? steps : []).filter((step) => moveOps.has(String(step?.operation || '').trim())).length;
}

function classifyFailure(status, error) {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').trim();
  if (status === 598 || code === 'LOCAL_TIMEOUT') return 'provider_timeout';
  if (status === 503) return 'provider_timeout';
  if (status >= 400 && HARD_FAILURE_CODES.has(code)) return 'malformed_output';
  if (status >= 500) return 'server_failure';
  if (status && status !== 200) return 'http_failure';
  if (/timeout|timed out|no bytes/i.test(message)) return 'provider_timeout';
  return 'unknown_failure';
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
    await sleep(700);
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
    await sleep(900);
  }
}

async function switchToTab(page, label) {
  const tab = page.locator(`button:has-text("${label}")`).first();
  if ((await tab.count()) === 0) return;
  if (await tab.isDisabled().catch(() => false)) return;
  await tab.click();
  await sleep(900);
}

async function parseViaUi(page, sentence) {
  const textarea = page.locator('textarea').first();
  await textarea.fill(sentence);

  const responsePromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/parse') && resp.request().method() === 'POST',
    { timeout: 260000 }
  );
  await textarea.press('Enter');
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
  const heading = page.locator('h2').filter({ hasText: /Structural Genealo(?:g|go)gy/i }).first();
  return sanitizeText(
    await heading
      .locator('xpath=ancestor::div[contains(@class,"glass-dark")]')
      .first()
      .innerText()
      .catch(() => '')
  );
}

function resultKey(item) {
  return `${item.route}::${item.framework}::${item.id}`;
}

function repairStoredResult(result) {
  if (!result || typeof result !== 'object') return result;
  const repaired = { ...result };
  const explanation = sanitizeText(repaired.explanation || '');
  const notesText = sanitizeText(repaired.notesText || '');
  if (!notesText && explanation) {
    repaired.notesText = explanation;
  }
  if (Array.isArray(repaired.issues) && repaired.issues.includes('MOVEMENT_MISSING_FROM_NOTES')) {
    const effectiveNotes = sanitizeText(repaired.notesText || explanation);
    if (MOVEMENT_RE.test(effectiveNotes)) {
      repaired.issues = repaired.issues.filter((issue) => issue !== 'MOVEMENT_MISSING_FROM_NOTES');
    }
  }
  if (repaired.status === 200) {
    repaired.category = repaired.issues?.length ? 'structural_issue' : 'structurally_clean';
    repaired.ok = !repaired.issues?.length;
  }
  return repaired;
}

function loadExistingResults() {
  if (!fs.existsSync(OUT_DIR)) return [];
  const entries = fs
    .readdirSync(OUT_DIR)
    .filter((name) => /^(?:pro|flash-lite)-(?:xbar|minimalism)-.+\.json$/.test(name))
    .sort();
  const seen = new Set();
  const results = [];
  for (const name of entries) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8'));
      const result = repairStoredResult(parsed?.result);
      if (!result) continue;
      const key = resultKey(result);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(result);
    } catch (error) {
      console.error(`[gauntlet100-ui] unable to load existing result ${name}: ${String(error?.message || error)}`);
    }
  }
  return results;
}

function upsertResult(results, nextResult) {
  const key = resultKey(nextResult);
  const index = results.findIndex((item) => resultKey(item) === key);
  if (index >= 0) {
    results[index] = nextResult;
    return;
  }
  results.push(nextResult);
}

function inferRouteFromModel(modelUsed) {
  const value = String(modelUsed || '').toLowerCase();
  return value.includes('flash-lite') ? 'flash-lite' : value.includes('pro') ? 'pro' : 'unknown';
}

function analyzeSuccess(testCase, route, payload, notesText, replay) {
  const analysis = payload?.analyses?.[0] || {};
  const sentenceTokens = tokenizeSentenceSurfaceOrder(testCase.sentence);
  const leaves = collectLeaves(analysis.tree)
    .sort((a, b) => {
      const left = Array.isArray(a.span) && Number.isInteger(a.span[0]) ? a.span[0] : Number.MAX_SAFE_INTEGER;
      const right = Array.isArray(b.span) && Number.isInteger(b.span[0]) ? b.span[0] : Number.MAX_SAFE_INTEGER;
      return left - right;
    })
    .map((entry) => entry.surface);
  const surfaceOrder = Array.isArray(analysis.surfaceOrder) ? analysis.surfaceOrder : [];
  const movementEvents = Array.isArray(analysis.movementEvents) ? analysis.movementEvents : [];
  const derivationSteps = Array.isArray(analysis.derivationSteps) ? analysis.derivationSteps : [];
  const explanation = sanitizeText(analysis.explanation || '');
  const effectiveNotesText = sanitizeText(notesText || explanation);
  const nodeIds = collectNodeIds(analysis.tree);
  const issues = [];
  const noMovementExplanation = NO_MOVEMENT_RE.test(effectiveNotesText);

  if (!sameSeq(leaves, sentenceTokens)) issues.push('LEAVES_NE_SENTENCE');
  if (!sameSeq(surfaceOrder, sentenceTokens)) issues.push('SURFACE_NE_SENTENCE');
  if (!sameSeq(leaves, surfaceOrder)) issues.push('LEAVES_NE_SURFACE');
  if (!sameCounts(leaves, sentenceTokens)) issues.push('LEAF_INVENTORY_NE_SENTENCE');
  if (derivationSteps.at(-1)?.operation !== 'SpellOut') issues.push('NO_FINAL_SPELLOUT');
  if (movementEvents.length > 0 && replay.maxVisibleArrows === 0) issues.push('MOVEMENT_EVENTS_WITHOUT_ARROWS');
  if (movementEvents.length === 0 && replay.maxVisibleArrows > 0) issues.push('ARROWS_WITHOUT_MOVEMENT_EVENTS');
  if (movementEvents.length > 0 && !MOVEMENT_RE.test(effectiveNotesText)) issues.push('MOVEMENT_MISSING_FROM_NOTES');
  if (movementEvents.length === 0 && MOVEMENT_RE.test(effectiveNotesText) && !noMovementExplanation) {
    issues.push('NOTES_MOVEMENT_WITHOUT_EVENTS');
  }
  if (movementEvents.length === 0 && MOVEMENT_RE.test(explanation) && !NO_MOVEMENT_RE.test(explanation)) {
    issues.push('EXPLANATION_MOVEMENT_WITHOUT_EVENTS');
  }
  if (countMoveSteps(derivationSteps) === 0 && movementEvents.length > 0) issues.push('MOVE_EVENTS_WITHOUT_MOVE_STEPS');
  if (HEDGE_RE.test(notesText)) issues.push('HEDGING_IN_NOTES');

  for (const event of movementEvents) {
    const from = String(event?.fromNodeId || '').trim();
    const to = String(event?.toNodeId || '').trim();
    const trace = String(event?.traceNodeId || '').trim();
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to) || (trace && !nodeIds.has(trace))) {
      issues.push('INVALID_MOVEMENT_NODE_REF');
      break;
    }
  }

  return {
    analysis,
    result: {
      id: testCase.id,
      route,
      framework: testCase.framework,
      language: testCase.language,
      phenomenon: testCase.phenomenon,
      sentence: testCase.sentence,
      status: 200,
      category: issues.length === 0 ? 'structurally_clean' : 'structural_issue',
      ok: issues.length === 0,
      issues,
      modelUsed: payload?.modelUsed || payload?.metadata?.modelUsed || null,
      actualRoute: inferRouteFromModel(payload?.modelUsed || payload?.metadata?.modelUsed || ''),
      fallbackUsed: Boolean(payload?.fallbackUsed),
      leaves,
      surfaceOrder,
      movementEventsCount: movementEvents.length,
      moveDerivationStepsCount: countMoveSteps(derivationSteps),
      derivationStepsCount: derivationSteps.length,
      replayFrames: replay.totalFrames,
      replayMovementFrames: replay.movementFrames,
      replayMaxVisibleArrows: replay.maxVisibleArrows,
      explanation,
      notesText: effectiveNotesText
    }
  };
}

function summarize(results) {
  const bucket = (predicate) => results.filter(predicate).length;
  const byRoute = {};
  const byFramework = {};

  for (const route of ACTIVE_ROUTES) {
    const routeResults = results.filter((item) => item.route === route);
    byRoute[route] = {
      total: routeResults.length,
      successful: bucket((item) => item.route === route && item.status === 200),
      structurallyClean: bucket((item) => item.route === route && item.category === 'structurally_clean'),
      structuralIssues: bucket((item) => item.route === route && item.category === 'structural_issue'),
      providerTimeouts: bucket((item) => item.route === route && item.category === 'provider_timeout'),
      malformedOutputs: bucket((item) => item.route === route && item.category === 'malformed_output'),
      serverFailures: bucket((item) => item.route === route && item.category === 'server_failure'),
      otherFailures: bucket((item) => item.route === route && !['structurally_clean', 'structural_issue', 'provider_timeout', 'malformed_output', 'server_failure'].includes(item.category))
    };
  }

  for (const framework of ['xbar', 'minimalism']) {
    const frameworkResults = results.filter((item) => item.framework === framework);
    byFramework[framework] = {
      total: frameworkResults.length,
      successful: bucket((item) => item.framework === framework && item.status === 200),
      structurallyClean: bucket((item) => item.framework === framework && item.category === 'structurally_clean'),
      structuralIssues: bucket((item) => item.framework === framework && item.category === 'structural_issue'),
      providerTimeouts: bucket((item) => item.framework === framework && item.category === 'provider_timeout'),
      malformedOutputs: bucket((item) => item.framework === framework && item.category === 'malformed_output'),
      serverFailures: bucket((item) => item.framework === framework && item.category === 'server_failure'),
      otherFailures: bucket((item) => item.framework === framework && !['structurally_clean', 'structural_issue', 'provider_timeout', 'malformed_output', 'server_failure'].includes(item.category))
    };
  }

  return {
    baseUrl: BASE_URL,
    captureUrl: CAPTURE_URL,
    outDir: OUT_DIR,
    generatedAt: new Date().toISOString(),
    total: results.length,
    successful: bucket((item) => item.status === 200),
    structurallyClean: bucket((item) => item.category === 'structurally_clean'),
    structuralIssues: bucket((item) => item.category === 'structural_issue'),
    providerTimeouts: bucket((item) => item.category === 'provider_timeout'),
    malformedOutputs: bucket((item) => item.category === 'malformed_output'),
    serverFailures: bucket((item) => item.category === 'server_failure'),
    otherFailures: bucket((item) => !['structurally_clean', 'structural_issue', 'provider_timeout', 'malformed_output', 'server_failure'].includes(item.category)),
    byRoute,
    byFramework,
    results
  };
}

function buildMarkdown(summary) {
  const lines = [];
  lines.push('# 100-Tree Dual-Route UI Gauntlet');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push(`Base URL: ${summary.baseUrl}`);
  lines.push(`Capture URL: ${summary.captureUrl}`);
  lines.push(`Artifacts: ${summary.outDir}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total runs completed so far: ${summary.total}`);
  lines.push(`- Successful parses: ${summary.successful}`);
  lines.push(`- Structurally clean: ${summary.structurallyClean}`);
  lines.push(`- Structural issues: ${summary.structuralIssues}`);
  lines.push(`- Provider timeouts: ${summary.providerTimeouts}`);
  lines.push(`- Malformed outputs: ${summary.malformedOutputs}`);
  lines.push(`- Server failures: ${summary.serverFailures}`);
  lines.push(`- Other failures: ${summary.otherFailures}`);
  lines.push('');
  lines.push('## Failures / Structural Issues');
  lines.push('');
  const flagged = summary.results.filter((item) => item.category !== 'structurally_clean');
  if (flagged.length === 0) {
    lines.push('- None');
  } else {
    for (const item of flagged) {
      const detail = item.issues?.length ? item.issues.join(', ') : item.error?.code || item.error?.message || item.category;
      lines.push(`- \`${item.route}\` / \`${item.framework}\` / \`${item.language}\` / \`${item.phenomenon}\`: ${item.sentence} — ${detail}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function writeSummaryArtifacts(results) {
  const summary = summarize(results);
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), buildMarkdown(summary));
}

function writeCaseArtifact(result, payload) {
  const filename = `${result.route}-${result.framework}-${result.id}.json`;
  fs.writeFileSync(
    path.join(OUT_DIR, filename),
    JSON.stringify({ result, payload }, null, 2)
  );
}

async function runCase(page, testCase, route) {
  await page.goto(CAPTURE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(1200);
  await setFramework(page, testCase.framework);
  await setRoute(page, route);

  const startedAt = Date.now();
  const parsed = await parseViaUi(page, testCase.sentence);
  const elapsedMs = Date.now() - startedAt;
  const prefix = `${route}-${testCase.framework}-${testCase.id}`;

  if (parsed.status !== 200) {
    const error = parsed.payload?.error || { message: parsed.bodyText || 'Unknown error' };
    const failed = path.join(OUT_DIR, `${prefix}-failed.png`);
    await page.screenshot({ path: failed, fullPage: true }).catch(() => {});
    return {
      result: {
        id: testCase.id,
        route,
        framework: testCase.framework,
        language: testCase.language,
        phenomenon: testCase.phenomenon,
        sentence: testCase.sentence,
        status: parsed.status,
        category: classifyFailure(parsed.status, error),
        ok: false,
        issues: [],
        error,
        elapsedMs,
        screenshots: { failed }
      },
      payload: parsed.payload || error
    };
  }

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

  const analyzed = analyzeSuccess(testCase, route, parsed.payload, notesText, replay);
  return {
    result: {
      ...analyzed.result,
      elapsedMs,
      analysisPath,
      screenshots: { canopy, growth, notes }
    },
    payload: parsed.payload
  };
}

(async () => {
  ensureOutDir();
  const activeCases = selectCases(CASES);
  const existingResults = loadExistingResults();
  const completedKeys = new Set(
    existingResults
      .filter((item) => item.status === 200)
      .map((item) => resultKey(item))
  );
  const queue = [];
  for (const route of ACTIVE_ROUTES) {
    for (const testCase of activeCases) {
      const key = resultKey({ route, framework: testCase.framework, id: testCase.id });
      if (completedKeys.has(key)) continue;
      queue.push({ route, testCase });
    }
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME_BIN
  });
  const context = await browser.newContext({ viewport: { width: 1832, height: 1142 } });
  const page = await context.newPage();
  await page.goto(CAPTURE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(1200);

  const results = existingResults.slice();
  const totalPlanned = activeCases.length * ACTIVE_ROUTES.length;
  if (results.length > 0) {
    writeSummaryArtifacts(results);
    console.error(`[gauntlet100-ui] resuming ${OUT_DIR} with ${results.length} saved cases; ${queue.length} remaining`);
  }

  for (const [index, entry] of queue.entries()) {
    const { route, testCase } = entry;
    const completedCount = results.filter((item) => item.status === 200).length;
    console.error(`[gauntlet100-ui] ${completedCount + 1}/${totalPlanned} ${route} ${testCase.framework} ${testCase.language} ${testCase.phenomenon}`);
    try {
      const { result, payload } = await runCase(page, testCase, route);
      upsertResult(results, result);
      writeCaseArtifact(result, payload);
      writeSummaryArtifacts(results);
      console.error(`[gauntlet100-ui] completed ${route}-${testCase.framework}-${testCase.id} ok=${result.ok} status=${result.status}`);
    } catch (error) {
      const prefix = `${route}-${testCase.framework}-${testCase.id}`;
      const failed = path.join(OUT_DIR, `${prefix}-exception.png`);
      await page.screenshot({ path: failed, fullPage: true }).catch(() => {});
      const result = {
        id: testCase.id,
        route,
        framework: testCase.framework,
        language: testCase.language,
        phenomenon: testCase.phenomenon,
        sentence: testCase.sentence,
        status: 'exception',
        category: 'other_failure',
        ok: false,
        issues: [],
        error: { message: String(error?.message || error) },
        screenshots: { failed }
      };
      upsertResult(results, result);
      writeCaseArtifact(result, result.error);
      writeSummaryArtifacts(results);
      console.error(`[gauntlet100-ui] exception ${prefix}: ${String(error?.message || error)}`);
      await page.goto(CAPTURE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
      await sleep(1200);
    }
  }

  await browser.close();
  writeSummaryArtifacts(results);
  console.log(path.join(OUT_DIR, 'report.json'));
  console.log(path.join(OUT_DIR, 'report.md'));
})();

require('./helpers/loadLocalEnv.cjs')();
const { parseSentenceWithGemini } = require('../server/geminiParser');

const CASES = [
  { framework: 'xbar', sentence: 'It was shocking that no one arrived on time' },
  { framework: 'xbar', sentence: 'The story was shocking' },
  { framework: 'xbar', sentence: 'I am proud that I won the prize' },
  { framework: 'xbar', sentence: 'I am proud of this victory' },
  { framework: 'minimalism', sentence: 'Melyik konyvet vette meg Anna?' },
  { framework: 'minimalism', sentence: 'Czy Piotr zamknal drzwi?' },
  { framework: 'minimalism', sentence: 'Foi lido o relatorio pela equipe.' },
  { framework: 'xbar', sentence: 'Gheall se go bhfillfeadh se ar an bhaile.' },
  { framework: 'xbar', sentence: 'Marie a dit que Paul partirait.' },
  { framework: 'xbar', sentence: 'Hanako-ga eiga-o mita.' }
];

const TRACE_RE = /^(?:t|trace|t\d+|trace\d+|t[_-][a-z0-9]+|trace[_-][a-z0-9]+|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\}|∅|Ø|ε|null|epsilon)$/i;
const MOVEMENT_RE = /\b(move(?:ment|d|s|ing)?|internal\s*merge|head\s*move|raising|raised|trace|copy|a-?bar|a-?move|wh-?move|spec(?:ifier)?[, ]*(?:cp|tp|inflp|ip)|epp)\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tokenize = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const normalizeToken = (value) => String(value || '').trim().toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function collectLeaves(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  const children = Array.isArray(node.children) ? node.children : [];
  const span = Array.isArray(node.surfaceSpan) ? node.surfaceSpan : [];
  if (children.length === 0) {
    if (span.length === 2 && Number.isInteger(span[0]) && span[0] === span[1]) {
      const surface = String(node.word || node.label || '').trim();
      if (surface && !TRACE_RE.test(surface)) out.push([span[0], surface]);
    }
    return out;
  }
  children.forEach((child) => collectLeaves(child, out));
  return out;
}

function sameSeq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (normalizeToken(a[i]) !== normalizeToken(b[i])) return false;
  }
  return true;
}

(async () => {
  const results = [];
  for (const testCase of CASES) {
    let final = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const bundle = await parseSentenceWithGemini(testCase.sentence, testCase.framework, 'flash-lite');
        const analysis = bundle.analyses[0];
        const leaves = collectLeaves(analysis.tree)
          .sort((a, b) => a[0] - b[0])
          .map(([, surface]) => surface);
        const surfaceOrder = Array.isArray(analysis.surfaceOrder) ? analysis.surfaceOrder : [];
        const sentenceTokens = tokenize(testCase.sentence);
        const derivationOps = Array.isArray(analysis.derivationSteps) ? analysis.derivationSteps.map((s) => s.operation) : [];
        const movementEvents = Array.isArray(analysis.movementEvents) ? analysis.movementEvents : [];
        const explanation = String(analysis.explanation || '').trim();
        const issues = [];
        if (!sameSeq(leaves, sentenceTokens)) issues.push('LEAVES_NE_SENTENCE');
        if (!sameSeq(surfaceOrder, sentenceTokens)) issues.push('SURFACE_NE_SENTENCE');
        if (!sameSeq(leaves, surfaceOrder)) issues.push('LEAVES_NE_SURFACE');
        if (derivationOps[derivationOps.length - 1] !== 'SpellOut') issues.push('NO_FINAL_SPELLOUT');
        if (movementEvents.length > 0 && !MOVEMENT_RE.test(explanation)) issues.push('MOVEMENT_MISSING_FROM_NOTES');
        if (movementEvents.length === 0 && /\b(wh-movement|head-movement|A-bar movement|A-movement|internal merge|movement)\b/i.test(explanation) && !/No movement is posited/i.test(explanation)) issues.push('NOTES_MOVEMENT_WITHOUT_EVENTS');
        final = {
          sentence: testCase.sentence,
          framework: testCase.framework,
          ok: true,
          issues,
          leaves,
          surfaceOrder,
          derivationOps,
          movementEventsCount: movementEvents.length,
          explanation
        };
        break;
      } catch (error) {
        final = { sentence: testCase.sentence, framework: testCase.framework, ok: false, status: error?.status || null, code: error?.code || null, message: error?.message || String(error) };
        if (error?.status === 503) {
          await sleep(3000);
          continue;
        }
        break;
      }
    }
    results.push(final);
  }
  console.log(JSON.stringify(results, null, 2));
})();

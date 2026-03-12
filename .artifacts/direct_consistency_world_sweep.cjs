const fs = require('fs');
const path = require('path');
require('./helpers/loadLocalEnv.cjs')();
const { parseSentenceWithGemini } = require('../server/geminiParser');

const CASES = [
  { framework: 'xbar', language: 'English', phenomenon: 'expletive-clause', sentence: 'It was shocking that no one arrived on time' },
  { framework: 'xbar', language: 'English', phenomenon: 'copular-adjective', sentence: 'The story was shocking' },
  { framework: 'xbar', language: 'English', phenomenon: 'small-clause-like-adjective', sentence: 'I am proud of this victory' },
  { framework: 'xbar', language: 'English', phenomenon: 'adjective-clausal-complement', sentence: 'I am proud that I won the prize' },
  { framework: 'xbar', language: 'French', phenomenon: 'embedded-clause', sentence: 'Marie a dit que Paul partirait.' },
  { framework: 'xbar', language: 'Spanish', phenomenon: 'yes-no', sentence: 'Ha comprado Ana el libro?' },
  { framework: 'xbar', language: 'Irish', phenomenon: 'VSO-embedded', sentence: 'Gheall se go bhfillfeadh se ar an bhaile.' },
  { framework: 'xbar', language: 'Japanese', phenomenon: 'head-final-declarative', sentence: 'Hanako-ga eiga-o mita.' },
  { framework: 'xbar', language: 'Romanian', phenomenon: 'embedded-clause', sentence: 'Profesorul a spus ca elevii au plecat.' },
  { framework: 'xbar', language: 'German', phenomenon: 'verb-second-question', sentence: 'Hat Maria den Brief gelesen?' },
  { framework: 'xbar', language: 'Turkish', phenomenon: 'embedded-clause', sentence: 'Fatma dedi ki Mehmet gelecek.' },
  { framework: 'xbar', language: 'Hindi', phenomenon: 'yes-no', sentence: 'Kya Anu ne chai banayi?' },
  { framework: 'minimalism', language: 'Hungarian', phenomenon: 'wh-fronting', sentence: 'Melyik konyvet vette meg Anna?' },
  { framework: 'minimalism', language: 'Polish', phenomenon: 'particle-question', sentence: 'Czy Piotr zamknal drzwi?' },
  { framework: 'minimalism', language: 'Portuguese', phenomenon: 'passive', sentence: 'Foi lido o relatorio pela equipe.' },
  { framework: 'minimalism', language: 'Dutch', phenomenon: 'wh-question', sentence: 'Welke film heeft Noor bekeken?' },
  { framework: 'minimalism', language: 'Italian', phenomenon: 'embedded-subjunctive', sentence: 'Giulia pensa che Paolo dorma.' },
  { framework: 'minimalism', language: 'Romanian', phenomenon: 'wh-question', sentence: 'Ce carte a cumparat Irina?' },
  { framework: 'minimalism', language: 'German', phenomenon: 'wh-question', sentence: 'Welches Buch hat Lara gekauft?' },
  { framework: 'minimalism', language: 'Norwegian', phenomenon: 'embedded-clause', sentence: 'Per sa at Eva kom tidlig.' },
  { framework: 'minimalism', language: 'Swedish', phenomenon: 'embedded-clause', sentence: 'Erik sade att Anna skulle komma.' },
  { framework: 'minimalism', language: 'Spanish', phenomenon: 'wh-question', sentence: 'Que carta escribio Lucia?' },
  { framework: 'minimalism', language: 'Turkish', phenomenon: 'wh-question', sentence: 'Hangi kitabi Ayse okudu?' },
  { framework: 'minimalism', language: 'Hindi', phenomenon: 'wh-question', sentence: 'Kaunsi film Ravi ne dekhi?' }
];

const TRACE_RE = /^(?:t|trace|t\d+|trace\d+|(?:t|trace)(?:_[a-z0-9]+)+|[a-z]+_trace(?:_[a-z0-9]+)*|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\}|∅|Ø|ε|null|epsilon)$/i;
const MOVEMENT_RE = /\b(wh-movement|head-movement|a-bar movement|a-movement|internal merge|movement|raising|move to|moved to|v-to-c|v-to-infl|v-to-t|fronted|fronting|occup(?:y|ies|ied)\s+the\s+spec(?:ifier)?[, ]*cp)\b/i;
const NO_MOVEMENT_RE = /\b(?:no movement is posited|no displacement(?: operation)? is encoded|without movement|no movement occurs)\b/i;
const PROVIDER_FAILURE_CODES = new Set(['GEMINI_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'GEMINI_QUOTA', 'SERVER_BUSY', 'RATE_LIMITED']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tokenize = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const normalizeToken = (value) => String(value || '').trim().toLowerCase().replace(/^<|>$/g, '').replace(/^⟨|⟩$/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function classifyFailure(error) {
  const code = String(error?.code || '').trim();
  const status = Number(error?.status);
  if (code === 'BAD_MODEL_RESPONSE') return 'malformed-output';
  if (PROVIDER_FAILURE_CODES.has(code) || status === 429 || status === 503) return 'provider-runtime';
  return 'other-failure';
}

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

function collectNodeIds(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  const id = String(node.id || '').trim();
  if (id) out.add(id);
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child) => collectNodeIds(child, out));
  return out;
}

function collectOvertSpans(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  const children = Array.isArray(node.children) ? node.children : [];
  const span = Array.isArray(node.surfaceSpan) ? node.surfaceSpan : null;
  const surface = String(node.word || node.label || '').trim();
  const overtLeaf = children.length === 0 && surface && !TRACE_RE.test(surface) && !/^(?:∅|Ø|ε|null|epsilon)$/i.test(surface);
  if (overtLeaf) out.push({ id: node.id, surface, span });
  children.forEach((child) => collectOvertSpans(child, out));
  return out;
}

function sameSeq(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (normalizeToken(a[i]) !== normalizeToken(b[i])) return false;
  }
  return true;
}

function countOps(steps, wanted) {
  return (Array.isArray(steps) ? steps : []).filter((s) => wanted.has(String(s?.operation || '').trim())).length;
}

function analyze(bundle, testCase) {
  const analysis = bundle.analyses[0];
  const sentenceTokens = tokenize(testCase.sentence);
  const leaves = collectLeaves(analysis.tree)
    .sort((a, b) => a[0] - b[0])
    .map(([, surface]) => surface);
  const surfaceOrder = Array.isArray(analysis.surfaceOrder) ? analysis.surfaceOrder : [];
  const derivationSteps = Array.isArray(analysis.derivationSteps) ? analysis.derivationSteps : [];
  const derivationOps = derivationSteps.map((s) => s.operation);
  const movementEvents = Array.isArray(analysis.movementEvents) ? analysis.movementEvents : [];
  const nodeIds = collectNodeIds(analysis.tree);
  const explanation = String(analysis.explanation || '').trim();
  const overtSpans = collectOvertSpans(analysis.tree);
  const issues = [];

  if (!sameSeq(leaves, sentenceTokens)) issues.push('LEAVES_NE_SENTENCE');
  if (!sameSeq(surfaceOrder, sentenceTokens)) issues.push('SURFACE_NE_SENTENCE');
  if (!sameSeq(leaves, surfaceOrder)) issues.push('LEAVES_NE_SURFACE');
  if (derivationOps[derivationOps.length - 1] !== 'SpellOut') issues.push('NO_FINAL_SPELLOUT');
  if (movementEvents.length > 0 && !MOVEMENT_RE.test(explanation)) issues.push('MOVEMENT_MISSING_FROM_NOTES');
  if (movementEvents.length === 0 && MOVEMENT_RE.test(explanation) && !NO_MOVEMENT_RE.test(explanation)) issues.push('NOTES_MOVEMENT_WITHOUT_EVENTS');
  const moveSteps = countOps(derivationSteps, new Set(['Move', 'InternalMerge', 'HeadMove', 'A-Move', 'AbarMove']));
  if (movementEvents.length > 0 && moveSteps === 0) issues.push('MOVEMENT_EVENTS_WITHOUT_MOVE_STEPS');

  for (const ev of movementEvents) {
    const from = String(ev?.fromNodeId || '').trim();
    const to = String(ev?.toNodeId || '').trim();
    const trace = String(ev?.traceNodeId || '').trim();
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to) || (trace && !nodeIds.has(trace))) {
      issues.push('INVALID_MOVEMENT_NODE_REF');
      break;
    }
  }

  for (let i = 0; i < overtSpans.length; i += 1) {
    const entry = overtSpans[i];
    if (!Array.isArray(entry.span) || entry.span[0] !== i || entry.span[1] !== i) {
      issues.push('BAD_LEAF_SPAN');
      break;
    }
  }

  return {
    framework: testCase.framework,
    language: testCase.language,
    phenomenon: testCase.phenomenon,
    sentence: testCase.sentence,
    ok: issues.length === 0,
    issues,
    leaves,
    surfaceOrder,
    derivationOps,
    movementEventsCount: movementEvents.length,
    explanation
  };
}

(async () => {
  const results = [];
  for (const testCase of CASES) {
    let final = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const bundle = await parseSentenceWithGemini(testCase.sentence, testCase.framework, 'flash-lite');
        final = analyze(bundle, testCase);
        break;
      } catch (error) {
        const category = classifyFailure(error);
        final = {
          framework: testCase.framework,
          language: testCase.language,
          phenomenon: testCase.phenomenon,
          sentence: testCase.sentence,
          ok: false,
          category,
          status: error?.status || null,
          code: error?.code || null,
          message: error?.message || String(error)
        };
        if (category === 'provider-runtime') {
          await sleep(3000);
          continue;
        }
        break;
      }
    }
    results.push(final);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    successfulParses: results.filter((r) => r.status == null).length,
    structurallyClean: results.filter((r) => r.status == null && r.ok).length,
    structuralIssues: results.filter((r) => r.status == null && !r.ok).length,
    malformedOutputFailures: results.filter((r) => r.category === 'malformed-output').length,
    providerRuntimeFailures: results.filter((r) => r.category === 'provider-runtime').length,
    otherFailures: results.filter((r) => r.category === 'other-failure').length,
    results
  };

  const outPath = path.resolve('/Users/francisronge/Documents/Babel/sylvan-architect-babel/.artifacts/direct-consistency-world-sweep.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(outPath);
  console.log(JSON.stringify(out, null, 2));
})();

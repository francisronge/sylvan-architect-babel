const fs = require('fs');
const path = require('path');
require('./helpers/loadLocalEnv.cjs')();
const { parseSentenceWithGemini } = require('../server/geminiParser');

const CASES = [
  { framework: 'xbar', language: 'English', phenomenon: 'relative-clause', sentence: 'The editor who praised the article resigned.' },
  { framework: 'xbar', language: 'English', phenomenon: 'raising-like-clause', sentence: 'It appears that the guests have departed.' },
  { framework: 'xbar', language: 'French', phenomenon: 'passive', sentence: 'Le rapport a ete publie hier.' },
  { framework: 'xbar', language: 'German', phenomenon: 'embedded-perfect', sentence: 'Der Lehrer sagte dass die Schuelerin das Buch gelesen hat.' },
  { framework: 'xbar', language: 'Spanish', phenomenon: 'complement-clause', sentence: 'El medico dijo que la paciente llego temprano.' },
  { framework: 'xbar', language: 'Portuguese', phenomenon: 'complement-clause', sentence: 'A diretora disse que os alunos chegaram cedo.' },
  { framework: 'xbar', language: 'Irish', phenomenon: 'simple-vso', sentence: 'Chonaic se an madra.' },
  { framework: 'xbar', language: 'Romanian', phenomenon: 'embedded-question', sentence: 'Profesorul a intrebat daca studentii au venit.' },
  { framework: 'xbar', language: 'Japanese', phenomenon: 'embedded-complement', sentence: 'Haru-wa Miki-ga hon-o yonda to itta.' },
  { framework: 'xbar', language: 'Dutch', phenomenon: 'embedded-declarative', sentence: 'Milan zegt dat Sara morgen belt.' },
  { framework: 'minimalism', language: 'English', phenomenon: 'passive', sentence: 'The letters were delivered yesterday.' },
  { framework: 'minimalism', language: 'French', phenomenon: 'wh-question', sentence: 'Quel roman a choisi Elise?' },
  { framework: 'minimalism', language: 'German', phenomenon: 'yes-no-question', sentence: 'Hat der Fahrer den Wagen verkauft?' },
  { framework: 'minimalism', language: 'Spanish', phenomenon: 'wh-question', sentence: 'Que cuadro pinto Elena?' },
  { framework: 'minimalism', language: 'Polish', phenomenon: 'wh-question', sentence: 'Ktora gazete kupil Marek?' },
  { framework: 'minimalism', language: 'Romanian', phenomenon: 'wh-question', sentence: 'Ce film a vazut Irina?' },
  { framework: 'minimalism', language: 'Italian', phenomenon: 'embedded-subjunctive', sentence: 'Gianni pensa che Lucia parta domani.' },
  { framework: 'minimalism', language: 'Japanese', phenomenon: 'simple-transitive', sentence: 'Aiko-ga ringo-o tabeta.' },
  { framework: 'minimalism', language: 'Hungarian', phenomenon: 'focus-like-order', sentence: 'Peter a konyvet olvasta.' },
  { framework: 'minimalism', language: 'Dutch', phenomenon: 'wh-question', sentence: 'Welke student heeft Emma gezien?' }
];

const TRACE_RE = /^(?:t|trace|t\d+|trace\d+|t[_-][a-z0-9]+|trace[_-][a-z0-9]+|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\}|∅|Ø|ε|null|epsilon)$/i;
const MOVEMENT_RE = /\b(move(?:ment|d|s|ing)?|internal\s*merge|head[\s-]*move(?:ment)?|raising|raised|trace|copy|a-?bar|a-?move|wh-?move|front(?:ing|ed)?|displac(?:e|ed|ement|ing)|spec(?:ifier)?[, ]*(?:cp|tp|inflp|ip)|epp)\b/i;
const HEDGE_RE = /\b(or|may|can|possibly|might)\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tokenize = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const normalizeToken = (value) => String(value || '').trim().toLowerCase().replace(/^<|>$/g, '').replace(/^⟨|⟩$/g, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

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
  if (movementEvents.length === 0 && MOVEMENT_RE.test(explanation) && !/no movement is posited/i.test(explanation)) issues.push('NOTES_MOVEMENT_WITHOUT_EVENTS');
  if (HEDGE_RE.test(explanation)) issues.push('HEDGING_IN_NOTES');

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
        final = {
          framework: testCase.framework,
          language: testCase.language,
          phenomenon: testCase.phenomenon,
          sentence: testCase.sentence,
          ok: false,
          transport: (error?.status === 503),
          status: error?.status || null,
          code: error?.code || null,
          message: error?.message || String(error)
        };
        if (error?.status === 503) {
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
    successful: results.filter((r) => r.status == null).length,
    structurallyClean: results.filter((r) => r.status == null && r.ok).length,
    withStructuralIssues: results.filter((r) => r.status == null && !r.ok).length,
    transportFailures: results.filter((r) => r.transport).length,
    hardFailures: results.filter((r) => r.status != null && !r.transport).length,
    results
  };

  const outPath = path.resolve('.artifacts/novel-gauntlet-20.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(outPath);
  console.log(JSON.stringify(out, null, 2));
})();

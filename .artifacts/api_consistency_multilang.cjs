const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = process.env.BABEL_BASE_URL || 'http://127.0.0.1:5177';
const OUT = path.resolve('.artifacts/api-consistency-multilang.json');

const CASES = [
  { id: 'en_decl', sentence: 'The farmer eats the pig.', expectedMovement: false },
  { id: 'fr_decl', sentence: 'Marie lit le livre.', expectedMovement: false },
  { id: 'es_decl', sentence: 'La profesora explico la teoria.', expectedMovement: false },
  { id: 'de_decl', sentence: 'Der Student liest das Buch.', expectedMovement: false },
  { id: 'nl_decl', sentence: 'De leraar verklaarde de oefening.', expectedMovement: false },
  { id: 'it_decl', sentence: 'Gli amici hanno visitato il museo.', expectedMovement: false },
  { id: 'pt_decl', sentence: 'Os alunos terminaram a tarefa cedo.', expectedMovement: false },
  { id: 'pl_decl', sentence: 'Nauczyciel wyjasnil zadanie.', expectedMovement: false },
  { id: 'ro_decl', sentence: 'Studentii au discutat problema.', expectedMovement: false },
  { id: 'ru_decl', sentence: 'Masha kupila knigu.', expectedMovement: false },
  { id: 'en_wh', sentence: 'What did the farmer buy?', expectedMovement: true },
  { id: 'fr_wh', sentence: "Qu'est-ce que Marie a vu ?", expectedMovement: true },
  { id: 'es_wh', sentence: '¿Que compro Juan?', expectedMovement: true },
  { id: 'de_wh', sentence: 'Wen hat Maria gesehen?', expectedMovement: true },
  { id: 'nl_wh', sentence: 'Wat heeft Jan gekocht?', expectedMovement: true },
  { id: 'it_wh', sentence: 'Che cosa ha comprato Gianni?', expectedMovement: true },
  { id: 'pt_wh', sentence: 'O que o Joao comprou?', expectedMovement: true },
  { id: 'pl_wh', sentence: 'Co kupil Jan?', expectedMovement: true },
  { id: 'ro_wh', sentence: 'Ce a cumparat Maria?', expectedMovement: true },
  { id: 'ru_wh', sentence: 'Chto kupil Ivan?', expectedMovement: true }
];

const FRAMEWORKS = ['xbar', 'minimalism'];
const MOVEMENT_RE = /\b(move(?:ment|d|s|ing)?|internal\s*merge|head\s*move|raising|raised|trace|copy|a-?bar|a-?move|wh-?move|spec(?:ifier)?[, ]*(?:cp|tp|inflp|ip)|epp)\b/i;
const HEDGE_RE = /\b(or|may|can|possibly|might)\b/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const collectNodeIds = (node, out = new Set()) => {
  if (!node || typeof node !== 'object') return out;
  const id = String(node.id || '').trim();
  if (id) out.add(id);
  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child) => collectNodeIds(child, out));
  return out;
};

const countMoveSteps = (analysis) => {
  const steps = Array.isArray(analysis?.derivationSteps) ? analysis.derivationSteps : [];
  return steps.filter((step) => {
    const op = String(step?.operation || '').trim();
    return op === 'Move' || op === 'InternalMerge';
  }).length;
};

async function parseSentence(sentence, framework) {
  const start = Date.now();
  const response = await fetch(`${BASE_URL}/api/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sentence, framework, modelRoute: 'flash-lite' })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {}

  return {
    status: response.status,
    elapsedMs: Date.now() - start,
    payload
  };
}

function analyze(framework, testCase, parsed) {
  if (parsed.status !== 200 || !parsed.payload?.analyses?.[0]) {
    return {
      framework,
      caseId: testCase.id,
      sentence: testCase.sentence,
      expectedMovement: testCase.expectedMovement,
      ok: false,
      status: parsed.status,
      elapsedMs: parsed.elapsedMs,
      issues: [`HTTP_${parsed.status}`]
    };
  }

  const analysis = parsed.payload.analyses[0];
  const nodeIds = collectNodeIds(analysis.tree, new Set());
  const movementEvents = Array.isArray(analysis.movementEvents) ? analysis.movementEvents : [];
  const derivationSteps = Array.isArray(analysis.derivationSteps) ? analysis.derivationSteps : [];
  const moveSteps = countMoveSteps(analysis);
  const explanation = String(analysis.explanation || '').trim();
  const explanationMentionsMovement = MOVEMENT_RE.test(explanation);
  const explanationHedging = HEDGE_RE.test(explanation);

  const invalidMovementRefs = movementEvents.filter((ev) => {
    const from = String(ev?.fromNodeId || '').trim();
    const to = String(ev?.toNodeId || '').trim();
    const trace = String(ev?.traceNodeId || '').trim();
    if (!from || !to) return true;
    if (!nodeIds.has(from) || !nodeIds.has(to)) return true;
    if (trace && !nodeIds.has(trace)) return true;
    return false;
  }).length;

  const outOfRangeStepIndex = movementEvents.filter((ev) => {
    const idx = Number(ev?.stepIndex);
    return Number.isInteger(idx) && idx >= derivationSteps.length && derivationSteps.length > 0;
  }).length;

  const issues = [];
  if (invalidMovementRefs > 0) issues.push('INVALID_MOVEMENT_NODE_REF');
  if (outOfRangeStepIndex > 0) issues.push('OUT_OF_RANGE_MOVEMENT_STEP');
  if (movementEvents.length > 0 && moveSteps === 0) issues.push('MOVE_EVENTS_WITHOUT_MOVE_STEPS');
  if (movementEvents.length === 0 && moveSteps > 0) issues.push('MOVE_STEPS_WITHOUT_MOVE_EVENTS');
  if (movementEvents.length > 0 && !explanationMentionsMovement) issues.push('EXPLANATION_MISSES_MOVEMENT');
  if (movementEvents.length === 0 && explanationMentionsMovement) issues.push('EXPLANATION_MOVEMENT_WITHOUT_EVENTS');
  if (explanationHedging) issues.push('EXPLANATION_HEDGING');
  if (testCase.expectedMovement && movementEvents.length === 0) issues.push('EXPECTED_MOVEMENT_MISSING');

  return {
    framework,
    caseId: testCase.id,
    sentence: testCase.sentence,
    expectedMovement: testCase.expectedMovement,
    ok: true,
    status: parsed.status,
    elapsedMs: parsed.elapsedMs,
    movementEventsCount: movementEvents.length,
    moveSteps,
    derivationStepsCount: derivationSteps.length,
    explanationMentionsMovement,
    explanationHedging,
    issues
  };
}

(async () => {
  const results = [];

  for (const framework of FRAMEWORKS) {
    for (const testCase of CASES) {
      const parsed = await parseSentence(testCase.sentence, framework);
      results.push(analyze(framework, testCase, parsed));
      await sleep(80);
    }
  }

  const summarizeFramework = (framework) => {
    const subset = results.filter((r) => r.framework === framework);
    const issueCounts = {};
    subset.forEach((r) => {
      (r.issues || []).forEach((issue) => {
        issueCounts[issue] = (issueCounts[issue] || 0) + 1;
      });
    });

    return {
      total: subset.length,
      ok: subset.filter((r) => r.ok).length,
      failed: subset.filter((r) => !r.ok).length,
      withIssues: subset.filter((r) => (r.issues || []).length > 0).length,
      avgElapsedMs: Math.round(subset.reduce((acc, r) => acc + (r.elapsedMs || 0), 0) / Math.max(1, subset.length)),
      issueCounts
    };
  };

  const report = {
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    frameworkSummary: {
      xbar: summarizeFramework('xbar'),
      minimalism: summarizeFramework('minimalism')
    },
    results
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  process.stdout.write(`${OUT}\n`);
})();

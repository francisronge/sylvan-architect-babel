const fs = require('node:fs');
const path = require('node:path');

const INPUT = process.argv[2];

if (!INPUT) {
  throw new Error('Usage: node audit_random30_dual.cjs <report.json>');
}

const OUT_DIR = path.dirname(INPUT);
const OUT_JSON = path.join(OUT_DIR, 'audit.json');
const OUT_MD = path.join(OUT_DIR, 'audit.md');

const MOVEMENT_RE = /\b(move(?:ment|d|s|ing)?|internal\s*merge|head\s*move|raising|trace|copy|a-?bar|a-?move|wh-?move|front(?:ing)?|epp|spec[, ]*(?:cp|tp|inflp|ip)|v\s*-?to\s*-?c|v\s*-?to\s*-?t|t\s*-?to\s*-?c)\b/i;
const HEAD_RE = /\b(head\s*move|v\s*-?to\s*-?[ct]|t\s*-?to\s*-?c)\b/i;
const WH_RE = /\b(wh-?move|wh-?movement|wh-?fronting|\[\+wh\]|a-?bar|spec[, ]*cp)\b/i;
const A_RE = /\b(a-?move|a-?movement|spec(?:ifier)?[, ]*tp|epp)\b/i;
const INTERNAL_RE = /\binternal\s*merge\b/i;
const PRIME_RE = /^[A-Za-z][A-Za-z0-9]*[’']$/;

const normalizeToken = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^<|>$/g, '')
  .replace(/^⟨|⟩$/g, '')
  .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

const normalizeOp = (op) => String(op || '').trim().toLowerCase().replace(/[^a-z]/g, '');

const sentenceTokens = (sentence) =>
  (String(sentence || '').toLowerCase().match(/\p{L}+(?:[-']\p{L}+)?/gu) || []).filter((t) => t.length > 1);

const countOccurrences = (text, pattern) => {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
};

const walkTree = (root) => {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    out.push(node);
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return out;
};

const claimsFromText = (text) => {
  const t = String(text || '');
  return {
    movement: MOVEMENT_RE.test(t),
    head: HEAD_RE.test(t),
    wh: WH_RE.test(t),
    a: A_RE.test(t),
    internal: INTERNAL_RE.test(t)
  };
};

const eventKinds = (events) => {
  const kinds = new Set();
  (Array.isArray(events) ? events : []).forEach((ev) => {
    const op = normalizeOp(ev?.operation);
    if (op === 'headmove') kinds.add('head');
    if (op === 'abarmove') kinds.add('wh');
    if (op === 'amove') kinds.add('a');
    if (op === 'internalmerge') kinds.add('internal');
    if (op === 'move') kinds.add('move');
  });
  return kinds;
};

const parseActualRoute = (result) => String(result?.parseMeta?.actualRoute || '').trim() || 'unknown';

const report = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const results = Array.isArray(report.results) ? report.results : [];
const findings = [];

for (const result of results) {
  const caseId = result.id || result.label || 'unknown-case';

  if (!result.ok) {
    findings.push({
      caseId,
      severity: 'critical',
      code: 'PARSE_FAILED',
      message: `Capture failed with status ${result.status}.`
    });
    continue;
  }

  const analysis = result.analysis || {};
  const tree = analysis.tree || {};
  const events = Array.isArray(analysis.movementEvents) ? analysis.movementEvents : [];
  const derivation = Array.isArray(analysis.derivationSteps) ? analysis.derivationSteps : [];
  const nodes = walkTree(tree);
  const notesText = String(result.notesText || '');
  const explanationText = String(analysis.explanation || '');
  const notesClaims = claimsFromText(notesText);
  const explanationClaims = claimsFromText(explanationText);
  const kinds = eventKinds(events);
  const moveOps = derivation.filter((step) => /^(move|internalmerge|headmove|amove|abarmove)$/.test(normalizeOp(step?.operation)));
  const replaySteps = Array.isArray(result.replay?.steps) ? result.replay.steps : [];
  const replayText = replaySteps.map((step) => String(step.panelText || '')).join('\n');
  const lexicalMentions = sentenceTokens(result.sentence).filter((tok) => explanationText.toLowerCase().includes(tok)).length;
  const actualRoute = parseActualRoute(result);
  const requestedRoute = String(result.modelRoute || result.parseMeta?.requestedModelRoute || '').trim();
  const replayMoveMentions = countOccurrences(replayText, /\b(move|internal merge|head move)\b/gi);
  const notesMovementMentions = countOccurrences(notesText, /\bmovement\b/gi);
  const spelloutSteps = derivation.filter((step) => String(step?.operation || '').trim() === 'SpellOut');
  const replayHasSpellout = replaySteps.some((step) => /\bspell\s*out\b/i.test(String(step.panelText || '')) || /SPELLOUT:/i.test(String(step.panelText || '')));

  if (requestedRoute && actualRoute !== 'unknown' && actualRoute !== requestedRoute) {
    findings.push({
      caseId,
      severity: 'major',
      code: 'MODEL_ROUTE_DRIFT',
      message: `Requested ${requestedRoute}, but actual model route was ${actualRoute}${result.parseMeta?.fallbackUsed ? ' via fallback.' : '.'}`
    });
  }

  if (result.parseMeta?.fallbackUsed) {
    findings.push({
      caseId,
      severity: 'major',
      code: 'MODEL_FALLBACK_USED',
      message: `Route ${requestedRoute} required fallback to ${result.parseMeta?.modelUsed || 'another model'}.`
    });
  }

  const checkNames = [
    ['sentenceMatchesSurfaceOrder', 'Committed surface order does not match the input sentence order.'],
    ['leavesMatchSurfaceOrder', 'Tree overt leaves do not match the committed surface order.'],
    ['leavesMatchSentence', 'Tree overt leaves do not match the sentence order.'],
    ['leafInventoryMatchesSentence', 'Tree overt leaves do not preserve the sentence token inventory.']
  ];
  checkNames.forEach(([key, message]) => {
    if (result.checks && result.checks[key] === false) {
      findings.push({
        caseId,
        severity: 'critical',
        code: key.toUpperCase(),
        message
      });
    }
  });

  if (spelloutSteps.length === 0) {
    findings.push({
      caseId,
      severity: 'major',
      code: 'MODEL_DERIVATION_OMITS_SPELLOUT',
      message: 'Model derivation omitted an explicit SpellOut step; replay appears to rely on the UI-appended endpoint.'
    });
  } else {
    const finalSpelloutOrder = (spelloutSteps.at(-1)?.spelloutOrder || []).map(normalizeToken).filter(Boolean);
    const committedSurface = (analysis.surfaceOrder || []).map(normalizeToken).filter(Boolean);
    if (JSON.stringify(finalSpelloutOrder) !== JSON.stringify(committedSurface)) {
      findings.push({
        caseId,
        severity: 'major',
        code: 'MODEL_SPELLOUT_MISMATCH',
        message: 'Model-provided SpellOut order does not match the committed surface order.'
      });
    }
  }

  if (!replayHasSpellout) {
    findings.push({
      caseId,
      severity: 'major',
      code: 'REPLAY_MISSES_SPELLOUT',
      message: 'Replay never visibly shows a SpellOut frame.'
    });
  }

  if (events.length > 0 && Number(result.replay?.maxVisibleArrows || 0) === 0) {
    findings.push({
      caseId,
      severity: 'critical',
      code: 'EVENTS_BUT_NO_ARROWS',
      message: 'Movement events exist but no visible movement arrows appeared in replay.'
    });
  }

  if (events.length > 0 && moveOps.length === 0) {
    findings.push({
      caseId,
      severity: 'major',
      code: 'EVENTS_WITHOUT_MOVE_DERIVATION',
      message: 'Movement events exist but derivation contains no move-like operation.'
    });
  }

  if (events.length > 0 && replayMoveMentions === 0) {
    findings.push({
      caseId,
      severity: 'major',
      code: 'REPLAY_TEXT_MISSES_MOVEMENT',
      message: 'Replay text never mentioned move-like operations despite movement events.'
    });
  }

  const claimNames = [
    ['head', 'head movement'],
    ['wh', 'wh/A-bar movement'],
    ['a', 'A-movement'],
    ['internal', 'internal merge']
  ];
  for (const [key, label] of claimNames) {
    const claimed = [notesClaims, explanationClaims].some((claims) => claims[key]);
    if (claimed && !kinds.has(key) && events.length >= 0) {
      findings.push({
        caseId,
        severity: 'major',
        code: 'TEXT_CLAIM_WITHOUT_EVENT',
        message: `Notes/explanation claim ${label}, but movementEvents do not contain that type.`
      });
    }
  }

  if (String(result.framework || '').trim().toLowerCase() === 'minimalism') {
    const primeLeak = nodes.some((node) => PRIME_RE.test(String(node.label || '')));
    if (primeLeak) {
      findings.push({
        caseId,
        severity: 'major',
        code: 'MINIMALISM_PRIME_LEAK',
        message: 'Prime labels leaked into a Minimalism tree.'
      });
    }
  }

  if (notesMovementMentions >= 3) {
    findings.push({
      caseId,
      severity: 'minor',
      code: 'NOTES_MOVEMENT_REPETITION',
      message: `Notes mention "movement" ${notesMovementMentions} times, which reads repetitive.`
    });
  }

  if (explanationText.length < 140 || lexicalMentions === 0) {
    findings.push({
      caseId,
      severity: 'major',
      code: 'NOTES_UNGROUNDED_GENERIC',
      message: 'Explanation is too generic or weakly anchored to the sentence-specific lexical material.'
    });
  }

  for (const event of events) {
    const op = normalizeOp(event.operation);
    const fromNode = nodes.find((node) => String(node.id || '') === String(event.fromNodeId || ''));
    const toNode = nodes.find((node) => String(node.id || '') === String(event.toNodeId || ''));
    const fromLabel = String(fromNode?.label || '').toLowerCase();
    const toLabel = String(toNode?.label || '').toLowerCase();

    if (op === 'headmove' && !['c', 't', 'infl', 'i', 'v', 'aux'].includes(toLabel)) {
      findings.push({
        caseId,
        severity: 'major',
        code: 'HEADMOVE_BAD_TARGET',
        message: `HeadMove targets unexpected label "${toLabel || '?'}".`
      });
    }

    if (op === 'headmove' && ['d', 'n', 'dp', 'np'].includes(fromLabel)) {
      findings.push({
        caseId,
        severity: 'major',
        code: 'HEADMOVE_BAD_SOURCE',
        message: `HeadMove source looks nominal ("${fromLabel}"), suggesting anchor drift.`
      });
    }
  }

  if (spelloutSteps.length > 1) {
    findings.push({
      caseId,
      severity: 'minor',
      code: 'MULTIPLE_SPELLOUT_STEPS',
      message: `Derivation returned ${spelloutSteps.length} SpellOut steps.`
    });
  }
}

const severityRank = { critical: 0, major: 1, minor: 2 };
findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || String(a.caseId).localeCompare(String(b.caseId)));

const bySeverity = {
  critical: findings.filter((item) => item.severity === 'critical').length,
  major: findings.filter((item) => item.severity === 'major').length,
  minor: findings.filter((item) => item.severity === 'minor').length
};

const byCode = {};
findings.forEach((item) => {
  byCode[item.code] = (byCode[item.code] || 0) + 1;
});

const summary = {
  generatedAt: new Date().toISOString(),
  input: INPUT,
  totalCases: results.length,
  successfulCases: results.filter((item) => item.ok).length,
  failedCases: results.filter((item) => !item.ok).length,
  totalFindings: findings.length,
  bySeverity,
  byCode
};

const payload = { summary, findings };
fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));

const lines = [
  '# Random30 Audit',
  '',
  `- Input: ${INPUT}`,
  `- Total cases: ${summary.totalCases}`,
  `- Successful cases: ${summary.successfulCases}`,
  `- Failed cases: ${summary.failedCases}`,
  `- Findings: ${summary.totalFindings}`,
  `- Critical: ${bySeverity.critical}`,
  `- Major: ${bySeverity.major}`,
  `- Minor: ${bySeverity.minor}`,
  '',
  '## Findings'
];

if (findings.length === 0) {
  lines.push('', 'No findings detected by the audit heuristics.');
} else {
  findings.forEach((item) => {
    lines.push('', `- [${item.severity.toUpperCase()}] ${item.caseId} :: ${item.code} :: ${item.message}`);
  });
}

fs.writeFileSync(OUT_MD, `${lines.join('\n')}\n`);
process.stdout.write(`${OUT_JSON}\n${OUT_MD}\n`);

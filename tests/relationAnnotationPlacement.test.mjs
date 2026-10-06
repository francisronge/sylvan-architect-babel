import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame, fitFallbackGeometry } from '../replay/relations/geometryBinding.ts';
import { headTrajectoryAttachment } from '../replay/relations/trajectoryAttachment.ts';

const stage = (workspaceForest, relations = []) => ({ statement: '', stageRecord: '', workspaceForest, relations });
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y;

test('an authored trace index inside its category is not repeated as another gap label', () => {
  const compile = (label, index = 'i') => {
    const low = { id: 'low', label: 'NP', lineageId: 'chain' };
    const verb = { id: 'verb', label: 'V', word: 'wrote' };
    const before = stage([{ id: 'vp', label: 'VP', children: [low, verb] }]);
    const after = stage([{ id: 'cp', label: 'CP', children: [
      { id: 'high', label: 'NP[Op]', lineageId: 'chain' },
      { id: 'vp', label: 'VP', children: [{ ...low, label, silent: true }, verb] }
    ] }], [{ relation: 'relative-operator movement', anchors: { landingOccurrence: 'high', trace: 'low' },
      priorAnchors: { source: 'low' }, values: { index } }]);
    const original = structuredClone([before, after]);
    const plan = compileRelationRenderPlan([before, after]);
    assert.deepEqual([before, after], original);
    const badge = plan.frames[1].items.find(item => item.badgeStyle === 'gap-notation');
    assert(badge, 'the supported gap claim remains in the plan');
    return { plan, text: badge.badges[0].text };
  };
  for (const label of ['NP[t_i]', 'DP[tᵢ]', 'NP[t_{i}]', 't_i', 'tᵢ']) {
    const { plan, text } = compile(label);
    assert.equal(text, label);
    const bound = bindRelationPlanFrame(plan, 1, () => ({ x: 0, y: 0 }), {
      hasExistingGapNotation: (id, notation) => id === 'low' && notation === label
    });
    assert(bound.primitives.some(p => p.type === 'text-badge' && p.nodeId === 'low' && p.reuseExistingNotation));
  }
  assert.equal(compile('NP[t_j]').text, 'NP[t_j]_i', 'distinct authored indices are not equated');
  assert.equal(compile('NP[feature_i]').text, 'NP[feature_i]_i', 'ordinary feature text is not trace notation');
  assert.equal(compile('NP[t]').text, 'NP[t]_i', 'an absent index remains available');
});

test('compound head movement attaches to its exact head, without choosing one of its terminals', () => {
  const compound = { id: 'compound', label: 'Asp⁰', children: [
    { id: 'aspect', label: 'Asp⁰', word: 'me-' },
    { id: 'lowerComplex', label: 'AgrO⁰', children: [
      { id: 'agreement', label: 'AgrO⁰', word: 'vi-' }, { id: 'verb', label: 'V⁰', word: 'soma' }
    ] }
  ] };
  const forest = [{ id: 'root', label: 'IP', children: [
    { id: 'landing', label: 'I⁰', children: [{ id: 'host', label: 'I⁰', word: 'wa-' }, compound] },
    { id: 'trace', label: 'tAsp', silent: true }
  ] }];
  const plan = compileRelationRenderPlan([stage(forest, [{ relation: 'HeadMove',
    anchors: { source: 'trace', target: 'compound' } }])]);
  const item = plan.frames[0].items.find(item => item.kind === 'trajectory');
  assert(item);
  assert.equal(item.targetNodeId, 'compound');
  assert.equal(item.targetAttachment, 'shell-bottom');
  const attachments = [];
  const bound = bindRelationPlanFrame(plan, 0, (id, attachment) => {
    attachments.push([id, attachment]);
    return id === 'compound' && attachment === 'terminal' ? null : { x: id === 'compound' ? 20 : 80, y: 100 };
  });
  assert(bound.primitives.some(p => p.type === 'trajectory-path'));
  assert.equal(bound.failed.length, 0);
  assert(attachments.some(([id, attachment]) => id === 'compound' && attachment === 'shell-bottom'));
  const reversed = structuredClone(compound); reversed.children.reverse();
  assert.equal(headTrajectoryAttachment(reversed), 'shell-bottom');
  assert.equal(headTrajectoryAttachment({ ...compound, label: 'NP' }), 'terminal',
    'a malformed phrasal endpoint does not gain a head attachment');
  assert.equal(headTrajectoryAttachment({ id: 'single', label: 'V', word: 'read' }), 'terminal');
  assert.equal(headTrajectoryAttachment({ id: 'head', label: 'T' }), 'shell-bottom');
  assert.equal(headTrajectoryAttachment({ id: 'unary', label: 'V', children: [{ id: 'word', label: 'V', word: 'read' }] }), 'terminal');
});

// Captured Dutch T-to-C relation: the old 24-unit role reservation touched the
// tense plaque above the source, although the 12px text and outline fit beside T.
const measuredRoleScene = (metrics, plaqueHeight = 140) => {
  const label = { x: 9668.55153969071, y: 809.1764705882352, width: 26.296875, height: 53 };
  const plaque = { x: 9496.7001953125, y: 658.2000122070312, width: 370, height: plaqueHeight };
  const scale = 3.7655012470709592;
  const measurements = { labels: [label], obstacles: [plaque], labelFor: () => label,
    subtreeFor: () => label, bottom: label.y + label.height };
  const plan = compileRelationRenderPlan([stage([{ id: 'head', label: 'T' }], [
    { relation: 'authored context', anchors: { source: 'head' } }
  ])]);
  const bound = bindRelationPlanFrame(plan, 0, () => ({ x: label.x + label.width / 2, y: label.y + label.height / 2 }), {
    fallbackMeasurements: measurements, plaqueTextLayout: { measureText: () => metrics }
  });
  const mark = bound.primitives.find(p => p.type === 'fallback-mark');
  const snapshot = structuredClone(bound);
  const placed = fitFallbackGeometry(bound, { fittedMarkerScale: scale, fallbackMeasurements: measurements }).get(mark);
  assert.deepEqual(bound, snapshot, 'Fit does not mutate the bound relation or syntax');
  const height = placed.textHeight === undefined ? 24 : placed.textHeight + 4;
  const box = { x: placed.x - (placed.textWidth / 2 + 4) * scale, y: placed.y - height / 2 * scale,
    width: (placed.textWidth + 8) * scale, height: height * scale };
  const preferred = { x: label.x + label.width + (placed.textWidth / 2 + 7) * scale, y: label.y + label.height / 2 };
  return { label, plaque, scale, mark, placed, box, preferred };
};

test('measured role height keeps the source beside its anchor when its ink clears the plaque', () => {
  const scene = measuredRoleScene({ width: 32.546875, ascent: 10, descent: 3.5 });
  const { placed, mark, preferred, box, plaque, label, scale } = scene;
  const oldBox = { ...box, y: preferred.y - 12 * scale, height: 24 * scale };
  assert(overlaps(oldBox, plaque), 'the former fixed-height reservation reproduces the obstruction');
  assert.equal(placed.textHeight, 13.5);
  assert.deepEqual({ x: placed.x, y: placed.y }, preferred);
  assert(![label, plaque].some(other => overlaps(box, other)));
  assert.equal(placed.nodeId, mark.nodeId);
  assert.equal(placed.text, 'source');
  assert.equal(placed.itemIndex, mark.itemIndex);
});

test('measured roles still move when the actual outlined text intersects a plaque', () => {
  for (const [metrics, plaqueHeight] of [
    [{ width: 32.546875, ascent: 10, descent: 3.5 }, 170],
    [{ width: 32.546875, ascent: 20, descent: 10 }, 140]
  ]) {
    const { placed, preferred, box, plaque, label, scale } = measuredRoleScene(metrics, plaqueHeight);
    assert(overlaps({ ...box, x: preferred.x - (placed.textWidth / 2 + 4) * scale,
      y: preferred.y - box.height / 2 }, plaque), 'the preferred slot genuinely intersects');
    assert.notDeepEqual({ x: placed.x, y: placed.y }, preferred);
    assert(![label, plaque].some(other => overlaps(box, other)));
    assert.equal(placed.nodeId, 'head');
    assert.equal(placed.text, 'source');
  }
});

test('missing or invalid vertical metrics retain the conservative role reservation', () => {
  for (const metrics of [
    { width: 32.546875 },
    { width: 32.546875, ascent: NaN, descent: 3.5 },
    { width: 32.546875, ascent: 10, descent: -1 }
  ]) {
    const { placed, preferred, box, plaque } = measuredRoleScene(metrics);
    assert.equal(placed.textHeight, undefined);
    assert.notDeepEqual({ x: placed.x, y: placed.y }, preferred);
    assert(!overlaps(box, plaque));
  }
});

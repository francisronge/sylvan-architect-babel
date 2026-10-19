import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { reserveMovementSlotClearance } from '../replay/movementSlotClearance.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { motionFrame, replayMotionFaults } from '../scripts/replayMotionContinuity.mjs';
import { auditVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

/* A later stage's attachment carries its layout back over earlier frames. Where
 * that layout holds a movement's slot for the compact lower occurrence, the
 * complete source painted there before its movement must still clear its sister. */

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/replay-regressions/${name}.json`, import.meta.url), 'utf8'));
const CASES = [
  // whose car stands in Spec-TP (frames 22-26) beside the T′ that stage 6 holds for the trace.
  ['later-occupant-intermediate-landing', 'car', 'was'],
  // Péter stands in Spec-VP (frame 24) beside the V′ that stage 3 holds for the A-trace.
  ['later-occupant-source-before-movement', 'd_pbar', 'd_v']
];
const viewports = VIEWPORTS.filter(viewport => viewport.name !== 'mobile');
// Construction order can depend on later stages, so a frame is named by its
// stage and step rather than by its position in Replay.
const stepNames = record => {
  const seen = new Map();
  return prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps.map(step => {
    const name = JSON.stringify([step.replayFrameIndex, step.replayKind, step.operation, step.targetNodeId,
      step.replayRelationIdentity?.relationIndex]);
    seen.set(name, (seen.get(name) ?? 0) + 1);
    return { stage: step.replayFrameIndex, name: `${name}#${seen.get(name)}` };
  });
};
const overlaps = record => {
  const steps = stepNames(record);
  return auditVisualRecord('slot', record, { viewports, canopy: false }).findings
    .filter(finding => finding.rule === 'glyph-overlap' || finding.rule === 'line-clearance' && finding.subtype === 'branch-text')
    .map(finding => ({ stage: steps[finding.frame - 1].stage,
      key: `${finding.viewport} ${steps[finding.frame - 1].name}: ${finding.rule} ${finding.subject}`, frame: finding.frame }));
};

for (const [name, occupant, sister] of CASES) {
  const record = fixture(name);
  test(`${name}: the source standing in a held slot clears its sister`, () => {
    const found = overlaps(record).map(entry => `frame ${entry.frame} ${entry.key}`);
    assert.deepEqual(found.filter(entry => entry.includes(occupant) && entry.includes(sister)), [], 'the reported collision is gone');
    assert.deepEqual(found, [], 'no text overlap or branch through text in any frame');
  });

  test(`${name}: adding later stages adds no overlap to earlier frames`, () => {
    const full = overlaps(record);
    for (let stages = 1; stages < record.derivationStages.length; stages++) {
      const alone = new Set(overlaps({ ...record, derivationStages: record.derivationStages.slice(0, stages) }).map(entry => entry.key));
      const added = full.filter(entry => entry.stage < stages && !alone.has(entry.key)).map(entry => `frame ${entry.frame} ${entry.key}`);
      assert.deepEqual(added, [], `stages after ${stages} add none of these overlaps`);
    }
  });
}

// A wide source moves out beside its sister and leaves a narrow trace; the next
// stage is laid out 500 units to the left. With `insert`, it inserts a unary parent
// above the trace, so the trace leaves the slot at that stage's first step.
function heldSlot(insert) {
  const node = (id, label, children) => ({ id, label, ...(children ? { children } : {}) });
  const word = (id, text) => ({ id, label: text, word: text });
  const forest = (...roots) => ({ id: 'forest', label: '', replayOrigin: { kind: 'workspace' }, children: roots });
  const phrase = (id, label) => node(id, label, [word('a', 'alpha'), word('b', 'beta')]);
  const sister = () => node('sis', 'VP', [word('c', 'gamma')]), trace = () => node('t', 't');
  const later = insert ? { canvas: forest(phrase('land', 'DP'), node('P', 'TP', [node('U', 'DP', [trace()]), sister()])), kind: 'micro',
    operation: 'Project', target: 'U', at: { U: [-200, 220], t: [-200, 440] } }
    : { canvas: forest(phrase('land', 'DP'), node('P', 'TP', [trace(), sister()])), kind: 'macro', operation: 'StageRecord', target: 'P',
      at: { t: [-200, 220] } };
  const frames = [
    { canvas: node('P', 'TP', [phrase('src', 'DP'), sister()]), stage: 0, kind: 'micro', operation: 'ExternalMerge', target: 'P',
      at: { P: [450, 0], src: [300, 220], a: [150, 440], b: [450, 440], sis: [600, 220], c: [600, 440] } },
    { canvas: forest(phrase('land', 'DP'), node('P', 'TP', [trace(), sister()])), stage: 0, kind: 'relation', operation: 'movement',
      target: 'land', at: { land: [-300, 0], a: [-450, 220], b: [-150, 220], P: [450, 0], t: [300, 220], sis: [600, 220], c: [600, 440] } },
    { ...later, stage: 1, at: { land: [-800, 0], a: [-950, 220], b: [-650, 220], P: [-50, 0], ...later.at, sis: [100, 220], c: [100, 440] } }
  ];
  const steps = frames.map(({ canvas, stage, kind, operation, target, at }, index) => ({
    replayCanvasData: canvas, replayFrameIndex: stage, replayStageStepIndex: index, replayKind: kind, operation, targetNodeId: target,
    replayVisibleNodeIds: Object.keys(at),
    ...(kind === 'relation' ? { replayRelationIdentity: { stageIndex: 0, relationIndex: 0 }, replayRelationLinks: [{ authoredRelationKey: '0:0',
      renderFamily: 'trajectory', priorSourceNodeId: 'src', witnessNodeId: 't', targetNodeId: 'land' }] } : {})
  }));
  const coordinates = new Map(frames.map(({ canvas, at }) => [canvas,
    new Map([['forest', { x: 0, y: -220 }], ...Object.entries(at).map(([id, [x, y]]) => [id, { x, y }])])]));
  const sizes = new Map([[0, [3000, 1000]], [1, [3000, 1000]]]);
  const faults = plan => replayMotionFaults({ frames: steps.map(step => {
    const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const visible = new Set(step.replayVisibleNodeIds);
    const nodes = new Map(layoutSyntaxTree(root, sizes.get(step.replayFrameIndex), 'ltr', plan.get(step.replayCanvasData), visible)
      .descendants().filter(laid => visible.has(getNodeId(laid))).map(laid => [getNodeId(laid), laid]));
    return motionFrame(step, nodes, getNodeId);
  }) }).map(fault => `${fault.frame}:${fault.kind}:${fault.node}`);
  const planned = reserveMovementSlotClearance({ steps, sizes, coordinates, direction: 'ltr' });
  return { before: faults(coordinates), after: faults(planned), source: planned.get(frames[0].canvas).get('src').x };
}

test('a held slot widens across a stage crossing and keeps its lower occurrence in place', () => {
  const { before, after, source } = heldSlot(false);
  assert.deepEqual(before, []);
  assert.ok(source < 300, 'the source moves away from its sister');
  assert.deepEqual(after, [], 'the carried stage shows no motion');
});

test('a widened slot that ends before a later stage inserts a parent adds no motion there', () => {
  const { before, after } = heldSlot(true);
  assert.deepEqual(before, [], 'the trace joins its new parent in place');
  assert.deepEqual(after, [], 'widening the slot defers no jump to the inserted parent');
});

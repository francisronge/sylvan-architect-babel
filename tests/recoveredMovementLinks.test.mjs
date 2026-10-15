import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import { adaptDerivationStagesForReplay } from '../replay/authoredFrames.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { buildAuthoredRelationLinksForFrames, createFrameRelationResolver } from '../replay/frameRelations.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';

const node = (id, label, children = [], fields = {}) => ({ id, label, children, ...fields });
const flatten = forest => forest.flatMap(item => [item, ...flatten(item.children ?? [])]);
const stage = (workspaceForest, relations = []) => ({ statement: '', stageRecord: '', workspaceForest, relations });

function example(kind = 'head') {
  const low = node('lower', kind === 'head' ? 'T' : 'DP', [], { word: 'item', lineageId: 'mover' });
  const domain = node('domain', 'TP', [node('subject', 'D', [], { word: 'subject' }),
    node('core', 'T′', [low, node('predicate', 'VP', [node('verb', 'V', [], { word: 'read' }),
      node('object', 'DP', [], { word: 'books' })])])]);
  const host = node('host', 'C', [], { silent: true });
  const high = { ...structuredClone(low), id: 'upper' };
  const before = [node('clause', 'CP', [host, domain])];
  const after = kind === 'head'
    ? [node('clause', 'CP', [node('receiving', 'C', [high, structuredClone(host)]), structuredClone(domain)])]
    : [node('landing', 'CP', [high, structuredClone(before[0])])];
  const relation = { relation: 'InternalMerge', anchors: { target: 'upper',
    ...(kind === 'head' ? { host: 'receiving' } : {}) }, priorAnchors: { source: 'lower' } };
  return [stage(before), stage(after, [relation])];
}

function resolve(stages, forest = stages.at(-1).workspaceForest) {
  const frames = adaptDerivationStagesForReplay(stages);
  const replayPlan = buildDerivationReplayPlan({ derivationStages: stages });
  const frameRelations = createFrameRelationResolver(frames, replayPlan);
  return { relation: frameRelations(1)[0], links: buildAuthoredRelationLinksForFrames({
    frames, replayPlan, activeFrameIndex: 1, forest, frameRelations
  }) };
}

for (const kind of ['head', 'phrasal']) test(`${kind}: a prior source and exact current witness survive the Replay link handoff`, () => {
  const stages = example(kind), original = structuredClone(stages), { relation, links } = resolve(stages);
  assert.equal(relation.recoveredMovement?.transition, true);
  assert.equal(relation.recoveredMovement?.trajectoryKind, kind);
  assert.equal(links.length, 1);
  const [link] = links;
  assert.equal(link.priorSourceNodeId, 'lower');
  assert.equal(link.sourceNodeId, 'lower');
  assert.equal(link.witnessNodeId, 'lower');
  assert.equal(link.targetNodeId, 'upper');
  assert.equal(link.movementTransition, true);
  assert.equal(link.renderFamily, 'trajectory');
  assert.equal(link.trajectoryKind, kind);
  assert.deepEqual(link.anchors, Object.entries(stages[1].relations[0].anchors).map(([role, nodeId]) => ({ role, nodeId })));
  assert.deepEqual(link.priorAnchors, stages[1].relations[0].priorAnchors);
  assert.deepEqual(stages, original, 'recovery must not add a current source anchor to the authored record');
});

test('a recovered endpoint must still be present exactly once in the displayed forest', () => {
  const stages = example(), source = flatten(stages[1].workspaceForest).find(item => item.id === 'lower');
  for (const forest of [
    [...structuredClone(stages[1].workspaceForest), structuredClone(source)],
    structuredClone(stages[1].workspaceForest).map(root => {
      flatten([root]).find(item => item.id === 'core').children.shift();
      return root;
    })
  ]) {
    const { relation, links } = resolve(stages, forest);
    assert.equal(relation.recoveredMovement?.transition, true, 'the original stages establish the movement');
    assert.deepEqual(links, [], 'a later displayed forest cannot borrow a missing or ambiguous occurrence');
  }
});

for (const [label, change] of [
  ['unrelated lineage', stages => { flatten(stages[1].workspaceForest).find(item => item.id === 'upper').lineageId = 'other'; }],
  ['duplicated lower ID', stages => { stages[1].workspaceForest.push(structuredClone(flatten(stages[1].workspaceForest).find(item => item.id === 'lower'))); }],
  ['duplicated prior source ID', stages => { stages[0].workspaceForest.push(structuredClone(flatten(stages[0].workspaceForest).find(item => item.id === 'lower'))); }],
  ['unresolved prior source', stages => { stages[1].relations[0].priorAnchors.source = 'missing'; }]
]) test(`${label} does not gain movement ownership during link construction`, () => {
  const stages = example(); change(stages);
  const { relation, links } = resolve(stages);
  assert(!relation.recoveredMovement?.transition);
  assert(!links.some(link => link.movementTransition));
});

for (const [width, height] of [[1600, 948], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`${width}px ${direction}: the movement link introduces its parent atomically and keeps the unchanged domain rigid`, () => {
    const stages = example(), original = structuredClone(stages);
    const replay = prepareReplay({ derivationStages: stages, sentence: 'subject item read books', includePlayback: true });
    const steps = replay.playbackSteps, index = steps.findIndex(step => step.replayKind === 'relation');
    assert(index > 0);
    const before = steps[index - 1], after = steps[index];
    assert(!before.replayVisibleNodeIds.includes('upper'));
    assert(!before.replayVisibleNodeIds.includes('receiving'));
    for (const id of ['upper', 'upper::__leaf', 'receiving', 'host', 'lower', 'lower::__leaf'])
      assert(after.replayVisibleNodeIds.includes(id), `${id} is available at the movement`);
    assert.equal(after.replayRelationLinks.filter(link => link.authoredRelationKey === '1:0').length, 1);
    const groups = buildStageLayoutGroups(steps, replay.replayDerivationFrames);
    const sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height, groups);
    const draw = step => {
      const size = sizeFor(step.replayFrameIndex), root = d3.hierarchy(step.replayCanvasData);
      applyVizIds(root);
      const points = buildStageCoordinateReservations(steps, step.replayFrameIndex, size, sizeFor, direction).get(step.replayCanvasData);
      return new Map(layoutSyntaxTree(root, size, direction, points, new Set(step.replayVisibleNodeIds)).descendants()
        .filter(item => step.replayVisibleNodeIds.includes(getNodeId(item))).map(item => [getNodeId(item), item]));
    };
    const a = draw(before), b = draw(after);
    for (const member of a.get('domain').descendants()) {
      const next = b.get(getNodeId(member));
      assert(Math.hypot(next.x - member.x, next.y - member.y) < 1e-6, `${getNodeId(member)} moves despite no authored change`);
    }
    assert.equal(b.get('upper').parent.data.id, 'receiving');
    assert.equal(b.get('host').parent.data.id, 'receiving');
    assert.equal(a.get('lower::__leaf').data.word, 'item');
    assert.equal(b.get('lower::__leaf').data.word, 'item', 'movement does not invent silence');
    assert.deepEqual(stages, original);
  });
}

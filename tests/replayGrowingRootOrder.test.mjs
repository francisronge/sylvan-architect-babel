import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';

const node = (id, label, children = [], word) => ({ id, label,
  ...(children.length ? { children } : {}), ...(word ? { word } : {}) });
const stage = workspaceForest => ({ statement: 'Build the current syntax.',
  stageRecord: 'Keep the independent topic until the clause is complete.', relations: [], workspaceForest });
function record({ wordlessC = false, wrappedChild = false, multipleChildren = false } = {}) {
  const topic = node('topic', 'DP', [node('topicD', 'D', [], '这'), node('topicNP', 'NP', [node('topicN', 'N', [], '书')])]);
  const subject = node('subject', 'DP', [node('subjectD', 'D', [], '小王')]);
  const verb = node('verb', 'V', [], '看');
  const c = node('c', 'C', [], wordlessC ? undefined : '了');
  const cbar = node('cbar', 'C′', [node('ip', 'IP', [subject, node('vp', 'VP', [verb, node('pro', 'DP')])]), c]);
  const other = node('other', 'C');
  const oldChildren = multipleChildren ? [cbar, other] : [cbar];
  const retained = wrappedChild ? node('wrapper', 'XP', [cbar]) : cbar;
  const nextChildren = multipleChildren ? [topic, retained, other] : [topic, retained];
  return { sentence: '这书小王看了', derivationStages: [stage([topic, subject, verb, c]),
    stage([topic, node('cp', 'CP', oldChildren)]), stage([node('cp', 'CP', nextChildren)])] };
}

for (const wordlessC of [false, true]) for (const [width, height, direction] of [
  [1600, 1100, 'ltr'], [390, 844, 'ltr'], [1600, 1100, 'rtl']
]) test(`${wordlessC ? 'wordless' : 'pronounced'} C, ${width}px ${direction}: a growing unary CP keeps the topic on its landing side`, () => {
  const source = record({ wordlessC }), original = structuredClone(source);
  const prepared = prepareReplay({ ...source, includePlayback: true });
  const steps = prepared.playbackSteps;
  const completed = steps.find(step => step.replayFrameIndex === 1 && step.replayKind === 'macro');
  assert.deepEqual(completed.replayCanvasData.children.map(child => child.id), ['topic', 'cp']);
  assert.deepEqual(completed.replayCanvasData.children[1].children.map(child => child.id), ['cbar'],
    'the future topic is still independent, not an early CP daughter');
  const groups = buildStageLayoutGroups(steps, prepared.replayDerivationFrames);
  const sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height, groups);
  const coordinates = buildStageCoordinateReservations(steps, 1, sizeFor(1), sizeFor, direction);
  for (const step of steps.filter(step => step.replayFrameIndex === 1)) {
    const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
    const tree = layoutSyntaxTree(root, sizeFor(1), direction, coordinates.get(step.replayCanvasData),
      new Set(step.replayVisibleNodeIds));
    const topic = tree.descendants().find(n => getNodeId(n) === 'topic');
    const clause = tree.descendants().find(n => getNodeId(n) === 'cp');
    assert((clause.x - topic.x) * (direction === 'rtl' ? -1 : 1) > 0,
      'completed clause construction must not send the waiting topic to the opposite side');
  }
  assert.deepEqual(source, original, 'display order does not rewrite the authored forest or Stage Records');
});

for (const [name, options] of [
  ['a reparented current child', { wrappedChild: true }],
  ['current material on multiple branches', { multipleChildren: true }]
]) test(`${name} cannot borrow one future child slot`, () => {
  const source = record(options), original = structuredClone(source);
  const { playbackSteps } = prepareReplay({ ...source, includePlayback: true });
  const completed = playbackSteps.find(step => step.replayFrameIndex === 1 && step.replayKind === 'macro');
  assert.deepEqual(completed.replayCanvasData.children.map(child => child.id), ['cp', 'topic']);
  assert.deepEqual(source, original);
});

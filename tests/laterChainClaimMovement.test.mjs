import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildReplayPanelContent } from '../replay/replayPanel.ts';
import { isPlanItemRevealed, planItemRelationRefs } from '../replay/relations/renderPlan.ts';

// A later claim of a stage that names a movement an earlier claim of that stage
// already owns (same moved phrase, source and landing) keeps its own moment and
// its own marks, but neither owns nor redraws the arrow. Francis chose this on
// 23 Oct ("option B").
const load = (file, pointer) => pointer.split('/').filter(Boolean)
  .reduce((value, key) => value[key], JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url))));
const prepare = record => prepareReplay({ sentence: record.sentence, derivationStages: structuredClone(record.derivationStages), includePlayback: true });
const trajectories = (replay, stageIndex, source, target) => replay.relationRenderPlan.frames[stageIndex].items
  .filter(item => item.kind === 'trajectory' && item.sourceNodeId === source && item.targetNodeId === target);
const sameStageOwners = (item, stageIndex) => planItemRelationRefs(item)
  .filter(ref => ref.stageIndex === stageIndex).map(ref => ref.relationIndex);
const momentOf = (replay, stageIndex, relationIndex) => replay.playbackSteps.findIndex(step =>
  step.replayRelationIdentity?.stageIndex === stageIndex && step.replayRelationIdentity?.relationIndex === relationIndex);
const ownedKinds = (replay, stageIndex, relationIndex) => replay.relationRenderPlan.frames[stageIndex].items
  .filter(item => planItemRelationRefs(item).some(ref => ref.stageIndex === stageIndex && ref.relationIndex === relationIndex))
  .map(item => item.kind);

const cases = [
  { name: 'Mia seems to want to leave: A-trace licensing after raising', file: 'movement/clause-context.json', pointer: '/cases/0',
    stage: 1, movements: [{ source: 'miaTrace', target: 'miaNP', owner: 0, later: [3] }] },
  { name: 'Georgian: chain interpretation and empty-category licensing', file: 'showcase/agreement-and-case.json', pointer: '/cases/4',
    stage: 2, movements: [{ source: 'verbTrace', target: 'verb', owner: 0, later: [3] },
      { source: 'subjectTrace', target: 'subjectNP', owner: 1, later: [2] }] },
  { name: 'Tier-1 A-movement, then a recovered antecedent-licensing claim', file: 'movement/restated-chains.json', pointer: '/0',
    stage: 3, movements: [{ source: 'miaLow', target: 'miaHigh', owner: 7, later: [11] }] },
  { name: 'subject movement restated by two later claims', file: 'showcase/scope-ellipsis-coordination.json', pointer: '/cases/1',
    stage: 2, movements: [{ source: 'patTrace', target: 'patNP', owner: 1, later: [2, 3] }] }
];

for (const { name, file, pointer, stage, movements } of cases) test(`${name}: only the earlier claim draws the arrow`, () => {
  const record = load(file, pointer);
  const replay = prepare(record);
  for (const { source, target, owner, later } of movements) {
    const [path, ...others] = trajectories(replay, stage, source, target);
    assert(path, `${source} -> ${target} keeps its arrow`);
    assert.equal(others.length, 0);
    assert.deepEqual(sameStageOwners(path, stage), [owner], 'the earlier claim alone owns the arrow');
    assert(isPlanItemRevealed(path, stage, new Set([owner]), owner), 'the arrow appears at the earlier claim\'s moment');
    for (const relationIndex of later) {
      assert(momentOf(replay, stage, relationIndex) > momentOf(replay, stage, owner), 'the later claim keeps its own later moment');
      const kinds = ownedKinds(replay, stage, relationIndex);
      assert(kinds.length > 0, 'the later claim still draws its own content');
      assert(!kinds.includes('trajectory'), 'the later claim draws no arrow of its own');
      const step = replay.playbackSteps[momentOf(replay, stage, relationIndex)];
      assert(!step.replayRelationLinks?.some(link => link.authoredRelationKey === `${stage}:${relationIndex}`
        && link.renderFamily === 'trajectory'), 'its Replay moment adds no trajectory');
      const panel = buildReplayPanelContent(step, record.derivationStages);
      assert.equal(panel.authoredRelation, record.derivationStages[stage].relations[relationIndex]);
      const anchors = Object.keys(record.derivationStages[stage].relations[relationIndex].anchors);
      assert(anchors.length > 0 && panel.supportLines.length >= anchors.length, 'the panel still lists the claim\'s own anchors');
    }
  }
});

test('a later claim that is the only one naming its movement still owns it', () => {
  const record = structuredClone(load('movement/clause-context.json', '/cases/0'));
  // Without the raising claim, A-trace licensing (now relation 2) is the stage's only claim of this movement.
  record.derivationStages[1].relations.splice(0, 1);
  const replay = prepare(record);
  const [path] = trajectories(replay, 1, 'miaTrace', 'miaNP');
  assert(path);
  assert.deepEqual(sameStageOwners(path, 1), [2]);
});

test('a restatement in a later stage still shares the earlier stage\'s arrow', () => {
  const record = load('movement/restated-chains.json', '/1');
  const replay = prepare(record);
  const [path] = replay.relationRenderPlan.frames.at(-1).items.filter(item => item.kind === 'trajectory'
    && item.sourceNodeId === record.source && item.targetNodeId === record.target);
  assert.deepEqual(planItemRelationRefs(path).map(ref => ref.stageIndex), [4, 5]);
});

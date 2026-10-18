import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { isPlanItemRevealed, planItemRelationRefs } from '../replay/relations/renderPlan.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { checkMarkPersistence, checkStepSemantics } from './helpers/replayStepInvariants.mjs';

const corpus = loadFixtureAnalyses().records;
const prepared = id => {
  const { record } = corpus.find(entry => entry.id === id);
  return { record, replay: prepareReplay({ ...structuredClone(record), includePlayback: true }) };
};
const moment = (steps, stage, relation) => steps.findIndex(step => step.replayKind === 'relation'
  && step.replayRelationIdentity.stageIndex === stage && step.replayRelationIdentity.relationIndex === relation);
const owns = (item, stage, relation) => planItemRelationRefs(item).some(ref => ref.stageIndex === stage && ref.relationIndex === relation);
/** Whether an item is revealed at each step of its frame's stage, as the renderer selects it. */
const revealedAcross = (replay, item, stage) => {
  const played = new Set();
  return replay.playbackSteps.flatMap(step => {
    if (step.replayFrameIndex !== stage) return [];
    const active = step.replayKind === 'relation' ? step.replayRelationIdentity.relationIndex : null;
    if (active !== null) played.add(active);
    return [isPlanItemRevealed(item, stage, played, active)];
  });
};

test('a persistent mark stays until the movement that carries its anchor away', () => {
  // Stage 3 moves the V-to-I complex holding v2 on to C; v2 keeps its place until that moment.
  const { record, replay } = prepared('replay-regressions/case-source-transfer.json#');
  const steps = replay.playbackSteps, carried = moment(steps, 2, 2), first = steps.findIndex(step => step.replayFrameIndex === 2);
  const arrow = replay.relationRenderPlan.frames[2].items.find(item => item.kind === 'trajectory' && owns(item, 1, 1));
  assert(arrow, 'stage 2\'s V-to-I arrow is materialized for stage 3');
  assert.deepEqual([arrow.supersededAt?.stageIndex, arrow.supersededAt?.relationIndex], [2, 2]);
  assert.deepEqual(revealedAcross(replay, arrow, 2), steps.filter(step => step.replayFrameIndex === 2).map((_step, index) => first + index < carried));
  assert.deepEqual(checkMarkPersistence(replay, record).filter(found => found.subtype === 'ends-before-removal'), []);
});

test('theta badges yield at the moment of the relation whose grid composes with them', () => {
  const { record, replay } = prepared('replay-regressions/clitic-displacement.json#/fixtures/1/analysis');
  const badges = replay.relationRenderPlan.frames[4].items.find(item => item.kind === 'node-badges' && item.badgeStyle === 'theta-role' && owns(item, 0, 0));
  assert(badges, 'the stage-1 badges remain in stage 5 until the composing relation');
  assert.deepEqual([badges.supersededAt?.stageIndex, badges.supersededAt?.relationIndex], [4, 1]);
  assert.deepEqual(checkMarkPersistence(replay, record).filter(found => found.subtype === 'composed-before-moment'), []);
});

test('a restated occurrence keeps its preceding label until the relation that names it', () => {
  // Stage 2 restates matrixI as V-adjoined; V-to-I head movement is the first relation naming it.
  const { record, replay } = prepared('movement/holdout-transitions.json#/1');
  const steps = replay.playbackSteps, adjoins = moment(steps, 1, 1);
  const labelAt = index => d3.hierarchy(steps[index].replayCanvasData).find(node => node.data.id === 'matrixI').data.label;
  steps.forEach((step, index) => {
    if (step.replayFrameIndex === 1) assert.equal(labelAt(index), index < adjoins ? 'I⁰ [finite]' : 'I⁰ [finite, V-adjoined]', `frame ${index + 1}`);
  });
  assert.deepEqual(checkStepSemantics(replay, record).filter(found => found.subtype === 'unowned-repaint'), []);
});

test('a restated participle keeps its unvalued form until the agreement that names it', () => {
  const { record, replay } = prepared('replay-regressions/obsolete-plaque-pockets.json#');
  const steps = replay.playbackSteps, agrees = moment(steps, 2, 1), moves = moment(steps, 2, 0);
  const participle = index => d3.hierarchy(steps[index].replayCanvasData).find(node => node.data.id === 'v').data;
  assert.equal(participle(moves).label, 'V[envoyer; participle; agreement unvalued]');
  assert.equal(participle(agrees).label, 'V[participle; feminine plural]');
  assert.deepEqual(checkStepSemantics(replay, record).filter(found => found.subtype === 'unowned-repaint'), []);
});

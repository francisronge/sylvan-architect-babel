import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { getFrameRelations } from '../replay/replayCompiler.ts';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/unproven-second-landing.json', import.meta.url)));
const nodes = forest => forest.flatMap(n => [n, ...nodes(n.children ?? [])]);
const phrase = (id, silent = false) => ({ id, label: 'NP', lineageId: 'whPhrase', ...(silent ? { silent: true } : {}),
  children: [{ id: `${id}N`, label: 'N', word: 'what', lineageId: 'whWord', ...(silent ? { silent: true } : {}) }] });
const reduced = () => {
  const previous = { statement: 'Build the verb phrase.', stageRecord: 'The interrogative is the object of read.', relations: [],
    workspaceForest: [{ id: 'body', label: 'VP', children: [{ id: 'verb', label: 'V', word: 'read' }, phrase('low')] }] };
  return { sentence: 'what read', derivationStages: [previous, {
    statement: 'Move through the two edges.', stageRecord: 'The phrase first moves to the inner edge and then to the outer edge.',
    relations: [
      { relation: 'wh movement through the phase edge', anchors: { sourceOccurrence: 'low', edgeOccurrence: 'edge' }, priorAnchors: { source: 'low' } },
      { relation: 'wh movement to the interrogative edge', anchors: { sourceOccurrence: 'edge', upperOccurrence: 'high' } }
    ], workspaceForest: [{ id: 'outer', label: 'CP', children: [phrase('high'), { id: 'inner', label: 'vP', children: [
      phrase('edge', true), { ...structuredClone(previous.workspaceForest[0]), children: [previous.workspaceForest[0].children[0], phrase('low', true)] }
    ] }] }]
  }] };
};
const play = record => prepareReplay({ sentence: record.sentence, derivationStages: record.derivationStages, includePlayback: true });
const visible = (step, id) => step.replayVisibleNodeIds.includes(id);

for (const [name, make, landing, parent, source] of [
  ['reduced', reduced, 'high', 'outer', 'edge'],
  ['fresh GPT-6.1 Sol', () => structuredClone(saved), 'whHigh', 'completedQuestion', 'whEdge']
]) test(`${name}: an unproven second hop reveals its exact landing at its own moment`, () => {
  const record = make(), original = structuredClone(record), replay = play(record), steps = replay.playbackSteps;
  const momentIndex = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity?.relationIndex === 1);
  assert(momentIndex >= 0);
  assert(steps.slice(0, momentIndex).every(s => !visible(s, landing)), 'the later landing must remain hidden');
  assert(steps.slice(0, momentIndex).every(s => !visible(s, parent)), 'a parent requiring the later landing must remain hidden');
  const moment = steps[momentIndex];
  assert(visible(moment, landing));
  assert(visible(moment, source));
  assert(moment.movementDiagnostics.some(d => d.startsWith('MOVEMENT_PRIOR_SOURCE_UNPROVEN:')));
  const items = replay.relationRenderPlan.frames[1].items;
  assert(!items.some(item => item.kind === 'trajectory' && item.relationRef.relationIndex === 1), 'timing ownership does not earn movement');
  const currentLanding = nodes(record.derivationStages[1].workspaceForest).find(n => n.id === landing);
  const displayed = nodes([moment.replayCanvasData]);
  for (const node of nodes([currentLanding])) {
    const view = displayed.find(n => n.id === node.id || n.replayOrigin?.authoredId === node.id);
    assert(view && visible(moment, view.id), 'the complete authored landing appears together');
    assert.equal(view.silent, node.silent, 'no pronunciation is inferred');
  }
  assert.deepEqual(steps.filter(s => s.replayKind === 'relation' && s.replayFrameIndex === 1).map(s => s.replayRelationIdentity.relationIndex), [0, 1, ...(name.startsWith('fresh') ? [2] : [])]);
  assert.deepEqual(record, original);
});

test('a supported second hop keeps its recovered movement and complete atomic landing', () => {
  const record = reduced();
  const final = record.derivationStages.pop(), intermediate = structuredClone(final);
  intermediate.workspaceForest = intermediate.workspaceForest[0].children.slice(1);
  intermediate.relations = [final.relations[0]];
  final.relations = [final.relations[1]];
  record.derivationStages.push(intermediate, final);
  const replay = play(record), steps = replay.playbackSteps;
  const momentIndex = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 2 && s.replayRelationIdentity?.relationIndex === 0);
  assert(steps.slice(0, momentIndex).every(s => !visible(s, 'high')));
  assert(visible(steps[momentIndex], 'high'));
  assert(!steps[momentIndex].movementDiagnostics?.some(d => d.startsWith('MOVEMENT_PRIOR_SOURCE_UNPROVEN:')));
  assert(replay.relationRenderPlan.frames[2].items.some(i => i.kind === 'trajectory' && i.targetNodeId === 'high'));
});

test('an ordinary semantic relation does not own new syntax merely by mentioning it', () => {
  const record = reduced(), stage = record.derivationStages[1];
  stage.relations = [{ relation: 'Interpretation', anchors: { participant: 'high', lowerOccurrence: 'edge' } }];
  const steps = play(record).playbackSteps, momentIndex = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1);
  assert(steps.slice(0, momentIndex).some(s => visible(s, 'high') && s.replayKind === 'micro'));
  assert(visible(steps[momentIndex], 'high'));
});

for (const priorAnchors of [
  { context: 'verb', currentSource: 'edge' },
  { context: 'missing' },
  { context: ['verb', 'low'], currentSource: 'edge' }
]) test(`exact new landing ownership survives an unusable prior witness ${JSON.stringify(priorAnchors)}`, () => {
  const record = reduced();
  record.derivationStages[1].relations[1].priorAnchors = priorAnchors;
  const replay = play(record), steps = replay.playbackSteps;
  const index = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity?.relationIndex === 1);
  assert(index >= 0);
  assert(steps.slice(0, index).every(s => !visible(s, 'high') && !visible(s, 'outer')));
  assert(visible(steps[index], 'high'));
  assert(visible(steps[index], 'edge'));
  assert(!replay.relationRenderPlan.frames[1].items.some(item => item.kind === 'trajectory' && item.relationRef.relationIndex === 1));
});

for (const ambiguity of ['landing', 'prior source']) test(`ambiguous ${ambiguity} evidence cannot grant an arbitrary movement or landing owner`, () => {
  const record = reduced(), relation = record.derivationStages[1].relations[1];
  if (ambiguity === 'landing') relation.anchors.upperOccurrence = ['high', 'verb'];
  else relation.priorAnchors = { source: ['verb', 'low'] };
  const replay = play(record);
  const derived = getFrameRelations(replay.replayDerivationFrames[1], replay.derivationReplayPlan.stages[1], record.derivationStages[0].workspaceForest)[1];
  assert.equal(derived.unprovenNewLandingNodeId, undefined);
  assert.equal(derived.recoveredMovement, undefined);
  assert(!replay.relationRenderPlan.frames[1].items.some(item => item.kind === 'trajectory' && item.relationRef.relationIndex === 1));
  assert(visible(replay.playbackSteps.at(-1), 'high'), 'the authored completed occurrence remains inspectable');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { indexMovementOccurrences, sourceOccurrencePair } from '../replay/relations/movementSourceEvidence.ts';
import { resolveFallbackTreeTransitionOwnership } from '../replay/treeTransitions.ts';

const flatten = forest => forest.flatMap(node => [node, ...flatten(node.children ?? [])]);
const find = (forest, id) => flatten(forest).find(node => node.id === id);
const example = (kind = 'phrasal', pronouncedLower = false) => {
  const source = { id: 'source', label: kind === 'head' ? 'V⁰' : 'AdvP', word: 'before' };
  const priorForest = [{ id: 'base', label: 'VP', children: [source, { id: 'sister', label: 'NP' }] }];
  const lower = { ...source, lineageId: 'new-chain', ...(pronouncedLower ? {} : { silent: true }) };
  const landing = { ...source, id: 'landing', lineageId: 'new-chain', word: 'after' };
  const attachment = kind === 'head'
    ? { id: 'complex', label: 'T⁰', children: [landing, { id: 'host', label: 'T⁰' }] }
    : landing;
  return { priorForest, currentForest: [{ id: 'root', label: 'TP', children: [attachment,
    { ...structuredClone(priorForest[0]), children: [lower, { id: 'sister', label: 'NP' }] }] }],
    relation: { relation: 'An independently named association', anchors: { source: 'source', target: 'landing' },
      priorAnchors: { source: 'source' } }, stageIndex: 1, relationIndex: 0 };
};
const recover = input => recoverMovementEvidence(input.relation, input.currentForest, input.priorForest);
const pair = input => sourceOccurrencePair(indexMovementOccurrences(input.currentForest),
  indexMovementOccurrences(input.priorForest), 'source', Object.values(input.relation.anchors).flat());

for (const kind of ['head', 'phrasal']) for (const pronouncedLower of [false, true])
  test(`the first ${kind} copy can declare lineage with a ${pronouncedLower ? 'pronounced' : 'silent'} persistent lower occurrence`, () => {
    const input = example(kind, pronouncedLower), original = structuredClone(input);
    const movement = recover(input).movement;
    assert.deepEqual([movement?.priorSourceNodeId, movement?.sourceNodeId, movement?.targetNodeId,
      movement?.trajectoryKind, movement?.transition], ['source', 'source', 'landing', kind, true]);
    assert.ok(dispatchRelationClaims(input).facets.some(facet => facet.recipe.id === 'movement.path'));
    assert.deepEqual(input, original);
  });

test('a bare adjunct at a projected modal edge uses the same first-copy identity proof', () => {
  const input = example();
  for (const forest of [input.priorForest, input.currentForest]) find(forest, 'source').label = 'Adv';
  find(input.currentForest, 'landing').label = 'Adv';
  const modal = children => ({ id: 'modal', label: 'ModP', children: [{ id: 'modal-head', label: 'Mod' }, ...children] });
  input.priorForest = [modal(input.priorForest)];
  input.currentForest[0].label = 'ModP';
  input.currentForest[0].children[1] = modal([input.currentForest[0].children[1]]);
  assert.equal(recover(input).movement?.trajectoryKind, 'phrasal');
  assert.ok(dispatchRelationClaims(input).facets.some(facet => facet.recipe.id === 'movement.path'));
});

test('unfamiliar current roles use the exact first-copy root pair and explicit preceding source', () => {
  const input = example();
  input.relation.anchors = { participant: 'source', counterpart: 'landing' };
  const original = structuredClone(input);
  assert.deepEqual([pair(input)?.source.id, pair(input)?.landing.id], ['source', 'landing']);
  assert.deepEqual([recover(input).movement?.sourceNodeId, recover(input).movement?.targetNodeId], ['source', 'landing']);
  assert.deepEqual(input, original);
});

test('an untagged witness is no earlier chain copy of a first copy, so it still competes', () => {
  const input = example();
  input.relation.anchors = { landing: 'landing', sourceTrace: 'source', lowerTrace: 'sister' };
  const result = recover(input);
  assert.equal(result.movement, undefined);
  assert.equal(result.failure, 'MOVEMENT_ENDPOINTS_UNRESOLVED');
});

test('an unknown category keeps one first-copy moment; wording invents no trajectory and structure reads it from the landing context', () => {
  const input = example();
  for (const forest of [input.priorForest, input.currentForest]) find(forest, 'source').label = 'An open syntax label';
  find(input.currentForest, 'landing').label = 'An open syntax label';
  const before = structuredClone(input), dispatch = dispatchRelationClaims(input);
  assert.ok(!dispatch.facets.some(facet => facet.recipe.id === 'movement.path'));
  assert.equal(dispatch.primaryClaim.tier, 3);
  const ownership = resolveFallbackTreeTransitionOwnership(input.relation, input.priorForest, input.currentForest);
  assert.deepEqual([...ownership.currentNodeIds].sort(), ['landing', 'source']);
  assert.deepEqual([...ownership.priorNodeIds], ['source']);
  assert.deepEqual(input, before);
  const replay = prepareReplay({ sentence: '', includePlayback: true, derivationStages: [
    { statement: 'Before', stageRecord: '', workspaceForest: input.priorForest, relations: [] },
    { statement: 'After', stageRecord: '', workspaceForest: input.currentForest, relations: [
      { relation: 'Independent inspection', anchors: { participant: 'sister' } }, input.relation] }
  ] });
  const index = replay.playbackSteps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 1);
  assert.ok(index > 0);
  for (const step of replay.playbackSteps.slice(0, index).filter(step => step.replayFrameIndex === 1)) {
    assert.equal(find([step.replayCanvasData], 'source')?.lineageId, undefined);
    assert.notEqual(find([step.replayCanvasData], 'source')?.silent, true);
    assert.ok(!step.replayVisibleNodeIds.includes('landing'));
  }
  assert.ok(replay.playbackSteps[index].replayVisibleNodeIds.includes('landing'));
  assert.equal(find([replay.playbackSteps[index].replayCanvasData], 'source').silent, true);
  // Wording reads no trajectory kind for the open label; the stage difference
  // does: the new copy lands inside TP, a phrase projection, so it is phrasal.
  assert.deepEqual(replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory')
    .map(item => [item.sourceNodeId, item.targetNodeId, item.trajectoryKind]), [['source', 'landing', 'phrasal']]);
  assert.deepEqual(input, before);
});

test('Replay retains the exact untagged source until its movement moment', () => {
  const input = example();
  const relation = { relation: 'Independent inspection', anchors: { participant: 'sister' } };
  const replay = prepareReplay({ sentence: '', includePlayback: true, derivationStages: [
    { statement: 'Before', stageRecord: '', workspaceForest: input.priorForest, relations: [] },
    { statement: 'After', stageRecord: '', workspaceForest: input.currentForest, relations: [relation, input.relation] }
  ] });
  const index = replay.playbackSteps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 1);
  assert.ok(index > 0);
  for (const step of replay.playbackSteps.slice(0, index).filter(step => step.replayFrameIndex === 1)) {
    assert.equal(find([step.replayCanvasData], 'source')?.lineageId, undefined);
    assert.equal(find([step.replayCanvasData], 'source')?.silent, undefined);
    assert.ok(!step.replayVisibleNodeIds.includes('landing'));
  }
  const moment = replay.playbackSteps[index];
  assert.equal(find([moment.replayCanvasData], 'source').lineageId, 'new-chain');
  assert.equal(find([moment.replayCanvasData], 'source').silent, true);
  assert.ok(moment.replayVisibleNodeIds.includes('landing'));
  assert.ok(moment.replayRelationLinks.some(link => link.sourceNodeId === 'source' && link.targetNodeId === 'landing'));
});

for (const [name, mutate] of [
  ['a conflicting declared prior lineage', input => { find(input.priorForest, 'source').lineageId = 'different'; }],
  ['an invalid explicitly empty prior lineage', input => { find(input.priorForest, 'source').lineageId = ''; }],
  ['a fresh lower ID', input => {
    find(input.currentForest, 'source').id = 'new-lower'; input.relation.anchors.source = 'new-lower';
  }],
  ['a different lower slot', input => { find(input.currentForest, 'base').children.reverse(); }],
  ['an unrelated containing parent', input => {
    const parent = find(input.currentForest, 'base'); parent.id = 'other-parent'; parent.label = 'XP';
  }],
  ['a duplicate prior occurrence', input => { input.priorForest.push(structuredClone(find(input.priorForest, 'source'))); }],
  ['a duplicate current source', input => { input.currentForest.push(structuredClone(find(input.currentForest, 'source'))); }],
  ['a duplicate landing', input => { input.currentForest.push(structuredClone(find(input.currentForest, 'landing'))); }],
  ['no declared current lineage', input => { delete find(input.currentForest, 'source').lineageId; }],
  ['different current endpoint identities', input => { find(input.currentForest, 'landing').lineageId = 'different'; }],
  ['a lineage already attached to another prior object', input => {
    input.priorForest.push({ id: 'other-object', label: 'NP', lineageId: 'new-chain' });
  }],
  ['a conflicting prior source anchor', input => { input.relation.priorAnchors.source = 'sister'; }]
]) test(`first-copy identity refuses ${name}`, () => {
  const input = example(); mutate(input);
  assert.equal(recover(input).movement, undefined);
  assert.ok(!dispatchRelationClaims(input).facets.some(facet => facet.recipe.id === 'movement.path'));
  if (name !== 'a conflicting prior source anchor') assert.equal(pair(input), undefined);
});

test('an anchored competing first-copy landing remains ambiguous', () => {
  const input = example();
  input.currentForest.push({ ...find(input.currentForest, 'landing'), id: 'other-landing' });
  input.relation.anchors.counterpart = 'other-landing';
  assert.equal(pair(input), undefined);
});

test('neutral first-copy ownership cannot borrow conflicting identity or another landing', () => {
  for (const mutate of [
    input => { find(input.priorForest, 'source').lineageId = 'different'; },
    input => { find(input.currentForest, 'landing').lineageId = 'different'; },
    input => { input.priorForest.push({ id: 'another', label: 'NP', lineageId: 'new-chain' }); },
    input => {
      input.currentForest.push({ ...find(input.currentForest, 'landing'), id: 'another' });
      input.relation.anchors.counterpart = 'another';
    }
  ]) {
    const input = example();
    for (const forest of [input.priorForest, input.currentForest]) find(forest, 'source').label = 'An open syntax label';
    find(input.currentForest, 'landing').label = 'An open syntax label';
    mutate(input);
    const ownership = resolveFallbackTreeTransitionOwnership(input.relation, input.priorForest, input.currentForest);
    assert.ok(!ownership?.currentNodeIds.has('landing'), mutate.toString());
  }
});

test('identity introduced without a new landing is not another movement', () => {
  const input = example();
  assert.equal(recoverMovementEvidence(input.relation, input.currentForest, input.currentForest).movement?.transition ?? false, false);
});

test('new first-copy identity cannot rescue an incomplete registered signature', () => {
  const input = example(); input.relation.relation = 'AbarMove';
  input.relation.anchors.target = ['landing', 'sister'];
  const dispatch = dispatchRelationClaims(input);
  assert.equal(dispatch.primaryClaim.tier, 3);
  assert.ok(!dispatch.facets.some(facet => facet.recipe.id === 'movement.path'));
});

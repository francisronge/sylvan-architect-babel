import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

// The shape of two saved Opus across-the-board analyses (s02, n3-49): a
// finite head already projects in one conjunct's workspace; a copy of it
// merges with the other conjunct, a separate root, and projects its own
// phrase there. The source stays pronounced in its exact slot.
const leaf = (id, label, word, extra = {}) => ({ id, label, word, ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const all = n => [n, ...(n.children ?? []).flatMap(all)];
const find = (forest, id) => forest.flatMap(all).find(n => n.id === id);
const shape = (relation = { relation: 'sideward-head-movement', anchors: { source: 'T2', landing: 'T1' } }) => {
  const first = node('vP1', 'v', [leaf('john', 'D', 'John'), node('v1bar', 'v', [leaf('buy', 'V', 'buy'), leaf('it1', 'D', 'it')])]);
  const second = node('T2bar', 'T', [leaf('T2', 'T[past]', 'did', { lineageId: 'T' }),
    node('vP2', 'v', [leaf('mary', 'D', 'Mary'), node('v2bar', 'v', [leaf('sell', 'V', 'sell'), leaf('it2', 'D', 'it')])])]);
  const priorForest = [first, second];
  const currentForest = [node('T1bar', 'T', [leaf('T1', 'T[past]', 'did', { lineageId: 'T' }), structuredClone(first)]),
    structuredClone(second)];
  return { priorForest, currentForest, relation };
};
const recover = x => recoverMovementEvidence(x.relation, x.currentForest, x.priorForest);
const prepare = x => prepareReplay({ sentence: 'John did buy it Mary did sell it', includePlayback: true,
  derivationStages: [x.priorForest, x.currentForest].map((workspaceForest, i) => ({
    statement: 'Authored state', stageRecord: 'Authored account', workspaceForest, relations: i ? [x.relation] : [] })) });

const relations = [
  ['openly named source and landing', { relation: 'sideward-head-movement', anchors: { source: 'T2', landing: 'T1' } }],
  ['the curated sideward relation with an open copy role', { relation: 'sidewardMovement', anchors: { source: 'T2', copy: 'T1' } }]
];

for (const [name, relation] of relations) test(`a head copied sideward into another workspace is head movement: ${name}`, () => {
  const input = shape(relation), original = structuredClone(input);
  const movement = recover(input).movement;
  assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind, movement?.transition],
    ['T2', 'T1', 'head', true]);
  const replay = prepare(input), steps = replay.playbackSteps;
  const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
  assert(moment > 0);
  assert.deepEqual(steps[moment].movementDiagnostics ?? [], []);
  // The landing and the one new parent attaching it above the existing
  // workspace arrive together at the movement's own moment, never earlier.
  for (const step of steps.slice(0, moment))
    for (const id of ['T1', 'T1bar']) assert(!step.replayVisibleNodeIds.includes(id), `${id} before its moment`);
  for (const id of ['T1', 'T1bar', 'vP1']) assert(steps[moment].replayVisibleNodeIds.includes(id), `${id} at its moment`);
  assert.equal(find([steps[moment].replayCanvasData], 'T2')?.silent, undefined, 'the source keeps its pronunciation');
  const path = replay.relationRenderPlan.frames[1].items.find(item => item.kind === 'trajectory');
  assert.deepEqual([path?.sourceNodeId, path?.targetNodeId, path?.trajectoryKind], ['T2', 'T1', 'sideward']);
  assert.deepEqual(input, original);
});

test('a sideward head reading keeps the refusals for malformed or unrelated claims', () => {
  for (const [name, mutate] of [
    ['unrelated lineage', x => { find(x.currentForest, 'T1').lineageId = 'other'; }],
    ['missing landing lineage', x => { delete find(x.currentForest, 'T1').lineageId; }],
    ['complement that was not a separate workspace', x => {
      x.priorForest = [node('outer', 'C', [x.priorForest[0], leaf('c', 'C', 'that')]), x.priorForest[1]];
      x.currentForest[0] = node('outer', 'C', [x.currentForest[0], leaf('c', 'C', 'that')]);
    }],
    ['changed complement', x => { find(x.currentForest, 'buy').word = 'bought'; }],
    ['source that left its slot', x => { find(x.currentForest, 'T2bar').children.reverse(); }],
    ['another occurrence of the head in the landing workspace', x => {
      for (const forest of [x.priorForest, x.currentForest])
        find(forest, 'v1bar').children.unshift(leaf('T0', 'T[past]', 'did', { lineageId: 'T', silent: true }));
    }],
    ['duplicated landing', x => { x.currentForest.push(leaf('T1', 'T[past]', 'did', { lineageId: 'T' })); }]
  ]) {
    const input = shape(); mutate(input);
    assert.notEqual(recover(input).movement?.trajectoryKind, 'head', name);
  }
});

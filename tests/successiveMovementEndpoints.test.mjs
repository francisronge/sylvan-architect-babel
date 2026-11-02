import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { resolveDisplayedTrajectoryAttachments } from '../replay/relations/renderPlan.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/holdout-transitions.json', import.meta.url)))
  .find(c => c.id === 'successive-trace');
const stages = () => structuredClone([saved.precedingStage, ...saved.derivationStages]);
const index = forest => {
  const nodes = new Map();
  const visit = n => { nodes.set(n.id, n); (n.children ?? []).forEach(visit); };
  forest.forEach(visit); return nodes;
};
const arrows = (plan, stage) => plan.frames[stage].items.filter(i => i.kind === 'trajectory');
const endpoints = items => items.map(i => [i.sourceNodeId, i.targetNodeId]);

for (const rename of [false, true]) test(`successive movement retains the intermediate landing${rename ? ' with renamed IDs' : ''}`, () => {
  const input = stages();
  const id = value => rename ? `renamed-${value}` : value;
  if (rename) for (const stage of input) {
    for (const node of index(stage.workspaceForest).values()) {
      node.id = id(node.id);
      if (node.lineageId) node.lineageId = id(node.lineageId);
    }
    for (const relation of stage.relations) for (const field of ['anchors', 'priorAnchors']) {
      for (const [key, value] of Object.entries(relation[field] ?? {}))
        relation[field][key] = Array.isArray(value) ? value.map(id) : id(value);
    }
  }
  const original = structuredClone(input), plan = compileRelationRenderPlan(input);
  assert.deepEqual(endpoints(arrows(plan, 1)), [[id('tObject'), id('wh')]]);
  const [earlier, later] = arrows(plan, 2);
  assert.deepEqual(endpoints([earlier, later]), [[id('tObject'), id('tEdge')], [id('tEdge'), id('wh')]]);
  const at = played => resolveDisplayedTrajectoryAttachments(earlier,
    nodeId => index(input[2].workspaceForest).get(nodeId), { stageIndex: 2, playedRelationIndices: played });
  assert.equal(at(new Set()).targetNodeId, id('wh'), 'before the second hop, the first arrow still reaches the phrase');
  assert.equal(at(new Set([0])).targetNodeId, id('tEdge'), 'the endpoint transfers at the second movement moment');
  assert.equal(at(null).targetNodeId, id('tEdge'), 'the completed stage preserves the intermediate landing');
  assert.equal(at(new Set()).targetNodeId, id('wh'), 'rewind restores the preceding endpoint');
  assert.equal(earlier.relationRef.anchors.movedPhrase, id('wh'), 'authored evidence remains unchanged');
  assert.deepEqual(input, original);
});

test('an earlier landing does not transfer without one unambiguous later movement', () => {
  for (const mutate of [
    s => { s[2].relations.splice(0, 3); },
    s => { s[2].relations[0].priorAnchors.sourcePhrase = 'unresolved'; }
  ]) {
    const input = stages(); mutate(input);
    const earlier = arrows(compileRelationRenderPlan(input), 2).find(i => i.relationRef.stageIndex === 1);
    assert.equal(earlier.targetNodeId, 'wh');
    assert.equal(earlier.occurrenceTransfers, undefined);
  }
});

test('without a worded movement, a chain inventory listing the hop and the older trace is the later movement', () => {
  // Structure proves the hop from tEdge to wh. The inventory's list names it
  // beside the older, unchanged trace tObject, which wording read as identity alone.
  const input = stages();
  input[2].relations.shift();
  const [earlier, later] = arrows(compileRelationRenderPlan(input), 2);
  assert.deepEqual(endpoints([earlier, later]), [['tObject', 'tEdge'], ['tEdge', 'wh']]);
  assert.equal(later.relationRef.relation, 'A′-chain');
  assert.deepEqual(earlier.occurrenceTransfers, [{ fromNodeId: 'wh', toNodeId: 'tEdge', stageIndex: 2, relationIndex: 0 }]);
});

test('without a worded movement, a claim naming the hop\'s landing, its new trace and the older trace in separate fields is the later movement', () => {
  // Wording coindexes the two traces and leaves the landing's field neutral;
  // structure reads the claim as naming the hop at both ends, as it reads a
  // topicalization naming topic, new trace and θ-position copy.
  const input = stages();
  input[2].relations.splice(0, 2);
  const [earlier, later] = arrows(compileRelationRenderPlan(input), 2);
  assert.deepEqual(endpoints([earlier, later]), [['tObject', 'tEdge'], ['tEdge', 'wh']]);
  assert.equal(later.relationRef.relation, 'proper government of wh-traces');
  assert.deepEqual(earlier.occurrenceTransfers, [{ fromNodeId: 'wh', toNodeId: 'tEdge', stageIndex: 2, relationIndex: 0 }]);
});

test('a restated later movement is one transfer, owned by its first claim', () => {
  const input = stages();
  input[2].relations.push(structuredClone(input[2].relations[0]));
  const earlier = arrows(compileRelationRenderPlan(input), 2).find(i => i.relationRef.stageIndex === 1);
  assert.equal(earlier.targetNodeId, 'tEdge');
  assert.deepEqual(earlier.occurrenceTransfers, [{ fromNodeId: 'wh', toNodeId: 'tEdge', stageIndex: 2, relationIndex: 0 }]);
});

test('a third hop keeps both preceding landings and does not move identity marks onto a trace', () => {
  const input = stages(), last = structuredClone(input.at(-1));
  const phrase = last.workspaceForest[0].children.shift();
  last.workspaceForest[0].children.unshift({ id: 'tHigher', label: 'NP: A′-trace', lineageId: 'portraitChain', silent: true });
  last.workspaceForest = [{ id: 'outer', label: 'CP', children: [phrase, ...last.workspaceForest] }];
  last.relations = [{ relation: 'Further displacement', anchors: { source: 'tHigher', landing: 'wh' }, priorAnchors: { source: 'wh' } }];
  input.push(last);
  const plan = compileRelationRenderPlan(input);
  assert.deepEqual(endpoints(arrows(plan, 3)), [['tObject', 'tEdge'], ['tEdge', 'tHigher'], ['tHigher', 'wh']]);
  const coindices = plan.frames[3].items.filter(i => i.kind === 'coindex' && i.nodeIds.includes('wh'));
  assert(coindices.length > 0, 'identity marks keep referring to the moving phrase');
  const nodes = index(last.workspaceForest);
  assert.deepEqual(endpoints(arrows(plan, 3).slice(0, 2).map(i => resolveDisplayedTrajectoryAttachments(i,
    id => nodes.get(id), { stageIndex: 3, playedRelationIndices: new Set() }))), [['tObject', 'tEdge'], ['tEdge', 'wh']]);
});

test('a later description of the first hop still shares its arrow after another movement', () => {
  const input = stages(), description = structuredClone(input[1]);
  description.relations = [{ relation: 'A-chain', anchors: { foot: 'tObject', head: 'wh' } }];
  input.splice(2, 0, description);
  const plan = compileRelationRenderPlan(input);
  assert.deepEqual(endpoints(arrows(plan, 2)), [['tObject', 'wh']]);
  assert.deepEqual(endpoints(arrows(plan, 3)), [['tObject', 'tEdge'], ['tEdge', 'wh']]);
  assert(arrows(plan, 3)[0].coalescedRefs.some(ref => ref.stageIndex === 2), 'both claims retain ownership of their shared arrow');
});

const successiveUnfamiliarRoles = () => {
  const mover = { id: 'mover', label: 'NP', lineageId: 'chain', children: [{ id: 'name', label: 'N', word: 'Mia' }] };
  const oldCopy = { id: 'old-copy', label: 'NP', lineageId: 'chain', silent: true };
  const lowerDomain = { id: 'predicate', label: 'VP', children: [oldCopy, { id: 'verb', label: 'V', word: 'left' }] };
  const before = [{ id: 'clause', label: 'IP', children: [mover, lowerDomain] }];
  const after = [{ id: 'root', label: 'CP', children: [structuredClone(mover),
    { id: 'clause', label: 'IP', children: [{ id: 'new-copy', label: 'NP', lineageId: 'chain', silent: true }, structuredClone(lowerDomain)] }
  ] }];
  const relation = { relation: 'Further dependency',
    anchors: { previousPosition: 'new-copy', earlierPosition: 'old-copy', currentPosition: 'mover', enclosingPosition: 'root' },
    priorAnchors: { sourceOccurrence: 'mover' } };
  return { before, after, relation };
};

test('an unchanged older copy cannot compete with the witnessed landing under unfamiliar role names', () => {
  for (const renamed of [false, true]) {
    const input = successiveUnfamiliarRoles();
    if (renamed) {
      for (const forest of [input.before, input.after]) for (const node of index(forest).values()) {
        node.id = `other-${node.id}`;
        if (node.lineageId) node.lineageId = `other-${node.lineageId}`;
      }
      for (const field of ['anchors', 'priorAnchors']) for (const key of Object.keys(input.relation[field]))
        input.relation[field][key] = `other-${input.relation[field][key]}`;
    }
    const original = structuredClone(input);
    const result = recoverMovementEvidence(input.relation, input.after, input.before);
    const prefix = renamed ? 'other-' : '';
    assert.deepEqual([result.movement?.priorSourceNodeId, result.movement?.sourceNodeId, result.movement?.targetNodeId,
      result.movement?.witnessNodeId, result.movement?.trajectoryKind, result.movement?.transition],
    ['mover', 'new-copy', 'mover', 'new-copy'].map(id => prefix + id).concat(['phrasal', true]));
    assert(!Object.hasOwn(result.movement.roles, 'earlier position'), 'the earlier copy is not consumed as this movement');
    const items = compileRelationRenderPlan([
      { statement: '', stageRecord: '', workspaceForest: input.before, relations: [] },
      { statement: '', stageRecord: '', workspaceForest: input.after, relations: [input.relation] }
    ]).frames[1].items;
    assert.deepEqual(items.filter(item => item.kind === 'trajectory').map(item => [item.sourceNodeId, item.targetNodeId]),
      [[`${prefix}new-copy`, `${prefix}mover`]]);
    assert.deepEqual(input, original);
  }
});

test('changed or relocated older copies remain competing landing evidence', () => {
  for (const mutate of [
    input => { index(input.after).get('old-copy').word = 'another occurrence'; },
    input => {
      const predicate = index(input.after).get('predicate');
      const oldCopy = predicate.children.shift();
      input.after.push({ id: 'different-root', label: 'CP', children: [oldCopy, { id: 'different-bar', label: 'C′', children: [{ id: 'different-head', label: 'C' }] }] });
    },
    input => { input.relation.anchors.anotherCandidate = 'alternative'; input.after.push({ id: 'alternative', label: 'NP', lineageId: 'chain' }); },
    input => { input.relation.priorAnchors = {}; },
    input => { input.relation.priorAnchors.sourceOccurrence = ['mover', 'mover']; }
  ]) {
    const input = successiveUnfamiliarRoles(); mutate(input);
    assert.equal(recoverMovementEvidence(input.relation, input.after, input.before).movement, undefined);
  }
});

test('generic plural participants do not turn concord into malformed movement', () => {
  const forest = [{ id: 'noun', label: 'N' }, { id: 'determiner', label: 'D' }, { id: 'adjective', label: 'A' }];
  const relation = { relation: 'Nominal concord', anchors: { controller: 'noun', targets: ['determiner', 'adjective'] }, values: { features: 'singular' } };
  assert.deepEqual(recoverMovementEvidence(relation, forest), { diagnostics: [] });
  const declared = { ...relation, relation: 'AbarMove', anchors: { source: 'noun', targets: ['determiner', 'adjective'] } };
  assert.equal(recoverMovementEvidence(declared, forest).failure, 'MOVEMENT_ENDPOINTS_UNRESOLVED');
});

test('an older chain foot is not the witness of a uniquely proved successive move', () => {
  for (const renamed of [false, true]) {
    const input = successiveUnfamiliarRoles();
    input.relation.anchors = { intermediateTrace: 'new-copy', objectTrace: 'old-copy', matrixOperator: 'mover', landingClause: 'root' };
    if (renamed) {
      for (const forest of [input.before, input.after]) for (const node of index(forest).values()) {
        node.id = `renamed-${node.id}`;
        if (node.lineageId) node.lineageId = `renamed-${node.lineageId}`;
      }
      for (const field of ['anchors', 'priorAnchors']) for (const key of Object.keys(input.relation[field]))
        input.relation[field][key] = `renamed-${input.relation[field][key]}`;
    }
    const original = structuredClone(input), prefix = renamed ? 'renamed-' : '';
    const result = recoverMovementEvidence(input.relation, input.after, input.before);
    assert.deepEqual([result.movement?.priorSourceNodeId, result.movement?.sourceNodeId,
      result.movement?.targetNodeId, result.movement?.witnessNodeId],
    ['mover', 'new-copy', 'mover', 'new-copy'].map(id => prefix + id));
    assert(!Object.hasOwn(result.movement.roles, 'object trace'), 'the older foot remains separate authored evidence');
    assert.deepEqual(input, original);
  }
});

test('a cited older foot requires unchanged syntax, identity, and position', () => {
  for (const mutate of [
    input => { index(input.after).get('old-copy').word = 'changed'; },
    input => { input.after.push(index(input.after).get('predicate').children.shift()); },
    input => { input.after.push(structuredClone(index(input.after).get('old-copy'))); },
    input => { index(input.after).get('old-copy').lineageId = 'different-chain'; },
    input => { input.relation.anchors.objectTrace = ['old-copy', 'old-copy']; },
    input => { delete input.relation.anchors.intermediateTrace; },
    input => { input.relation.priorAnchors.sourceOccurrence = ['mover', 'mover']; }
  ]) {
    const input = successiveUnfamiliarRoles();
    input.relation.anchors = { intermediateTrace: 'new-copy', objectTrace: 'old-copy', matrixOperator: 'mover', landingClause: 'root' };
    mutate(input);
    assert.equal(recoverMovementEvidence(input.relation, input.after, input.before).movement, undefined);
  }
});

test('the earlier arrow transfers at the new hop even when that claim also cites the chain foot', () => {
  const input = stages();
  input[2].relations[0].anchors = {
    intermediateTrace: 'tEdge', objectTrace: 'tObject', matrixOperator: 'wh', landingClause: 'mCP'
  };
  const original = structuredClone(input), plan = compileRelationRenderPlan(input);
  const [earlier, later] = arrows(plan, 2), nodes = index(input[2].workspaceForest);
  assert.deepEqual(endpoints([earlier, later]), [['tObject', 'tEdge'], ['tEdge', 'wh']]);
  const at = played => resolveDisplayedTrajectoryAttachments(earlier,
    id => nodes.get(id), { stageIndex: 2, playedRelationIndices: played });
  assert.equal(at(new Set()).targetNodeId, 'wh');
  assert.equal(at(new Set([0])).targetNodeId, 'tEdge');
  assert.equal(at(null).targetNodeId, 'tEdge');
  assert.equal(at(new Set()).targetNodeId, 'wh', 'rewind restores the earlier landing');
  assert.deepEqual(input, original);
});


test('a cited older foot of the same lineage does not compete with the step\'s new lower trace', () => {
  const input = successiveUnfamiliarRoles(), original = structuredClone(input);
  input.relation.anchors = { landing: 'mover', sourceTrace: 'new-copy', lowerTrace: 'old-copy' };
  input.relation.priorAnchors = { source: 'mover' };
  const result = recoverMovementEvidence(input.relation, input.after, input.before);
  assert.deepEqual([result.movement?.priorSourceNodeId, result.movement?.sourceNodeId, result.movement?.targetNodeId,
    result.movement?.witnessNodeId], ['mover', 'new-copy', 'mover', 'new-copy']);
  assert.deepEqual(input.before, original.before);
  index(input.after).get('old-copy').lineageId = 'other-chain';
  assert.equal(recoverMovementEvidence(input.relation, input.after, input.before).failure, 'MOVEMENT_ENDPOINTS_UNRESOLVED',
    'a trace of another lineage still competes');
});

// GPT-6.1 Sol's second analysis of sol-120-20261026 n4-04 (stage 3) names the
// clauses beside the hop and both traces under open names.
test('an unchanged older copy does not compete beside the clauses a hop leaves and lands in', () => {
  const input = successiveUnfamiliarRoles();
  input.relation = { relation: 'A-movement',
    anchors: { movedNominal: 'mover', newTrace: 'new-copy', earlierTrace: 'old-copy', landingClause: 'root', sourceClause: 'clause' },
    priorAnchors: { movedNominal: 'mover', sourceClause: 'clause' } };
  const original = structuredClone(input);
  const result = recoverMovementEvidence(input.relation, input.after, input.before);
  assert.deepEqual([result.movement?.priorSourceNodeId, result.movement?.sourceNodeId, result.movement?.targetNodeId,
    result.movement?.witnessNodeId], ['mover', 'new-copy', 'mover', 'new-copy']);
  const items = compileRelationRenderPlan([
    { statement: '', stageRecord: '', workspaceForest: input.before, relations: [] },
    { statement: '', stageRecord: '', workspaceForest: input.after, relations: [input.relation] }
  ]).frames[1].items;
  assert.deepEqual(items.filter(item => item.kind === 'trajectory').map(item => [item.claimTier, item.sourceNodeId, item.targetNodeId]),
    [[1, 'new-copy', 'mover']]);
  assert.deepEqual(input, original);
  // A changed older copy is not chain context and still competes.
  index(input.after).get('old-copy').word = 'another occurrence';
  assert.equal(recoverMovementEvidence(input.relation, input.after, input.before).movement, undefined);
});

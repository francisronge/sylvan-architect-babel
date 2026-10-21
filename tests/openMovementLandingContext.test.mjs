import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

const record = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/open-landing-head-context.json', import.meta.url)));
const nodes = node => [node, ...(node.children ?? []).flatMap(nodes)];
const find = (forest, id) => forest.flatMap(nodes).find(node => node.id === id);
const example = () => {
  const copy = structuredClone(record);
  return { ...copy, priorForest: copy.derivationStages[2].workspaceForest,
    currentForest: copy.derivationStages[3].workspaceForest,
    relation: copy.derivationStages[3].relations[0], stageIndex: 3, relationIndex: 0 };
};
const recover = input => recoverMovementEvidence(input.relation, input.currentForest, input.priorForest);

test('an exact phrase pair distinguishes an open landing field from a retained head', () => {
  const input = example(), original = structuredClone(input);
  const movement = recover(input).movement;
  assert.deepEqual([movement?.priorSourceNodeId, movement?.sourceNodeId, movement?.targetNodeId,
    movement?.witnessNodeId, movement?.trajectoryKind],
  ['a2-object-low', 'a2-object-low', 'a2-object-high', 'a2-object-low', 'phrasal']);
  assert.deepEqual(movement.context, [{ key: 'landingClause', nodeId: 'a2-cp', kind: 'site' }]);
  const dispatch = dispatchRelationClaims(input);
  assert.ok(dispatch.facets.some(facet => facet.recipe.id === 'movement.path'));
  for (const key of ['raisedVerbalHead', 'verbalGovernor']) {
    const field = dispatch.evidenceCoverage.fields.find(field => field.field === 'anchors' && field.key === key);
    assert.deepEqual(field.recognizedBy, []);
    assert.ok(dispatch.claims.some(claim => claim.tier === 3 && claim.consumedEvidence.some(field =>
      field.field === 'anchors' && field.key === key)));
  }
  assert.deepEqual(input, original);
});

test('the exact pair is independent of participant names, relation text and pronunciation', () => {
  const input = example();
  const rename = id => `opaque-${id}`;
  for (const forest of [input.priorForest, input.currentForest]) for (const node of forest.flatMap(nodes)) {
    node.id = rename(node.id);
    if (node.lineageId) node.lineageId = rename(node.lineageId);
    delete node.word;
    delete node.silent;
  }
  input.relation.relation = 'An independently authored association';
  input.relation.anchors = { participant: rename('a2-object-high'), upperClauseHead: rename('a2-verb-high'),
    landingSite: rename('a2-cp'), lowerOccurrence: rename('a2-object-low') };
  input.relation.priorAnchors = { sourceOccurrence: rename('a2-object-low') };
  const movement = recover(input).movement;
  assert.equal(movement?.sourceNodeId, rename('a2-object-low'));
  assert.equal(movement?.targetNodeId, rename('a2-object-high'));
  assert.equal(movement?.trajectoryKind, 'phrasal');
});

test('the source, lower replacement and attaching parent change only at the owning moment', () => {
  const input = example();
  input.derivationStages[3].relations.unshift({ relation: 'Independent inspection', anchors: { participant: 'a2-verb-high' } });
  const replay = prepareReplay({ ...input, includePlayback: true });
  const index = replay.playbackSteps.findIndex(step => step.replayRelationIdentity?.stageIndex === 3
    && step.replayRelationIdentity.relationIndex === 1);
  assert.ok(index > 0);
  for (const step of replay.playbackSteps.slice(0, index).filter(step => step.replayFrameIndex === 3)) {
    assert.deepEqual(find([step.replayCanvasData], 'a2-object-low')?.children?.map(node => node.id), ['a2-object-nbar']);
    assert.ok(!step.replayVisibleNodeIds.includes('a2-object-high'));
    assert.ok(!step.replayVisibleNodeIds.includes('a2-cp'));
  }
  const moment = replay.playbackSteps[index];
  assert.ok(moment.replayVisibleNodeIds.includes('a2-object-high'));
  assert.ok(moment.replayVisibleNodeIds.includes('a2-cp'));
  assert.equal(find([moment.replayCanvasData], 'a2-object-low').silent, true);
  assert.equal(moment.replayRelationLinks.filter(link => link.authoredRelationKey === '3:1'
    && link.sourceNodeId === 'a2-object-low' && link.targetNodeId === 'a2-object-high').length, 1);
});

for (const [name, mutate] of [
  ['a changed contextual head', input => { find(input.currentForest, 'a2-verb-high').word = 'other'; }],
  ['a head outside the landing domain', input => {
    for (const forest of [input.priorForest, input.currentForest]) forest.push({ id: 'unrelated', label: 'XP',
      children: [{ id: 'other-head', label: 'T' }] });
    input.relation.anchors.raisedVerbalHead = 'other-head';
  }],
  ['a reparented contextual head', input => {
    const complex = find(input.currentForest, 'a2-complex-i');
    input.currentForest.push(complex.children.shift());
  }],
  ['a branching contextual head', input => { for (const forest of [input.priorForest, input.currentForest])
    find(forest, 'a2-verb-high').children = [{ id: 'head-member', label: 'V' }]; }],
  ['a duplicate contextual head', input => { input.currentForest.push(structuredClone(find(input.currentForest, 'a2-verb-high'))); }],
  ['a second real landing', input => {
    const other = { ...structuredClone(find(input.currentForest, 'a2-object-high')), id: 'other-landing', children: [] };
    input.currentForest.push(other); input.relation.anchors.raisedPhrase = other.id;
  }],
  ['a contradictory phrase claim on the head', input => { input.relation.anchors.movedPhrase = 'a2-verb-high'; }],
  ['a conflicting explicit current source', input => { input.relation.anchors.sourceOccurrence = 'a2-verb-low'; }],
  ['a conflicting explicit prior source', input => { input.relation.priorAnchors.sourceOccurrence = 'a2-verb-high'; }],
  ['an unrelated lower slot', input => { find(input.currentForest, 'a2-vbar').children.reverse(); }],
  ['a changed landing lineage', input => { find(input.currentForest, 'a2-object-high').lineageId = 'other'; }],
  ['an out-of-source witness', input => { input.relation.anchors.trace = 'a2-verb-low'; }]
]) test(`open landing recovery preserves refusal for ${name}`, () => {
  const input = example(); mutate(input);
  assert.equal(recover(input).movement, undefined);
  assert.ok(!dispatchRelationClaims(input).facets.some(facet => facet.recipe.id === 'movement.path'));
});

test('a malformed exact Tier-1 signature remains neutral', () => {
  const input = example(); input.relation.relation = 'AbarMove';
  const dispatch = dispatchRelationClaims(input);
  assert.equal(dispatch.primaryClaim.tier, 3);
  assert.equal(dispatch.primaryClaim.reason, 'registered-signature-incomplete');
  assert.ok(!dispatch.facets.some(facet => facet.recipe.id === 'movement.path'));
});

test('an unchanged pair never owns another movement transition', () => {
  const input = example();
  assert.equal(recoverMovementEvidence(input.relation, input.currentForest, input.currentForest).movement?.transition ?? false, false);
});

test('ordinary clause projection does not turn a retained object into movement', () => {
  const input = example();
  input.currentForest[0].children.shift();
  find(input.currentForest, 'a2-vbar').children[1] = structuredClone(find(input.priorForest, 'a2-object-low'));
  input.relation = { relation: 'Clause interpretation', anchors: {
    clause: 'a2-cp', predicate: 'a2-verb-high', participant: 'a2-object-low'
  } };
  assert.deepEqual(recover(input), { diagnostics: [] });
  assert.ok(!dispatchRelationClaims(input).facets.some(facet => facet.recipe.id === 'movement.path'));
});

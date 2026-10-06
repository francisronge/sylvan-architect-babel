import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

const nodes = node => [node, ...(node.children ?? []).flatMap(nodes)];
const find = (forest, id) => forest.flatMap(nodes).find(node => node.id === id);
const parent = (forest, id) => forest.flatMap(nodes).find(node => node.children?.some(child => child.id === id));
const stage = (workspaceForest, relations = []) => ({ statement: 'Authored state', stageRecord: 'Authored account', workspaceForest, relations });
const example = () => {
  const object = { id: 'foot', label: 'K', lineageId: 'object-chain', children: [
    { id: 'nominal', label: 'N', children: [{ id: 'noun', label: 'N', word: 'book' }] },
    { id: 'case', label: 'K', word: 'acc' }
  ] };
  const priorForest = [{ id: 'clause', label: 'T', children: [
    { id: 'base', label: 'V', children: [object, { id: 'verb', label: 'V', word: 'read' }] },
    { id: 'head', label: 'T[past]', word: 'past' }
  ] }];
  const currentBase = structuredClone(priorForest[0]);
  currentBase.children[0].children[0] = { id: 'foot', label: 'K[trace]', lineageId: 'object-chain', silent: true };
  const landing = { ...structuredClone(object), id: 'upper' };
  return { priorForest, currentForest: [{ id: 'outer', label: 'T', children: [landing, currentBase] }],
    stageIndex: 1, relationIndex: 0, relation: { relation: 'An authored dependency',
      anchors: { upperOccurrence: 'upper', lowerTrace: 'foot', targetHead: 'head' },
      priorAnchors: { sourceOccurrence: 'foot' } } };
};
const recover = input => recoverMovementEvidence(input.relation, input.currentForest, input.priorForest);
const prepare = (input, relations = [input.relation]) => prepareReplay({ sentence: 'book acc read past', includePlayback: true,
  derivationStages: [stage(input.priorForest), stage(input.currentForest, relations)] });
const hasTrajectory = input => prepare(input).relationRenderPlan.frames.at(-1).items.some(item => item.kind === 'trajectory');

for (const [role, label] of [['targetHead', 'T[past]'], ['targetFiniteHead', 'I[finite]'], ['movementTargetClauseHead', 'C'], ['target', 'T[past]']]) {
  test(`a stationary ${role} does not compete with the proven phrase landing`, () => {
    const input = example();
    input.relation.anchors[role] = 'head';
    if (role !== 'targetHead') delete input.relation.anchors.targetHead;
    find(input.priorForest, 'head').label = label;
    find(input.currentForest, 'head').label = label;
    const original = structuredClone(input);
    const movement = recover(input).movement;
    assert.deepEqual([movement?.priorSourceNodeId, movement?.sourceNodeId, movement?.targetNodeId,
      movement?.trajectoryKind, movement?.transition], ['foot', 'foot', 'upper', 'phrasal', true]);
    assert.equal(movement.context, undefined);
    assert.equal(movement.roles[role], undefined);
    const dispatch = dispatchRelationClaims(input);
    const field = dispatch.evidenceCoverage.fields.find(field => field.field === 'anchors' && field.key === role);
    assert.deepEqual(field.recognizedBy, []);
    assert.ok(dispatch.facets.some(facet => facet.recipe.id === 'movement.path'));
    assert.ok(dispatch.claims.some(claim => claim.tier === 3 && claim.consumedEvidence.some(field => field.field === 'anchors' && field.key === role)));
    assert.ok(hasTrajectory(input));
    assert.deepEqual(input, original);
  });
}

test('renamed IDs and arbitrary wording retain phrasal movement and neutral head context', () => {
  const input = example();
  const rename = id => `opaque-${id}`;
  for (const forest of [input.priorForest, input.currentForest]) for (const node of forest.flatMap(nodes)) {
    node.id = rename(node.id);
    if (node.lineageId) node.lineageId = rename(node.lineageId);
  }
  for (const field of ['anchors', 'priorAnchors']) input.relation[field] = Object.fromEntries(
    Object.entries(input.relation[field]).reverse().map(([key, value]) => [key, rename(value)]));
  input.relation.relation = 'An independently named association';
  assert.equal(recover(input).movement?.targetNodeId, 'opaque-upper');
  assert.ok(hasTrajectory(input));
});

test('phrase, trace, attaching parent and trajectory become visible in the movement moment', () => {
  const input = example();
  const steps = prepare(input, [{ relation: 'Head inspection', anchors: { participant: 'head' } }, input.relation]).playbackSteps;
  const index = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 1);
  assert.ok(index > 0);
  for (const step of steps.slice(0, index).filter(step => step.replayFrameIndex === 1)) {
    assert.equal(parent([step.replayCanvasData], 'foot')?.id, 'base');
    assert.ok(find([step.replayCanvasData], 'foot').children?.length);
    assert.ok(!step.replayVisibleNodeIds.includes('upper'));
    assert.ok(!step.replayVisibleNodeIds.includes('outer'));
  }
  const moment = steps[index];
  assert.ok(moment.replayVisibleNodeIds.includes('upper'));
  assert.ok(moment.replayVisibleNodeIds.includes('outer'));
  assert.equal(find([moment.replayCanvasData], 'foot').silent, true);
  assert.equal(parent([moment.replayCanvasData], 'upper')?.id, 'outer');
  assert.ok(moment.replayRelationLinks.some(link => link.authoredRelationKey === '1:1'
    && link.trajectoryKind === 'phrasal' && link.sourceNodeId === 'foot' && link.targetNodeId === 'upper'));
  assert.ok(!steps.some(step => step.replayKind === 'micro' && step.targetNodeId === 'outer'));
});

for (const [name, mutate] of [
  ['missing head', input => { input.relation.anchors.targetHead = 'missing'; }],
  ['duplicate head', input => { input.currentForest.push(structuredClone(find(input.currentForest, 'head'))); }],
  ['new head', input => { find(input.priorForest, 'head').id = 'prior-head'; }],
  ['changed head', input => { find(input.currentForest, 'head').word = 'other'; }],
  ['reparented head', input => {
    const head = find(input.currentForest, 'head');
    find(input.currentForest, 'clause').children.pop();
    input.currentForest[0].children.push(head);
  }],
  ['branching bare head label', input => {
    for (const forest of [input.priorForest, input.currentForest]) find(forest, 'head').children = [{ id: 'h-child', label: 'N', word: 'noun' }];
  }],
  ['phrase label on head participant', input => { for (const forest of [input.priorForest, input.currentForest]) find(forest, 'head').label = 'TP'; }],
  ['head in moving lineage', input => { for (const forest of [input.priorForest, input.currentForest]) find(forest, 'head').lineageId = 'object-chain'; }],
  ['missing upper lineage', input => { delete find(input.currentForest, 'upper').lineageId; }],
  ['conflicting prior source', input => { input.relation.priorAnchors.sourceOccurrence = 'head'; }],
  ['ambiguous prior source', input => { input.priorForest.push(structuredClone(find(input.priorForest, 'foot'))); }],
  ['wrong prior trace slot', input => { find(input.currentForest, 'base').children.reverse(); }],
  ['repeated head anchor array', input => { input.relation.anchors.targetHead = ['head', 'head']; }],
  ['contradictory occurrence role on head participant', input => { input.relation.anchors.movedPhrase = 'head'; }],
  ['two actual landing occurrences', input => {
    input.currentForest[0].children.push({ ...structuredClone(find(input.currentForest, 'upper')), id: 'competing' });
    input.relation.anchors.raisedPhrase = 'competing';
  }]
]) {
  test(`head context cannot bypass movement evidence: ${name}`, () => {
    const input = example(); mutate(input);
    assert.equal(recover(input).movement, undefined);
    assert.equal(hasTrajectory(input), false);
  });
}

test('a second target head remains ambiguous for head movement', () => {
  const context = { id: 'context', label: 'CP', children: [{ id: 'head', label: 'C' }] };
  const input = {
    priorForest: [{ id: 'root', label: 'XP', children: [
      { id: 'base', label: 'VP', children: [{ id: 'foot', label: 'V', lineageId: 'head-chain', word: 'read' }] }, context
    ] }],
    currentForest: [{ id: 'root', label: 'XP', children: [
      { id: 'complex', label: 'T', children: [{ id: 'upper', label: 'V', lineageId: 'head-chain', word: 'read' }, { id: 'host', label: 'T' }] },
      { id: 'base', label: 'VP', children: [{ id: 'foot', label: 'V[trace]', lineageId: 'head-chain', silent: true }] }, context
    ] }],
    relation: { relation: 'An authored dependency', anchors: { raisedHead: 'upper', trace: 'foot' }, priorAnchors: { sourceHead: 'foot' } }
  };
  assert.equal(recover(input).movement?.trajectoryKind, 'head');
  input.relation.anchors.targetHead = 'head';
  assert.equal(recover(input).movement, undefined);
});

test('head context recovery cannot repair an incomplete exact Tier-1 signature', () => {
  const input = example();
  input.relation.relation = 'AbarMove';
  input.relation.anchors.target = ['upper', 'head'];
  const dispatch = dispatchRelationClaims(input);
  assert.equal(dispatch.primaryClaim.tier, 3);
  assert.equal(dispatch.primaryClaim.reason, 'registered-signature-incomplete');
  assert.ok(!dispatch.facets.some(facet => facet.recipe.id === 'movement.path'));
  assert.equal(hasTrajectory(input), false);
});

test('an explicit landing and one exact prior occurrence recover open source wording', () => {
  const input = example();
  input.relation = { relation: 'An independently named dependency',
    anchors: { landing: 'upper', departureTrace: 'foot' }, priorAnchors: { movingPhrase: 'foot' } };
  assert.deepEqual(recover(input).movement?.priorAnchorKeys, ['movingPhrase']);
  assert.equal(recover(input).movement?.sourceNodeId, 'foot');
  assert.ok(hasTrajectory(input));
});

for (const [name, mutate] of [
  ['no authored landing direction', input => { input.relation.anchors.participant = 'upper'; delete input.relation.anchors.landing; }],
  ['prior occurrence is not in the lower slot', input => { find(input.currentForest, 'base').children.reverse(); }],
  ['two possible prior occurrences', input => {
    const older = { id: 'older', label: 'KP', lineageId: 'object-chain', silent: true };
    for (const forest of [input.priorForest, input.currentForest]) find(forest, 'base').children.push(structuredClone(older));
    input.relation.anchors.olderCopy = 'older';
    input.relation.priorAnchors.movingPhrase = ['foot', 'older'];
  }]
]) test(`open source wording still needs unambiguous movement proof: ${name}`, () => {
  const input = example();
  input.relation = { relation: 'An independently named dependency',
    anchors: { landing: 'upper', departureTrace: 'foot' }, priorAnchors: { movingPhrase: 'foot' } };
  mutate(input);
  assert.equal(recover(input).movement, undefined);
  assert.equal(hasTrajectory(input), false);
});

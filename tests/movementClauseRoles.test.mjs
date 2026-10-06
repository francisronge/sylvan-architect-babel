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
  const clause = { id: 'clause', label: 'CP', lineageId: 'clause-chain', children: [
    { id: 'c', label: 'C', word: 'that' },
    { id: 'ip', label: 'IP', children: [{ id: 'v', label: 'V', word: 'rained' }] }
  ] };
  const verb = { id: 'predicate', label: 'V', word: 'believes' };
  const priorForest = [{ id: 'base', label: 'VP', children: [clause, verb] }];
  const currentForest = [{ id: 'landing', label: 'IP', children: [
    { id: 'base', label: 'VP', children: [
      { id: 'lower', label: 'CP trace', lineageId: 'clause-chain', silent: true }, verb
    ] }, clause
  ] }];
  return { priorForest, currentForest, stageIndex: 1, relationIndex: 0,
    relation: { relation: 'An authored dependency',
      anchors: { movedClause: 'clause', argumentTrace: 'lower', licensingPredicate: 'predicate', landingDomain: 'landing' },
      priorAnchors: { sourceClause: 'clause' },
      values: { movementType: 'rightward A-bar movement' } } };
};
const recover = input => recoverMovementEvidence(input.relation, input.currentForest, input.priorForest);
const prepare = (input, relations = [input.relation]) => prepareReplay({ sentence: 'believes that rained', includePlayback: true,
  derivationStages: [stage(input.priorForest), stage(input.currentForest, relations)] });
const hasTrajectory = input => prepare(input).relationRenderPlan.frames.at(-1).items.some(item => item.kind === 'trajectory');

for (const [landingRole, priorRole] of [
  ['movedClause', 'sourceClause'],
  ['raisedEmbeddedClause', 'sourceEmbeddedClause'],
  ['higher_clause', 'prior_source_clause'],
  ['movementTargetClause', 'movementSourceClause'],
  ['movedClauses', 'sourceClauses']
]) {
  test(`qualified clause roles recover an exact phrasal path: ${landingRole}/${priorRole}`, () => {
    const input = example();
    input.relation.anchors[landingRole] = input.relation.anchors.movedClause;
    if (landingRole !== 'movedClause') delete input.relation.anchors.movedClause;
    input.relation.priorAnchors = /** @type {Record<string, string>} */ ({ [priorRole]: 'clause' });
    const original = structuredClone(input);
    const movement = recover(input).movement;
    assert.deepEqual([movement?.priorSourceNodeId, movement?.sourceNodeId, movement?.targetNodeId,
      movement?.witnessNodeId, movement?.trajectoryKind, movement?.transition],
    ['clause', 'lower', 'clause', 'lower', 'phrasal', true]);
    assert.deepEqual(movement.priorAnchorKeys, [priorRole]);
    assert.ok(dispatchRelationClaims(input).facets.some(facet => facet.recipe.id === 'movement.path'));
    assert.ok(hasTrajectory(input));
    assert.deepEqual(input, original);
  });
}

test('a landing-clause role names the verified containing site, not a second occurrence', () => {
  const input = example();
  input.relation.anchors.landingClause = input.relation.anchors.landingDomain;
  delete input.relation.anchors.landingDomain;
  assert.deepEqual(recover(input).movement?.context, [{ key: 'landingClause', nodeId: 'landing', kind: 'site' }]);
  assert.equal(recover(input).movement?.targetNodeId, 'clause');
  const invalid = structuredClone(input);
  invalid.currentForest = [{ id: 'outer', label: 'XP', children: invalid.currentForest }];
  invalid.relation.anchors.landingClause = 'outer';
  assert.equal(Boolean(recover(invalid).movement?.context?.some(context => context.key === 'landingClause')), false);
  assert.ok(recover(invalid).diagnostics.some(message => message.includes('MOVEMENT_CONTEXT_UNPROVEN')));
});

test('clause movement introduces the lower occurrence, landing parent and trajectory in one relation moment', () => {
  const input = example();
  const original = structuredClone(input);
  const beforeMovement = { relation: 'Inspect the predicate', anchors: { participant: 'predicate' } };
  const prepared = prepare(input, [beforeMovement, input.relation]);
  const steps = prepared.playbackSteps;
  const momentIndex = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 1);
  assert.ok(momentIndex > 0);
  const priorSteps = steps.slice(0, momentIndex).filter(step => step.replayFrameIndex === 1);
  assert.ok(priorSteps.length);
  for (const step of priorSteps) {
    assert.equal(parent([step.replayCanvasData], 'clause')?.id, 'base');
    assert.ok(step.replayVisibleNodeIds.includes('clause'));
    assert.ok(!step.replayVisibleNodeIds.includes('lower'));
    assert.ok(!step.replayVisibleNodeIds.includes('landing'));
    assert.ok(!step.replayRelationLinks.some(link => link.authoredRelationKey === '1:1'));
  }
  const moment = steps[momentIndex];
  assert.equal(parent([moment.replayCanvasData], 'clause')?.id, 'landing');
  assert.ok(moment.replayVisibleNodeIds.includes('lower'));
  assert.ok(moment.replayVisibleNodeIds.includes('landing'));
  assert.ok(moment.replayRelationLinks.some(link => link.authoredRelationKey === '1:1'
    && link.renderFamily === 'trajectory' && link.trajectoryKind === 'phrasal'
    && link.sourceNodeId === 'lower' && link.targetNodeId === 'clause'));
  assert.ok(!steps.some(step => step.replayKind === 'micro' && step.targetNodeId === 'landing'));
  assert.deepEqual(input, original);
});

for (const [name, mutate] of [
  ['unproved root lineage', input => { delete find(input.currentForest, 'lower').lineageId; }],
  ['conflicting lower lineage', input => { find(input.currentForest, 'lower').lineageId = 'another-chain'; }],
  ['trace in a different prior slot', input => { find(input.currentForest, 'base').children.reverse(); }],
  ['missing prior occurrence', input => { input.priorForest = []; }],
  ['repeated prior source', input => { input.relation.priorAnchors.sourceClause = ['clause', 'clause']; }],
  ['conflicting prior source', input => { input.relation.priorAnchors.sourceClause = 'predicate'; }],
  ['ambiguous prior occurrence', input => { input.priorForest.push(structuredClone(find(input.priorForest, 'clause'))); }],
  ['ambiguous lower occurrence', input => { input.currentForest.push(structuredClone(find(input.currentForest, 'lower'))); }],
  ['unresolved trace array', input => { input.relation.anchors.argumentTrace = ['lower', 'lower']; }],
  ['plural role with repeated landing array', input => {
    input.relation.anchors.movedClauses = ['clause', 'clause'];
    delete input.relation.anchors.movedClause;
  }],
  ['two competing landings', input => {
    input.currentForest[0].children.push({ id: 'competitor', label: 'CP', lineageId: 'clause-chain' });
    input.relation.anchors.raisedClause = 'competitor';
  }]
]) {
  test(`clause wording cannot bypass movement proof: ${name}`, () => {
    const input = example();
    mutate(input);
    assert.equal(recover(input).movement, undefined);
    assert.equal(hasTrajectory(input), false);
  });
}

test('neutral clause association does not become movement from lineage or a move-like title', () => {
  const input = example();
  input.relation = { relation: 'CP-extraposition chain', anchors: { participantA: 'clause', participantB: 'lower' } };
  assert.equal(recover(input).movement, undefined);
  assert.equal(hasTrajectory(input), false);
  input.relation = { relation: 'Clause comparison', anchors: { sourceClause: 'clause', targetClause: 'predicate' } };
  assert.equal(recover(input).movement, undefined);
  assert.equal(hasTrajectory(input), false);
});

test('clause-role recovery cannot repair a malformed exact Tier-1 movement signature', () => {
  const input = example();
  input.relation.relation = 'AbarMove';
  input.relation.anchors.target = ['clause', 'predicate'];
  const dispatch = dispatchRelationClaims(input);
  assert.equal(dispatch.primaryClaim.tier, 3);
  assert.equal(dispatch.primaryClaim.reason, 'registered-signature-incomplete');
  assert.ok(!dispatch.facets.some(facet => facet.recipe.id === 'movement.path'));
  assert.equal(hasTrajectory(input), false);
});

const raisingExample = () => {
  const subject = { id: 'subject', label: 'NP', lineageId: 'subject-chain', children: [{ id: 'name', label: 'N', word: 'Mia' }] };
  const priorForest = [{ id: 'matrix', label: 'IP', children: [{ id: 'predicate', label: 'VP', children: [
    { id: 'verb', label: 'V', word: 'seems' },
    { id: 'embedded', label: 'IP', children: [subject, { id: 'infinitive', label: 'VP', word: 'leave' }] }
  ] }] }];
  const currentForest = structuredClone(priorForest);
  find(currentForest, 'embedded').children[0] = { id: 'trace', label: 'NP[trace]', lineageId: 'subject-chain', silent: true };
  currentForest[0].children.unshift(subject);
  return { priorForest, currentForest, stageIndex: 1, relationIndex: 0, relation: {
    relation: 'An independently named dependency', anchors: { head: 'subject', trace: 'trace', sourceClause: 'embedded', targetClause: 'matrix' },
    priorAnchors: { movingNP: 'subject', sourceClause: 'embedded', targetClause: 'matrix' }
  } };
};

for (const lineage of [undefined, 'embedded-domain']) {
  test(`containing source clauses remain neutral beside a proved raising pair, domain lineage ${lineage}`, () => {
    const input = raisingExample();
    for (const forest of [input.priorForest, input.currentForest]) if (lineage) find(forest, 'embedded').lineageId = lineage;
    const movement = recover(input).movement;
    assert.deepEqual([movement?.priorSourceNodeId, movement?.sourceNodeId, movement?.targetNodeId], ['subject', 'trace', 'subject']);
    const dispatch = dispatchRelationClaims(input);
    for (const scope of ['anchors', 'priorAnchors']) {
      const field = dispatch.evidenceCoverage.fields.find(field => field.field === scope && field.key === 'sourceClause');
      assert.deepEqual(field.recognizedBy, []);
      assert.ok(dispatch.claims.some(claim => claim.tier === 3 && claim.consumedEvidence.some(field => field.field === scope && field.key === 'sourceClause')));
    }
    assert.ok(hasTrajectory(input));
  });
}

for (const [name, mutate] of [
  ['no named prior occurrence', input => { delete input.relation.priorAnchors.movingNP; }],
  ['registered prior source beside its clause', input => {
    input.relation.priorAnchors.source = input.relation.priorAnchors.movingNP;
    delete input.relation.priorAnchors.movingNP;
  }]
]) test(`the exact source slot disambiguates containing context: ${name}`, () => {
  const input = raisingExample(); mutate(input);
  assert.equal(recover(input).movement?.sourceNodeId, 'trace');
  assert.ok(hasTrajectory(input));
});

for (const [name, mutate] of [
  ['unrelated clause source', input => {
    input.currentForest.push({ id: 'competitor', label: 'CP', lineageId: 'other-clause' });
    input.relation.anchors.sourceClause = 'competitor';
  }],
  ['another source occurrence in the moving lineage', input => {
    input.currentForest.push({ id: 'competitor', label: 'CP', lineageId: 'subject-chain' });
    input.relation.anchors.sourceClause = 'competitor';
  }],
  ['containing clause asserts the moving root identity', input => {
    for (const forest of [input.priorForest, input.currentForest]) find(forest, 'embedded').lineageId = 'subject-chain';
    input.relation.priorAnchors.source = 'subject';
  }],
  ['contradictory source occurrence role on the containing clause', input => { input.relation.anchors.sourceOccurrence = 'embedded'; }],
  ['contradictory prior source occurrence role on the clause', input => { input.relation.priorAnchors.sourceOccurrence = 'embedded'; }],
  ['unproved prior source slot', input => { find(input.currentForest, 'embedded').children.reverse(); }],
  ['ambiguous prior source ID', input => { input.priorForest.push(structuredClone(find(input.priorForest, 'subject'))); }],
  ['ambiguous current trace ID', input => { input.currentForest.push(structuredClone(find(input.currentForest, 'trace'))); }]
]) test(`source-clause context cannot suppress competing evidence: ${name}`, () => {
  const input = raisingExample(); mutate(input);
  assert.equal(recover(input).movement, undefined);
  assert.equal(hasTrajectory(input), false);
});

test('containing source and target clauses alone do not assert movement or a movement failure', () => {
  const input = raisingExample();
  input.relation = { relation: 'Pending requirement', anchors: { nominal: 'subject', sourceClause: 'embedded', targetClause: 'matrix' } };
  assert.deepEqual(recover(input), { diagnostics: [] });
  assert.equal(hasTrajectory(input), false);
});

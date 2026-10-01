import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
const example = () => ({
  relation: { relation: 'Open dependency', anchors: { movedHead: 'upper', trace: 'lower', landingHead: 'complex' } },
  priorForest: [{ id: 'lower', label: 'X', lineageId: 'same', word: 'token' }],
  currentForest: [{ id: 'root', label: 'ZP', children: [
    { id: 'complex', label: 'Z', children: [
      { id: 'upper', label: 'X', lineageId: 'same', word: 'token' },
      { id: 'host', label: 'Z', silent: true }
    ] },
    { id: 'lower', label: 'X', lineageId: 'same', silent: true },
    { id: 'other', label: 'YP' }
  ] }], stageIndex: 1, relationIndex: 0
});
const recovered = input => recoverMovementEvidence(input.relation, input.currentForest, input.priorForest);
const field = (dispatch, key) => dispatch.evidenceCoverage.fields.find(f => f.field === 'anchors' && f.key === key);
const owned = (dispatch, key) => Boolean(field(dispatch, key)?.recognizedBy.length && !field(dispatch, key).unrecoveredItemIndices.length);

for (const [name, stageIndex, key, id] of [
  ['astra-xbar', 3, 'host', 'complexC'],
  ['fable-xbar', 3, 'landingHead', 'c1'],
  ['fable-xbar', 4, 'landingSite', 'cp1']
]) {
  test(`${name} stage ${stageIndex + 1}: verified ${key} belongs to the movement`, () => {
    const record = saved.find(r => r.name === name);
    const input = { relation: record.derivationStages[stageIndex].relations[0],
      currentForest: record.derivationStages[stageIndex].workspaceForest,
      priorForest: record.derivationStages[stageIndex - 1].workspaceForest, stageIndex, relationIndex: 0 };
    const original = structuredClone(input);
    const dispatch = dispatchRelationClaims(input);
    assert.ok(dispatch.evidence.movement.context.some(c => c.key === key && c.nodeId === id));
    assert.ok(owned(dispatch, key));
    assert.ok(dispatch.claims.some(c => c.tier === 2));
    assert.ok(!dispatch.claims.some(c => c.tier === 3 && c.consumedEvidence.some(e => e.field === 'anchors' && e.key === key)));
    assert.deepEqual(input, original, 'the original authored host is retained');
  });
}

test('renamed IDs, open titles, role spelling and property order preserve context ownership', () => {
  const input = example();
  input.relation.anchors = { 'Landing Head': 'complex', trace: 'lower', movedHead: 'upper' };
  const dispatch = dispatchRelationClaims(input);
  assert.ok(owned(dispatch, 'Landing Head'));
  assert.deepEqual(dispatch.evidence.movement.context, [{ key: 'Landing Head', nodeId: 'complex', kind: 'head-landing' }]);
  assert.equal(dispatch.claims.some(c => c.tier === 3), false);
});

test('a unary head host retains the authored landing without inventing a silent host child', () => {
  const input = example();
  input.currentForest[0].children[0].children.pop();
  const original = structuredClone(input);
  const dispatch = dispatchRelationClaims(input);
  assert.equal(dispatch.evidence.movement.trajectoryKind, 'head');
  assert.equal(dispatch.evidence.movement.targetNodeId, 'upper');
  assert.equal(dispatch.evidence.movement.sourceNodeId, 'lower');
  assert(owned(dispatch, 'landingHead'));
  assert(dispatch.facets.some(facet => facet.recipe.id === 'movement.path'));
  assert.deepEqual(input, original);
});

test('zero-level head notation does not obscure the exact adjunction host', () => {
  for (const zero of ['⁰', '^0', '0']) {
    const input = example();
    input.currentForest[0].children[0].label = `Z${zero}`;
    const d = dispatchRelationClaims(input);
    assert.equal(d.evidence.movement?.trajectoryKind, 'head');
    assert.equal(d.evidence.movement?.targetNodeId, 'upper');
    assert(owned(d, 'landingHead'));
    input.currentForest[0].children[0].children[1].label = 'Q';
    assert.equal(recovered(input).movement, undefined, 'a different host category does not prove adjunction');
  }
});

test('a moved head can occupy its projection head position without an invented adjunction host', () => {
  for (const parentLabel of ['Z′', "Z'", 'ZP']) for (const headLabel of ['Z', 'Z⁰', 'Z^0']) {
    const input = example();
    const parent = input.currentForest[0].children[0];
    parent.label = parentLabel;
    parent.children[0].label = headLabel;
    parent.children[1].label = 'YP';
    delete input.relation.anchors.landingHead;
    const original = structuredClone(input);
    const d = dispatchRelationClaims(input);
    assert.equal(d.evidence.movement?.trajectoryKind, 'head', `${parentLabel}/${headLabel}`);
    assert.equal(d.evidence.movement?.targetNodeId, 'upper');
    assert(d.facets.some(facet => facet.recipe.id === 'movement.path'));
    assert.deepEqual(input, original);
    for (const mutate of [
      x => { x.currentForest[0].children[0].children[0].label = 'QP'; },
      x => { x.currentForest[0].children[0].children[0].label = 'Q'; },
      x => { x.currentForest[0].children[0].children[1].label = 'Z'; },
      x => { delete x.currentForest[0].children[0].children[0].lineageId; },
      x => { x.relation.priorAnchors = { source: 'other' }; }
    ]) {
      const bad = structuredClone(input); mutate(bad);
      assert.notEqual(recovered(bad).movement?.trajectoryKind, 'head');
    }
  }
});

test('saved projection landing appears at its movement moment with its lower witness', () => {
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/projected-head-landing.json', import.meta.url)));
  for (const renamed of [false, true]) {
    const response = structuredClone(record);
    const id = key => renamed ? `opaque-${key}` : key;
    if (renamed) for (const stage of response.analyses[0].derivationStages) {
      const visit = node => { node.id = id(node.id); if (node.lineageId) node.lineageId = id(node.lineageId); node.children?.forEach(visit); };
      stage.workspaceForest.forEach(visit);
      stage.realizations?.forEach(group => { group.nodeIds = group.nodeIds.map(id); });
      for (const relation of stage.relations) {
        relation.relation = 'An unfamiliar authored claim';
        for (const field of ['anchors', 'priorAnchors']) if (relation[field]) relation[field] = Object.fromEntries(Object.entries(relation[field]).reverse()
          .map(([key, value]) => [key, Array.isArray(value) ? value.map(id) : id(value)]));
      }
    }
    const stages = response.analyses[0].derivationStages;
    const plan = compileRelationRenderPlan(stages);
    const path = plan.frames[2].items.find(item => item.kind === 'trajectory' && item.relationRef.stageIndex === 2 && item.relationRef.relationIndex === 4);
    assert.equal(path?.targetNodeId, id('auxC'));
    assert.equal(path?.sourceNodeId, id('auxITrace'));
    const playback = buildReplayPlayback(response);
    const moment = playback.steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 2 && step.replayRelationIdentity.relationIndex === 4);
    assert(moment > 0);
    const before = playback.steps[moment - 1], after = playback.steps[moment];
    assert(!before.replayVisibleNodeIds.includes(id('auxC')));
    assert(!before.replayVisibleNodeIds.includes(id('auxITrace')));
    assert(before.replayVisibleNodeIds.includes(id('auxI')));
    assert(after.replayVisibleNodeIds.includes(id('auxC')));
    assert(after.replayVisibleNodeIds.includes(id('auxITrace')));
    assert(!before.replayVisibleNodeIds.includes(id('rootCBar')));
    assert(after.replayVisibleNodeIds.includes(id('rootCBar')), 'the landing projection belongs to the same movement moment');
    assert.equal(after.replayRelationLinks.filter(link => link.authoredRelationKey === '2:4' && link.renderFamily === 'trajectory').length, 1);
  }
});

test('unary landing recovery still requires a head, exact lineage, and one supported occurrence', () => {
  for (const mutate of [
    input => { input.currentForest[0].children[0].label = 'ZP'; },
    input => { input.currentForest[0].children[0].label = 'Z′'; },
    input => { input.currentForest[0].children[0].children[0].lineageId = 'different'; },
    input => { delete input.currentForest[0].children[0].children[0].lineageId; },
    input => { input.currentForest.push({ id: 'upper', label: 'X', lineageId: 'same' }); }
  ]) {
    const input = example();
    input.currentForest[0].children[0].children.pop();
    mutate(input);
    assert.equal(recovered(input).movement, undefined, JSON.stringify(input));
  }
  const phrasal = example();
  phrasal.currentForest[0].children[0].children.pop();
  phrasal.currentForest[0].children[0].children[0].label = 'XP';
  assert.notEqual(recovered(phrasal).movement?.trajectoryKind, 'head');
  assert(!owned(dispatchRelationClaims(phrasal), 'landingHead'));
});

test('verified context does not change trajectory identity, witnesses or replacement behavior', () => {
  const input = example();
  const stage = (forest, relations) => ({ statement: 'State', stageRecord: 'Authored state.', workspaceForest: forest, relations });
  const plan = relation => compileRelationRenderPlan([
    stage(input.priorForest, []), stage(input.currentForest, [relation])
  ]).frames.at(-1).items.filter(item => item.kind !== 'fallback');
  const withContext = plan(input.relation);
  delete input.relation.anchors.landingHead;
  const withoutContext = plan(input.relation);
  assert.ok(withContext.some(item => item.kind === 'trajectory'));
  // The full authored relation is retained separately; the drawing itself does
  // not gain a new identity or visible witness for its enclosing context.
  const drawing = items => items.map(({ relationRef, ...item }) => item);
  assert.deepEqual(drawing(withContext), drawing(withoutContext));
});

for (const [value, reason] of [
  ['other', 'not-the-landing-host-or-complex'],
  ['upper', 'not-the-landing-host-or-complex'],
  ['absent', 'landing-or-context-id-missing-or-ambiguous'],
  [['host', 'complex'], 'context-needs-one-exact-node'],
  [['host', 'host'], 'context-needs-one-exact-node'],
  [[], 'context-needs-one-exact-node']
]) {
  test(`unproven head context ${JSON.stringify(value)} stays unresolved`, () => {
    const input = example();
    input.relation.anchors.landingHead = value;
    const dispatch = dispatchRelationClaims(input);
    assert.ok(dispatch.evidence.movement, 'the independently proven movement remains available');
    assert.ok(!owned(dispatch, 'landingHead'));
    assert.ok(dispatch.claims.some(c => c.tier === 3));
    assert.match(dispatch.evidence.movementDiagnostics.join('\n'), new RegExp(`anchors.landingHead.*${reason}`));
    assert.deepEqual(input.relation.anchors.landingHead, value);
  });
}

test('duplicate host and parent IDs cannot be consumed', () => {
  for (const id of ['host', 'complex']) {
    const input = example();
    input.relation.anchors.landingHead = id;
    input.currentForest.push({ id, label: 'Other' });
    assert.equal(recovered(input).movement.context, undefined);
    assert.match(recovered(input).diagnostics.join('\n'), /missing-or-ambiguous/);
  }
});

test('an enclosing ancestor is not accepted as the immediate landing site', () => {
  const input = example();
  delete input.relation.anchors.landingHead;
  input.relation.anchors.landingSite = 'root';
  const dispatch = dispatchRelationClaims(input);
  assert.ok(dispatch.evidence.movement);
  assert.ok(!owned(dispatch, 'landingSite'));
  assert.match(dispatch.evidence.movementDiagnostics.join('\n'), /anchors.landingSite.*not-the-immediate-landing-parent/);
});

test('a valid host and complex are checked separately from an invalid extra context', () => {
  const input = example();
  input.relation.anchors = { ...input.relation.anchors, hostHead: 'host', complexHead: 'complex', host: 'other' };
  const dispatch = dispatchRelationClaims(input);
  for (const key of ['landingHead', 'hostHead', 'complexHead']) assert.ok(owned(dispatch, key), key);
  assert.ok(!owned(dispatch, 'host'));
  const fallback = dispatch.claims.find(c => c.tier === 3);
  assert.deepEqual(fallback.contextAnchors, { movedHead: 'upper', trace: 'lower', host: 'other' });
});

test('licensing, thematic, government and locality claims are not erased with verified context', () => {
  for (const key of ['licensor', 'thematicOccurrence', 'governor', 'pairHost']) {
    const input = example();
    input.relation.anchors[key] = 'other';
    input.relation.values = { locality: 'The model authors a separate qualification.' };
    const dispatch = dispatchRelationClaims(input);
    const fallback = dispatch.claims.find(c => c.tier === 3);
    assert.ok(fallback, key);
    assert.equal(fallback.contextAnchors[key], 'other');
    assert.equal(fallback.contextAnchors.landingHead, undefined);
    assert.ok(fallback.consumedEvidence.some(e => e.field === 'values' && e.key === 'locality'));
    assert.ok(!owned(dispatch, key));
  }
});

test('a host without proven movement does not earn context ownership', () => {
  const input = example();
  delete input.relation.anchors.trace;
  assert.equal(recovered(input).movement, undefined);
  assert.ok(!owned(dispatchRelationClaims(input), 'landingHead'));
});

test('valid context cannot rescue a malformed exact Tier-1 recipe', () => {
  const input = example();
  input.relation.relation = 'HeadMove';
  input.relation.anchors = { source: 'lower', target: 'upper', hostHead: 'other', complexHead: 'complex' };
  const dispatch = dispatchRelationClaims(input);
  assert.equal(dispatch.primaryClaim.tier, 3);
  assert.equal(dispatch.primaryClaim.reason, 'registered-signature-incomplete');
  assert.ok(!dispatch.facets.some(f => f.recipe.id === 'movement.path'));
  assert.ok(!owned(dispatch, 'complexHead'));
});

test('Replay retains the precise host diagnostic even when movement succeeds', () => {
  const input = example();
  input.relation.anchors.landingHead = 'other';
  const stage = (forest, relations) => ({ statement: 'State', stageRecord: 'Authored state.', workspaceForest: forest, relations });
  const { steps } = buildReplayPlayback({ sentence: 'token', analyses: [{ derivationStages: [
    stage(input.priorForest, []), stage(input.currentForest, [input.relation])
  ] }] });
  const moment = steps.find(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
  assert.ok(moment.replayRelationLinks.some(link => link.renderFamily === 'trajectory'
    && link.sourceNodeId === 'lower' && link.targetNodeId === 'upper'));
  assert.match(moment.movementDiagnostics.join('\n'), /anchors.landingHead \(other\).*landing upper.*not-the-landing-host-or-complex/);
});


test('filling an existing head position is a movement independent of pronunciation', () => {
  const relation = { relation: 'An unfamiliar claim', anchors: { lowerCopy: 'low', higherCopy: 'high' } };
  for (const pronounced of [false, true]) {
    const low = { id: 'low', label: 'T', lineageId: 'root-chain', children: [{ id: 'wordLow', label: 'X', lineageId: 'material-chain', ...(pronounced ? { word: 'form' } : { silent: true }) }] };
    const high = { id: 'high', label: 'C', lineageId: 'root-chain', children: [] };
    const before = [{ id: 'clause', label: 'CP', children: [{ id: 'bar', label: 'C′', children: [high, { id: 'phrase', label: 'TP', children: [low] }] }] }];
    const after = structuredClone(before);
    after[0].children[0].children[0].children = [{ ...low.children[0], id: 'wordHigh' }];
    const result = recoverMovementEvidence(relation, after, before);
    assert.equal(result.movement?.transition, true);
    assert.equal(recoverMovementEvidence(relation, after, after).movement?.transition, false);
    const onlySpelling = structuredClone(after); onlySpelling[0].children[0].children[0].children[0].word = 'new form';
    assert.equal(recoverMovementEvidence(relation, onlySpelling, after).movement?.transition, false);
  }
});

test('a decorated projection label still establishes a phrasal specifier landing', () => {
  const lower = { id: 'lower', label: 'N[trace]', lineageId: 'chain', silent: true };
  const old = { id: 'relativeT', label: 'T (projection)', children: [lower,
    { id: 'verb', label: 'V', word: 'read' }] };
  const before = [old];
  const after = [{ id: 'relativeCP', label: 'C (relative projection)', children: [
    { id: 'higher', label: 'N[operator]', lineageId: 'chain', silent: true },
    { id: 'relativeCProjection', label: 'C (projection)', children: [
      { id: 'relativeC', label: 'C', word: 'yang' }, structuredClone(old)
    ] }
  ] }];
  const relation = { relation: 'An open movement claim', anchors: { landingOccurrence: 'higher', trace: 'lower' },
    priorAnchors: { source: 'lower' } };
  assert.equal(recoverMovementEvidence(relation, after, before).movement?.trajectoryKind, 'phrasal');
  const unrelated = structuredClone(after);
  unrelated[0].children[1].label = 'T (projection)';
  assert.equal(recoverMovementEvidence(relation, unrelated, before).movement, undefined);
});

test('head features after a colon do not hide an exact head-adjunction landing', () => {
  const before = [{ id: 'base', label: 'VP', children: [{ id: 'low', label: 'V', lineageId: 'verb', word: 'form' }] }];
  const after = [{ id: 'root', label: 'IP', children: [
    { id: 'complex', label: 'I', children: [
      { id: 'high', label: 'V', lineageId: 'verb', word: 'form' },
      { id: 'features', label: 'I: finite, present', silent: true }
    ] },
    { id: 'base', label: 'VP', children: [{ id: 'low', label: 'V: head trace', lineageId: 'verb', silent: true }] }
  ] }];
  const relation = { relation: 'Open head movement', anchors: { raisedHead: 'high', trace: 'low', landingHead: 'complex' },
    priorAnchors: { source: 'low' } };
  assert.equal(recoverMovementEvidence(relation, after, before).movement?.trajectoryKind, 'head');
  const wrong = structuredClone(after);
  wrong[0].children[0].children[1].label = 'C: declarative';
  assert.equal(recoverMovementEvidence(relation, wrong, before).movement, undefined);
});

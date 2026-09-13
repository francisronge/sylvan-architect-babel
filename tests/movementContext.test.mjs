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

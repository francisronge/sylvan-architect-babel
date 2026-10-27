import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

// Sol n3-13 (Finnish, sol-cfc 27 Oct, stage 5) moves a verbal complex to T and
// also names the stem and light verb inside each copy. Those parts move with the
// complex, so they must not read as competing sources or landings.
const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), children: [], ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const complex = (id, stem, light, extra = {}) => node(id, 'v', [leaf(stem, 'V', 'juo', { lineageId: 'drink' }),
  leaf(light, 'v', undefined, { silent: true, lineageId: 'light' })], { lineageId: 'vc', ...extra });
const before = [node('TP', 'T', [leaf('T', 'T', 'n'), node('vP', 'v', [complex('vComplex', 'V_at_v', 'v')])])];
const after = [node('TP', 'T', [node('TComplex', 'T', [complex('v_at_T', 'V_at_T', 'v_copy'), leaf('T', 'T', 'n')]),
  node('vP', 'v', [complex('vComplex', 'V_at_v', 'v', { silent: true })])])];
const claim = (extra = {}) => ({ relation: 'head movement', anchors: { source: 'vComplex', landing: 'v_at_T', host: 'T', ...extra } });
const parts = { lowerStem: 'V_at_v', higherStem: 'V_at_T', lowerLightVerb: 'v', higherLightVerb: 'v_copy' };
const replay = relation => prepareReplay({ sentence: 'juo n', includePlayback: true, derivationStages: [before, after].map((workspaceForest, i) => ({
  statement: 'State', stageRecord: 'Authored state.', workspaceForest, relations: i ? [relation] : [] })) });

test('parts named inside a moving head complex move with it', () => {
  const movement = recoverMovementEvidence(claim(parts), after, before);
  assert.deepEqual(movement.diagnostics, []);
  assert.deepEqual([movement.movement?.sourceNodeId, movement.movement?.targetNodeId, movement.movement?.trajectoryKind], ['vComplex', 'v_at_T', 'head']);
  const paths = replay(claim(parts)).relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory');
  assert.deepEqual(paths.map(item => `${item.familyId} ${item.sourceNodeId}->${item.targetNodeId}`), ['trajectory.head vComplex->v_at_T']);
});

test('a part named on the wrong side, outside the endpoint it describes, stays unresolved', () => {
  for (const extra of [{ lowerLightVerb: 'v_copy' }, { higherLightVerb: 'v' }])
    assert.equal(recoverMovementEvidence(claim(extra), after, before).movement, undefined, JSON.stringify(extra));
});

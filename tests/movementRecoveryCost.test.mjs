import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { recoverMovementGroups } from '../replay/relations/movementGroups.ts';

// Model-authored claims are untrusted input: Replay preparation must reject an
// oversized claim without first spending time or memory exponential in it.
const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word ? { word } : {}), children: [], ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });

test('a movement group with too many landing combinations is refused before they are built', () => {
  const entry = (key, items) => ({ key, items, concepts: [], conceptItemIndices: {} });
  const forest = [node('R', 'IP', [leaf('s0', 'V', 'a'), leaf('s1', 'V', 'b')])];
  // Six landing-role lists of twelve items: 12^6 (about three million) combinations.
  const landings = ['landing', 'target', 'destination', 'landing site', 'targets', 'landings']
    .map((key, f) => entry(key, Array.from({ length: 12 }, (_, i) => `t${f}_${i}`)));
  const evidence = { currentForest: forest, priorForest: forest, values: {},
    authoredCurrentAnchors: [entry('source', ['s0', 's1']), ...landings], authoredPriorAnchors: [entry('prior source', ['s0', 's1'])] };
  // Count the array elements flatMap builds while the claim is read.
  const flatMap = Array.prototype.flatMap;
  let built = 0;
  Array.prototype.flatMap = function (...args) { const result = flatMap.apply(this, args); built += result.length; return result; };
  let groups;
  try { groups = recoverMovementGroups(evidence); } finally { Array.prototype.flatMap = flatMap; }
  assert.deepEqual(groups, []);
  assert.ok(built < 10_000, `built ${built} combination elements`);
});

test('comparing two copies of a deep head complex serializes each node once', () => {
  // The verbal complex of tests/movementEndpointParts.test.mjs, its stem wrapped in sixteen unary heads.
  const wrap = (prefix, inner) => Array.from({ length: 16 }, (_, i) => i)
    .reduce((n, i) => node(`${prefix}w${i}`, 'V', [n], { lineageId: `w${i}` }), inner);
  const complex = (id, stem, light, extra = {}) => node(id, 'v', [wrap(id, leaf(stem, 'V', 'juo', { lineageId: 'drink' })),
    leaf(light, 'v', undefined, { silent: true, lineageId: 'light' })], { lineageId: 'vc', ...extra });
  const before = [node('TP', 'T', [leaf('T', 'T', 'n'), node('vP', 'v', [complex('vComplex', 'V_at_v', 'v')])])];
  const after = [node('TP', 'T', [node('TComplex', 'T', [complex('v_at_T', 'V_at_T', 'v_copy'), leaf('T', 'T', 'n')]),
    node('vP', 'v', [complex('vComplex', 'V_at_v', 'v', { silent: true })])])];
  const claim = { relation: 'head movement', anchors: { source: 'vComplex', landing: 'v_at_T', host: 'T',
    lowerStem: 'V_at_v', higherStem: 'V_at_T', lowerLightVerb: 'v', higherLightVerb: 'v_copy' } };
  const stringify = JSON.stringify;
  let written = 0;
  JSON.stringify = (...args) => { const text = stringify(...args); written += text?.length ?? 0; return text; };
  let movement;
  try { movement = recoverMovementEvidence(claim, after, before).movement; } finally { JSON.stringify = stringify; }
  assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind], ['vComplex', 'v_at_T', 'head']);
  // Linear serialization of this forest writes well under 100k characters;
  // re-serializing nested JSON text doubles its escapes at every level.
  assert.ok(written < 100_000, `serialized ${written} characters`);
});

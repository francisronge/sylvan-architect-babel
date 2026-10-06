import test from 'node:test';
import assert from 'node:assert/strict';
import { pairedWorkspaceClearance } from '../replay/workspacePairedClearance.ts';

const points = (gap) => new Map([['a', { x: -gap / 2, y: 210 }], ['b', { x: gap / 2, y: 210 }]]);
const gap = (preferences, id) => preferences.get(id).get('b').x - preferences.get(id).get('a').x;
function plateau(side = 'both', acceptedGap = 150) {
  const accepted = new Map([[1, points(acceptedGap)], [2, points(80)]]);
  const rejected = new Map(accepted).set(1, points(20));
  const reservation = { incarnation: 1, split: 1, side, increase: 45, realizedGap: 70 };
  const obstruction = { incarnation: 2, split: 1, side: 'left', nodeId: 'a' };
  return {
    attempted: { incarnation: 1, split: 1 }, accepted, rejected,
    witness: { preference: reservation, obstructions: [obstruction] },
    forks: new Map([1, 2].map(id => [id, { children: [{ id: 'a' }, { id: 'b' }] }])),
    currentGap: () => 80, budget: { remaining: 16, evaluations: 0 },
    evaluate: preferences => {
      const preferred = gap(preferences, 1), realized = Math.max(70, preferred);
      const required = gap(preferences, 2) + 35;
      return realized < required
        ? { clearance: { preference: { ...reservation, realizedGap: realized, increase: required - realized }, obstructions: [obstruction] } }
        : { value: { preferred, realized } };
    },
  };
}
for (const side of ['left', 'right', 'both']) test(`one paired repair escapes a packed-gap plateau (${side})`, () => {
  const input = plateau(side), before = structuredClone(input.rejected);
  const results = pairedWorkspaceClearance(input);
  // A legacy +25/+5 correction produces preferences45/25, both still packed
  // to70; targeting the actual gap95/75 needs exactly the existing one retry.
  assert.deepEqual(results.map(result => result.candidate), [{ preferred: 95, realized: 95 }, { preferred: 75, realized: 75 }]);
  assert.equal(input.budget.evaluations, 4);
  assert.deepEqual(input.rejected, before);
  for (const result of results) {
    assert.equal(result.preferences.get(2).get('b').x, 40);
    for (const value of result.preferences.values()) for (const point of value.values()) assert.equal(point.y, 210);
    if (side === 'left') assert.equal(result.preferences.get(1).get('b').x, 10);
    if (side === 'right') assert.equal(result.preferences.get(1).get('a').x, -10);
  }
});
for (const realizedGap of [NaN, Infinity, 0, -1]) test(`invalid measured gap ${realizedGap} cannot authorize a retry`, () => {
  const input = plateau();
  input.evaluate = () => ({ clearance: { preference: { ...input.witness.preference, realizedGap }, obstructions: [] } });
  assert.deepEqual(pairedWorkspaceClearance(input), []);
  assert.equal(input.budget.evaluations, 2);
});
test('an actual target beyond the accepted gap cannot masquerade as a partial repair', () => {
  const input = plateau('both', 100);
  input.evaluate = () => ({ clearance: { preference: { ...input.witness.preference, realizedGap: 90, increase: 20 }, obstructions: [] } });
  assert.deepEqual(pairedWorkspaceClearance(input), []);
  assert.equal(input.budget.evaluations, 2);
});
test('a measured target already below the stored preference does not shrink in a clearance retry', () => {
  const input = plateau();
  input.evaluate = () => ({ clearance: { preference: { ...input.witness.preference, realizedGap: 10, increase: 5 }, obstructions: [] } });
  assert.deepEqual(pairedWorkspaceClearance(input), []);
  assert.equal(input.budget.evaluations, 2);
});
test('measured repair cannot evaluate after the shared budget is exhausted', () => {
  const input = plateau(); input.budget.remaining = 1;
  assert.deepEqual(pairedWorkspaceClearance(input), []);
  assert.equal(input.budget.evaluations, 1);
});

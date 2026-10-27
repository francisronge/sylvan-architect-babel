import assert from 'node:assert/strict';
import test from 'node:test';
import { rankScopeDomains } from '../replay/relations/scopeColourRanks.ts';

// Sol n4-39 (center embedding, sol-cfc 27 Oct): the cat clause's scope domain
// turned from green to the second colour at stage 7's first step, because the
// rat clause's larger domain, not yet shown, already took the first rank.
// Francis: "it's only supposed to have a different colour if there are multiple".
const scope = (stageIndex, relationIndex, members) => ({ kind: 'operator-variable-binding', scopeDomainNodeId: `d${stageIndex}`,
  scopeMemberNodeIds: Array.from({ length: members }, (_, i) => `m${i}`), relationRef: { stageIndex, relationIndex, relation: 'x', anchors: {} } });
const cat = scope(2, 2, 12), rat = scope(6, 2, 30);

test('a domain not yet shown takes no colour rank', () => {
  assert.deepEqual([...rankScopeDomains([cat, rat], new Set([0])).ranks], [[0, 0]]);
});

test('domains keep the colour of their appearance order, so a later larger one never recolours an earlier one', () => {
  assert.deepEqual([...rankScopeDomains([rat, cat], new Set([0, 1])).ranks].sort(), [[0, 1], [1, 0]]);
});

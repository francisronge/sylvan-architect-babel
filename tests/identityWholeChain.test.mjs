import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';

// An identity family lights every occurrence its relation anchors from one
// lineage. Membership is structural: a field whose name the chain wording does
// not cover still names an occurrence of the same chain.
const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const families = (record, stageIndex, relationIndex) => prepareReplay({ ...structuredClone(record) })
  .relationRenderPlan.frames[stageIndex].items
  .filter(item => item.familyId === 'identity.occurrences' && item.kind === 'coindex'
    && item.relationRef.stageIndex === stageIndex && item.relationRef.relationIndex === relationIndex)
  .map(item => [...item.nodeIds].sort());

test('topicalization lights the pronounced topic with both traces of its chain', () => {
  // Stage 5 anchors 太郎 as `topic` and its two traces as `subjectPosition` and
  // `thetaPosition`; all three share the lineage a-taro-chain.
  const record = fixture('replay-regressions/kept-id-landing.json');
  assert.deepEqual(families(record, 4, 0), [['a-subject-trace', 'a-taro-np', 'a-topic-trace']]);
});

test('an across-the-board chain is one family over its shared landing, edge copies and thematic copies', () => {
  const record = fixture('replay-regressions/unrecognized-movement.json').cases[4];
  assert.deepEqual(families(record, 7, 0),
    [['object-buy', 'object-buy-edge', 'object-final', 'object-sell', 'object-sell-edge']]);
});

test('a family never takes in an occurrence nested in one of its members or another lineage', () => {
  const leaf = (id, label, word, extra = {}) => ({ id, label, children: [], ...(word === null ? { silent: true } : { word }), ...extra });
  const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
  const stage = {
    statement: 'Front the phrase.', stageRecord: 'The fronted phrase and its trace.',
    relations: [{ relation: 'subject licensing', anchors: {
      chainHead: 'high', chainFoot: 'low', container: 'inner', other: 'name' } }],
    workspaceForest: [node('tp', 'TP', [
      node('high', 'DP', [node('inner', 'DP', [leaf('d', 'D', 'it')], { lineageId: 'x' })], { lineageId: 'x' }),
      node('tbar', "T'", [leaf('t', 'T', null), node('vp', 'VP', [
        leaf('low', 'DP', null, { lineageId: 'x' }), leaf('name', 'V', 'fell', { lineageId: 'y' })])])])]
  };
  assert.deepEqual(families({ sentence: 'it fell', derivationStages: [stage] }, 0, 0), [['high', 'low']]);
});

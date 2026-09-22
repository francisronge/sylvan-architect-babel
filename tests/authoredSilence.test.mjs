import assert from 'node:assert/strict';
import test from 'node:test';
import { collectAuthoredSilentSubtreeIds } from '../replay/relations/authoredSilence.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const phrase = silent => ({ id: 'site', label: 'VP', ...(silent ? { silent: true } : {}), children: [
  { id: 'verb', label: 'V', word: 'read' },
  { id: 'object', label: 'DP', silent: false, children: [
    { id: 'determiner', label: 'D', word: 'the' }, { id: 'noun', label: 'N', word: 'book' }
  ] }
] });
const stage = (site, relations) => ({ statement: 'A completed state', stageRecord: 'An authored record', relations,
  workspaceForest: [{ id: 'root', label: 'TP', children: [{ id: 'subject', label: 'D', word: 'Leo' }, site] }] });

test('ellipsis ghosting inherits authored phrase silence in both tiers and later stages', () => {
  for (const relation of [
    { relation: 'Ellipsis', anchors: { domain: 'site' } },
    { relation: 'An open claim', anchors: { ellipsisDomain: 'site' } }
  ]) {
    const initial = stage(phrase(true), [relation]);
    const later = stage(phrase(true), []);
    later.workspaceForest[0].children[1].children[1].children.push({ id: 'modifier', label: 'A', word: 'old' });
    const plan = compileRelationRenderPlan([initial, later]);
    assert.deepEqual(plan.frames[0].items.find(item => item.kind === 'ellipsis-site').ghostNodeIds,
      ['site', 'verb', 'object', 'determiner', 'noun']);
    assert.deepEqual(plan.frames[1].items.find(item => item.kind === 'ellipsis-site').ghostNodeIds,
      ['site', 'verb', 'object', 'determiner', 'noun', 'modifier']);
    assert.equal(initial.workspaceForest[0].children[1].children[0].silent, undefined);
  }
});

test('ghost collection does not silence overt siblings or an overt ellipsis target', () => {
  const root = stage(phrase(true), []).workspaceForest[0];
  assert.deepEqual(collectAuthoredSilentSubtreeIds(root), ['site', 'verb', 'object', 'determiner', 'noun']);
  assert.deepEqual(collectAuthoredSilentSubtreeIds(phrase(false)), []);
  const plan = compileRelationRenderPlan([stage(phrase(false), [{ relation: 'Open claim', anchors: { ellipsisDomain: 'site' } }])]);
  assert.equal(plan.frames[0].items.some(item => item.kind === 'ellipsis-site'), false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label, word, extra = {}) => ({ id, label, word, ...extra });
const forest = [{ id: 'tp', label: 'TP', children: [leaf('mia', 'DP', 'Mia'),
  { id: 'vp', label: 'VP', children: [leaf('tried', 'V', 'tried'), { id: 'cp', label: 'CP', children: [
    leaf('pro', 'DP', 'PRO', { silent: true }), leaf('leave', 'VP', 'to leave')] }] }] }];
const items = relation => compileRelationRenderPlan([{ statement: '', stageRecord: '', relations: [relation], workspaceForest: forest }])
  .frames[0].items.map(item => [item.kind, item.familyId, item.claimTier]);

// Francis approved on 27 Oct 2026 (relayed by the coordinating agent) that a claim
// named Control with a controller and controllee but no domain draws like
// obligatory-control: the Control connector and coindex, without the domain rectangle.
test('a Control claim without a domain draws the same connector and coindex as obligatory-control', () => {
  const control = items({ relation: 'control', anchors: { controller: 'mia', controllee: 'pro' } });
  assert.deepEqual(control, [['directed-path', 'control.dependency', 1], ['coindex', 'control.dependency', 1]]);
  assert.deepEqual(items({ relation: 'obligatory-control', anchors: { controller: 'mia', controllee: 'pro' } })
    .map(([kind, family]) => [kind, family]), control.map(([kind, family]) => [kind, family]));
  // An authored domain still adds its rectangle; a missing controller still draws nothing.
  assert.deepEqual(items({ relation: 'control', anchors: { controller: 'mia', controllee: 'pro', domain: 'cp' } }).map(([kind]) => kind),
    ['domain-mark', 'directed-path', 'coindex']);
  assert.deepEqual(items({ relation: 'control', anchors: { controllee: 'pro' } }).map(([kind]) => kind), ['fallback']);
});

test('a controller that is its own controllee draws nothing, with or without a domain', () => {
  // On 50c09be `control [controller:mia, controllee:mia]` drew a Tier-1 path from Mia to itself;
  // main drew the same self-path once a domain was named.
  for (const anchors of [{ controller: 'mia', controllee: 'mia' }, { controller: 'mia', controllee: 'mia', domain: 'cp' },
    { controller: ['mia'], controllee: ['mia'], domain: 'cp' }]) {
    assert.deepEqual(items({ relation: 'control', anchors }).map(([kind]) => kind), ['fallback'], JSON.stringify(anchors));
  }
});

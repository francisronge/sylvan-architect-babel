import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan, isPlanItemRevealed, planItemRelationRefs, visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';
import { caseFeatureComposition, featurePlaqueAssignment } from '../replay/relations/featureComposition.ts';

const forest = [{ id: 'root', label: 'TP', children: [
  { id: 'head', label: 'T', lineageId: 'tense' },
  { id: 'goal', label: 'DP', lineageId: 'subject', word: 'children' },
  { id: 'outer', label: 'P' }, { id: 'other', label: 'DP', lineageId: 'subject', word: 'children' }
] }];
const stage = relations => ({ statement: 'Completed syntax.', stageRecord: 'The authored relations.', workspaceForest: structuredClone(forest), relations });
const agree = { relation: 'Agree', anchors: { probe: 'head', goal: 'goal' }, values: { person: 'third', number: 'plural' } };
const caseClaim = (association, exact) => {
  const assigner = association === 'bearer' ? 'outer' : 'head';
  const bearer = association === 'bearer' ? 'head' : 'goal';
  return exact
    ? { relation: 'CaseAssignment', anchors: { assigner, bearer }, values: { feature: 'Case', value: 'NOM' } }
    : { relation: 'An authored licensing', anchors: { licensor: assigner, nominal: bearer }, values: { case: 'NOM' } };
};
const compile = relations => compileRelationRenderPlan([stage(relations)]);
const composition = items => caseFeatureComposition(items, items.findIndex(item => item.pathStyle === 'case-assignment'));
const rowsOf = value => value.rows.map(({ label, value, ownerNodeId, sourceNodeId }) => ({ label, value, ownerNodeId, sourceNodeId }));
const ownerCoordinates = item => planItemRelationRefs(item).map(ref => [ref.stageIndex, ref.relationIndex]);

test('accepted native and open Agree share the same rows with native or recovered Case', () => {
  for (const association of ['bearer', 'pair']) for (const exactCase of [false, true]) for (const reverse of [false, true]) {
    const snapshots = [];
    for (const exactAgree of [false, true]) {
      const agreement = { ...agree, relation: exactAgree ? 'Agree' : 'An authored agreement' };
      const relations = [agreement, caseClaim(association, exactCase)];
      if (reverse) relations.reverse();
      const before = structuredClone(relations), plan = compile(relations), items = plan.frames[0].items;
      const shared = composition(items), agreementIndex = relations.indexOf(agreement), caseIndex = 1 - agreementIndex;
      assert.equal(shared.bundles.length, 1);
      assert.equal(shared.collections.length, 2);
      assert.equal(shared.rows.length, 3);
      assert.equal(featurePlaqueAssignment(items, shared.bundles[0].index), shared.assignmentIndex);
      for (const row of shared.rows) {
        const owner = row.label === 'Case' ? caseIndex : agreementIndex;
        assert(row.ownerIndices.every(index => ownerCoordinates(items[index]).every(([si, ri]) => si === 0 && ri === owner)));
        for (const step of [new Set(), new Set([0]), new Set([0, 1])]) {
          assert.equal(row.ownerIndices.some(index => isPlanItemRevealed(items[index], 0, step)), step.has(owner));
        }
      }
      snapshots.push({ rows: rowsOf(shared), paths: shared.collections.map(({ item }) => ({ from: item.fromNodeId, to: item.toNodeId, row: item.featureRow })) });
      assert.deepEqual(relations, before);
    }
    assert.deepEqual(snapshots[0], snapshots[1], JSON.stringify({ association, exactCase, reverse }));
  }
});

test('no Case, malformed Case and ambiguous Case keep ordinary native Agree separate', () => {
  const pair = caseClaim('pair', false), bearer = caseClaim('bearer', true);
  for (const companions of [
    [],
    [{ relation: 'CaseAssignment', anchors: { bearer: 'head' }, values: { case: 'NOM' } }],
    [pair, { ...pair, anchors: { licensor: 'outer', nominal: 'goal' } }],
    [bearer, { ...bearer, anchors: { assigner: 'other', bearer: 'head' } }],
    [{ ...pair, anchors: { licensor: 'head', nominal: 'other' } }]
  ]) {
    const plan = compile([agree, ...companions]), items = plan.frames[0].items;
    const plaque = items.find(item => item.familyId === 'agree.plaque' && item.kind === 'node-plaque');
    assert(plaque);
    assert.equal(plaque.title, 'T probe');
    assert.deepEqual(plaque.rows, [{ label: 'person', value: 'third' }, { label: 'number', value: 'plural' }]);
    assert.equal(items.some(item => item.pathStyle === 'case-agree'), false);
    assert.equal(featurePlaqueAssignment(items, items.indexOf(plaque)), undefined);
  }
});

test('competing same-bearer and same-pair associations do not choose a collection path', () => {
  const items = compile([agree, caseClaim('bearer', true), caseClaim('pair', false)]).frames[0].items;
  assert.equal(items.some(item => item.pathStyle === 'case-agree'), false);
  const plaque = items.find(item => item.familyId === 'agree.plaque' && item.kind === 'node-plaque');
  assert.deepEqual(plaque.rows, [{ label: 'person', value: 'third' }, { label: 'number', value: 'plural' }]);
  assert.deepEqual(plaque.relationRef.anchors, agree.anchors);
});

test('a malformed exact Agree cannot earn collectors from its Case companion', () => {
  for (const anchors of [{ probe: 'head' }, { probe: 'head', goal: ['goal', 'other'] }, { probe: 'head', goal: 'missing' }]) {
    const plan = compile([{ ...agree, anchors }, caseClaim('pair', false)]);
    assert.equal(plan.frames[0].items.some(item => item.pathStyle === 'case-agree'), false);
  }
});

test('only supported feature rows get collectors while extra authored values remain visible', () => {
  const relations = [{ ...agree, values: { person: 'third', number: 'plural', qualification: 'A model-authored qualification.' } }, caseClaim('pair', false)];
  const items = compile(relations).frames[0].items, shared = composition(items);
  assert.deepEqual(shared.collections.map(({ item }) => item.featureRow.label), ['person', 'number']);
  assert(shared.rows.some(row => row.label === 'qualification' && row.value === 'A model-authored qualification.'));
  assert.equal(shared.rows.find(row => row.label === 'qualification').sourceNodeId, undefined);
  assert.equal(shared.collections.length, 2);
});

test('different values and same-lineage goals remain separate owned collection rows', () => {
  const second = { ...agree, values: { number: 'singular' } };
  const distinctGoal = { ...agree, anchors: { probe: 'head', goal: 'other' } };
  const items = compile([agree, second, distinctGoal, caseClaim('bearer', true)]).frames[0].items;
  const shared = composition(items);
  assert.equal(shared.collections.length, 5);
  assert.equal(shared.rows.filter(row => row.label === 'number').length, 3);
  assert.deepEqual(new Set(shared.rows.filter(row => row.label === 'person').map(row => row.sourceNodeId)), new Set(['goal', 'other']));
  assert(shared.collections.every(({ item }) => planItemRelationRefs(item).length === 1));
});

test('repeated native agreement keeps one shared plaque and both relation moments after a label change', () => {
  const first = stage([agree, caseClaim('pair', false)]), second = stage([agree, caseClaim('pair', false)]);
  first.workspaceForest[0].children[0].label = 'T [EPP]';
  second.workspaceForest[0].children[0].label = 'T [EPP satisfied]';
  const plan = compileRelationRenderPlan([first, second]), items = plan.frames[1].items, shared = composition(items);
  assert.equal(shared.bundles.length, 1);
  assert.equal(shared.collections.length, 2);
  assert.deepEqual(ownerCoordinates(shared.bundles[0].item), [[0, 0], [1, 0]]);
  assert(shared.collections.every(({ item }) => JSON.stringify(ownerCoordinates(item)) === '[[0,0],[1,0]]'));
  assert.equal(visiblePlanFrameItems(plan, 0, new Set()).length, 0);
  assert.equal(visiblePlanFrameItems(plan, 0, new Set([0])).filter(item => item.pathStyle === 'case-agree').length, 2);
  assert.equal(visiblePlanFrameItems(plan, 0, new Set([0])).filter(item => item.pathStyle === 'case-assignment').length, 0);
});

test('native and open restatements share one collector per exact row without losing either moment', () => {
  for (const reverse of [false, true]) {
    const agreements = [agree, { ...agree, relation: 'An authored agreement' }];
    if (reverse) agreements.reverse();
    const plan = compile([...agreements, caseClaim('pair', false)]), items = plan.frames[0].items;
    const shared = composition(items);
    assert.equal(shared.collections.length, 2);
    assert.equal(shared.rows.length, 3);
    assert(shared.collections.every(({ item }) => JSON.stringify(ownerCoordinates(item)) === '[[0,0],[0,1]]'));
    for (const played of [new Set([0]), new Set([0, 1])]) {
      assert.equal(visiblePlanFrameItems(plan, 0, played).filter(item => item.pathStyle === 'case-agree').length, 2);
    }
    for (const row of shared.rows.filter(row => row.label !== 'Case')) {
      assert.deepEqual(new Set(row.ownerIndices.flatMap(index => ownerCoordinates(items[index]).map(ref => ref[1]))), new Set([0, 1]));
    }
  }
});

test('duplicate Case records do not block native collectors or split their ownership', () => {
  for (const exactCase of [false, true]) for (const association of ['pair', 'bearer']) {
    const licensing = caseClaim(association, exactCase);
    const plan = compile([agree, licensing, structuredClone(licensing)]), shared = composition(plan.frames[0].items);
    assert.equal(shared.collections.length, 2);
    assert.equal(shared.rows.length, 3);
    assert.deepEqual(ownerCoordinates(shared.assignment), [[0, 1], [0, 2]]);
    assert(shared.collections.every(({ item }) => JSON.stringify(ownerCoordinates(item)) === '[[0,0]]'));
  }
  for (const reverse of [false, true]) {
    const agreements = [agree, { ...agree, relation: 'An authored agreement' }];
    if (reverse) agreements.reverse();
    const licensing = caseClaim('pair', false);
    const plan = compileRelationRenderPlan(agreements.map(agreement => stage([agreement, licensing])));
    const shared = composition(plan.frames[1].items);
    assert.equal(shared.collections.length, 2);
    assert.equal(shared.rows.length, 3);
    assert(shared.collections.every(({ item }) => JSON.stringify(ownerCoordinates(item)) === '[[0,0],[1,0]]'));
    assert.deepEqual(ownerCoordinates(shared.assignment), [[0, 1], [1, 1]]);
  }
});

test('same endpoints with different Case claims remain ambiguous', () => {
  const licensing = caseClaim('pair', true);
  const items = compile([agree, licensing, { ...licensing, values: { feature: 'Case', value: 'ACC' } }]).frames[0].items;
  assert.equal(items.filter(item => item.pathStyle === 'case-assignment').length, 2);
  assert.equal(items.some(item => item.pathStyle === 'case-agree'), false);
});

test('collection sharing does not merge outcomes or changed occurrence lineages', () => {
  const changed = stage([{ ...agree, relation: 'An authored agreement' }, caseClaim('pair', false)]);
  changed.workspaceForest[0].children[1].lineageId = 'a-different-subject';
  const plan = compileRelationRenderPlan([stage([agree, caseClaim('pair', false)]), changed]);
  assert.equal(plan.frames[1].items.filter(item => item.pathStyle === 'case-agree').length, 4);
  const blocked = compile([agree, { ...agree, relation: 'An authored agreement', values: { ...agree.values, outcome: 'blocked' } }, caseClaim('pair', false)]);
  assert.equal(blocked.frames[0].items.filter(item => item.pathStyle === 'case-agree').length, 4);
  for (const key of ['outcome', 'status', 'judgment']) {
    const native = compile([agree, { ...agree, values: { ...agree.values, [key]: 'blocked' } }, caseClaim('pair', false)]);
    const collectors = native.frames[0].items.filter(item => item.pathStyle === 'case-agree');
    assert.equal(collectors.length, 4, key);
    assert(collectors.every(item => planItemRelationRefs(item).length === 1));
    assert(collectors.every(item => item.outcome === undefined), 'identity checks do not invent native outcome graphics');
  }
});

test('a later Case companion does not change an earlier standalone Agree frame', () => {
  const plan = compileRelationRenderPlan([stage([agree]), stage([agree, caseClaim('pair', false)])]);
  assert.equal(plan.frames[0].items.length, 1);
  assert.equal(plan.frames[0].items[0].title, 'T probe');
  const shared = composition(plan.frames[1].items);
  assert.equal(shared.bundles.length, 1);
  assert.equal(shared.collections.length, 2);
  assert.deepEqual(ownerCoordinates(shared.bundles[0].item), [[0, 0], [1, 0]]);
  assert.equal(visiblePlanFrameItems(plan, 1, new Set()).filter(item => item.pathStyle === 'case-agree').length, 0);
});

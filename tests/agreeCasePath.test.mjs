import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { plaqueIdentity } from '../replay/relations/plaquePlacement.ts';
import { isPlanItemRevealed, planItemRelationRefs } from '../replay/relations/renderPlan.ts';

// Structural Case is a reflex of Agree (Francis, 30 Oct 2026): an Agree that
// values its goal's Case shows it on its own probe→goal path, drawn as Case.
const forest = [{ id: 'tp', label: 'TP', children: [
  { id: 'goal', label: 'DP', lineageId: 'subject', word: 'children' },
  { id: 'tbar', label: "T'", children: [
    { id: 'probe', label: 'T', lineageId: 'tense' },
    { id: 'vp', label: 'vP', children: [{ id: 'v', label: 'v' }, { id: 'other', label: 'DP', word: 'books' }] }
  ] }
] }];
const stage = relations => ({ statement: 'Completed syntax.', stageRecord: 'The authored relations.',
  workspaceForest: structuredClone(forest), relations });
const items = relations => compileRelationRenderPlan([stage(relations)]).frames[0].items;
const casePaths = list => list.filter(item => item.kind === 'directed-path' && item.pathStyle === 'case-assignment');
const plaqueRows = (list, familyId) => list.filter(item => item.kind === 'node-plaque' && item.familyId === familyId)
  .flatMap(item => item.rows.map(row => `${row.label}: ${row.value}`));
const agree = (values, relation = 'Agree', anchors = { probe: 'probe', goal: 'goal' }) => ({ relation, anchors, values });

test('an exact Agree valuing its goal\'s Case draws that Case on its probe-goal path', () => {
  for (const relation of ['Agree', 'Feature Valuation']) for (const key of ['case', 'Case']) {
    const relations = [agree({ phi: '3pl', [key]: 'nominative' }, relation)];
    const before = structuredClone(relations), list = items(relations);
    const paths = casePaths(list);
    assert.equal(paths.length, 1, `${relation} ${key}`);
    assert.deepEqual([paths[0].fromNodeId, paths[0].toNodeId, paths[0].label], ['probe', 'goal', 'nominative']);
    assert.deepEqual(planItemRelationRefs(paths[0]).map(ref => [ref.stageIndex, ref.relationIndex]), [[0, 0]]);
    assert.equal(isPlanItemRevealed(paths[0], 0, new Set()), false);
    assert.equal(isPlanItemRevealed(paths[0], 0, new Set([0])), true);
    // The path replaces the plaque's Case row; the phi row stays on the probe.
    assert.deepEqual(plaqueRows(list, 'agree.plaque'), ['phi: 3pl']);
    assert.deepEqual(relations, before);
  }
  const caseOnly = items([agree({ case: 'nominative' })]);
  assert.equal(casePaths(caseOnly).length, 1);
  assert.equal(caseOnly.some(item => item.kind === 'node-plaque' || item.kind === 'node-badges'), false);
});

test('an exact Agree and the recovered agreement it restates draw the same Case path and rows', () => {
  const shape = list => ({
    paths: list.filter(item => item.kind === 'directed-path')
      .map(item => [item.pathStyle, item.fromNodeId, item.toNodeId, item.label ?? null, item.featureRow ?? null]).sort(),
    rows: list.filter(item => item.kind === 'node-plaque').map(item => [item.anchorNodeIds, item.rows])
  });
  const values = { number: 'plural', person: 'third', case: 'nominative' };
  const exact = items([agree(values)]), recovered = items([agree(values, 'An authored agreement')]);
  assert.equal(exact[0].tier2FacetId, undefined);
  assert(recovered.some(item => item.tier2FacetId));
  assert.equal(casePaths(recovered).length, 1);
  assert.deepEqual(shape(exact), shape(recovered));
});

test('an Agree without a Case value is unchanged', () => {
  const list = items([agree({ person: 'third', number: 'plural' })]);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'node-plaque');
  assert.equal(list[0].title, 'T probe');
  assert.deepEqual(plaqueRows(list, 'agree.plaque'), ['person: third', 'number: plural']);
  const bare = items([agree(undefined)]);
  assert.deepEqual(bare.map(item => [item.kind, item.badgeStyle]), [['node-badges', 'agreement-goal']]);
});

test('an Agree never draws a Case it does not establish for its one goal', () => {
  for (const relation of [
    agree({ phi: '3pl', case: 'unvalued' }),
    agree({ phi: '3pl', case: 'nominative', outcome: 'failed' }),
    agree({ phi: '3pl', probeCase: 'nominative' }),
    agree({ phi: '3pl', case: ['nominative', 'accusative'] }),
    agree({ phi: '3pl', case: 'nominative' }, 'Agree', { probe: 'probe', goal: ['goal', 'other'] }),
    agree({ phi: '3pl', case: 'nominative' }, 'Agree', { probe: 'probe', goal: 'missing' }),
    agree({ phi: '3pl', case: 'nominative' }, 'Agree', { probe: 'probe' })
  ]) {
    const list = items([relation]);
    assert.equal(casePaths(list).length, 0, JSON.stringify(relation));
    assert.equal(list.some(item => item.pathStyle === 'case-agree'), false, JSON.stringify(relation));
  }
});

test('a separately authored Case claim and an Agree carrying the same Case draw one path', () => {
  const companions = [
    { relation: 'CaseAssignment', anchors: { assigner: 'probe', bearer: 'goal' }, values: { feature: 'Case', value: 'nominative' } },
    { relation: 'An authored licensing', anchors: { licensor: 'probe', nominal: 'goal' }, values: { case: 'nominative' } },
    agree({ case: 'nominative', number: 'plural' }, 'An authored agreement')
  ];
  for (const companion of companions) for (const reverse of [false, true]) {
    const relations = [agree({ phi: '3pl', case: 'nominative' }), companion];
    if (reverse) relations.reverse();
    const list = items(relations), paths = casePaths(list);
    assert.equal(paths.length, 1, JSON.stringify({ companion: companion.relation, reverse }));
    assert.equal(paths[0].familyId === 'agree.plaque', false);
    assert.deepEqual([paths[0].fromNodeId, paths[0].toNodeId], ['probe', 'goal']);
    // The exact Agree keeps its Case row, as it did beside a Case claim before.
    assert(plaqueRows(list, 'agree.plaque').includes('case: nominative'));
    const identities = list.filter(item => item.kind === 'node-plaque' || item.pathStyle === 'case-assignment').map(plaqueIdentity);
    assert.equal(new Set(identities).size, identities.length);
  }
});

test('two exact Agree claims valuing one goal\'s Case in a stage draw one path', () => {
  const list = items([agree({ phi: '3pl', case: 'nominative' }), agree({ number: 'plural', case: 'nominative' })]);
  const paths = casePaths(list);
  assert.equal(paths.length, 1);
  assert.deepEqual(planItemRelationRefs(paths[0]).map(ref => ref.relationIndex), [0]);
  assert.deepEqual(plaqueRows(list, 'agree.plaque').sort(), ['case: nominative', 'number: plural', 'phi: 3pl']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { caseFeatureComposition, collectionPlaque, featurePlaqueAssignment, featureRowKey } from '../replay/relations/featureComposition.ts';
import { prepareCasePlaqueRows } from '../replay/relations/plaqueTextLayout.ts';
import { dottedCollectionPath } from '../replay/relations/markGeometry.ts';
import { featureCollectionPlaquePath } from '../replay/relations/overlayGeometry.ts';
const tree = { id: 'root', label: 'PP', children: [{ id: 'p', label: 'P' }, { id: 'k', label: 'KP', children: [
  { id: 'num', label: 'Num', word: 'books' }, { id: 'n', label: 'N' }
] }] };
const compile = relations => compileRelationRenderPlan([{ statement: 'Features.', stageRecord: 'Authored associations.',
  workspaceForest: [tree], relations }]).frames[0].items;
const dependency = (values, goal = 'num') => ({ relation: 'An open dependency', anchors: { probe: 'k', goal }, values });
const assignment = { relation: 'CaseAssignment', anchors: { assigner: 'p', bearer: 'k' }, values: { feature: 'Case', value: 'DAT' } };

test('Tier 2 puts agreement-only values in a plaque and connects each exact row without inventing Case', () => {
  for (const values of [{ agreement: 'third-person singular' }, { features: ['尊敬', 'inclusive', 'inclusive'] }, { features: ['animacy: animate', 'clusivity: inclusive'] }]) {
    const original = structuredClone(values);
    const items = compile([dependency(values)]);
    const plaqueIndex = items.findIndex(item => item.kind === 'node-plaque');
    const plaque = items[plaqueIndex];
    assert.deepEqual(plaque.rows, [...new Map(Object.entries(values).flatMap(([label, value]) =>
      [value].flat().map(value => [JSON.stringify([label, value]), { label, value }]))).values()]);
    assert.deepEqual(plaque.anchorNodeIds, ['k']);
    assert.equal(plaque.title, undefined, 'no invented heading or blank heading slot');
    const paths = items.filter(item => item.kind === 'directed-path');
    assert.equal(paths.length, plaque.rows.length);
    for (const path of paths) {
      assert.equal(path.pathStyle, 'case-agree');
      assert.equal(collectionPlaque(items, path)?.index, plaqueIndex);
      assert.equal(path.toNodeId, 'num');
      assert(plaque.rows.some(row => featureRowKey(row) === featureRowKey(path.featureRow)));
    }
    assert.deepEqual(values, original);
  }
});

test('Case and Tier-2 collection compose without dropping Case or merging equal row labels', () => {
  const items = compile([assignment, dependency({ agreement: ['inclusive', 'dual'] })]);
  const index = items.findIndex(item => item.pathStyle === 'case-assignment');
  const composition = caseFeatureComposition(items, index);
  assert.deepEqual(composition.rows.map(({ label, value }) => [label, value]),
    [['Case', 'DAT'], ['agreement', 'inclusive'], ['agreement', 'dual']]);
  assert.equal(composition.collections.length, 2);
  assert.equal(featurePlaqueAssignment(items, composition.bundles[0].index), index);
  assert.deepEqual(composition.rows[0].ownerIndices, [index]);
  for (const row of composition.rows.slice(1)) assert(!row.ownerIndices.includes(index), 'Case must not reveal future agreement values');
});

test('ambiguous incoming assignments keep feature claims in their own plaques', () => {
  const cases = [
    [assignment, { ...assignment, anchors: { assigner: 'n', bearer: 'k' } }, dependency({ agreement: 'dual' })]
  ];
  for (const relations of cases) {
    const items = compile(relations);
    items.forEach((item, index) => {
      if (item.kind === 'node-plaque') assert.equal(featurePlaqueAssignment(items, index), undefined);
      if (item.pathStyle === 'case-agree') assert(collectionPlaque(items, item), 'exact own plaque is retained');
      if (item.pathStyle === 'case-assignment') assert.equal(caseFeatureComposition(items, index).collections.length, 0);
    });
  }
});

test('the complete D6 composition keeps three rows, their independent owners and its accepted short-row dimensions', () => {
  const items = compile([assignment,
    { relation: 'Agree', anchors: { probe: 'k', goal: 'num' }, values: { feature: 'Number', value: 'PL' } },
    { relation: 'Agree', anchors: { probe: 'k', goal: 'n' }, values: { feature: 'Gender', value: 'MASC' } },
    { relation: 'FeatureBundle', anchors: { bearer: 'k' }, values: { Case: 'DAT', Number: 'PL', Gender: 'MASC' } }
  ]);
  const index = items.findIndex(item => item.pathStyle === 'case-assignment');
  const composition = caseFeatureComposition(items, index);
  assert.deepEqual(composition.rows.map(({ label, value }) => [label, value]), [['Case', 'DAT'], ['Number', 'PL'], ['Gender', 'MASC']]);
  assert.equal(composition.collections.length, 2);
  const layout = prepareCasePlaqueRows(composition.rows);
  assert.equal(layout.height, 262);
  assert.deepEqual(layout.rows.map(row => row.y), [93, 155, 217]);
  assert.deepEqual(layout.rows.map(row => row.lines.length), [1, 1, 1]);
  assert.notDeepEqual(composition.rows[1].ownerIndices, composition.rows[2].ownerIndices);
});

test('collection geometry attaches to its row and feature source on either side without arrowheads', () => {
  const plaque = { x: 300, y: 100, width: 310, height: 262 };
  for (const source of [{ x: 900, y: 60, width: 60, height: 50 }, { x: 0, y: 400, width: 60, height: 50 }]) {
    const points = featureCollectionPlaquePath(plaque, 255, source).match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal(points[1], 255);
    assert.equal(points[7], source.y + source.height / 2);
    assert.equal(points[0], source.x > plaque.x ? 622 : 288);
    assert.equal(points[6], source.x > plaque.x ? source.x : source.x + source.width);
    assert.equal(points[1], points[3], 'the curve leaves the plaque horizontally');
    assert.equal(points[5], points[7], 'the curve reaches the source horizontally');
  }
});

test('plaque collections use the original Orchard geometry, including short and vertical spans', () => {
  const plaque = { x: 0, y: 0, width: 310, height: 262 };
  for (const target of [{ x: 1000, y: 70 }, { x: -500, y: 400 }, { x: 330, y: 55 },
    { x: 322, y: 500 }, { x: -12, y: -500 }]) {
    for (const lane of [0, 1, 2]) {
      const rect = { ...target, width: 0, height: 0 };
      const start = { x: target.x >= 155 ? 322 : -12, y: 50 };
      assert.equal(featureCollectionPlaquePath(plaque, 50, rect, lane), dottedCollectionPath(start, target, lane),
        'Tier 2 must use the same curve as the original drawing');
    }
  }
});

test('Case and agreement for the same pair share a plaque without changing each row owner', () => {
  const items = compile([
    { relation: 'Finite specification', anchors: { finiteHead: 'p' }, values: { number: 'singular', person: 'third' } },
    assignment,
    { relation: 'Specifier-head agreement', anchors: { head: 'p', specifier: 'k' }, values: { agreement: 'third-person singular' } }
  ]);
  const index = items.findIndex(item => item.pathStyle === 'case-assignment');
  const composition = caseFeatureComposition(items, index);
  assert.equal(composition.bundles.length, 2);
  assert.deepEqual(composition.rows.map(row => [row.label, row.value, row.ownerNodeId]), [
    ['number', 'singular', 'p'], ['person', 'third', 'p'], ['Case', 'DAT', 'k'], ['agreement', 'third-person singular', 'p']
  ]);
  for (const bundle of composition.bundles) assert.equal(featurePlaqueAssignment(items, bundle.index), index);
  const agreementRow = composition.rows.find(row => row.label === 'agreement');
  assert.equal(agreementRow.sourceNodeId, 'k');
  assert(agreementRow.ownerIndices.every(i => items[i].relationRef.relationIndex === 2));
  assert.deepEqual(composition.rows.find(row => row.label === 'Case').ownerIndices, [index]);
});

test('collections at one bearer share a shell but identical values from different sources retain separate rows', () => {
  const items = compile([assignment, dependency({ agreement: 'dual' }), dependency({ agreement: 'dual' }, 'n')]);
  const composition = caseFeatureComposition(items, items.findIndex(item => item.pathStyle === 'case-assignment'));
  const rows = composition.rows.filter(row => row.label === 'agreement');
  assert.equal(composition.bundles.length, 2);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.sourceNodeId), ['num', 'n']);
});

test('an assigner with several recipients cannot donate its standalone specification to one arbitrary Case plaque', () => {
  const items = compile([
    { relation: 'Finite specification', anchors: { finiteHead: 'p' }, values: { number: 'singular' } },
    assignment, { ...assignment, anchors: { assigner: 'p', bearer: 'n' } },
    { relation: 'Specifier-head agreement', anchors: { head: 'p', specifier: 'k' }, values: { agreement: 'third-person singular' } }
  ]);
  const spec = items.findIndex(item => item.kind === 'node-plaque' && item.rows.some(row => row.label === 'number'));
  assert.equal(featurePlaqueAssignment(items, spec), undefined);
});


test('a combined plaque uses a compact bounded width before wrapping long values', () => {
  const layout = prepareCasePlaqueRows([
    { label: 'number', value: 'singular' }, { label: 'person', value: 'third' },
    { label: 'Case', value: 'nominative' }, { label: 'agreement', value: 'third-person singular' }
  ]);
  assert.equal(layout.width, 480);
  assert(layout.height <= 480, 'the combined plaque remains eligible for a local pocket');
  assert.equal(layout.rows[2].lines.length, 1, 'Case does not wrap unnecessarily');
  assert(layout.rows[3].lines.length > 1, 'long content wraps instead of widening the tree');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { caseFeatureComposition, collectionPlaque, featurePlaqueAssignment, featureRowKey } from '../replay/relations/featureComposition.ts';
import { prepareCasePlaqueRows } from '../replay/relations/plaqueTextLayout.ts';
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
  assert.equal(featurePlaqueAssignment(items, composition.bundle.index), index);
  assert.deepEqual(composition.rows[0].ownerIndices, [index]);
  for (const row of composition.rows.slice(1)) assert(!row.ownerIndices.includes(index), 'Case must not reveal future agreement values');
});

test('separate complete claims and ambiguous incoming assignments keep their own plaques', () => {
  const cases = [
    [assignment, dependency({ agreement: 'dual' }), dependency({ agreement: 'polite' }, 'n')],
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
  }
});

test('a collection bows around opaque labels instead of cutting a hole or crossing the label', () => {
  const plaque = { x: 800, y: 240, width: 310, height: 160 }, source = { x: 0, y: 90, width: 60, height: 50 };
  const obstacle = { x: 380, y: 180, width: 70, height: 70 };
  const base = featureCollectionPlaquePath(plaque, 310, source);
  const routed = featureCollectionPlaquePath(plaque, 310, source, 0, [obstacle]);
  assert.notEqual(routed, base);
  assert.equal((routed.match(/M/g) || []).length, 1, 'one continuous collection curve');
  const p = routed.match(/-?\d+(?:\.\d+)?/g).map(Number);
  for (let i = 1; i < 300; i++) {
    const t = i / 300, u = 1 - t;
    const x = u ** 3 * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t ** 3 * p[6];
    const y = u ** 3 * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t ** 3 * p[7];
    assert(!(x > obstacle.x && x < obstacle.x + obstacle.width && y > obstacle.y && y < obstacle.y + obstacle.height));
  }
});

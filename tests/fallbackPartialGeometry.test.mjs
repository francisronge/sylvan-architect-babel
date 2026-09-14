import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame, fitFallbackGeometry } from '../replay/relations/geometryBinding.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
const node = id => ({ id, label: id });
const stage = relations => ({ statement: 'Test', stageRecord: 'Test', relations, workspaceForest: [node('a'), node('b'), node('c')] });
const plan = compileRelationRenderPlan([stage([{ relation: 'Open claim', anchors: { first: 'a', second: 'b' } }])]);
const bind = ids => bindRelationPlanFrame(plan, 0, id => ids.includes(id) ? { x: ids.indexOf(id) * 150, y: 100 } : null);
for (const visible of [['a'], ['b']]) test(`neutral fallback retains available ${visible[0]} and diagnoses its unavailable peer`, () => {
  const result = bind(visible);
  assert.deepEqual(result.primitives.filter(p => p.type === 'fallback-mark').map(p => p.nodeId), visible);
  assert.equal(result.primitives.some(p => p.type === 'segment'), false);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].nodeId, visible[0] === 'a' ? 'b' : 'a');
});
test('both available neutral participants earn their connector; no participants never invent geometry', () => {
  const result = bind(['a', 'b']);
  assert.equal(result.primitives.filter(p => p.type === 'fallback-mark').length, 2);
  assert.equal(result.primitives.filter(p => p.type === 'segment').length, 1);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(bind([]).primitives, []);
  assert.equal(bind([]).failed.length, 2);
});
test('a neutral fan keeps independent spokes and requires its actual hub for every connector', () => {
  const fan = compileRelationRenderPlan([stage([
    { relation: 'Open fan', anchors: { hub: 'a', spokes: ['b', 'c'] } }
  ])]);
  for (const [ids, expectedLinks] of [[['a', 'b'], [['a', 'b']]], [['b', 'c'], []]]) {
    const result = bindRelationPlanFrame(fan, 0, id => ids.includes(id) ? { x: id.charCodeAt(0) * 100, y: 100 } : null);
    assert.deepEqual(result.primitives.filter(p => p.type === 'fallback-mark').map(p => p.nodeId).sort(), ids);
    assert.deepEqual(result.primitives.filter(p => p.type === 'segment').map(p => p.witnessNodeIds), expectedLinks);
    assert.equal(result.failed.length, 1);
  }
});
test('partial neutral marks reserve their slots without poisoning the next independent claim', () => {
  const combined = compileRelationRenderPlan([stage([
    { relation: 'First open claim', anchors: { first: 'a', second: 'b' } },
    { relation: 'Second open claim', anchors: { first: 'a', second: 'c' } }
  ])]);
  const bound = bindRelationPlanFrame(combined, 0, id => id === 'b' ? null : { x: id === 'a' ? 100 : 400, y: 100 });
  const atA = bound.primitives.filter(p => p.type === 'fallback-mark' && p.nodeId === 'a');
  assert.deepEqual(atA.map(p => p.stackIndex), [0, 1]);
  assert.notEqual(atA[0].x, atA[1].x);
  assert.equal(bound.primitives.filter(p => p.type === 'segment').length, 1);
});

test('fitted scalar connectors and fan spokes stay attached to their exact stacked marks', () => {
  const mixed = compileRelationRenderPlan([stage([
    { relation: 'First open claim', anchors: { first: 'a', second: 'b' } },
    { relation: 'Open fan', anchors: { hub: 'b', spokes: ['a', 'c'] } },
    { relation: 'Second open claim', anchors: { first: 'a', second: 'c' } }
  ])]);
  const points = { a: { x: 50, y: 20 }, b: { x: 270, y: 80 }, c: { x: 500, y: 140 } };
  const options = { markerScale: 0.5, badgeGap: 46, laneGap: 60, connectorBaselineY: 400 };
  const bound = bindRelationPlanFrame(mixed, 0, id => points[id], options);
  const original = structuredClone(bound);
  const segments = bound.primitives.filter(primitive => primitive.type === 'segment');
  for (const fittedMarkerScale of [options.markerScale, 3]) {
    const fitted = fitFallbackGeometry(bound, { ...options, fittedMarkerScale });
    assert.deepEqual([...fitted.keys()], segments, 'each update retains its exact original primitive');
    const fresh = bindRelationPlanFrame(mixed, 0, id => points[id], { ...options, markerScale: fittedMarkerScale });
    assert.deepEqual([...fitted.values()], fresh.primitives.filter(primitive => primitive.type === 'segment'));
    const marks = fresh.primitives.filter(primitive => primitive.type === 'fallback-mark');
    for (const segment of fitted.values()) {
      const centers = segment.witnessNodeIds.map(nodeId => marks.find(mark =>
        mark.itemIndex === segment.itemIndex && mark.nodeId === nodeId));
      if (segment.route === 'counter-lane') {
        assert.deepEqual([segment.from.x, segment.to.x], centers.map(mark => mark.x).sort((a, b) => a - b));
        assert.equal(segment.laneY, options.connectorBaselineY + segment.lane * options.laneGap);
      } else {
        assert.deepEqual(segment.from, { x: centers[0].x, y: centers[0].y });
        assert.deepEqual(segment.to, { x: centers[1].x, y: centers[1].y });
        const [x1, y1, x2, y2] = segment.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
        assert.ok(Math.abs(Math.hypot(x1 - segment.from.x, y1 - segment.from.y) - 10 * fittedMarkerScale) < 0.1);
        assert.ok(Math.abs(Math.hypot(x2 - segment.to.x, y2 - segment.to.y) - 10 * fittedMarkerScale) < 0.1);
      }
    }
  }
  assert.deepEqual(bound, original, 'Fit does not mutate the bound frame or its source geometry');
});

test('fitted stack offsets can reverse endpoints and require a different collision lane', () => {
  const claimStage = stage([
    { relation: 'Earlier context', anchors: { participant: 'a' } },
    { relation: 'First open claim', anchors: { first: 'a', second: 'b' } },
    { relation: 'Second open claim', anchors: { first: 'c', second: 'd' } }
  ]);
  claimStage.workspaceForest.push(node('d'));
  const p = compileRelationRenderPlan([claimStage]);
  const points = { a: { x: 0, y: 0 }, b: { x: 60, y: 0 }, c: { x: 80, y: 0 }, d: { x: 100, y: 0 } };
  const options = { markerScale: 0.5, badgeGap: 46, laneGap: 5, connectorBaselineY: 200 };
  const bound = bindRelationPlanFrame(p, 0, id => points[id], options);
  const original = structuredClone(bound);
  const before = bound.primitives.filter(primitive => primitive.type === 'segment');
  assert.deepEqual(before.map(segment => segment.lane), [0, 0]);
  const fitted = [...fitFallbackGeometry(bound, { ...options, fittedMarkerScale: 3 }).values()];
  assert.deepEqual([before[0].from.x, before[0].to.x], [23, 60]);
  assert.deepEqual([fitted[0].from.x, fitted[0].to.x], [60, 138]);
  assert.deepEqual(fitted.map(segment => segment.lane), [0, 1]);
  assert.deepEqual(fitted.map(segment => segment.laneY), [200, 205]);
  assert.deepEqual(fitted[0].witnessNodeIds, ['a', 'b'], 'geometry never changes authored participant identity');
  assert.deepEqual(bound, original);
});

test('organizational rails remain below the deepest fitted connector lane', () => {
  const ids = Array.from({ length: 4 }, (_, i) => [`a${i}`, `b${i}`]).flat();
  const points = new Map(ids.map(id => [id, { x: Number(id[1]) * 300 + (id[0] === 'b' ? 250 : 0), y: 0 }]));
  const relations = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 10; j++) relations.push({ relation: `Context ${i} ${j}`,
      anchors: { participant: `a${i}` }, values: { information: String(j) } });
    relations.push({ relation: `Pair ${i}`, anchors: { first: `a${i}`, second: `b${i}` } });
  }
  relations.push({ relation: 'Large set', anchors: { members: ids } });
  const p = compileRelationRenderPlan([{ ...stage(relations), workspaceForest: ids.map(node) }]);
  const options = { markerScale: 0.5, badgeGap: 46, laneGap: 60, connectorBaselineY: 200, railBaseY: 240 };
  const bound = bindRelationPlanFrame(p, 0, id => points.get(id), options);
  const original = structuredClone(bound);
  const rail = bound.primitives.find(primitive => primitive.type === 'anchor-set-rail');
  assert.equal(rail.y, 290);
  const fitted = fitFallbackGeometry(bound, { ...options, fittedMarkerScale: 3 });
  assert.deepEqual([...fitted.values()].filter(primitive => primitive.type === 'segment').map(segment => segment.laneY),
    [200, 260, 320, 380]);
  assert.equal(fitted.get(rail).y, 470, 'the rail follows the last lane with the existing 90-unit clearance');
  const fresh = bindRelationPlanFrame(p, 0, id => points.get(id), { ...options, markerScale: 3 });
  assert.deepEqual([...fitted.values()], fresh.primitives.filter(primitive => primitive.type === 'segment')
    .concat(fresh.primitives.filter(primitive => primitive.type === 'anchor-set-rail')));
  assert.deepEqual(bound, original);
});

test('specialized two-occurrence coindex remains atomic', () => {
  const specialized = structuredClone(plan);
  specialized.frames[0].items = [{ kind: 'coindex', nodeIds: ['a', 'b'], index: 'i', relationRef: plan.frames[0].items[0].relationRef }];
  const bound = bindRelationPlanFrame(specialized, 0, id => id === 'a' ? { x: 100, y: 100 } : null);
  assert.deepEqual(bound.primitives, []);
  assert.equal(bound.failed.length, 1);
});
test('Astra wh licensing draws C at F32 and adds its future operator only at F33', () => {
  const records = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
  const record = records.find(r => r.name === 'astra-xbar');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const p = compileRelationRenderPlan(record.derivationStages);
  p.frames[4].items = p.frames[4].items.filter(i => i.kind === 'fallback' && i.relationRef.stageIndex === 4 && i.relationRef.relationIndex === 0);
  assert.equal(p.frames[4].items.length, 1);
  for (const [frame, expected] of [[31, ['questionC']], [32, ['frontedNP', 'questionC']]]) {
    const visible = new Set(steps[frame].replayVisibleNodeIds);
    const bound = bindRelationPlanFrame(p, 4, id => visible.has(id) ? { x: 100, y: 100 } : null);
    assert.deepEqual(bound.primitives.filter(p => p.type === 'fallback-mark').map(p => p.nodeId), expected);
    assert.equal(bound.primitives.some(p => p.type === 'segment'), frame === 32);
    assert.match(steps[frame].movementDiagnostics.join('\n'), /RELATION_TIMING_CONFLICT/);
  }
});

test('the production reveal filter keeps neutral badges independent of hidden peers', () => {
  const source = ts.createSourceFile('TreeVisualizer.tsx', fs.readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let guard;
  const find = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'primitiveWitnessesVisible') guard = node.initializer;
    ts.forEachChild(node, find);
  };
  find(source);
  assert(guard, 'exercise the guard actually used by production drawing');
  const frames = [{ kind: 'fallback' }, { kind: 'coindex' }];
  const visible = new Set(['a']);
  const reveal = new Function('frameItems', 'resolveOverlayAnchor', 'itemWitnessesVisible',
    ts.transpile(`return ${guard.getText(source)};`, { target: ts.ScriptTarget.ES2023 }))(
    frames, id => visible.has(id), () => false);
  assert.equal(reveal({ type: 'fallback-mark', itemIndex: 0, nodeId: 'a' }), true);
  assert.equal(reveal({ type: 'fallback-mark', itemIndex: 0, nodeId: 'b' }), false);
  assert.equal(reveal({ type: 'segment', itemIndex: 0, witnessNodeIds: ['a', 'b'] }), false);
  assert.equal(reveal({ type: 'index-badge', itemIndex: 1, nodeId: 'a' }), false, 'specialized coindex stays atomic');
  visible.add('b');
  assert.equal(reveal({ type: 'segment', itemIndex: 0, witnessNodeIds: ['a', 'b'] }), true);
});

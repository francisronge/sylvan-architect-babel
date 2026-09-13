import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
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

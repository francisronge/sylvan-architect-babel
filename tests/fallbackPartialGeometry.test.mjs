import fs from 'node:fs';
import { createPrimitiveVisibility } from '../components/renderer/relationVisibility.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { anchorSetRailPaths, fitFallbackGeometry } from '../replay/relations/fallbackGeometry.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { adaptDerivationStagesForReplay } from '../replay/authoredFrames.ts';
import { buildPlaybackStepsFromDerivationFrames } from '../replay/replayCompiler.ts';
import { buildReplayPanelContent } from '../replay/replayPanel.ts';
import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import { FALLBACK_ROLE_STYLE } from '../replay/relations/fallbackGeometry.ts';
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

test('Orchard marks clear measured labels; scalar links start below subtrees, fans at their own marks', () => {
  const p = compileRelationRenderPlan([stage([
    { relation: 'Pair', anchors: { first: 'a', second: 'b' } },
    { relation: 'Fan', anchors: { hub: 'a', spokes: ['b', 'c'] } }
  ])]);
  const labels = { a: { x: 0, y: 0, width: 30, height: 20 },
    b: { x: 200, y: 40, width: 30, height: 20 }, c: { x: 400, y: 0, width: 30, height: 20 } };
  const subtrees = Object.fromEntries(Object.entries(labels).map(([id, rect]) => [id, { ...rect, height: 250 }]));
  const fallbackMeasurements = { labels: Object.values(labels), labelFor: id => labels[id],
    subtreeFor: id => subtrees[id], bottom: 290 };
  const options = { markerScale: 1, fallbackMeasurements };
  const bound = bindRelationPlanFrame(p, 0, id => ({ x: labels[id].x + 15, y: labels[id].y + 10 }), options);
  const original = structuredClone(bound);
  const sameScale = fitFallbackGeometry(bound, { ...options, fittedMarkerScale: 1 });
  for (const mark of bound.primitives.filter(p => p.type === 'fallback-mark')) {
    assert.equal(sameScale.get(mark).x, mark.x);
    assert.equal(sameScale.get(mark).y, mark.y);
  }
  for (const scale of [0.5, 1, 3]) {
    const updates = fitFallbackGeometry(bound, { ...options, fittedMarkerScale: scale });
    const marks = [...updates.values()].filter(p => p.type === 'fallback-mark');
    for (const mark of marks) {
      assert.ok(!Object.values(labels).some(rect => mark.x + 9 * scale > rect.x && mark.x - 9 * scale < rect.x + rect.width
        && mark.y + 9 * scale > rect.y && mark.y - 9 * scale < rect.y + rect.height));
    }
    const pair = [...updates.values()].find(p => p.type === 'segment' && p.route === 'counter-lane');
    assert.deepEqual(pair.from, { x: 15, y: 250 });
    assert.deepEqual(pair.to, { x: 215, y: 290 });
    assert.equal(pair.laneY, 290 + 34 * scale);
    for (const fan of [...updates.values()].filter(p => p.type === 'segment' && p.route === 'direct')) {
      const exact = fan.witnessNodeIds.map(id => marks.find(m => m.nodeId === id && m.itemIndex === fan.itemIndex));
      assert.deepEqual(fan.from, { x: exact[0].x, y: exact[0].y });
      assert.deepEqual(fan.to, { x: exact[1].x, y: exact[1].y });
      const [x, y] = fan.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.ok(Math.abs(x - fan.from.x) >= (exact[0].textWidth / 2 + 4) * scale - 0.1
        || Math.abs(y - fan.from.y) >= 12 * scale - 0.1, 'the line starts outside its role text');
    }
  }
  assert.deepEqual(bound, original);
});

test('dense shared witnesses reserve distinct marks and organizational rails follow the fitted ownership', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  // A wholly neutral set's rail joins its own badges from its moment; a rail
  // beside a recognized role still joins the neutral numerals drawn there.
  for (const [large, joins] of [[{ relation: 'Large set', anchors: { members: ids } }, 'anchor-set-badge'],
    [{ relation: 'Current forms', anchors: { context: ids, verb: ids }, values: { verbForm: ids.map(() => 'past') } }, 'fallback-mark']]) {
    const relations = Array.from({ length: 8 }, (_, i) => ({ relation: `Context ${i}`, anchors: { participant: 'a' } }));
    relations.push(large);
    const p = compileRelationRenderPlan([{ ...stage(relations), workspaceForest: ids.map(node) }]);
    const bound = bindRelationPlanFrame(p, 0, id => ({ x: ids.indexOf(id) * 300, y: 0 }));
    const updates = fitFallbackGeometry(bound, { fittedMarkerScale: 2 });
    const atA = [...updates.values()].filter(p => p.type === 'fallback-mark' && p.nodeId === 'a');
    assert.equal(new Set(atA.map(mark => `${mark.x}:${mark.y}`)).size, atA.length);
    const rail = bound.primitives.find(p => p.type === 'anchor-set-rail');
    assert(rail.anchors.every(anchor => anchor.type === joins), `${large.relation} joins ${joins}`);
    const fittedRail = updates.get(rail);
    assert.deepEqual(fittedRail.anchors.map(a => a.nodeId), ids);
    for (const [i, mark] of rail.anchors.entries()) assert.deepEqual(fittedRail.anchors[i], updates.get(mark)
      ?? { ...mark, y: mark.y + (mark.stackIndex + 1) * 22 * (2 - 1) });
    assert.equal(anchorSetRailPaths(fittedRail, 2).joins.split('M ').length - 1, ids.length);
  }
});

test('neutral roles reserve plaque space before reveal and retain that clearance at Fit', () => {
  const p = compileRelationRenderPlan([stage([{ relation: 'Context', anchors: { witness: 'a' } }])]);
  const label = { x: 0, y: 0, width: 30, height: 20 };
  const plaque = { x: 31, y: -30, width: 200, height: 100 };
  const measurements = { labels: [label], labelFor: () => label, subtreeFor: () => label, bottom: 20 };
  const overlaps = (mark, scale) => mark.x + (mark.textWidth / 2 + 4) * scale > plaque.x
    && mark.x - (mark.textWidth / 2 + 4) * scale < plaque.x + plaque.width
    && mark.y + 12 * scale > plaque.y && mark.y - 12 * scale < plaque.y + plaque.height;
  const bind = fallbackMeasurements => bindRelationPlanFrame(p, 0, () => ({ x: 15, y: 10 }), { fallbackMeasurements });
  const unreserved = bind(measurements);
  assert(overlaps(unreserved.primitives.find(p => p.type === 'fallback-mark'), 1), 'reproduce the missing plaque clearance');
  const fallbackMeasurements = { ...measurements, obstacles: [plaque] };
  const bound = bind(fallbackMeasurements);
  const mark = bound.primitives.find(p => p.type === 'fallback-mark');
  assert(!overlaps(mark, 1));
  for (const scale of [0.5, 1, 3]) {
    const fitted = fitFallbackGeometry(bound, { fallbackMeasurements, fittedMarkerScale: scale }).get(mark);
    assert(!overlaps(fitted, scale), `Fit preserves plaque clearance at scale ${scale}`);
  }
  assert.deepEqual(bind({ ...measurements, obstacles: [{ ...plaque, x: 10000 }] }), unreserved,
    'a distant plaque leaves accepted geometry unchanged');
});

const sampleConnector = d => {
  const tokens = d.match(/[MLQ]|-?\d+(?:\.\d+)?/g), points = [];
  let i = 0, current;
  const point = () => ({ x: Number(tokens[i++]), y: Number(tokens[i++]) });
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M') { current = point(); points.push(current); continue; }
    const control = command === 'Q' ? point() : null, end = point();
    for (let j = 1; j <= 100; j++) {
      const t = j / 100, u = 1 - t;
      points.push(control ? { x: u * u * current.x + 2 * u * t * control.x + t * t * end.x,
        y: u * u * current.y + 2 * u * t * control.y + t * t * end.y }
        : { x: current.x * u + end.x * t, y: current.y * u + end.y * t });
    }
    current = end;
  }
  return points;
};

test('neutral connectors keep straight stems while lower lanes clear plaques', () => {
  const labels = { a: { x: 0, y: 100, width: 20, height: 20 }, b: { x: 300, y: 0, width: 20, height: 20 } };
  const plaques = [{ x: 100, y: 140, width: 80, height: 80 }];
  const measurements = { labels: Object.values(labels), labelFor: id => labels[id], subtreeFor: id => labels[id], bottom: 400 };
  const bind = fallbackMeasurements => bindRelationPlanFrame(plan, 0, id => ({ x: labels[id].x + 10, y: labels[id].y + 10 }), { fallbackMeasurements });
  const crosses = (path, box) => sampleConnector(path).some(p => p.x > box.x && p.x < box.x + box.width
    && p.y > box.y && p.y < box.y + box.height);
  const before = bind(measurements);
  const beforePath = before.primitives.find(p => p.type === 'segment');
  assert(plaques.every(box => crosses(beforePath.d, box)), 'reproduce the lower-lane collision');
  const fallbackMeasurements = { ...measurements, obstacles: plaques };
  const after = bind(fallbackMeasurements), segment = after.primitives.find(p => p.type === 'segment');
  for (const fitted of [segment, ...[0.5, 1, 3, 12].map(fittedMarkerScale =>
    fitFallbackGeometry(after, { fallbackMeasurements, fittedMarkerScale }).get(segment))]) {
    assert(plaques.every(box => !crosses(fitted.d, box)), 'the full rounded connector clears every plaque');
    assert.deepEqual(fitted.witnessNodeIds, beforePath.witnessNodeIds);
    assert.deepEqual(fitted.from, beforePath.from);
    assert.deepEqual(fitted.to, beforePath.to);
    assert.equal((fitted.d.match(/Q/g) ?? []).length, 2, 'only the two accepted bottom corners');
    assert.equal((fitted.d.match(/L/g) ?? []).length, 3, 'no additional doglegs');
  }
  assert.deepEqual(bind({ ...measurements, obstacles: [{ x: 10000, y: 0, width: 100, height: 100 }] }), before,
    'clear connectors and labels keep their exact existing geometry');
  const shared = structuredClone(plan);
  shared.frames[0].items.push(...structuredClone(shared.frames[0].items));
  const links = bindRelationPlanFrame(shared, 0, id => ({ x: labels[id].x + 10, y: labels[id].y + 10 }),
    { fallbackMeasurements }).primitives.filter(p => p.type === 'segment');
  assert.equal(new Set(links.map(link => link.laneY)).size, links.length,
    'clearing a wide plaque cannot collapse separate lower lanes');
});

test('role text yields to reserved connector stems instead of creating long detours', () => {
  const p = compileRelationRenderPlan([stage([
    { relation: 'Open claim', anchors: { first: 'a', second: 'b' } },
    { relation: 'Context', anchors: { longNamedWitness: 'c' } }
  ])]);
  const labels = { a: { x: 0, y: 0, width: 20, height: 20 }, b: { x: 300, y: 0, width: 20, height: 20 },
    c: { x: -100, y: 200, width: 20, height: 20 } };
  const fallbackMeasurements = { labels: Object.values(labels), labelFor: id => labels[id],
    subtreeFor: id => labels[id], bottom: 300 };
  const bound = bindRelationPlanFrame(p, 0, id => ({ x: labels[id].x + 10, y: labels[id].y + 10 }), { fallbackMeasurements });
  const mark = bound.primitives.find(p => p.type === 'fallback-mark' && p.nodeId === 'c');
  assert(mark.x - mark.textWidth / 2 < 10 && mark.x + mark.textWidth / 2 > 10,
    'the former side position overlaps the existing vertical stem');
  const fitted = fitFallbackGeometry(bound, { fallbackMeasurements, fittedMarkerScale: 1 });
  const text = fitted.get(mark);
  const paths = [...fitted.values()].filter(p => p.type === 'segment');
  assert(paths.every(path => !sampleConnector(path.d).some(point => Math.abs(point.x - text.x) < text.textWidth / 2
    && Math.abs(point.y - text.y) < 12)), 'fitted role text clears the entire connector');
  assert(paths.every(path => path.d === bound.primitives.find(p => p.type === 'segment').d),
    'the accepted connector stays straight');
});

test('a long neutral role uses nearby vertical space when both sides leave the fitted viewport', () => {
  const p = compileRelationRenderPlan([stage([{ relation: 'Context', anchors: { witness: 'a' } }])]);
  const label = { x: 490, y: 100, width: 20, height: 30 };
  const fallbackMeasurements = { labels: [label], labelFor: () => label, subtreeFor: () => label, bottom: 130 };
  const bound = bindRelationPlanFrame(p, 0, () => ({ x: 500, y: 115 }), { fallbackMeasurements });
  const mark = bound.primitives.find(p => p.type === 'fallback-mark');
  mark.textWidth = 600;
  const options = { fittedMarkerScale: 1, fallbackMeasurements };
  const original = structuredClone(bound);
  const withoutBounds = fitFallbackGeometry(bound, options).get(mark);
  assert.ok(withoutBounds.x + 304 > 1000, 'reproduce the offscreen side placement');
  const fittedViewport = { x: 0, y: 0, width: 1000, height: 300 };
  const fitted = fitFallbackGeometry(bound, { ...options, fittedViewport }).get(mark);
  assert.equal(fitted.x, 500);
  assert.ok(fitted.y + 12 < label.y, 'the complete role clears its syntax label');
  assert.ok(fitted.x - 304 >= 0 && fitted.x + 304 <= 1000 && fitted.y - 12 >= 0);
  assert.deepEqual(bound, original, 'fitting leaves the authored allocation untouched');

  mark.textWidth = 60;
  assert.deepEqual(fitFallbackGeometry(bound, { ...options, fittedViewport }).get(mark),
    fitFallbackGeometry(bound, options).get(mark), 'ordinary accepted positions do not change');
  mark.textWidth = 2000;
  assert.deepEqual(fitFallbackGeometry(bound, { ...options, fittedViewport }).get(mark),
    fitFallbackGeometry(bound, options).get(mark), 'impossible containment preserves readable text for panning without looping');
});

test('specialized two-occurrence coindex remains atomic', () => {
  const specialized = structuredClone(plan);
  specialized.frames[0].items = [{ kind: 'coindex', nodeIds: ['a', 'b'], index: 'i', relationRef: plan.frames[0].items[0].relationRef }];
  const bound = bindRelationPlanFrame(specialized, 0, id => id === 'a' ? { x: 100, y: 100 } : null);
  assert.deepEqual(bound.primitives, []);
  assert.equal(bound.failed.length, 1);
});

test('two organizational roles sharing nodes join their own badges', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const p = compileRelationRenderPlan([{ ...stage([{ relation: 'Open list', anchors: { members: ids } }]), workspaceForest: ids.map(node) }]);
  const item = p.frames[0].items.find(item => item.kind === 'anchor-set');
  item.showBadges = true;
  item.set.roles.push({ ...item.set.roles[0], role: 'other', anchors: [...item.set.roles[0].anchors].reverse() });
  p.frames[0].items = [item];
  const bound = bindRelationPlanFrame(p, 0, id => ({ x: ids.indexOf(id) * 100, y: 0 }));
  const rails = bound.primitives.filter(primitive => primitive.type === 'anchor-set-rail');
  assert.deepEqual(rails.map(rail => rail.anchors.map(anchor => anchor.nodeId)), [ids, [...ids].reverse()]);
  assert.ok(rails[0].anchors.every(anchor => !rails[1].anchors.includes(anchor)), 'a shared node does not merge distinct role marks');
});
test('Astra wh licensing waits for the movement that introduces its operator, then marks C and the operator together', () => {
  const records = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
  const record = records.find(r => r.name === 'astra-xbar');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const p = compileRelationRenderPlan(record.derivationStages);
  p.frames[4].items = p.frames[4].items.filter(i => i.kind === 'fallback' && i.relationRef.stageIndex === 4 && i.relationRef.relationIndex === 0);
  assert.equal(p.frames[4].items.length, 1);
  const moments = steps.filter(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === 4);
  assert.deepEqual(moments.slice(0, 2).map(step => step.replayRelationIdentity.relationIndex), [1, 0],
    'the A′-chain that introduces frontedNP plays first');
  const [movement, licensing] = moments;
  assert.ok(!steps[steps.indexOf(movement) - 1].replayVisibleNodeIds.includes('frontedNP'), 'the operator is not revealed early');
  const visible = new Set(licensing.replayVisibleNodeIds);
  const bound = bindRelationPlanFrame(p, 4, id => visible.has(id) ? { x: 100, y: 100 } : null);
  assert.deepEqual(bound.primitives.filter(p => p.type === 'fallback-mark').map(p => p.nodeId), ['frontedNP', 'questionC']);
  assert.ok(bound.primitives.some(p => p.type === 'segment'));
  assert.ok(!steps.some(step => step.movementDiagnostics?.some(message => message.includes('RELATION_TIMING_CONFLICT'))));
});

test('the production reveal filter keeps neutral badges independent of hidden peers', () => {
  const frames = [{ kind: 'fallback' }, { kind: 'coindex', nodeIds: ['a', 'b'] }];
  const visible = new Set(['a']);
  const reveal = createPrimitiveVisibility(frames, id => visible.has(id) ? {x: 0, y: 0} : null);
  assert.equal(reveal({ type: 'fallback-mark', itemIndex: 0, nodeId: 'a' }), true);
  assert.equal(reveal({ type: 'fallback-mark', itemIndex: 0, nodeId: 'b' }), false);
  assert.equal(reveal({ type: 'segment', itemIndex: 0, witnessNodeIds: ['a', 'b'] }), false);
  assert.equal(reveal({ type: 'index-badge', itemIndex: 1, nodeId: 'a' }), false, 'specialized coindex stays atomic');
  visible.add('b');
  assert.equal(reveal({ type: 'segment', itemIndex: 0, witnessNodeIds: ['a', 'b'] }), true);
});

test('fan labels keep authored roles and repeated witnesses have exact connector ownership', () => {
  const relation = { relation: 'Open fan', anchors: { exactHub: 'a', exactItems: ['b', 'b', 'a'] } };
  const stages = [stage([relation])];
  const plan = compileRelationRenderPlan(stages);
  const bound = bindRelationPlanFrame(plan, 0, id => ({ x: id === 'a' ? 0 : 400, y: 0 }));
  const marks = bound.primitives.filter(p => p.type === 'fallback-mark');
  assert.deepEqual(marks.map(m => [m.role, m.text]), [
    ['exactHub', 'exact Hub'], ['exactItems', 'exact Items[1]'], ['exactItems', 'exact Items[2]'], ['exactItems', 'exact Items[3]']
  ]);
  const fitted = fitFallbackGeometry(bound, { fittedMarkerScale: 2 });
  const fan = [...fitted.values()].filter(p => p.type === 'segment');
  assert.equal(new Set(fan.map(p => p.toMark)).size, 2, 'a role sharing the hub node does not create a self-connection');
  fan.forEach((line, i) => {
    const target = fitted.get(marks[i + 1]);
    assert.deepEqual(line.to, { x: target.x, y: target.y });
  });
  assert.deepEqual(stages[0].relations, [relation]);
});

test('separate Replay moments cannot displace or clip one another, including owned rails', () => {
  const fan = { relation: 'Open fan', anchors: { hub: 'a', members: ['a', 'b', 'c'] } };
  const contexts = Array.from({ length: 8 }, (_, i) => ({ relation: `Context ${i}`, anchors: { role: 'a', peer: 'b' } }));
  const options = { separateFallbackMoments: true };
  const bind = relations => bindRelationPlanFrame(compileRelationRenderPlan([stage(relations)]), 0,
    id => ({ x: ['a', 'b', 'c'].indexOf(id) * 300, y: 0 }), options);
  const alone = bind([fan]);
  const together = bind([...contexts, fan]);
  const shape = (bound, scale) => [...fitFallbackGeometry(bound, { ...options, fittedMarkerScale: scale }).values()]
    .filter(p => p.type === 'fallback-mark' ? p.role === 'hub' || p.role === 'members'
      : p.type === 'segment' && p.route === 'direct')
    .map(p => p.type === 'fallback-mark' ? [p.type, p.text, p.x, p.y] : [p.type, p.d]);
  for (const scale of [1, 3, 6]) assert.deepEqual(shape(together, scale), shape(alone, scale));
  const marks = [...fitFallbackGeometry(together, { ...options, fittedMarkerScale: 3 }).values()]
    .filter(p => p.type === 'fallback-mark' && ['hub', 'members'].includes(p.role));
  assert.equal(new Set(marks.map(m => `${m.x}:${m.y}`)).size, marks.length, 'roles visible together still reserve separate positions');
  const large = compileRelationRenderPlan([{ ...stage([...contexts, { relation: 'Set', anchors: { members: ['a', 'b', 'c', 'd', 'e'] } }]),
    workspaceForest: ['a', 'b', 'c', 'd', 'e'].map(node) }]);
  const bound = bindRelationPlanFrame(large, 0, id => ({ x: id.charCodeAt(0) * 300, y: 0 }), options);
  const fitted = fitFallbackGeometry(bound, { ...options, fittedMarkerScale: 3 });
  const rail = bound.primitives.find(p => p.type === 'anchor-set-rail');
  // A wholly neutral set's rail joins its own badges, which Fit lowers with the badge gap.
  assert(rail.anchors.every(anchor => anchor.type === 'anchor-set-badge'));
  assert.deepEqual(fitted.get(rail).anchors, rail.anchors.map(mark => fitted.get(mark)
    ?? { ...mark, y: mark.y + (mark.stackIndex + 1) * 22 * (3 - 1) }));
});

test('a role placed above its node clears text height without drifting by its width', () => {
  const p = compileRelationRenderPlan([stage([{ relation: 'Context', anchors: { aLongAuthoredParticipantRole: 'a' } }])]);
  const label = { x: 500, y: 100, width: 20, height: 20 };
  const measurements = { labels: [label], labelFor: () => label, subtreeFor: () => label, bottom: 120,
    obstacles: [{ x: 0, y: 100, width: 500, height: 40 }, { x: 520, y: 100, width: 500, height: 40 }] };
  const bound = bindRelationPlanFrame(p, 0, () => ({ x: 510, y: 110 }), { fallbackMeasurements: measurements });
  const mark = bound.primitives.find(p => p.type === 'fallback-mark');
  assert.deepEqual({ x: mark.x, y: mark.y }, { x: 510, y: 85 });
});

test('straight connectors leave gaps around all crossed labels, including non-endpoints', async () => {
  const { clearLabelPath } = await import('../replay/relations/fallbackGeometry.ts');
  const box = { x: 40, y: 40, width: 20, height: 20 };
  assert.equal(clearLabelPath({ x: 0, y: 0 }, { x: 100, y: 100 }, [box]),
    'M 0.0 0.0 L 40.0 40.0 M 60.0 60.0 L 100.0 100.0');
  assert.equal(clearLabelPath({ x: 50, y: 0 }, { x: 50, y: 100 }, [box]),
    'M 50.0 0.0 L 50.0 40.0 M 50.0 60.0 L 50.0 100.0');
  assert.equal(clearLabelPath({ x: 0, y: 10 }, { x: 100, y: 10 }, [box]),
    'M 0.0 10.0 L 100.0 10.0');
});

test('counter-lane stems clear intervening syntax while keeping their original endpoints and lower lane', () => {
  const labels = { a: { x: 0, y: 0, width: 30, height: 20 }, b: { x: 200, y: 200, width: 30, height: 20 } };
  const intervening = { x: 0, y: 90, width: 30, height: 30 };
  const measurements = { labels: [...Object.values(labels), intervening], labelFor: id => labels[id],
    subtreeFor: id => labels[id], bottom: 220 };
  const bound = bindRelationPlanFrame(plan, 0, id => ({ x: labels[id].x + 15, y: labels[id].y }), { fallbackMeasurements: measurements });
  for (const scale of [0.5, 1, 3]) {
    const segment = [...fitFallbackGeometry(bound, { fittedMarkerScale: scale, fallbackMeasurements: measurements }).values()]
      .find(p => p.type === 'segment');
    assert.deepEqual(segment.from, { x: 15, y: 20 });
    assert.deepEqual(segment.to, { x: 215, y: 220 });
    assert.equal(segment.laneY, 220 + 34 * scale);
    const straightPieces = [...segment.d.matchAll(/M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)/g)].map(m => m.slice(1).map(Number));
    const leftStem = straightPieces.filter(([x1,,x2]) => x1 === 15 && x2 === 15);
    assert.equal(leftStem.length, 2);
    for (const [,y1,,y2] of leftStem) assert.ok(Math.max(y1,y2) <= 90 || Math.min(y1,y2) >= 120);
  }
});

test('a local scalar connector does not descend to unrelated deep syntax', () => {
  const labels = { a: { x: 0, y: 0, width: 30, height: 20 }, b: { x: 60, y: 200, width: 30, height: 20 } };
  const deep = { x: 600, y: 1800, width: 90, height: 30 };
  const measurements = { labels: [...Object.values(labels), deep], labelFor: id => labels[id],
    subtreeFor: id => labels[id], bottom: 1830 };
  const options = { fallbackMeasurements: measurements, connectorBaselineY: 1900 };
  const bound = bindRelationPlanFrame(plan, 0, id => ({ x: labels[id].x + 15, y: labels[id].y }), options);
  assert.equal(bound.primitives.find(p => p.type === 'segment').laneY, 254);
  for (const scale of [0.5, 1, 3]) {
    const segment = [...fitFallbackGeometry(bound, { ...options, fittedMarkerScale: scale }).values()]
      .find(p => p.type === 'segment');
    assert.deepEqual(segment.from, { x: 15, y: 20 });
    assert.deepEqual(segment.to, { x: 75, y: 220 });
    assert.equal(segment.laneY, 220 + 34 * scale);
  }
  const obstacle = { x: 35, y: 235, width: 20, height: 50 };
  const blocked = bindRelationPlanFrame(plan, 0, id => ({ x: labels[id].x + 15, y: labels[id].y }), {
    ...options, fallbackMeasurements: { ...measurements, obstacles: [obstacle] }
  });
  assert.equal(blocked.primitives.find(p => p.type === 'segment').laneY, 297,
    'a plaque in the local lane still requires clearance');
});

test('a counter lane drops below unrelated tree text it would run through, not below the whole tree', () => {
  // bughunt 09-en-do-support stage 5: the lane under the lower T ran through the
  // word "John" of the subject between the two participants.
  const labels = { a: { x: 0, y: 0, width: 30, height: 20 }, b: { x: 200, y: 200, width: 30, height: 20 } };
  const word = { x: 80, y: 240, width: 100, height: 40 };
  const deep = { x: 600, y: 1800, width: 90, height: 30 };
  const measurements = { labels: [...Object.values(labels), word, deep], labelFor: id => labels[id],
    subtreeFor: id => labels[id], bottom: 1830 };
  const bound = bindRelationPlanFrame(plan, 0, id => ({ x: labels[id].x + 15, y: labels[id].y }), { fallbackMeasurements: measurements });
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
  close(bound.primitives.find(p => p.type === 'segment').laneY, 293.2);
  // At scale 1 the lane at 254 runs through the word: it takes the gap below,
  // three units under the word plus its turn (8) and half its shadow (2.2). At
  // 0.5 and 3 its turns and run already clear the word's three units, so it stays.
  for (const [scale, laneY] of [[0.5, 237], [1, 293.2], [3, 322]]) {
    const segment = [...fitFallbackGeometry(bound, { fittedMarkerScale: scale, fallbackMeasurements: measurements }).values()]
      .find(p => p.type === 'segment');
    close(segment.laneY, laneY);
    assert.ok(segment.laneY + 2.2 * scale <= word.y - 3 * scale
      || segment.laneY - 10.2 * scale >= word.y + word.height + 3 * scale, 'the turns and run keep clear of the word');
  }
  // Rows of text with no gap for the lane within one tree row (220 units) below
  // its local floor keep that floor rather than descending past all of them.
  const rows = Array.from({ length: 6 }, (_, index) => ({ x: 80, y: 240 + 50 * index, width: 100, height: 40 }));
  const dense = { ...measurements, labels: [...Object.values(labels), ...rows] };
  const crowded = bindRelationPlanFrame(plan, 0, id => ({ x: labels[id].x + 15, y: labels[id].y }), { fallbackMeasurements: dense });
  close(crowded.primitives.find(p => p.type === 'segment').laneY, 254);
});

test('future labels and plaques reserve space without cutting holes in current connectors', () => {
  const segment = { type: 'segment', itemIndex: 0, route: 'direct', lane: null,
    from: { x: 0, y: 100 }, to: { x: 500, y: 100 }, witnessNodeIds: ['a', 'b'], d: '' };
  const frame = { stageIndex: 0, primitives: [segment], failed: [] };
  const label = { x: 100, y: 80, width: 80, height: 40 };
  const plaque = { x: 300, y: 80, width: 80, height: 40 };
  const measurements = { labels: [label], obstacles: [plaque], visibleLabels: [], visibleObstacles: [],
    labelFor: () => null, subtreeFor: () => null, bottom: 120 };
  const fit = fallbackMeasurements => fitFallbackGeometry(frame, { fittedMarkerScale: 1, fallbackMeasurements }).get(segment);
  const hidden = fit(measurements);
  assert.equal(hidden.d, 'M 0.0 100.0 L 500.0 100.0');
  const shown = fit({ ...measurements, visibleLabels: [label], visibleObstacles: [plaque] });
  assert.equal(shown.d.split('M ').length - 1, 3);
  assert.deepEqual(hidden.from, shown.from);
  assert.deepEqual(hidden.to, shown.to);
});

test('Tier-3 tree role labels measure and draw the Replay panel spacing; the authored roles stay unchanged', () => {
  const relation = Object.freeze({ relation: 'open_claim',
    anchors: Object.freeze({ selecting_head: 'a', escape_domain: 'b', x_i: 'c' }) });
  const stages = [stage([relation])];
  const measured = [];
  const bound = bindRelationPlanFrame(compileRelationRenderPlan(stages), 0, id => ({ x: id.charCodeAt(0) * 150, y: 100 }), {
    plaqueTextLayout: { measureText: (text, style) => {
      measured.push([text, style]);
      return { width: text.length * 10, ascent: 8, descent: 2 };
    } }
  });
  const marks = bound.primitives.filter(p => p.type === 'fallback-mark');
  assert.deepEqual(marks.map(mark => [mark.role, mark.text, mark.textWidth]), [
    ['selecting_head', 'selecting head', 140], ['escape_domain', 'escape domain', 130], ['x_i', 'x_i', 30]
  ], 'snake_case roles are spaced; single-letter notation keeps its underscore');
  assert.deepEqual(measured, marks.map(mark => [mark.text, FALLBACK_ROLE_STYLE]), 'measurement reads the displayed text');
  const steps = buildPlaybackStepsFromDerivationFrames({ frames: adaptDerivationStagesForReplay(stages),
    replayPlan: buildDerivationReplayPlan({ derivationStages: stages }) });
  const panel = buildReplayPanelContent(steps.find(step => step.replayKind === 'relation'), stages);
  assert.deepEqual(marks.map(mark => mark.text), panel.supportLines.map(line => line.label), 'the tree matches the panel');
  assert.deepEqual(Object.keys(stages[0].relations[0].anchors), ['selecting_head', 'escape_domain', 'x_i']);
});

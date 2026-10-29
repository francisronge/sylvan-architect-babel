import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { fitFallbackGeometry } from '../replay/relations/fallbackGeometry.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { pathPolylines } from './helpers/visualFrames.mjs';

// Loaded lazily so this file also runs, and fails, against a checkout without the law.
const { coveredWordSpan } = await import('../replay/relations/fallbackSpans.ts').catch(() => ({}));

// A neutral (Tier 3) connector stands for the words each participant covers.
// A participant high in the tree gets a bracket under its words below the
// tree, a silent one a tick at its place in word order, and nothing rises
// into the tree; two words on one row keep the stems they always had.

const word = (id, text) => ({ id, label: text, word: text });
const head = (id, label, text) => ({ id, label, children: [word(`${id}_w`, text)] });
// [C [I [will [read [the book]]]]] with C silent, as a laid-out tree whose
// words hang at different rows, as Babel's tidy layout hangs them.
const forest = [{ id: 'CP', label: 'CP', children: [
  { id: 'C', label: 'C', silent: true },
  { id: 'TP', label: 'TP', children: [
    head('I', 'D', 'I'),
    { id: 'Tbar', label: 'T′', children: [
      { id: 'T', label: 'T', silent: true },
      { id: 'VP', label: 'VP', children: [head('read', 'V', 'read'),
        { id: 'DP', label: 'DP', children: [head('the', 'D', 'the'), head('book', 'N', 'book')] }] }
    ] }
  ] }
] }];
const ROW = 220;
const place = { CP: [400, 0], C: [180, 1], TP: [620, 1], I: [380, 2], I_w: [380, 3], Tbar: [860, 2], T: [640, 3],
  VP: [1080, 3], read: [860, 4], read_w: [860, 5], DP: [1300, 4], the: [1180, 5], the_w: [1180, 6], book: [1420, 5], book_w: [1420, 6] };
const root = d3.hierarchy(forest[0]);
root.each(node => { const [x, row] = place[node.data.id]; node.x = x; node.y = row * ROW; });
const byId = new Map(root.descendants().map(node => [node.data.id, node]));
const isWordNode = node => !node.children && node.data.word;
const labelRect = node => isWordNode(node)
  ? { x: node.x - node.data.word.length * 14, y: node.y + 70, width: node.data.word.length * 28, height: 56 }
  : { x: node.x - 24, y: node.y - 24, width: 48, height: 48 };
const rects = new Map(root.descendants().map(node => [node.data.id, labelRect(node)]));
const union = list => {
  const x = Math.min(...list.map(r => r.x)), y = Math.min(...list.map(r => r.y));
  return { x, y, width: Math.max(...list.map(r => r.x + r.width)) - x, height: Math.max(...list.map(r => r.y + r.height)) - y };
};
const measurements = {
  labels: [...rects.values()], obstacles: [], visibleLabels: [...rects.values()], visibleObstacles: [],
  labelFor: id => rects.get(id) ?? null,
  subtreeFor: id => byId.has(id) ? union(byId.get(id).descendants().map(node => rects.get(node.data.id))) : null,
  spanFor: coveredWordSpan && (id => byId.has(id) ? coveredWordSpan(byId.get(id), node => isWordNode(node) ? rects.get(node.data.id) : null) : null),
  bottom: Math.max(...[...rects.values()].map(r => r.y + r.height))
};
const positionFor = id => byId.has(id) ? { x: byId.get(id).x, y: byId.get(id).y } : null;
const stage = relations => ({ statement: 'Test', stageRecord: 'Test', relations, workspaceForest: forest });
const SCALE = 2;
const route = relation => {
  const plan = compileRelationRenderPlan([stage([relation])]);
  const bound = bindRelationPlanFrame(plan, 0, positionFor, { fallbackMeasurements: measurements, separateFallbackMoments: true,
    relationNameFor: ref => [relation][ref.relationIndex]?.relation });
  const fitted = fitFallbackGeometry(bound, { fittedMarkerScale: SCALE, fallbackMeasurements: measurements, separateFallbackMoments: true });
  const pick = type => bound.primitives.filter(p => p.type === type).map(p => fitted.get(p) ?? p);
  return { segment: pick('segment')[0], marks: pick('fallback-mark') };
};
const points = d => pathPolylines(d).flat();
const lowest = ids => Math.max(...ids.map(id => measurements.subtreeFor(id)).map(r => r.y + r.height));
const wordRect = id => rects.get(`${id}_w`);

test('a connector whose anchor is a high phrase never draws inside the tree above the floor', () => {
  for (const anchors of [{ typer: 'C', clause: 'CP' }, { valuer: 'T', host: 'read' }, { first: 'I', second: 'VP' }]) {
    const { segment } = route({ relation: 'open claim', anchors });
    const floor = lowest(Object.values(anchors));
    const above = points(segment.d).filter(point => point.y < floor);
    assert.deepEqual(above, [], `${JSON.stringify(anchors)}: no stem rises above the participants' lowest word (y ${floor})`);
  }
});

test('two words on one row keep exactly the connector they had', () => {
  const { segment, marks } = route({ relation: 'open claim', anchors: { first: 'the', second: 'book' } });
  // The path main drew before brackets existed (c7baa3f).
  assert.equal(segment.d, 'M 1180.0 1458.0 L 1180.0 1498.0 M 1180.0 1498.0 Q 1180.0 1514.0 1198.0 1514.0 L 1402.0 1514.0 '
    + 'Q 1420.0 1514.0 1420.0 1498.0 M 1420.0 1498.0 L 1420.0 1458.0');
  assert.equal(segment.brackets, undefined);
  assert.deepEqual(marks.map(mark => mark.text), ['first', 'second'], 'role tags stay beside their words');
});

test('a silent head gets a tick at its place in word order, between its neighbouring words', () => {
  const { segment } = route({ relation: 'open claim', anchors: { valuer: 'T', host: 'book' } });
  const [I, read] = [wordRect('I'), wordRect('read')];
  const ticks = pathPolylines(segment.d).filter(path => path.length === 2 && path[0].x === path[1].x && path[1].y > path[0].y
    && path[1].y - path[0].y <= 8 * SCALE + 0.1);
  const tick = ticks.find(path => path[0].x > I.x + I.width && path[0].x < read.x);
  assert.ok(tick, `a tick stands between "I" and "read": ${segment.d}`);
  assert.equal(tick[0].x, 640, 'at the silent head\'s own x, which lies between them');
  assert.ok(tick[0].y >= lowest(['T', 'book']), 'below the tree');
});

test('nested C and CP stack their brackets, the inner tick nearest the words, joined without rising', () => {
  const { segment, marks } = route({ relation: 'clause typing', anchors: { typer: 'C', clause: 'CP' } });
  const { brackets } = segment;
  assert.ok(brackets, 'the connector brackets its participants');
  assert.equal(brackets.inner, 0, 'CP dominates C, so C is the inner end');
  const [cLevel, cpLevel] = brackets.levels;
  assert.ok(cLevel < cpLevel, 'the inner tick stands nearer the words than the outer bracket');
  assert.equal(cpLevel, segment.laneY, 'the outer bracket is the joining run');
  const paths = pathPolylines(segment.d);
  const run = paths.find(path => path.length === 2 && path[0].y === cpLevel && path[1].y === cpLevel);
  const first = wordRect('I'), last = wordRect('book');
  assert.ok(run, 'CP has one horizontal bracket line');
  assert.ok(Math.min(run[0].x, run[1].x) <= first.x && Math.max(run[0].x, run[1].x) >= last.x + last.width - 0.1,
    'spanning its first word to its last and reaching the tick');
  const stem = paths.find(path => path.length === 2 && path[0].x === path[1].x && path[0].y === cLevel && path[1].y === cpLevel);
  assert.ok(stem, 'one short stem joins the tick to the bracket below it');
  assert.ok(stem[0].x < first.x, 'the silent C stands before the first word');
  const texts = marks.map(mark => mark.text);
  assert.deepEqual(texts, ['C · typer', 'CP · clause', 'clause typing']);
  for (const mark of marks) assert.ok(mark.y > cpLevel, `${mark.text} sits below the brackets`);
});

test('a bracket names its node as painted: features dropped, a chain index kept', () => {
  const cp = byId.get('CP'), wordOf = node => isWordNode(node) ? rects.get(node.data.id) : null;
  assert.equal(coveredWordSpan(cp, wordOf, 'ltr', 'CP₁').category, 'CP₁');
  assert.equal(coveredWordSpan(cp, wordOf, 'ltr', 'T[past]₁').category, 'T₁');
  assert.equal(coveredWordSpan(cp, wordOf, 'ltr', 'C [declarative]').category, 'C');
  assert.equal(coveredWordSpan(cp, wordOf).category, 'CP');
});

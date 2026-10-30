import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrajectoryDrawing } from '../components/renderer/trajectoryDrawing.ts';
import { createTrajectoryRefinements } from '../components/renderer/trajectoryRefinements.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { createSvgDom, select } from './helpers/svgDom.mjs';

// A quadratic trajectory whose ends share a column used to dip below its
// departure and climb back up one straight line. It now bows sideways, away
// from the departure's parent branch, in the binder and the painter alike.
// A route whose horizontal offset is at least 0.40 of its rise keeps its exact
// path; steeper routes bow fully at 0.30 or less, blending in between.

const item = (kind = 'phrasal') => ({ kind: 'trajectory', trajectoryKind: kind, sourceNodeId: 'lower',
  targetNodeId: 'landing', sourceAttachment: 'shell-bottom', targetAttachment: 'shell-bottom',
  relationRef: { stageIndex: 0, relationIndex: 0, relation: 'Authored movement', anchors: {} } });

/** Layout points; each shell is 40 wide and 30 tall above its node point. */
function draw(planItem, { lowerX, parentX }) {
  const nodes = { landing: { x: 100, y: 100 }, lower: { x: lowerX, y: 540 }, parent: { x: parentX, y: 440 } };
  const parentOf = { lower: 'parent' };
  const shell = id => nodes[id] ? { x: nodes[id].x - 20, y: nodes[id].y - 30, width: 40, height: 30 } : null;
  const bound = bindRelationPlanFrame({ frames: [{ items: [planItem] }] }, 0, (id, attachment) => {
    if (attachment === 'parent') return parentOf[id] ? nodes[parentOf[id]] : null;
    const box = shell(id);
    return box ? { x: box.x + box.width / 2, y: box.y + box.height + 6 } : null;
  });
  const dom = createSvgDom();
  try {
    const g = select(new dom.Element('g'));
    const painter = createTrajectoryDrawing({ ensureTrajectoryRelationLayer: () => g,
      clearMovedCopyClassForAnchors: () => {}, trajectoryMarkerIds: { movement: 'arrow', open: 'open', carrier: 'carrier' } });
    for (const primitive of bound.primitives) painter.drawTrajectoryPath(primitive, planItem, g.append('g'), null);
    const path = g.select('.babel-trajectory-path').node();
    const refinements = createTrajectoryRefinements({ g, measuredTrajectoryShellRect: shell,
      measuredTrajectoryTerminalRect: shell, productionTrajectoryPaths: () => [path] });
    (planItem.trajectoryKind === 'head' ? refinements.refineTerminalTrajectory : refinements.refinePhrasalPath).call(path);
    return { primitive: bound.primitives[0], painted: path.getAttribute('d') };
  } finally { dom.restore(); }
}

const quadratic = d => {
  const [sx, sy, cx, cy, ex, ey] = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return { start: { x: sx, y: sy }, control: { x: cx, y: cy }, end: { x: ex, y: ey } };
};
const samples = ({ start, control, end }) => Array.from({ length: 101 }, (_, i) => {
  const t = i / 100, a = (1 - t) ** 2, b = 2 * t * (1 - t), c = t * t;
  return { x: a * start.x + b * control.x + c * end.x, y: a * start.y + b * control.y + c * end.y };
});

/** Horizontal distance of the arc beyond its chord, toward `side`, at each sample. */
const beyondChord = (route, side) => samples(route).map(point => {
  const t = (point.y - route.start.y) / (route.end.y - route.start.y);
  return (point.x - (route.start.x + (route.end.x - route.start.x) * t)) * side;
});

for (const kind of ['phrasal', 'head']) {
  for (const [lowerX, parentX, side, why] of [
    [100, 300, -1, 'a vertical arrow with its parent to the right'],
    [100, -100, 1, 'a vertical arrow with its parent to the left'],
    [100, 100, -1, 'a vertical arrow with its parent in the same column'],
    [120, 300, -1, 'an arrow leaning 20 across 440 up'],
    [225, 400, -1, 'an arrow leaning 125 across 440 up, as steep as the flagged K to K hop']
  ]) {
    test(`${kind}: ${why} bows ${side < 0 ? 'left' : 'right'}, never below its departure`, () => {
      const { primitive, painted } = draw(item(kind), { lowerX, parentX });
      for (const [where, d] of [['binder', primitive.d], ['painter', painted]]) {
        const route = quadratic(d), points = samples(route);
        assert(points.every(point => point.y <= route.start.y + 1e-9), `${where}: no hook below the departure: ${d}`);
        const beyond = beyondChord(route, side);
        assert(beyond.every(distance => distance >= -1e-9), `${where}: the whole arc lies on the bow side: ${d}`);
        assert(Math.max(...beyond) > 40, `${where}: the arc visibly bows (${Math.max(...beyond).toFixed(1)}): ${d}`);
      }
      assert.equal(primitive.bowSide, side);
      assert.equal(painted, primitive.d, 'the painter and the binder draw the same arc from the same ends');
    });
  }
}

test('a shallow trajectory keeps its exact path in the binder and the painter', () => {
  // 200 across and 440 up: the path string the belly law produced before steep arrows bowed.
  const expected = 'M 292.0 546.0 Q 200.0 588.0, 108.0 106.0';
  for (const kind of ['phrasal', 'head']) {
    const { primitive, painted } = draw(item(kind), { lowerX: 300, parentX: 400 });
    assert.equal(primitive.bowSide, undefined);
    assert.equal(primitive.d, expected);
    assert.equal(painted, expected);
  }
});

test('the bow fades into the belly law without a jump as an arrow leans further', () => {
  // One tree unit of lean at a time, from fully bowed to the unchanged belly law.
  let previous = null;
  for (let lowerX = 220; lowerX <= 290; lowerX += 1) {
    const { primitive, painted } = draw(item('phrasal'), { lowerX, parentX: 400 });
    assert.equal(painted, primitive.d);
    const route = quadratic(primitive.d);
    if (previous) for (const key of ['start', 'control', 'end']) {
      const moved = Math.hypot(route[key].x - previous[key].x, route[key].y - previous[key].y);
      assert(moved < 12, `${key} jumps ${moved.toFixed(1)} between ${lowerX - 1} and ${lowerX}`);
    }
    previous = route;
  }
});

test('a leaning head arrow bows to the side whose arc clears the word under its landing', () => {
  // Opus n3-24-qu-evidential (3:0) at Replay step 35, as the offline desktop
  // layout measures it: the head moves from the word t (tV) to V (Vcx), 187.5
  // right and 569 up. Bowing away from tV's parent V' would carry the arc past
  // the landing and back up through the word t (tI) hanging below it; the left
  // arc clears every label.
  const cells = {
    VP: { x: 783.1, y: 388, width: 53.8, height: 52.5 },
    tI: { x: 1173.5, y: 499, width: 22.9, height: 70 },
    Vbar: { x: 791.3, y: 608, width: 37.4, height: 52.5 },
    tV: { x: 986, y: 939, width: 22.9, height: 70 },
    chaya: { x: 1424.5, y: 939, width: 195.9, height: 70 }
  };
  const points = { tV: { x: 997.5, y: 1015 }, Vcx: { x: 1185, y: 446 } };
  const planItem = { ...item('head'), sourceNodeId: 'tV', targetNodeId: 'Vcx', sourceAttachment: 'terminal' };
  const bound = bindRelationPlanFrame({ frames: [{ items: [planItem] }] }, 0,
    (id, attachment) => attachment === 'parent' ? (id === 'tV' ? { x: 810, y: 660 } : null) : points[id] ?? null,
    { trajectoryLabelBoxes: () => Object.values(cells) });
  const primitive = bound.primitives[0];
  const dom = createSvgDom();
  let painted;
  try {
    const g = select(new dom.Element('g'));
    createTrajectoryDrawing({ ensureTrajectoryRelationLayer: () => g, clearMovedCopyClassForAnchors: () => {},
      trajectoryMarkerIds: { movement: 'arrow', open: 'open', carrier: 'carrier' } })
      .drawTrajectoryPath(primitive, planItem, g.append('g'), null);
    const path = g.select('.babel-trajectory-path').node();
    createTrajectoryRefinements({ g, productionTrajectoryPaths: () => [path],
      measuredTrajectoryTerminalRect: id => id === 'tV' ? { x: 987.5, y: 939, width: 20, height: 70 } : null,
      measuredTrajectoryShellRect: id => id === 'Vcx' ? { x: 1165, y: 390, width: 40, height: 50 } : null
    }).refineTerminalTrajectory.call(path);
    painted = path.getAttribute('d');
  } finally { dom.restore(); }
  const word = cells.tI;
  for (const [where, d] of [['binder', primitive.d], ['painter', painted]]) {
    const through = samples(quadratic(d)).some(({ x, y }) => x >= word.x && x <= word.x + word.width && y >= word.y && y <= word.y + word.height);
    assert(!through, `${where}: the arc passes through t: ${d}`);
  }
  assert.equal(primitive.bowSide, -1, 'it still bows, to the left');
});

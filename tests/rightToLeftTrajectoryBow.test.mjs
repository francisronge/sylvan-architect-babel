import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrajectoryDrawing } from '../components/renderer/trajectoryDrawing.ts';
import { createTrajectoryRefinements } from '../components/renderer/trajectoryRefinements.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { createSvgDom, select } from './helpers/svgDom.mjs';

// RTL Replay is the LTR Replay reflected. A steep arrow whose departure hangs
// under a parent in its own column, or under none, bows left LTR, so it bows
// right RTL; the binder and the painter's measured refinement agree.

const AXIS = 1000;
const mirror = point => point && { ...point, x: AXIS - point.x };
const mirrorRect = rect => ({ ...rect, x: AXIS - rect.x - rect.width });
const mirrorPath = d => {
  let index = 0;
  return d.replace(/-?\d+(?:\.\d+)?/g, value => (index++ % 2 === 0 ? (AXIS - Number(value)).toFixed(1) : value));
};

const item = (kind = 'phrasal') => ({ kind: 'trajectory', trajectoryKind: kind, sourceNodeId: 'lower',
  targetNodeId: 'landing', sourceAttachment: 'shell-bottom', targetAttachment: 'shell-bottom',
  relationRef: { stageIndex: 0, relationIndex: 0, relation: 'Authored movement', anchors: {} } });

function bind(planItem, points, direction, labels) {
  const flip = direction === 'rtl' ? mirror : point => point;
  return bindRelationPlanFrame({ frames: [{ items: [planItem] }] }, 0, (id, attachment) =>
    flip(attachment === 'parent' ? points.parentOf[id] ?? null : points[id] ?? null),
  { direction, ...(labels ? { trajectoryLabelBoxes: () => direction === 'rtl' ? labels.map(mirrorRect) : labels } : {}) })
    .primitives[0];
}

for (const kind of ['phrasal', 'head']) {
  for (const [why, parent] of [['no parent', undefined], ['a parent in its own column', { x: 100, y: 440 }]]) {
    test(`${kind}: a vertical arrow under ${why} bows right RTL, the reflection of its left bow`, () => {
      const points = { landing: { x: 100, y: 106 }, lower: { x: 100, y: 546 }, parentOf: parent ? { lower: parent } : {} };
      const ltr = bind(item(kind), points, 'ltr'), rtl = bind(item(kind), points, 'rtl');
      assert.equal(ltr.bowSide, -1);
      assert.equal(rtl.bowSide, 1);
      assert.equal(rtl.d, mirrorPath(ltr.d));
    });
  }
}

test('a bow that clears a label takes the reflected side RTL', () => {
  // The vertical arc's preferred left side would cross this label; LTR clears it on the right.
  const points = { landing: { x: 100, y: 106 }, lower: { x: 100, y: 546 }, parentOf: {} };
  const labels = [{ x: 0, y: 300, width: 40, height: 40 }];
  const ltr = bind(item(), points, 'ltr', labels), rtl = bind(item(), points, 'rtl', labels);
  assert.equal(ltr.bowSide, 1);
  assert.equal(rtl.bowSide, -1);
  assert.equal(rtl.d, mirrorPath(ltr.d));
});

test('the measured refinement bows a route the binder left unbowed to the reflected side RTL', () => {
  // The binder's ends lean too far to bow; the painted labels stand in one column.
  const points = { landing: { x: 100, y: 106 }, lower: { x: 300, y: 546 }, parentOf: {} };
  const shells = { landing: { x: 80, y: 70, width: 40, height: 30 }, lower: { x: 80, y: 510, width: 40, height: 30 } };
  const paint = direction => {
    const primitive = bind(item(), points, direction);
    assert.equal(primitive.bowSide, undefined);
    const dom = createSvgDom();
    try {
      const g = select(new dom.Element('g'));
      createTrajectoryDrawing({ ensureTrajectoryRelationLayer: () => g, clearMovedCopyClassForAnchors: () => {},
        trajectoryMarkerIds: { movement: 'arrow', open: 'open', carrier: 'carrier' } })
        .drawTrajectoryPath(primitive, item(), g.append('g'), null);
      const path = g.select('.babel-trajectory-path').node();
      const shell = id => shells[id] ? (direction === 'rtl' ? mirrorRect(shells[id]) : shells[id]) : null;
      createTrajectoryRefinements({ g, direction, laneTrajectoryPaths: () => [],
        measuredTrajectoryShellRect: shell, measuredTrajectoryTerminalRect: shell }).refinePhrasalPath.call(path);
      return path.getAttribute('d');
    } finally { dom.restore(); }
  };
  const ltr = paint('ltr'), rtl = paint('rtl');
  const controlX = d => Number(d.match(/Q (-?\d+(?:\.\d+)?)/)[1]);
  assert(controlX(ltr) < 100, `LTR bows left: ${ltr}`);
  assert.equal(rtl, mirrorPath(ltr));
});

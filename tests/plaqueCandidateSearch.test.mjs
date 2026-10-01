import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareCollectionPlaqueSpace, prepareCasePlaqueSpace, caseAssignmentClears, plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { featureCollectionPlaqueCurve } from '../replay/relations/overlayGeometry.ts';
import { sampleCubic } from '../replay/relations/markGeometry.ts';

// Exhaustive sampling is the reference for the optimized crossing lookup. Keep
// every duplicate candidate and its order, since stable ties choose a placement.
function exhaustiveCandidates(box, nodes, obstacles, axis) {
  const sources = new Map(nodes.map(node => {
    const id = node.data.id;
    const find = list => list.find(rect => rect.connectorAttachment === `${id}:category`)
      ?? list.find(rect => rect.connectorAttachment === `${id}:terminal`);
    return [id, find(obstacles) ?? find(plaqueTreeObstacles([node]))];
  }));
  const curves = sidesOnly => (box.collectionRows ?? []).flatMap(row => {
    const attachment = sources.get(row.sourceNodeId);
    return attachment ? [{ row, attachment, ...featureCollectionPlaqueCurve(box, box.y + row.y,
      attachment.connectorInk ?? attachment, row.lane ?? 0, row.edge ?? (sidesOnly ? 'side' : undefined), row.portX) }] : [];
  });
  const routes = curves(false);
  if (box.collectionRows?.some(row => !row.edge)) for (const route of curves(true)) {
    if (!routes.some(old => old.row === route.row && old.source.x === route.source.x && old.source.y === route.source.y
      && old.target.x === route.target.x && old.target.y === route.target.y)) routes.push(route);
  }
  const other = axis === 'x' ? 'y' : 'x';
  const extent = axis === 'x' ? 'width' : 'height';
  const otherExtent = axis === 'x' ? 'height' : 'width';
  const result = [];
  for (const curve of routes) {
    const points = sampleCubic(curve.source, curve.control1, curve.control2, curve.target, 64);
    for (const obstacle of obstacles.filter(rect => rect.blocksConnectors)) {
      if (obstacle.connectorAttachment === curve.attachment.connectorAttachment) continue;
      const rect = obstacle.connectorInk ?? obstacle;
      const matches = [];
      for (let i = 1; i < 64; i++) {
        if (points[i][other] >= rect[other] - 8 && points[i][other] <= rect[other] + rect[otherExtent] + 8) matches.push(i);
      }
      if (!matches.length) continue;
      for (const i of [matches[0], matches.at(-1)]) {
        const t = i / 64, u = 1 - t, weight = u ** 3 + 3 * u * u * t;
        for (const edge of [rect[axis] - 8, rect[axis] + rect[extent] + 8]) result.push(box[axis] + (edge - points[i][axis]) / weight);
      }
    }
  }
  return result;
}

test('collection search preserves every sampled crossing and its order across orientation, ink and boundary changes', () => {
  const nodes = d3.tree().nodeSize([600, 300])(d3.hierarchy({ id: 'root', label: 'XP', children: [
    { id: 'left', label: 'X', word: 'left' }, { id: 'right', label: 'Y', word: 'right' }
  ] })).descendants();
  const obstacles = plaqueTreeObstacles(nodes);
  // A terminal may precede a category in input order. Category preference and
  // the first matching source rectangle must both survive attachment indexing.
  obstacles.unshift({ x: 8000, y: 8000, width: 20, height: 40, connectorAttachment: 'left:terminal' });
  obstacles.push({ x: 9000, y: 9000, width: 20, height: 40, connectorAttachment: 'left:category' });
  for (let i = 0; i < 100; i++) obstacles.push({
    x: i * 71 % 1400 - 700, y: i * 137 % 1200 - 600, width: i % 4 ? 23.125 : 0,
    height: i % 3 ? 51.25 : 0, blocksConnectors: true, connectorAttachment: `ink-${i}`,
    ...(i % 5 === 0 ? { connectorInk: { x: i * 41 % 700 - 350, y: i * 23 % 800 - 400, width: 18, height: 32 } } : {})
  });
  const snapshot = structuredClone(obstacles);
  const space = prepareCollectionPlaqueSpace(nodes, obstacles);
  let candidates = 0;
  for (const edge of [undefined, 'side', 'bottom', 'top']) for (const lane of [0, 2, -20]) {
    for (const [x, y] of [[-500, -300], [150, 600], [-150, 250], [0, 0], [300, -123.125]]) {
      const box = { x, y, width: 240, height: 110, collectionRows: [
        { sourceNodeId: 'left', y: 41, edge, lane }, { sourceNodeId: 'right', y: 73, edge, lane: 0 },
        { sourceNodeId: 'missing', y: 90 }
      ] };
      for (const axis of ['x', 'y']) {
        const expected = exhaustiveCandidates(box, nodes, obstacles, axis);
        const actual = axis === 'x' ? space.candidateXs(box) : space.candidateYs(box);
        candidates += actual.length;
        assert.deepEqual(actual, expected, `edge=${edge}, lane=${lane}, box=${x}/${y}, axis=${axis}`);
      }
    }
  }
  assert(candidates > 10000, 'exercise many clearances, including reversed and nonmonotone curves');
  assert.deepEqual(obstacles, snapshot, 'prepared searches do not mutate shared geometry');
});

test('repeated Case clearance reuses only identical painted geometry within its own obstacle space', () => {
  const source = d3.hierarchy({ id: 'source', label: 'T' });
  source.x = 0; source.y = 0;
  const obstacles = [{ x: 150, y: 90, width: 120, height: 100, blocksConnectors: true }];
  const prepared = prepareCasePlaqueSpace(source, obstacles);
  const otherSpace = prepareCasePlaqueSpace(source, [{ x: -1000, y: -1000, width: 2000, height: 2000, blocksConnectors: true }]);
  const outcomes = new Set();
  const box = { x: 0, y: 0, width: 240, height: 140 };
  for (const x of [-500, -120, 80, 400]) for (const y of [-300, -80, 0, 180, 600]) {
    for (const drawnWidth of [undefined, 160]) for (const drawnHeight of [undefined, 100]) for (const caseRowY of [undefined, 30, 160]) {
      // Reusing and mutating the caller's rectangle must not mutate the cache key.
      Object.assign(box, { x, y, drawnWidth, drawnHeight, caseRowY });
      const expected = caseAssignmentClears(source, box, obstacles);
      outcomes.add(expected);
      assert.equal(prepared(box), expected);
      assert.equal(prepared({ ...box, collectionRows: [{ sourceNodeId: 'source', y: 30, portX: 48 }] }), expected,
        'collector port changes do not affect the independently owned Case approach');
      assert.equal(otherSpace(box), false, 'cached answers cannot cross obstacle spaces');
      assert.equal(prepared(box), expected);
    }
  }
  assert.deepEqual(outcomes, new Set([false, true]), 'exercise blocked and clear routes across every painted dimension');
});

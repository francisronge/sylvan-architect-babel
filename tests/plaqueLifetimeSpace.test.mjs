import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import {
  casePlaqueSpace,
  collectionPlaqueSpace,
  plaqueTreeObstacles,
  prepareCasePlaqueSpace,
  prepareCollectionPlaqueSpace,
  prepareConnectorScene,
  prepareUniquePlaqueObstacles,
  projectPlaqueContent,
  uniquePlaqueObstacles
} from '../replay/relations/plaquePlacement.ts';
import { prepareLifetimePlaqueSpaces } from '../replay/relations/plaqueLifetimeSpace.ts';
import { prepareImmutableObstacleTranslations, preparePlaqueColumnIntervals, translateObstacle } from '../replay/relations/plaqueObstacleIndex.ts';

// One clause with two Case sources and a later word; every scene reuses these ids.
const tree = (shift = 0) => {
  const root = d3.tree().nodeSize([420, 260])(d3.hierarchy({ id: 'root', label: 'TP', children: [
    { id: 'subject', label: 'DP', word: 'Mia' },
    { id: 'tbar', label: "T'", children: [
      { id: 'head', label: 'T', word: 'will' },
      { id: 'vp', label: 'VP', children: [{ id: 'verb', label: 'V', word: 'leave' }, { id: 'object', label: 'DP', word: 'home' }] }
    ] }
  ] }));
  root.each(node => { node.x += shift; });
  return root;
};
const curveBox = (x, y) => ({ x, y, width: 40, height: 30, curvePadding: 6,
  curve: { source: { x, y }, control1: { x: x + 10, y: y + 30 }, control2: { x: x + 30, y }, target: { x: x + 40, y: y + 30 } } });
const rows = [{ sourceNodeId: 'subject', y: 40, ownerKeys: ['0:1'] }, { sourceNodeId: 'object', y: 80, ownerKeys: ['0:2'] }];
const boxes = () => {
  const queries = [];
  for (const x of [-900, -520, -260, -40, 180, 430, 760]) for (const y of [-260, -60, 120, 330, 610]) {
    queries.push({ x, y, width: 220, height: 140 });
    for (const edge of [undefined, 'side', 'top', 'bottom'])
      queries.push({ x, y, width: 220, height: 140, drawnWidth: 180, drawnHeight: 120, collectionRows: rows.map(row => ({ ...row, edge, portX: 50 })) });
    queries.push({ x, y, width: 220, height: 140, caseRowY: 60, collectionRows: rows });
    for (const row of rows) queries.push({ x, y, width: 220, height: 140, collectionRows: [{ ...row, edge: 'side' }] });
  }
  return queries;
};

test('a shared connector scene answers every query as its combined obstacle list does', () => {
  const nodes = tree().descendants().filter(node => node.data.id !== 'verb');
  const fixed = [...plaqueTreeObstacles(nodes), ...Array.from({ length: 60 }, (_, i) => ({
    x: (i * 137 % 1500) - 750, y: (i * 89 % 900) - 300, width: 30 + i % 50, height: 20 + i % 40,
    blocksConnectors: i % 3 !== 0, ...(i % 7 === 0 ? { connectorAttachment: `ink-${i}`, connectorInk: { x: (i * 41 % 900) - 450, y: (i * 23 % 500), width: 18, height: 32 } } : {})
  }))];
  // Added plaques stand in the approaches to both collection sources and the Case word.
  const plaques = [{ x: -400, y: 100, width: 380, height: 60 }, { x: 450, y: 600, width: 360, height: 60 },
    { x: -150, y: 640, width: 300, height: 40 }, { x: 120, y: 470, width: 60, height: 200 }].map(box => ({ ...box, blocksConnectors: true }));
  const anchor = nodes.find(node => node.data.id === 'head');
  for (const added of [[], plaques, [...plaques, curveBox(0, 200), { x: 10, y: 10, width: 5, height: 5 }],
    // A label the plaques add, and an exceptional rectangle, need one combined list.
    [...plaques, { x: 900, y: 900, width: 40, height: 40, connectorAttachment: 'object:category' }],
    [...plaques, { x: NaN, y: 100, width: 50, height: 50, blocksConnectors: true }]]) {
    const scene = prepareConnectorScene(nodes, fixed), combined = [...fixed, ...added];
    const shared = collectionPlaqueSpace(scene, added), reference = prepareCollectionPlaqueSpace(nodes, combined);
    const caseShared = casePlaqueSpace(scene, anchor, added), caseReference = prepareCasePlaqueSpace(anchor, combined);
    let accepted = 0, rejected = 0, addedRoutes = 0, addedArrows = 0;
    const unblocked = prepareCollectionPlaqueSpace(nodes, fixed), caseUnblocked = prepareCasePlaqueSpace(anchor, fixed);
    for (const box of boxes()) {
      const clears = reference.clears(box);
      clears ? accepted++ : rejected++;
      if (clears !== unblocked.clears(box)) addedRoutes++;
      if (caseReference(box) !== caseUnblocked(box)) addedArrows++;
      assert.equal(shared.clears(box), clears);
      assert.equal(caseShared(box), caseReference(box));
      assert.deepEqual(shared.candidateXs(box), reference.candidateXs(box));
      assert.deepEqual(shared.candidateYs(box), reference.candidateYs(box));
      assert.deepEqual(shared.attach(box), reference.attach(box));
      assert.deepEqual(shared.attach(box, true, false), reference.attach(box, true, false));
      assert.deepEqual(shared.withClearPorts(box), reference.withClearPorts(box));
      assert.deepEqual(shared.routeRects(box), reference.routeRects(box));
    }
    assert(accepted && rejected, 'exercise accepted and rejected routes');
    assert(!added.length || addedRoutes && addedArrows, 'added plaques decide some collection routes and Case arrows');
  }
  // A second allocation reuses the same scene without seeing the first one's plaques.
  const scene = prepareConnectorScene(nodes, fixed);
  collectionPlaqueSpace(scene, plaques).clears(boxes()[1]);
  for (const box of boxes()) assert.equal(collectionPlaqueSpace(scene).clears(box), prepareCollectionPlaqueSpace(nodes, fixed).clears(box));
});

/** The lifetime space as each scene answered separately before scenes shared work. */
function referenceSpace(scenes) {
  const translate = prepareImmutableObstacleTranslations();
  const spaces = scenes.map(scene => {
    const obstacles = [...scene.obstacles, ...scene.added];
    return { ...scene, collection: prepareCollectionPlaqueSpace(scene.nodes, obstacles), caseClears: prepareCasePlaqueSpace(scene.anchor, obstacles) };
  });
  return {
    obstacles: uniquePlaqueObstacles(scenes.flatMap(scene => [...translate(scene.obstacles, scene.dx, scene.dy),
      ...scene.added.map(box => translateObstacle(box, scene.dx, scene.dy))])),
    connectorCandidateXs: box => spaces.flatMap(scene => scene.collection.candidateXs({ ...box, x: box.x - scene.dx, y: box.y - scene.dy }).map(x => x + scene.dx)),
    connectorCandidateYs: box => spaces.flatMap(scene => scene.collection.candidateYs({ ...box, x: box.x - scene.dx, y: box.y - scene.dy }).map(y => y + scene.dy)),
    acceptsConnector: box => (box.caseRowY === undefined && !box.collectionRows?.length) || spaces.every(scene => {
      const projected = projectPlaqueContent({ ...box, x: box.x - scene.dx, y: box.y - scene.dy }, scene.request);
      projected.collectionRows = projected.collectionRows?.filter(row => scene.rowVisible(row.ownerKeys));
      return (box.caseRowY === undefined || !scene.caseVisible || scene.caseClears(projected))
        && (!projected.collectionRows?.length || scene.collection.clears(projected));
    })
  };
}

test('a lifetime space shares equal scenes without changing obstacles, hints or connector decisions', () => {
  // Microsteps reveal syntax in place; a later stage carries the clause sideways
  // and one scene moves only the anchor's subtree.
  const full = tree(), shifted = tree(310.25), moved = tree(), lifted = tree();
  moved.each(node => { if (['tbar', 'head', 'vp', 'verb', 'object'].includes(node.data.id)) node.y += 57.5; });
  // Only the anchor rises: its sources and their ink stay where they were.
  lifted.each(node => { if (node.data.id === 'head') node.y -= 37; });
  const reveal = (root, hidden) => root.descendants().filter(node => !hidden.includes(node.data.id));
  const sceneNodes = [reveal(full, ['vp', 'verb', 'object']), reveal(full, ['verb', 'object']), reveal(full, ['verb']), reveal(full, []),
    reveal(shifted, []), reveal(shifted, ['object']), reveal(moved, []), reveal(lifted, [])];
  const request = { index: 0, ids: ['head'], width: 220, height: 140, collectionRows: rows };
  const anchor = full.descendants().find(node => node.data.id === 'head');
  const played = [new Set(), new Set([1]), new Set([1, 2]), null, null, new Set([2]), null, null];
  const make = () => sceneNodes.map((nodes, index) => {
    const future = nodes.find(node => node.data.id === 'head');
    const extra = index % 2 ? [{ x: future.x - 500, y: future.y + 200, width: 180, height: 110, blocksConnectors: true }, curveBox(future.x, future.y + 400)] : [];
    return { nodes, obstacles: plaqueTreeObstacles(nodes), added: extra, anchor: future, request,
      dx: anchor.x - future.x, dy: anchor.y - future.y, caseVisible: index !== 2,
      rowVisible: owners => !played[index] || !owners || owners.some(key => played[index].has(Number(key.split(':')[1]))) };
  });
  const spaces = prepareLifetimePlaqueSpaces();
  for (const scenes of [make(), make().slice(2), make().reverse(), make()]) {
    const space = spaces(scenes), expected = referenceSpace(scenes);
    assert.deepEqual(space.obstacles, expected.obstacles);
    let accepted = 0, rejected = 0;
    for (const order of [boxes(), boxes().reverse()]) for (const box of order) {
      for (const axis of ['X', 'Y']) {
        // The search reads each distinct hint once, in first-occurrence order.
        assert.deepEqual([...new Set(space[`connectorCandidate${axis}s`](box))], [...new Set(expected[`connectorCandidate${axis}s`](box))]);
      }
      const accepts = expected.acceptsConnector(box);
      accepts ? accepted++ : rejected++;
      assert.equal(space.acceptsConnector(box), accepts);
    }
    assert(accepted && rejected, 'exercise accepted and rejected lifetime pockets');
  }
});

test('geometry sets agree with first-occurrence deduplication', () => {
  const list = [{ x: 0, y: 0, width: 1, height: 1 }, { x: -0, y: 0, width: 1, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 },
    { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1, extendsDownward: true }, curveBox(0, 0), curveBox(0, 0),
    { ...curveBox(0, 0), curvePadding: 8 }, { x: 0, y: 0, width: 1, height: 1, blocksConnectors: true }];
  const unique = prepareUniquePlaqueObstacles();
  assert.deepEqual(list.filter(box => unique.add(box)), uniquePlaqueObstacles(list));
  for (const box of list) assert.equal(unique.has(box), true);
  assert.equal(unique.has({ x: 2, y: 0, width: 1, height: 1 }), false);
});

test('indexed column intervals match the complete scan for every repeated query', () => {
  const obstacles = [
    ...Array.from({ length: 400 }, (_, i) => ({ x: (i * 137 % 4000) - 2000, y: (i * 71 % 900) - 450,
      width: i * 17 % 340, height: i * 23 % 150, extendsDownward: i % 29 === 0 })),
    // Wider than the cell reach, unbounded, and so far out that low and high round together.
    { x: -9000, y: 0, width: 30000, height: 10 }, { x: 0, y: 5, width: Infinity, height: 10 }, { x: NaN, y: 5, width: 10, height: 10 },
    { x: 100, y: 1e20, width: 10, height: 10 }, { x: 100, y: 1e20, width: 10, height: 1e5 }, { x: -Infinity, y: 0, width: 10, height: 10 },
    // Cells this far out cannot be counted one by one.
    { x: 1e300, y: 0, width: 10, height: 10 }, { x: 2 ** 60, y: 0, width: 300, height: 10 }
  ];
  for (const height of [0, 80.5]) for (const gap of [0, 24]) {
    const prepared = preparePlaqueColumnIntervals(obstacles, height, gap);
    const ordered = obstacles.map(box => ({ x: box.x, right: box.x + box.width + gap, low: box.y - height - gap,
      high: box.extendsDownward ? Infinity : box.y + box.height + gap })).sort((a, b) => a.low - b.low);
    for (const width of [0, 220, 40000, NaN]) for (const x of [-30000, -2100, -256, -0.5, 0, 255.75, 256, 1999, 1e6, 2 ** 60, 1e300, NaN, -Infinity]) {
      const expected = [];
      for (const interval of ordered) {
        if (!(x < interval.right && x + width + gap > interval.x)) continue;
        const last = expected.at(-1);
        if (last && interval.low < last[1]) last[1] = Math.max(last[1], interval.high);
        else expected.push([interval.low, interval.high]);
      }
      assert.deepEqual(prepared(x, width), expected, `x=${x}, width=${width}`);
    }
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { reserveCompleteComponentLifetime as reserve, prepareComponentLifetimeReservations } from '../replay/workspaceComponentLifetime.ts';

function scenario(direction, { owned = true, needed = true } = {}) {
  const branch = (id, label, children) => ({ id, label, children });
  const word = (id, text) => ({ id, label: text, word: text });
  const peer = () => branch('peer', 'N', [word('peerWord', 'peer')]);
  const before = branch('root', 'P', [
    branch('source', 'DP', [word('sourceWord', 'complete source')]), peer()
  ]);
  const after = () => branch('root', 'P', [
    { id: 'source', label: 'DP', silent: true }, peer(),
    branch('landing', 'DP', [word('landingWord', 'complete source')])
  ]);
  const canvases = [before, after(), branch('workspace', '', [after(), word('next', 'next')])];
  const base = new Map();
  const scenes = canvases.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const points = new Map(root.descendants().map(node => {
      const id = getNodeId(node);
      const x = id === 'source' || id === 'sourceWord' ? (index ? 300 : 0)
        : id === 'peer' || id === 'peerWord' ? (needed ? 450 : 900)
          : id === 'landing' || id === 'landingWord' ? 1400 : id === 'next' ? 2200 : 800;
      const y = id.endsWith('Word') ? 300 : id === 'root' ? 0 : 150;
      return [id, { x, y }];
    }));
    base.set(canvas, points);
    const nodes = new Map(root.descendants().filter(node => getNodeId(node) !== 'workspace').map(node => {
      const point = points.get(getNodeId(node));
      return [getNodeId(node), Object.assign(node, { ...point, x: direction === 'rtl' ? 3000 - point.x : point.x })];
    }));
    const step = index === 1 ? {
      replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 1 },
      replayRelationLinks: [{ authoredRelationKey: owned ? '1:1' : '1:0', renderFamily: 'trajectory',
        priorSourceNodeId: 'source', witnessNodeId: 'source', targetNodeId: 'landing' }]
    } : { replayKind: 'micro', operation: index ? 'LexicalSelect' : 'ExternalMerge',
      targetNodeId: index ? 'next' : 'root' };
    return { canvas, nodes, coordinates: points, size: [3000, 1000], step };
  });
  const cache = new Map(), created = [];
  const render = (scene, points) => {
    let plans = cache.get(scene);
    if (!plans) cache.set(scene, plans = new Map());
    if (plans.has(points)) return plans.get(points);
    const root = d3.hierarchy(scene.canvas); applyVizIds(root);
    const nodes = root.descendants().filter(node => scene.nodes.has(getNodeId(node))).map(node => {
      const point = points.get(getNodeId(node));
      return Object.assign(node, { ...point, x: direction === 'rtl' ? 3000 - point.x : point.x });
    });
    plans.set(points, nodes);
    created.push({ nodes, positions: nodes.map(node => [getNodeId(node), node.x, node.y]) });
    return nodes;
  };
  const saved = JSON.stringify([...base].map(([canvas, points]) => [canvas, [...points]]));
  const ordinary = reserve(scenes, base, direction, 2, 'root', render, { throughRelations: true });
  const cleared = reserve(scenes, base, direction, 2, 'root', render, { throughRelations: true, clearPriorSources: true });
  assert.equal(JSON.stringify([...base].map(([canvas, points]) => [canvas, [...points]])), saved);
  for (const { nodes, positions } of created) {
    assert.deepEqual(nodes.map(node => [getNodeId(node), node.x, node.y]), positions,
      'cached rendered nodes must remain immutable');
  }
  return { ordinary, cleared, canvases, scenes, base, render };
}

for (const direction of ['ltr', 'rtl']) {
  test(`${direction}: clear the complete prior source, retaining its contour and other current syntax`, () => {
    const { ordinary, cleared, canvases } = scenario(direction);
    const before = ordinary.get(canvases[0]), after = cleared.get(canvases[0]);
    const dx = after.get('source').x - before.get('source').x;
    assert(Math.abs(dx) > 1);
    assert.equal(after.get('sourceWord').x - before.get('sourceWord').x, dx);
    assert.equal(after.get('sourceWord').y - before.get('sourceWord').y, 0);
    assert.deepEqual(after.get('peer'), before.get('peer'));
    assert.deepEqual(after.get('peerWord'), before.get('peerWord'));
    for (const canvas of canvases.slice(1)) assert.deepEqual([...ordinary.get(canvas)], [...cleared.get(canvas)],
      'own movement and final geometry stay native');
  });
  test(`${direction}: clear prior sources only for the exact owning relation`, () => {
    const { ordinary, cleared, canvases } = scenario(direction, { owned: false });
    for (const canvas of canvases) assert.deepEqual([...ordinary.get(canvas)], [...cleared.get(canvas)]);
  });
  test(`${direction}: leave a clear current source unchanged`, () => {
    const { ordinary, cleared, canvases } = scenario(direction, { needed: false });
    for (const canvas of canvases) assert.deepEqual([...ordinary.get(canvas)], [...cleared.get(canvas)]);
  });

  test(`${direction}: repeated clearance policies reuse the reservation without changing any attempt`, () => {
    const { canvases, scenes, base, render } = scenario(direction);
    const prepared = prepareComponentLifetimeReservations(scenes, base, direction, 2, 'root', render);
    const policies = [
      {}, { throughRelations: true },
      { throughRelations: true, reserveSourceProjections: true },
      { throughRelations: true, carryUntilMovement: true },
      { throughRelations: true, clearPriorSources: true },
      { throughRelations: true, reserveSourceProjections: true, carryUntilMovement: true, clearPriorSources: true }
    ];
    const snapshot = plan => canvases.map(canvas => [...plan.get(canvas)].map(([id, point]) => [id, { ...point }]));
    const original = snapshot(base), prior = [];
    for (const policy of policies) {
      const expected = snapshot(reserve(scenes, base, direction, 2, 'root', render, policy));
      const actual = prepared(policy);
      assert.deepEqual(snapshot(actual), expected, JSON.stringify(policy));
      prior.push({ actual, expected });
      for (const result of prior) assert.deepEqual(snapshot(result.actual), result.expected,
        'a later rejected policy cannot mutate an earlier completed attempt');
    }
    assert.notDeepEqual(prior[1].expected, prior[4].expected,
      'the two prefixes retain distinct prior-source clearance behavior');
    for (const index of [2, 5, 1, 4, 3, 0]) assert.deepEqual(snapshot(prepared(policies[index])), prior[index].expected,
      'later clearance cannot mutate a cached prefix before reuse');
    assert.deepEqual(snapshot(base), original, 'the captured baseline remains immutable');
  });

  test(`${direction}: prepared reservations belong only to their captured baseline`, () => {
    const { canvases, scenes, base, render } = scenario(direction);
    const alternate = new Map([...base].map(([canvas, points]) => [canvas,
      new Map([...points].map(([id, point]) => [id, { ...point, x: point.x + 137 }]))]));
    const policy = { throughRelations: true, clearPriorSources: true };
    const first = prepareComponentLifetimeReservations(scenes, base, direction, 2, 'root', render);
    const second = prepareComponentLifetimeReservations(scenes, alternate, direction, 2, 'root', render);
    const expectedFirst = reserve(scenes, base, direction, 2, 'root', render, policy);
    const expectedSecond = reserve(scenes, alternate, direction, 2, 'root', render, policy);
    for (const [prepared, expected] of [[first, expectedFirst], [second, expectedSecond], [first, expectedFirst]]) {
      const actual = prepared(policy);
      for (const canvas of canvases) assert.deepEqual([...actual.get(canvas)], [...expected.get(canvas)]);
    }
    assert.notDeepEqual([...expectedFirst.get(canvases[0])], [...expectedSecond.get(canvases[0])]);
  });
}

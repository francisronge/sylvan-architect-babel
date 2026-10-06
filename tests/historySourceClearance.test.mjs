import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { reserveCompleteComponentLifetime as reserve } from '../replay/workspaceComponentLifetime.ts';

function scenario(direction, { owned = true, needed = true, changedSource = false } = {}) {
  const word = (id, text) => ({ id, label: text, word: text });
  const branch = (id, label, children) => ({ id, label, children });
  const source = () => branch('source', 'DP', [word('sourceWord', 'source')]);
  const small = () => branch('obstacle', 'N', [word('obstacleWord', 'small')]);
  const before = branch('root', 'P', [source(), branch('obstacle', 'N', [word('obstacleWord', 'earlier complete obstacle')])]);
  if (changedSource) before.children[0].children[0].word = 'different source material';
  const prior = branch('root', 'P', [source(), small()]);
  const after = () => branch('root', 'P', [{ id: 'source', label: 'DP', silent: true }, small(),
    branch('landing', 'DP', [word('landingWord', 'source')])]);
  const canvases = [before, prior, after(), after()];
  const base = new Map();
  const scenes = canvases.map((canvas, index) => {
    const hierarchy = d3.hierarchy(canvas); applyVizIds(hierarchy);
    const points = new Map(hierarchy.descendants().map(node => {
      const id = getNodeId(node);
      const x = id.startsWith('source') ? (index < 2 ? 0 : 300)
        : id.startsWith('obstacle') ? (index || !needed ? 1100 : 460)
          : id.startsWith('landing') ? 2100 : 900;
      const y = id.endsWith('Word') ? 300 : id === 'root' ? 0 : 150;
      return [id, { x, y }];
    }));
    base.set(canvas, points);
    const nodes = new Map(hierarchy.descendants().map(node => {
      const point = points.get(getNodeId(node));
      return [getNodeId(node), Object.assign(node, { ...point, x: direction === 'rtl' ? 3000 - point.x : point.x })];
    }));
    const step = index === 2 ? { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 1 },
      replayRelationLinks: [{ authoredRelationKey: owned ? '1:1' : '1:0', renderFamily: 'trajectory',
        priorSourceNodeId: 'source', witnessNodeId: 'source', targetNodeId: 'landing' }] }
      : { replayKind: index ? 'relation' : 'micro', operation: index ? 'Relation' : 'ExternalMerge', targetNodeId: 'root' };
    return { canvas, nodes, coordinates: points, size: [3000, 1000], step };
  });
  const cache = new Map(), retained = [];
  const render = (scene, points) => {
    let plans = cache.get(scene); if (!plans) cache.set(scene, plans = new Map());
    if (plans.has(points)) return plans.get(points);
    const hierarchy = d3.hierarchy(scene.canvas); applyVizIds(hierarchy);
    const nodes = hierarchy.descendants().map(node => {
      const point = points.get(getNodeId(node));
      return Object.assign(node, { ...point, x: direction === 'rtl' ? 3000 - point.x : point.x });
    });
    plans.set(points, nodes); retained.push([nodes, nodes.map(node => [getNodeId(node), node.x, node.y])]);
    return nodes;
  };
  const input = JSON.stringify([...base].map(([canvas, points]) => [canvas, [...points]]));
  const result = reserve(scenes, base, direction, 3, 'root', render, { throughRelations: true, clearPriorSources: true });
  assert.equal(JSON.stringify([...base].map(([canvas, points]) => [canvas, [...points]])), input);
  for (const [nodes, points] of retained) assert.deepEqual(nodes.map(node => [getNodeId(node), node.x, node.y]), points);
  return { result, canvases, base };
}

for (const direction of ['ltr', 'rtl']) {
  test(`${direction}: one rigid source slot clears its earlier complete neighbor and later compact neighbor`, () => {
    const { result, canvases, base } = scenario(direction);
    const first = result.get(canvases[0]), last = result.get(canvases[1]);
    assert(Math.abs(first.get('source').x - 300) > 1);
    assert.equal(first.get('source').x, last.get('source').x);
    assert.equal(first.get('sourceWord').x, first.get('source').x);
    assert.equal(last.get('sourceWord').x, last.get('source').x);
    for (let index = 0; index < 2; index++) for (const id of ['obstacle', 'obstacleWord'])
      assert.deepEqual(result.get(canvases[index]).get(id), base.get(canvases[index]).get(id), 'other current syntax is unchanged');
    for (const canvas of canvases.slice(2)) assert.deepEqual([...result.get(canvas)], [...base.get(canvas)], 'clearance stops at its own movement');
  });
  test(`${direction}: another relation cannot borrow the trajectory's source history`, () => {
    const { result, canvases } = scenario(direction, { owned: false });
    assert.equal(result.get(canvases[0]).get('source').x, 0);
  });
  test(`${direction}: a source clear in every current scene needs no extra offset`, () => {
    const { result, canvases } = scenario(direction, { needed: false });
    assert.equal(result.get(canvases[0]).get('source').x, 300);
    assert.equal(result.get(canvases[1]).get('source').x, 300);
  });
  test(`${direction}: changed earlier material is outside the exact source lifetime`, () => {
    const { result, canvases } = scenario(direction, { changedSource: true });
    assert.equal(result.get(canvases[0]).get('sourceWord').x, 0);
    assert.equal(result.get(canvases[1]).get('sourceWord').x, 300);
  });
}

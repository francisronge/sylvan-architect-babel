import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { retainMovementSourceSlots } from '../replay/movementSourceContinuity.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { treeInkObstacles } from '../replay/treeInkGeometry.ts';

const atom = (id, word) => ({ id, label: id, ...(word ? { word } : {}) });
const fork = (id, ...children) => ({ id, label: id, children });
const points = rows => new Map(rows.map(([id, x, y]) => [id, { x, y }]));

function fixture({ direction, measured = false, forest = false, short = false, hostX = 400 }) {
  const host = fork('host', fork('inner', atom('word', measured || short ? 'w' : 'longword'.repeat(11))));
  const beforeTree = fork('p', atom('left'), host, fork('right', atom('source')));
  const afterTree = fork('p', atom('left'), fork('wrapper', atom('landing'), host), fork('right', atom('lower')));
  const canvas = tree => forest
    ? { id: 'canvas', replayOrigin: { kind: 'workspace' }, children: [atom('farLeft'), tree, atom('farRight')] }
    : tree;
  const before = canvas(beforeTree), after = canvas(afterTree);
  const beforePoints = points([
    ['p', 0, 0], ['left', -2000, 220], ['host', hostX, 220], ['inner', hostX, 440],
    ['word', hostX, 660], ['right', 2000, 220], ['source', 2000, 440]
  ]);
  const afterPoints = points([
    ['p', 0, 0], ['left', -2000, 220], ['wrapper', 600, 220], ['landing', 200, 440],
    ['host', 1000, 440], ['inner', 1000, 660], ['word', 1000, 880], ['right', 2000, 220], ['lower', 2000, 440]
  ]);
  if (forest) for (const coords of [beforePoints, afterPoints]) {
    coords.set('farLeft', { x: -10000, y: 0 });
    coords.set('farRight', { x: 10000, y: 0 });
  }
  const frame = (tree, stage) => ({ replayFrameIndex: stage, replayCanvasData: tree,
    replayVisibleNodeIds: d3.hierarchy(tree).descendants().map(node => node.data.id) });
  const steps = [{ ...frame(before, 0), replayKind: 'macro' }, {
    ...frame(after, 1), replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
    replayRelationLinks: [{ authoredRelationKey: '1:0', movementTransition: true,
      priorSourceNodeId: 'source', witnessNodeId: 'lower', targetNodeId: 'landing' }]
  }];
  const size = [4000, 1000], sizes = new Map([[0, size], [1, size]]);
  const baseline = new Map([[before, beforePoints], [after, afterPoints]]);
  const labels = measured ? new Map([['word', [{ kind: 'terminal', text: 'w', indices: [] }]]]) : undefined;
  const labelRuns = measured ? new Map([[before, labels], [after, labels]]) : undefined;
  const measureLabel = measured ? () => ({ x: -1760, y: 65, width: 3520, height: 110 }) : undefined;
  const bounds = coords => {
    const root = d3.hierarchy(before); applyVizIds(root);
    const visible = new Set(steps[0].replayVisibleNodeIds);
    const nodes = layoutSyntaxTree(root, size, direction, coords, visible).descendants()
      .filter(node => node.data.replayOrigin?.kind !== 'workspace');
    const inkWidth = nodes => {
      const boxes = treeInkObstacles(nodes, undefined, undefined, true, labels, measureLabel);
      return Math.max(...boxes.map(box => box.x + box.width)) - Math.min(...boxes.map(box => box.x));
    };
    return {
      pointWidth: Math.max(...nodes.map(node => node.x)) - Math.min(...nodes.map(node => node.x)),
      forestWidth: inkWidth(nodes),
      rootWidth: inkWidth(nodes.find(node => getNodeId(node) === 'p').descendants())
    };
  };
  const proposed = new Map(beforePoints);
  for (const id of ['host', 'inner', 'word']) proposed.set(id, { ...proposed.get(id), x: 600 });
  return { before, after, beforePoints, afterPoints, baseline, proposed, bounds,
    run: () => retainMovementSourceSlots(steps, sizes, baseline, direction, undefined, undefined, labelRuns, measureLabel) };
}

for (const direction of ['ltr', 'rtl']) for (const measured of [false, true]) for (const forest of [false, true]) {
  test(`${direction}, ${measured ? 'measured' : 'fallback'} text, ${forest ? 'forest' : 'one root'}: reject painted growth behind unchanged node spans`, () => {
    const f = fixture({ direction, measured, forest });
    const before = f.bounds(f.beforePoints), proposed = f.bounds(f.proposed);
    assert.equal(proposed.pointWidth, before.pointWidth);
    assert(proposed.rootWidth > before.rootWidth + 190, 'the candidate expands the receiving tree despite stationary outer nodes');
    if (forest) assert.equal(proposed.forestWidth, before.forestWidth, 'other roots mask that growth at forest level');
    assert.equal(f.run(), f.baseline, 'keep the accepted placement when any completed tree would grow');
  });
}

for (const direction of ['ltr', 'rtl']) for (const short of [false, true]) {
  test(`${direction}: accept ${short ? 'short text' : 'a contraction with long text'} when painted bounds fit`, () => {
    const f = fixture({ direction, short, hostX: short ? 400 : 900 });
    assert(f.bounds(f.proposed).rootWidth <= f.bounds(f.beforePoints).rootWidth);
    const result = f.run();
    assert.notEqual(result, f.baseline, 'the guard must still admit safe receiving slots');
    assert.equal(result.get(f.before).get('host').x, 600);
    assert.deepEqual(result.get(f.after), f.afterPoints, 'movement and later geometry stay unchanged');
  });
}

test('an ordinary receiving slot cannot widen its completed tree behind a detached input', () => {
  const before = { id: 'canvas', replayOrigin: { kind: 'workspace' },
    children: [fork('p', atom('peer'), fork('host', atom('feature'))), atom('input', 'stem')] };
  const after = { id: 'canvas', replayOrigin: { kind: 'workspace' },
    children: [fork('p', atom('peer'), fork('wrapper', fork('host', atom('feature')), atom('input', 'stem')))] };
  const beforePoints = points([['canvas', 0, 0], ['p', 3000, 0], ['peer', 1000, 220],
    ['host', 5000, 220], ['feature', 5000, 440], ['input', 12000, 220]]);
  const afterPoints = points([['canvas', 0, 0], ['p', 7000, 0], ['peer', 1000, 220], ['wrapper', 13000, 220],
    ['host', 11000, 440], ['feature', 11000, 660], ['input', 15000, 440]]);
  const frame = (canvas, stage) => ({ replayFrameIndex: stage, replayCanvasData: canvas,
    replayVisibleNodeIds: d3.hierarchy(canvas).descendants().map(node => node.data.id) });
  const steps = [{ ...frame(before, 0), replayKind: 'macro' }, {
    ...frame(after, 1), replayKind: 'micro', operation: 'ExternalMerge', targetNodeId: 'wrapper', sourceNodeIds: ['host', 'input']
  }];
  const size = [16000, 1000], baseline = new Map([[before, beforePoints], [after, afterPoints]]);
  assert.equal(retainMovementSourceSlots(steps, new Map([[0, size], [1, size]]), baseline), baseline,
    'the receiving tree itself must not grow even when a loose input masks that growth at forest level');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { visibleComponentNodes } from '../replay/visibleComponent.ts';
import { workspaceComponentLifetimeSeeds } from '../replay/workspaceComponentLifetime.ts';
import { reserveWorkspaceAttachments } from '../replay/workspacePlacement.ts';

const atom = (id, word) => ({ id, label: 'N', word });
const branch = (id, children) => ({ id, label: 'XP', children });
function fixture(left) {
  const host = () => branch('opaque/host', [atom('opaque/a', 'alpha'), atom('opaque/b', 'beta')]);
  const incoming = () => branch('opaque/incoming', [atom('opaque/c', 'gamma')]);
  const root = child => branch('opaque/root', [child]);
  const stage = workspaceForest => ({ statement: 'Construct the current objects.', stageRecord: 'Current syntax.', relations: [], workspaceForest });
  return {
    sentence: 'alpha beta gamma', inputTokens: ['alpha', 'beta', 'gamma'],
    derivationStages: [stage(left ? [root(host()), incoming()] : [incoming(), root(host())]),
      stage([root(branch('opaque/join', left ? [incoming(), host()] : [host(), incoming()]))])],
  };
}

function orderSeeds({ relation = false, target = 'join', sourceNodeIds = ['incoming', 'host'],
  incomingOwner = false, changedWord = false, reversedPeers = false } = {}) {
  const host = () => branch('host', [atom('word', 'same')]);
  const incoming = after => atom('incoming', after && changedWord ? 'changed' : 'same');
  const canvases = [branch('forest', [branch('root', [atom('peer', 'fixed'), host()]),
    incomingOwner ? branch('other', [incoming(false)]) : incoming(false)]),
  branch('forest', [branch('root', reversedPeers ? [branch('join', [incoming(true), host()]), atom('peer', 'fixed')]
    : [atom('peer', 'fixed'), branch('join', [incoming(true), host()])])])];
  const scenes = canvases.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const nodes = root.descendants().filter(node => getNodeId(node) !== 'forest');
    for (const node of nodes) Object.assign(node, {
      x: getNodeId(node) === 'incoming' ? index ? 100 : 1000 : getNodeId(node) === 'peer' ? 0 : index ? 700 : 400,
      y: node.depth * 100,
    });
    return { canvas, nodes: new Map(nodes.map(node => [getNodeId(node), node])), coordinates: new Map(), size: [1400, 1000],
      step: { replayKind: relation ? 'relation' : 'micro', operation: 'ExternalMerge', targetNodeId: target, sourceNodeIds } };
  });
  return workspaceComponentLifetimeSeeds(scenes, new Map(scenes.map(scene => [scene.canvas, scene.coordinates])),
    scene => [...scene.nodes.values()], 'merge-order');
}

test('a side reversal reserves the complete unique ordinary join', () => {
  assert.deepEqual(orderSeeds(), [{ index: 1, rootId: 'join', attachment: 'order' }]);
});
for (const [name, options] of [
  ['authored movement', { relation: true }], ['stale target', { target: 'root' }],
  ['unproved inputs', { sourceNodeIds: ['incoming', 'unrelated'] }], ['already connected input', { incomingOwner: true }],
  ['changed material', { changedWord: true }], ['reordered existing peers', { reversedPeers: true }],
]) test(`${name} cannot reserve an ordinary merge order`, () => assert.deepEqual(orderSeeds(options), []));

test('a reversed join cannot widen an already completed receiving tree', () => {
  const host = () => branch('host', [branch('a', []), branch('b', [])]);
  const forest = children => ({ ...branch('forest', children), replayOrigin: { kind: 'workspace' } });
  const before = forest([branch('root', [branch('peer', []), host()]), branch('incoming', [])]);
  const after = forest([branch('root', [branch('peer', []), branch('join', [branch('incoming', []), host()])])]);
  const points = (values) => new Map(Object.entries(values).map(([id, [x, y]]) => [id, { x, y }]));
  const original = new Map([
    [before, points({ root: [800, 0], peer: [0, 400], host: [1600, 400], a: [1200, 800], b: [2000, 800], incoming: [5000, 0] })],
    [after, points({ root: [2250, 0], peer: [0, 400], join: [4500, 400], incoming: [3000, 800], host: [6000, 800], a: [5600, 1200], b: [6400, 1200] })],
  ]);
  const steps = [before, after, after].map((canvas, index) => {
    const tree = d3.hierarchy(canvas); applyVizIds(tree);
    return { replayCanvasData: canvas, replayVisibleNodeIds: tree.descendants().map(getNodeId).filter(id => id !== 'forest'),
      replayFrameIndex: index ? 1 : 0, replayStageStepIndex: index === 2 ? 1 : 0,
      replayKind: index === 1 ? 'micro' : 'macro', operation: index === 1 ? 'ExternalMerge' : 'Stage Record',
      targetNodeId: 'join', sourceNodeIds: ['incoming', 'host'] };
  });
  const size = [10000, 2000];
  const result = reserveWorkspaceAttachments({ steps, sizes: new Map([[0, size], [1, size]]), direction: 'ltr',
    coordinatesForStage: stage => new Map([[stage ? after : before, original.get(stage ? after : before)]]) });
  const tree = d3.hierarchy(before); applyVizIds(tree);
  const nodes = new Map(layoutSyntaxTree(tree, size, 'ltr', result.get(before), new Set(steps[0].replayVisibleNodeIds))
    .descendants().map(node => [getNodeId(node), node]));
  const xs = visibleComponentNodes(nodes.get('root'), nodes).map(node => node.x);
  assert(Math.max(...xs) - Math.min(...xs) <= 2000, 'future attachment space must not stretch the existing fork');
  assert.equal(nodes.get('a').x, 1200, 'the unsafe reservation retains the accepted component positions');
});

for (const left of [true, false]) for (const direction of ['ltr', 'rtl']) {
  for (const [width, height] of [[1600, 1000], [390, 844]]) {
    test(`nested merge reserves the eventual ${left ? 'left' : 'right'} daughter (${direction}, ${width}px)`, () => {
      const input = fixture(left), authored = JSON.stringify(input);
      const replay = prepareReplay({ ...input, includePlayback: true }), steps = replay.playbackSteps;
      const groups = buildStageLayoutGroups(steps, replay.replayDerivationFrames);
      const sizeFor = stage => stageTreeLayoutSize(steps, stage, width, height, groups);
      const scenes = steps.map(step => {
        const size = sizeFor(step.replayFrameIndex), tree = d3.hierarchy(step.replayCanvasData);
        applyVizIds(tree);
        const visible = new Set(step.replayVisibleNodeIds);
        const coordinates = buildStageCoordinateReservations(steps, step.replayFrameIndex, size, sizeFor, direction).get(step.replayCanvasData);
        return new Map(layoutSyntaxTree(tree, size, direction, coordinates, visible).descendants()
          .filter(node => visible.has(getNodeId(node))).map(node => [getNodeId(node), node]));
      });
      const join = steps.findIndex(step => step.operation === 'ExternalMerge' && step.targetNodeId === 'opaque/join');
      assert(join > 0);
      const before = scenes[join - 1], after = scenes[join], host = after.get('opaque/host');
      for (const member of visibleComponentNodes(host, after)) {
        const id = getNodeId(member), old = before.get(id);
        assert(Math.abs((old.x - before.get('opaque/host').x) - (member.x - host.x)) < 1e-6,
          `${id} changes the existing horizontal branch shape`);
        assert(Math.abs((old.y - before.get('opaque/host').y) - (member.y - host.y)) < 1e-6,
          `${id} changes the existing branch shape`);
        for (let index = 0; index < join; index++) {
          const earlier = scenes[index].get(id);
          if (earlier) assert(Math.abs(earlier.x - old.x) < 1e-6, `${id} defers the jump to frame ${index + 1}`);
        }
      }
      const a = before.get('opaque/incoming').x - before.get('opaque/host').x;
      const b = after.get('opaque/incoming').x - host.x;
      assert(a * b > 0, 'the waiting object starts on its eventual side');
      assert(!before.has('opaque/join'), 'reserved space never reveals the future wrapper');
      assert.equal(JSON.stringify(input), authored, 'authored syntax remains unchanged');
    });
  }
}

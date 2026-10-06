import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { workspaceComponentLifetimeSeeds } from '../replay/workspaceComponentLifetime.ts';

const atom = id => ({ id, label: id });
const branch = (id, children) => ({ id, label: id, children });
function seeds({ reverse = false, operation = 'ExternalMerge', target = 'joining', relation = false,
  peerMoves = true, changedOwner = false, changedWord = false, incomingCompound = false, incomingDeforms = false } = {}) {
  const peer = after => branch('peer', [branch('peerChild', [{ ...atom('peerWord'), word: after && changedWord ? 'changed' : 'same' }])]);
  const host = () => branch('host', [atom('hostWord')]);
  const incoming = () => incomingCompound ? branch('incoming', [atom('incomingWord')]) : atom('incoming');
  const oldPeer = changedOwner ? branch('oldOwner', [peer(false)]) : peer(false);
  const canvases = [branch('forest', [branch('root', [oldPeer, host()]), incoming()]),
    branch('forest', [branch('root', [peer(true), branch('joining', [host(), incoming()])])])];
  const scenes = canvases.map((canvas, index) => {
    const root = d3.hierarchy(canvas); applyVizIds(root);
    const nodes = root.descendants().filter(node => getNodeId(node) !== 'forest');
    for (const node of nodes) {
      const id = getNodeId(node);
      Object.assign(node, { x: id.startsWith('peer') ? 100 + (peerMoves && index ? 20 : 0) : 500,
        y: id === 'incomingWord' && incomingDeforms ? node.depth * 100 + index * 10 : id === 'hostWord' ? 200 + index * 10 : id === 'host' ? 100 : node.depth * 100 });
    }
    const ordered = reverse ? nodes.reverse() : nodes;
    return { canvas, nodes: new Map(ordered.map(node => [getNodeId(node), node])), coordinates: new Map(), size: [1000, 1000],
      step: relation ? { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 },
        replayRelationLinks: [{ authoredRelationKey: '1:0', renderFamily: 'trajectory', priorSourceNodeId: 'peer', targetNodeId: 'host', witnessNodeId: 'peer' }] }
        : { replayKind: 'micro', operation, targetNodeId: target } };
  });
  return workspaceComponentLifetimeSeeds(scenes, new Map(scenes.map(scene => [scene.canvas, scene.coordinates])), scene => [...scene.nodes.values()]);
}

test('the joining attachment is reserved before the maximal unrelated component', () => {
  assert.deepEqual(seeds(), [
    { index: 1, rootId: 'host', attachment: true },
    { index: 1, rootId: 'peer', unrelated: true },
  ]);
});
test('reversing node and Map iteration preserves the same structural dependency order', () => {
  assert.deepEqual(seeds({ reverse: true }), seeds());
});
for (const [name, option] of [['selection', { operation: 'LexicalSelect' }], ['missing target', { target: 'absent' }],
  ['already visible target', { target: 'root' }], ['owned movement moment', { relation: true }],
  ['unchanged absolute position', { peerMoves: false }], ['different parent', { changedOwner: true }],
  ['different pronunciation', { changedWord: true }]]) test(`${name} cannot create an unchanged unrelated peer seed`, () => {
    assert(!seeds(option).some(seed => seed.rootId === 'peer'));
  });

function hiddenIslandSeeds(reverseHiddenOrder = false) {
  const island = (name, after) => branch(`island${name}`, [branch(`peer${name}`, [atom(`word${name}`)]),
    { ...atom(`change${name}`), word: after ? 'after' : 'before' }]);
  const canvas = after => {
    const children = ['A', 'B'].map(name => island(name, after));
    if (reverseHiddenOrder) children.reverse();
    const shield = branch('shield', [branch('invisible', children)]);
    return branch('forest', [after ? branch('joining', [shield, atom('incoming')]) : shield]);
  };
  const scenes = [false, true].map(after => {
    const data = canvas(after), root = d3.hierarchy(data); applyVizIds(root);
    const visible = root.descendants().filter(node => !['forest', 'invisible'].includes(getNodeId(node)));
    for (const node of visible) {
      const id = getNodeId(node), side = id.endsWith('A') ? 100 : id.endsWith('B') ? 500 : 1000;
      Object.assign(node, { x: side + (after && id.startsWith('peer') ? 20 : 0), y: node.depth * 100 });
    }
    return { canvas: data, nodes: new Map(visible.map(node => [getNodeId(node), node])), coordinates: new Map(),
      size: [2000, 1500], step: { replayKind: 'micro', operation: 'ExternalMerge', targetNodeId: 'joining' } };
  });
  return workspaceComponentLifetimeSeeds(scenes, new Map(scenes.map(scene => [scene.canvas, scene.coordinates])), scene => [...scene.nodes.values()]);
}
test('a merge target and unchanged ancestor above an invisible parent cannot claim its separate visible islands', () => {
  assert.deepEqual(hiddenIslandSeeds().map(seed => seed.rootId), ['peerA', 'peerB']);
});
test('reordering invisible scaffold children cannot change visible-island seed order', () => {
  assert.deepEqual(hiddenIslandSeeds(true), hiddenIslandSeeds(false));
});

test('an independent complete component joining a new nested wrapper receives its own shape seed', () => {
  assert(seeds({ incomingCompound: true, incomingDeforms: true }).some(seed => seed.rootId === 'incoming' && seed.attachment));
});
test('rigid translation alone does not add an independent attachment-shape seed', () => {
  assert(!seeds({ incomingCompound: true }).some(seed => seed.rootId === 'incoming'));
});
test('an unrelated selection cannot own an independent attachment-shape seed', () => {
  assert(!seeds({ incomingCompound: true, incomingDeforms: true, operation: 'LexicalSelect' }).some(seed => seed.rootId === 'incoming'));
});

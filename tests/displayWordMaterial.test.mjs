import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { authoredDisplayWord } from '../replay/displayWordMaterial.ts';
import { workspaceComponentLifetimeSeeds } from '../replay/workspaceComponentLifetime.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';

const leaf = (word, changes = {}) => ({ id: 'word', label: word, word, replayOrigin: { kind: 'word', ownerId: 'owner' }, ...changes });
const owner = (word, display, changes = {}) => ({ id: 'owner', label: 'D', word, children: [leaf(display)], ...changes });
function seeds(before, after, hiddenOwner = false) {
  const scenes = [before, after].map((canvas, index) => {
    const root = d3.tree().nodeSize([100, 100])(d3.hierarchy(canvas)); applyVizIds(root);
    const nodes = new Map(root.descendants().filter(node => !hiddenOwner || getNodeId(node) !== 'owner').map(node => {
      node.x += index * 50; return [getNodeId(node), node];
    }));
    const coordinates = new Map([...nodes].map(([id, node]) => [id, { x: node.x, y: node.y }]));
    return { canvas, nodes, coordinates, size: [1000, 1000], step: {} };
  });
  return workspaceComponentLifetimeSeeds(scenes, new Map(scenes.map(s => [s.canvas, s.coordinates])), scene => [...scene.nodes.values()]);
}
test('sentence-case display change keeps the same authored word lifetime', () => {
  const before = owner('The', 'The'), after = owner('The', 'the');
  const original = JSON.stringify([before, after]);
  assert.deepEqual(seeds(before, after), [{ index: 1, rootId: 'owner' }]);
  assert.equal(JSON.stringify([before, after]), original);
});
for (const [name, after] of [
  ['different authored spelling', owner('A', 'A')],
  ['authored casing change', owner('the', 'the')],
  ['silent occurrence', owner('The', 'The', { silent: true })]
]) test(`${name} ends the previous material lifetime`, () => assert.deepEqual(seeds(owner('The', 'The'), after), []));
test('a display child separated by an invisible owner cannot borrow its spelling', () => {
  assert.deepEqual(seeds(owner('The', 'The'), owner('The', 'the'), true), []);
});
test('only an exact generated leaf and owner pair can share authored spelling', () => {
  const syntaxOwner = owner('The', 'the');
  assert.equal(authoredDisplayWord(leaf('the'), syntaxOwner), 'The');
  assert.equal(authoredDisplayWord(leaf('the'), undefined), undefined);
  assert.equal(authoredDisplayWord(leaf('the', { replayOrigin: undefined }), syntaxOwner), undefined);
  assert.equal(authoredDisplayWord(leaf('the', { replayOrigin: { kind: 'word', ownerId: 'other' } }), syntaxOwner), undefined);
  assert.equal(authoredDisplayWord(leaf('that'), syntaxOwner), undefined);
  assert.equal(authoredDisplayWord(leaf('the', { children: [{ id: 'child', label: 'N' }] }), syntaxOwner), undefined);
});

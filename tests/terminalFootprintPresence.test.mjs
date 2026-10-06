import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId, isUnderTriangulation } from '../replay/replayCompiler.ts';
import { plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';
import { treeInkObstacles } from '../replay/treeInkGeometry.ts';
import { treeLabelRunsForStep } from '../replay/treeLabelRuns.ts';

const width = text => text.length * 20;
function nodes(data) {
  const root = d3.hierarchy(data);
  applyVizIds(root);
  root.each(node => { node.x = 200; node.y = 300 + node.depth * 210; });
  return root.descendants();
}
const attached = (rects, id, kind) => rects.filter(rect => rect.connectorAttachment === `${id}:${kind}`);
const stems = (rects, id) => rects.filter(rect => rect.terminalStemNodeId === id);
function descriptors(canvas) {
  return treeLabelRunsForStep({
    playbackSteps: [{ replayCanvasData: canvas, replayFrameIndex: 0, replayKind: 'micro', replayRelationLinks: [] }],
    replayDerivationFrames: [{ workspaceForest: [canvas] }],
    movementChainIndexCatalogue: { forest: [canvas], links: [], authoredIndicesByNodeId: new Map() }
  }, 0, width);
}

test('label-only trace and null notation reserve a terminal and its stem, with no phantom category', () => {
  for (const label of ['t', 't₁', 't₂', 't₃', '∅']) {
    const data = { id: 'witness', label, silent: true };
    const current = nodes(data), labels = descriptors(data);
    assert.deepEqual(labels.get('witness').map(run => run.kind), ['terminal']);
    const boxes = plaqueTreeObstacles(current, width);
    assert.equal(attached(boxes, 'witness', 'terminal').length, 1);
    assert.equal(stems(boxes, 'witness').length, 1);
    assert.equal(attached(boxes, 'witness', 'category').length, 0);
    assert.deepEqual(boxes, [
      { x: 125, y: 365, width: 150, height: 110, blocksConnectors: true, connectorAttachment: 'witness:terminal' },
      { x: 194, y: 300, width: 12, height: 130, terminalStemNodeId: 'witness' }
    ]);
  }
});

test('styled trace metrics replace the new base footprint and reserve the exact painted stem once', () => {
  const current = nodes({ id: 'witness', label: 't', silent: true });
  const run = { kind: 'terminal', text: 't₁', indices: [] };
  const labels = new Map([['witness', [run]]]);
  const calls = [];
  const boxes = treeInkObstacles(current, width, undefined, true, labels, value => {
    calls.push(value);
    return { x: -19, y: 63, width: 42, height: 67 };
  });
  assert.deepEqual(calls, [run]);
  assert.deepEqual(attached(boxes, 'witness', 'terminal'), [
    { x: 125, y: 363, width: 150, height: 67, connectorAttachment: 'witness:terminal' }
  ]);
  assert.deepEqual(stems(boxes, 'witness'), [
    { x: 198.5, y: 318.5, width: 3, height: 48, terminalStemNodeId: 'witness' }
  ]);
  assert.equal(attached(boxes, 'witness', 'category').length, 0);
});

test('changing a word-stored trace to identical label-stored notation preserves prior geometry', () => {
  const before = nodes({ id: 'witness', label: 't', word: 't', silent: true });
  const after = nodes({ id: 'witness', label: 't', silent: true });
  assert.deepEqual(plaqueTreeObstacles(after, width), plaqueTreeObstacles(before, width));
  const labels = new Map([['witness', [{ kind: 'terminal', text: 't₁', indices: [] }]]]);
  const measure = () => ({ x: -19, y: 63, width: 42, height: 67 });
  assert.deepEqual(treeInkObstacles(after, width, undefined, true, labels, measure),
    treeInkObstacles(before, width, undefined, true, labels, measure));
});

test('ordinary authored word envelopes retain their exact dimensions, including padded source spelling', () => {
  for (const word of ['Mia', 'children', '  children  ']) {
    const boxes = plaqueTreeObstacles(nodes({ id: 'word', label: word, word }), width);
    const wordWidth = Math.max(150, word.length * 40);
    assert.deepEqual(boxes, [
      { x: 200 - wordWidth / 2, y: 365, width: wordWidth, height: 110, blocksConnectors: true, connectorAttachment: 'word:terminal' },
      { x: 194, y: 300, width: 12, height: 130, terminalStemNodeId: 'word' }
    ]);
  }
});

test('wordless categories and trace-labelled parents have only their painted categories', () => {
  for (const data of [
    { id: 'head', label: 'T', silent: true },
    { id: 'head', label: 'AgrObj⁰', silent: true },
    { id: 'head', label: '', word: '' },
    { id: 'head', label: 't', children: [{ id: 'child', label: 'N', word: 'Mia' }] }
  ]) {
    const current = nodes(data), labels = descriptors(data);
    assert.deepEqual(labels.get('head').map(run => run.kind), ['category']);
    const boxes = plaqueTreeObstacles(current, width);
    assert.equal(attached(boxes, 'head', 'category').length, 1);
    assert.equal(attached(boxes, 'head', 'terminal').length, 0);
    assert.equal(stems(boxes, 'head').length, 0);
  }
});

test('ghost copies retain one terminal, and a wordless ghost category gains no terminal', () => {
  for (const data of [
    { id: 'ghost', label: 'Mia', word: 'Mia', ghost: true },
    { id: 'ghost', label: 't', ghost: true }
  ]) {
    const boxes = plaqueTreeObstacles(nodes(data), width);
    assert.equal(attached(boxes, 'ghost', 'terminal').length, 1);
    assert.equal(stems(boxes, 'ghost').length, 1);
  }
  const boxes = plaqueTreeObstacles(nodes({ id: 'ghost', label: 'NP', ghost: true }), width);
  assert.equal(attached(boxes, 'ghost', 'category').length, 1);
  assert.equal(attached(boxes, 'ghost', 'terminal').length, 0);
  assert.equal(stems(boxes, 'ghost').length, 0);
});

test('visible-node filtering adds no absent or triangulated descendant terminals', () => {
  const current = nodes({ id: 'root', label: 'CP', children: [
    { id: 'collapsed', label: 'DP', children: [{ id: 'hidden', label: '∅', silent: true }] },
    { id: 'future', label: 't', silent: true }
  ] });
  current.find(node => getNodeId(node) === 'collapsed').isTriangulated = true;
  const visible = current.filter(node => !isUnderTriangulation(node) && getNodeId(node) !== 'future');
  const boxes = plaqueTreeObstacles(visible, width);
  assert.equal(attached(boxes, 'collapsed', 'terminal').length, 0);
  assert.equal(boxes.filter(rect => rect.connectorAttachment?.endsWith(':terminal')).length, 0);
  assert.equal(boxes.filter(rect => rect.terminalStemNodeId).length, 0);
});

test('missing styled metrics retain complete new trace protection', () => {
  const current = nodes({ id: 'witness', label: '∅', silent: true });
  const base = plaqueTreeObstacles(current, width, true);
  const labels = descriptors(current[0].data);
  for (const measure of [() => undefined, () => ({ x: 0, y: 0, width: NaN, height: 10 })]) {
    assert.deepEqual(treeInkObstacles(current, width, undefined, true, labels, measure), base);
  }
});

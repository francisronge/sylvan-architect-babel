import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { paintSyntaxTree } from '../components/renderer/syntaxDrawing.ts';
import { applyVizIds } from '../replay/displayIdentity.ts';
import { createSvgDom, select } from './helpers/svgDom.mjs';

const { Element, restore } = createSvgDom();
after(restore);

function render(label, x = 400) {
  const canvas = { id: 'root', label: 'XP', children: [{ id: 'child', label }] };
  const tree = d3.hierarchy(canvas);
  applyVizIds(tree);
  tree.x = 0; tree.y = 0;
  tree.children[0].x = x; tree.children[0].y = 180;
  const root = new Element('g');
  paintSyntaxTree({
    treeData: tree, rootHierarchy: tree, clonedCanvasData: canvas, g: select(root),
    playbackSteps: [], animated: false, activeStepIndex: 0, replayVisibleNodeIdSet: null,
    traceDisplayIndexByNodeId: new Map(), traceDisplayFrame: null,
    traceDisplayRelationLinks: [], traceDisplayFrameIndex: 0, usesDerivationFrames: false,
    activeDerivationArrowLinks: [], terminalMorphRef: { current: new Map() },
    firstSentenceReplayToken: '', firstSentenceReplayDisplayToken: '',
    relationRenderPlan: null,
    measureCategoryText: text => [...text].length * 25, currentReplayStep: null,
    pendingPhraseFrontingSourceNodeIds: new Set(), getReplayTokenIndex: () => undefined,
    hasDerivationFrames: false
  });
  return { root, tree };
}

const labels = ['I', 'I[finite, present, perfect, third-person singular]', 'I[' + 'long feature, '.repeat(12) + ']'];

test('wrapped categories preserve the original downward branch instead of moving its endpoint upward', () => {
  const native = d3.linkVertical().x(d => d.x).y(d => d.y);
  for (const label of labels) for (const x of [-400, 400]) {
    const { root, tree } = render(label, x);
    const paths = select(root).selectAll('.branch').nodes();
    assert.equal(paths.length, 1);
    assert.equal(paths[0].getAttribute('d'), native(tree.links()[0]), label);
  }
});

test('multiline category labels retain a local readability halo without masking incoming branches', () => {
  const { root } = render(labels.at(-1));
  const branch = select(root).select('.branch').node();
  assert.equal(branch.getAttribute('mask'), null);
  assert.equal(branch.style.getPropertyValue('mask'), '');
  const category = select(root).selectAll('.category-label').nodes().find(label =>
    label.getAttribute('data-category-node-id') === 'child');
  assert(category.children.length > 1, 'the fixture must wrap onto several lines');
  assert.equal(category.style.getPropertyValue('paint-order'), 'stroke');
  assert.equal(category.style.getPropertyValue('stroke'), '#020806');
  assert.equal(category.style.getPropertyValue('stroke-width'), '10px');
});

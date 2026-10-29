import * as d3 from 'd3';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { refineRelationGeometry } from '../components/renderer/relationRefinements.ts';
import { TRAJECTORY_ROUTES } from '../replay/rendererMetrics.ts';
import { createSvgDom } from './helpers/svgDom.mjs';

// Remnant and smuggling paths run along numbered lanes under the tree. Head,
// phrasal and roll-up paths take no lane, so however many precede them in the
// frame, the first lane-taking path keeps the first lane and the next the second.
const { Element, restore } = createSvgDom();
after(restore);

const rect = (x, y) => ({ left: x, top: y, right: x + 40, bottom: y + 30, width: 40, height: 30 });

function paintedLanes(kinds) {
  const root = new Element('g');
  const g = d3.select(root);
  const treeData = d3.hierarchy({ id: 'cp', label: 'CP', children: [
    { id: 'dp', label: 'DP', children: [{ id: 'w', label: 'w', word: 'w' }] }
  ] });
  treeData.each(node => { node.__vizId = node.data.id; });
  const byId = new Map(treeData.descendants().map(node => [node.data.id, node]));
  for (const [id, y] of [['cp', 0], ['dp', 100]]) {
    const label = g.append('text').attr('class', 'category-label').attr('data-category-node-id', id).datum(byId.get(id)).node();
    label.rect = rect(100, y);
  }
  g.append('text').attr('class', 'terminal-label').attr('data-node-id', 'w').datum(byId.get('w')).node().rect = rect(100, 200);
  const paths = kinds.map(kind => {
    const path = g.append('g').append('path')
      .attr('class', `babel-trajectory-path vr-trajectory vr-trajectory-${kind}`)
      .attr('data-trajectory-kind', kind).attr('d', 'M 0 0 L 0 0').node();
    if (kind === 'remnant' || kind === 'smuggling') {
      d3.select(path).attr('data-trajectory-from', 'dp').attr('data-trajectory-to', 'cp');
    }
    path.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    return { kind, path };
  });
  refineRelationGeometry({
    treeData, g, svg: d3.select(new Element('svg')), relationRenderPlan: null, activeDerivationFrameIndex: 0,
    replayPlaqueLayout: new Map(), visibleNodes: treeData.descendants(), measureCategoryText: () => 20,
    deferredAcceptedRelationDraws: [], playedRelationIndices: null, updateScreenStableText() {},
    measureGraphicsElementsInTreeSpace: () => null, deferredTreeMatrix: () => root.getScreenCTM()
  });
  return paths.filter(({ kind }) => kind === 'remnant' || kind === 'smuggling')
    .map(({ path }) => Number(path.getAttribute('d').split(' L ')[1].split(' ')[1]));
}

const treeBottom = 230;
const lane = ordinal => treeBottom + TRAJECTORY_ROUTES.orthogonalLaneSpacing * (1 + ordinal);

test('head, phrasal and roll-up paths before a remnant leave it the first lane', () => {
  assert.deepEqual(paintedLanes(['remnant']), [lane(0)], 'a lone remnant takes the first lane');
  assert.deepEqual(paintedLanes(['head', 'phrasal', 'roll-up', 'remnant']), [lane(0)]);
});

test('two lane-taking paths after other movement take the first and second lanes', () => {
  assert.deepEqual(paintedLanes(['head', 'remnant', 'phrasal', 'smuggling']), [lane(0), lane(1)]);
});

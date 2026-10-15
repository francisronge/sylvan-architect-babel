import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrajectoryRefinements } from '../components/renderer/trajectoryRefinements.ts';
import { createSvgDom, select } from './helpers/svgDom.mjs';

for (const nodeId of ['ordinary-edge', 'edge"quoted', String.raw`edge\segment`, 'edge"].other-branch[data-x="value']) {
  test(`blocked-edge refinement preserves opaque anchor ID ${JSON.stringify(nodeId)}`, () => {
    const { Element, restore } = createSvgDom();
    try {
      const root = new Element('g');
      const g = select(root);
      g.append('path').attr('class', 'branch')
        .attr('data-target-node-id', `${nodeId}-neighbor`)
        .attr('d', 'M 1000 0 C 1033.333 0 1066.667 0 1100 0');
      g.append('path').attr('class', 'branch')
        .attr('data-target-node-id', nodeId)
        .attr('d', 'M 0 0 C 33.333 0 66.667 0 100 0');
      const layer = g.append('g');
      const slashes = [0, 1].map(() => layer.append('line')
        .attr('class', 'babel-pg-blocked-edge')
        .attr('data-blocked-edge-node', nodeId).node());

      const { refinePhillipsBlockedEdge } = createTrajectoryRefinements({ g });
      refinePhillipsBlockedEdge.call(layer.node());

      assert.deepEqual(slashes.map(slash => ['x1', 'y1', 'x2', 'y2'].map(name => slash.getAttribute(name))), [
        ['30.0', '-20.0', '30.0', '20.0'],
        ['86.0', '-20.0', '86.0', '20.0']
      ]);
      assert(slashes.every(slash => !slash.hasAttribute('data-blocked-edge-node')));
      assert.equal(g.selectAll('.branch').nodes()[1].getAttribute('data-target-node-id'), nodeId);
    } finally {
      restore();
    }
  });
}

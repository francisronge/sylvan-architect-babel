import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds } from '../replay/displayIdentity.ts';
import { nativePlaqueObstacles } from '../replay/relations/nativePlaqueSpace.ts';
import { nativeRelationPlaqueRects } from '../replay/relations/plaquePlacement.ts';

test('fixed dependent-case plaques reserve independent label variants that reverse their vertical order', () => {
  for (const direction of [1, -1]) {
    const root = d3.hierarchy({ id: 'root', label: 'XP', children: ['probe', 'goal'].map(id => ({ id, label: 'NP',
      children: [{ id: `${id}-word`, label: 'N', word: id }] })) });
    applyVizIds(root);
    const nodes = root.descendants();
    nodes.forEach(node => {
      node.x = (node.data.id.startsWith('probe') ? 100 : node.data.id.startsWith('goal') ? 600 : 350) * direction;
      node.y = node.parent?.parent ? 350 : node.parent ? 150 : 0;
    });
    const labels = new Map(['probe', 'goal'].map(id => [id,
      [0, 1].map(variant => ({ kind: 'category', text: `${id}:${variant}`, indices: [] }))]));
    for (const id of ['probe-word', 'goal-word']) labels.set(id, [{ kind: 'terminal', text: id, indices: [] }]);
    const measure = run => run.kind === 'terminal' ? { x: -30, y: 90, width: 60, height: 60 }
      : { x: -20, y: (run.text.startsWith('probe') ? -40 : -41) + Number(run.text.split(':')[1]) * 2,
          width: 40, height: 30 };
    const item = { kind: 'directed-path', pathStyle: 'dependent-case', fromNodeId: 'probe', toNodeId: 'goal',
      label: 'probe', secondaryLabel: 'goal', dependentCaseStep: '2' };
    const obstacles = nativePlaqueObstacles([item], nodes, { labels, measureTreeLabel: measure });
    for (const probeVariant of [0, 1]) for (const goalVariant of [0, 1]) {
      const rectFor = (id, terminal) => {
        const node = nodes.find(node => node.data.id === `${id}${terminal ? '-word' : ''}`);
        const box = measure(labels.get(node.data.id)[terminal ? 0 : id === 'probe' ? probeVariant : goalVariant]);
        return { ...box, x: node.x + box.x, y: node.y + box.y };
      };
      for (const box of nativeRelationPlaqueRects([item], rectFor)) assert(obstacles.some(outer =>
        box.x >= outer.x && box.y >= outer.y && box.x + box.width <= outer.x + outer.width
          && box.y + box.height <= outer.y + outer.height),
      'every actually painted state fits its reserved footprint, including mixed metric corners');
    }
    assert.deepEqual(nativePlaqueObstacles([{ kind: 'undirected-link', linkStyle: 'unknown', pairs: [] }], nodes), [],
      'unknown marks cannot gain invented native plaque geometry');
  }
});

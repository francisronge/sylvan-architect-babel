import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildStageCameraBounds, measureStagePlaqueSpace } from '../replay/stageCamera.ts';
import { bindingDomainEllipse, bindingDomainTreeRect, bindingEllipseBounds } from '../replay/relations/bindingDomainGeometry.ts';
import { availableTreeViewport, containCamera } from '../components/treeViewport.ts';
import { categoryTextLayout } from '../replay/categoryTextLayout.ts';

const leaf = (id, word) => ({ id, label: 'N', word });
const branch = (id, label, children) => ({ id, label, children });
const forest = [branch('clause', 'IP', [
  branch('subject', 'DP', [leaf('no', 'No'), leaf('student', 'student')]),
  branch('finite', "I′", [leaf('has', 'has'), branch('domain', 'VP', [
    { id: 'trace', label: 'DP[trace]', silent: true },
    branch('predicate', "V′", [leaf('read', 'read'), branch('object', 'DP', [
      leaf('this', 'this'), branch('nominal', 'NP', [leaf('book', 'book')])
    ])])
  ])])
])];
const stage = (relations) => ({ statement: 'The clause is complete.',
  stageRecord: 'The subject binds its lower occurrence inside the authored local domain.',
  relations, workspaceForest: structuredClone(forest) });
const preferredFit = (bounds, view) => {
  const k = Math.min(1, (view.right - view.left) / (bounds.maxX - bounds.minX + 440),
    (view.bottom - view.top) / (bounds.maxY - bounds.minY + 320));
  return { k, x: (view.left + view.right) / 2 - (bounds.minX + bounds.maxX) * k / 2,
    y: (view.top + view.bottom) / 2 - (bounds.minY + bounds.maxY) * k / 2 };
};
const contains = (outer, inner, message) => {
  for (const key of ['minX', 'minY']) assert(outer[key] <= inner[key] + 1e-6, `${message}: ${key}`);
  for (const key of ['maxX', 'maxY']) assert(outer[key] >= inner[key] - 1e-6, `${message}: ${key}`);
};

test('wordless witnesses reserve their category ink without an invented terminal below it', () => {
  const witness = d3.hierarchy({ id: 'trace', label: 'DP[trace]', silent: true });
  witness.x = 0; witness.y = 0;
  const label = categoryTextLayout(witness.data.label);
  assert.deepEqual(bindingDomainTreeRect([witness]), {
    x: label.x - 8, y: label.y - 8, width: label.width + 16, height: label.height + 16
  });
});

test('the accepted ellipse still encloses every padded domain corner', () => {
  for (const rect of [{ x: -300, y: -50, width: 900, height: 2000 },
    { x: 120, y: 300, width: 2400, height: 300 }, { x: 0, y: 0, width: 30, height: 80 }]) {
    const ellipse = bindingDomainEllipse(rect);
    for (const x of [rect.x - 34, rect.x + rect.width + 34]) {
      for (const y of [rect.y - 26, rect.y + rect.height + 26]) {
        assert(Math.abs(((x - ellipse.cx) / ellipse.rx) ** 2 + ((y - ellipse.cy) / ellipse.ry) ** 2 - 1) < 1e-9);
      }
    }
  }
});

for (const [relation, domain] of [
  [{ relation: 'Binding', anchors: { binder: 'subject', bound: 'trace', domain: 'clause' } }, 'clause'],
  [{ relation: 'local A-binding', anchors: { binder: 'subject', anaphoricTrace: 'trace', localDomain: 'clause' } }, 'clause'],
  [{ relation: 'Binding', anchors: { binder: 'subject', bound: 'trace', domain: 'domain' } }, 'domain']
]) {
  for (const [width, height] of [[1600, 1020], [390, 844]]) {
    test(`${relation.relation} in ${domain}, ${width}px: the full domain fits before and after its relation moment`, () => {
      const stages = [stage([relation])];
      const prepared = prepareReplay({ derivationStages: stages, sentence: 'No student has read this book', includePlayback: true });
      const input = { steps: prepared.playbackSteps, stageIndex: 0, plan: prepared.relationRenderPlan, width, height,
        completedCanvas: prepared.playbackSteps.at(-1).replayCanvasData, plaqueLayout: new Map(),
        includeOverlays: false, includePlaques: false };
      const items = input.plan.frames[0].items.filter(item => item.kind === 'binding-domain');
      assert.equal(items.length, 1);
      assert.equal(items[0].domainNodeId, domain);
      assert(items[0].domainMemberNodeIds.includes('book'), 'the last word remains part of the authored domain');
      const ordinary = buildStageCameraBounds(input);
      const bounds = buildStageCameraBounds({ ...input, includeBindingDomains: true });
      const view = availableTreeViewport(width, height, { headerBottom: 80, panelTop: height - 230 });
      const camera = containCamera(preferredFit(ordinary, view), bounds, view);
      const scene = measureStagePlaqueSpace(input);
      let checked = 0;
      for (const { nodes } of scene.scenes) {
        const root = nodes.find(node => node.data.id === domain);
        if (!root) continue;
        const visible = new Set(nodes);
        const rect = bindingDomainTreeRect(root.descendants().filter(node => visible.has(node)));
        if (!rect) continue;
        const ellipse = bindingDomainEllipse(rect), ink = bindingEllipseBounds(ellipse);
        contains(bounds, ink, 'stage reservation contains the ellipse');
        contains({ minX: view.left, minY: view.top, maxX: view.right, maxY: view.bottom }, {
          minX: camera.x + ink.minX * camera.k, maxX: camera.x + ink.maxX * camera.k,
          minY: camera.y + ink.minY * camera.k, maxY: camera.y + ink.maxY * camera.k
        }, 'fitted ellipse stays in the available viewport');
        checked++;
      }
      assert(checked > 0);
      assert(prepared.playbackSteps.some(step => step.replayKind === 'relation'));
      assert.deepEqual(buildStageCameraBounds({ ...input, includeBindingDomains: true,
        steps: [...prepared.playbackSteps].reverse() }), bounds, 'Replay traversal does not change the reserved camera');
    });
  }
}

test('a fitting domain retains the accepted camera; user zoom preserves all enclosure geometry', () => {
  const rect = { x: 300, y: 300, width: 300, height: 400 }, ellipse = bindingDomainEllipse(rect);
  const camera = { x: 0, y: 0, k: 1 }, view = { left: 0, top: 0, right: 1000, bottom: 1000 };
  assert.equal(containCamera(camera, bindingEllipseBounds(ellipse), view), camera);
  for (const k of [0.08, 0.5, 2.5]) {
    const zoom = d3.zoomIdentity.translate(120, -80).scale(k);
    for (const point of [[rect.x, rect.y], [rect.x + rect.width, rect.y + rect.height]]) {
      const screen = zoom.apply(point), center = zoom.apply([ellipse.cx, ellipse.cy]);
      assert(((screen[0] - center[0]) / (ellipse.rx * k)) ** 2
        + ((screen[1] - center[1]) / (ellipse.ry * k)) ** 2 < 1);
    }
  }
});

test('long labels and wide-script terminal text remain inside the reserved domain', () => {
  const root = d3.hierarchy({ id: 'domain', label: 'A very long authored category label with several features',
    children: [{ id: 'last', label: 'N', word: '語語語語語語語語語語語語' }] });
  root.x = 100; root.y = 0; root.children[0].x = 500; root.children[0].y = 1000;
  const measure = text => [...text].reduce((width, c) => width + (/語/u.test(c) ? 42 : 24), 0);
  const rect = bindingDomainTreeRect(root.descendants(), measure);
  assert(rect.y < -52, 'all wrapped category lines are reserved');
  assert(rect.x + rect.width >= 500 + 12 * 56 / 2, 'terminal measurement follows its rendered font size');
  assert(rect.y + rect.height >= 1115, 'terminal baseline is inside the domain');
});

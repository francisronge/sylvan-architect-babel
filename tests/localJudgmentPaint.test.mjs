import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createPlaqueDrawing } from '../components/renderer/plaqueDrawing.ts';
import { decorateRelationElement as decorate } from '../components/renderer/relationOwnership.ts';
import { rescaleOverlayMarkers as refineZoom } from '../components/renderer/treeNotation.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { createSvgDom, descendants, select } from './helpers/svgDom.mjs';

const { Element, restore } = createSvgDom();
after(restore);
const hasClass = (node, name) => node.classList.contains(name);
const { drawTextBadge } = createPlaqueDrawing({});
const setup = () => {
  const workspaceForest = [{ id: 'root', label: 'XP', children: [
    { id: 'a', label: 'N', word: 'alpha' }, { id: 'a-other', label: 'N', word: 'beta' }
  ] }];
  const relations = ['blocked', 'licensed'].map((outcome, index) => ({ relation: 'Independent local condition',
    anchors: { 'judged.anchor': index ? 'a-other' : 'a' }, values: { outcome } }));
  const plan = compileRelationRenderPlan([{ statement: 'State', stageRecord: '', relations, workspaceForest }]);
  const positions = { a: { x: 100, y: 200 }, 'a-other': { x: 800, y: 400 } };
  const bound = bindRelationPlanFrame(plan, 0, id => positions[id]);
  assert.deepEqual(bound.failed, []);
  const root = new Element('g');
  const marks = bound.primitives.filter(primitive => primitive.type === 'text-badge' && primitive.badgeStyle === 'local-judgment');
  assert.equal(marks.length, 2);
  const hosts = marks.map(primitive => {
    const host = new Element('g'); root.appendChild(host);
    decorate(host, plan.frames[0].items[primitive.itemIndex], 'active');
    drawTextBadge(primitive, plan.frames[0].items[primitive.itemIndex], select(host), 'active');
    return host;
  });
  return { root, marks, hosts };
};

test('local judgments execute native cross and check paint at their exact owned badge anchors', () => {
  const { marks, hosts } = setup();
  for (const [index, host] of hosts.entries()) {
    const primitive = marks[index];
    const marker = host.children[0];
    assert.equal(marker.attrs['data-judgment-anchor'], primitive.nodeId);
    assert.equal(marker.attrs['data-judgment-outcome'], primitive.outcome);
    assert.equal(marker.attrs.transform, `translate(${primitive.x},${primitive.y})`);
    assert.equal(host.attrs['data-vr-owner-refs'], `0:${index}`);
    assert.equal(host.attrs['data-vr-emphasis'], 'active');
    assert.equal(descendants(host).some(node => node.tag === 'text'), false, 'native marks have no font glyph');
    assert.equal(descendants(host).some(node => hasClass(node, 'vr-overlay-marker')), false, 'native mark stays in tree coordinates');
  }
  const cross = hosts[0].children[0].children;
  assert.equal(cross.length, 4);
  assert.deepEqual(cross.filter(node => hasClass(node, 'babel-domain-locality-x')).map(node => node.attrs), [
    { class: 'babel-domain-locality-x', x1: '-17', y1: '-17', x2: '17', y2: '17' },
    { class: 'babel-domain-locality-x', x1: '17', y1: '-17', x2: '-17', y2: '17' }
  ]);
  assert.equal(cross.filter(node => hasClass(node, 'babel-domain-locality-x-shadow')).length, 2);
  assert.deepEqual(hosts[1].children[0].children.map(node => node.attrs), [
    { class: 'babel-domain-locality-check-shadow', d: 'M -13.0 0.0 L -3.6 9.4 L 13.0 -13.0' },
    { class: 'babel-domain-locality-check', d: 'M -13.0 0.0 L -3.6 9.4 L 13.0 -13.0' }
  ]);
});

test('native judgment marks keep their local geometry and owner spacing through production zoom refinement', () => {
  const { root, marks, hosts } = setup();
  const snapshot = () => hosts.map(host => descendants(host).map(node => ({ tag: node.tag, attrs: { ...node.attrs } })));
  const before = snapshot();
  for (const k of [0.25, 0.5, 1, 3]) {
    root.setAttribute('transform', `translate(91,37) scale(${k})`);
    refineZoom(select(root), k);
    assert.deepEqual(snapshot(), before);
    assert.equal(hosts[0].attrs['data-vr-owner-refs'], '0:0');
    assert.equal(hosts[1].attrs['data-vr-owner-refs'], '0:1');
    const screenAnchor = { x: 91 + marks[0].x * k, y: 37 + marks[0].y * k };
    const screenEndpoint = { x: 91 + (marks[0].x - 17) * k, y: 37 + (marks[0].y - 17) * k };
    assert.equal((screenEndpoint.x - screenAnchor.x) / k, -17);
    assert.equal((screenEndpoint.y - screenAnchor.y) / k, -17);
  }
});

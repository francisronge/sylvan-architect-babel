import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { blockingCrossSegments, checkMarkPath } from '../replay/relations/markGeometry.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { compileRelationRenderPlan, planItemRelationRefs } from '../replay/relations/renderPlanCompiler.ts';

const source = readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('TreeVisualizer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const find = predicate => {
  let found;
  const visit = node => { if (!found && predicate(node)) found = node; ts.forEachChild(node, visit); };
  visit(parsed);
  assert.ok(found, 'the tested production branch must exist');
  return found;
};
const branch = find(node => ts.isIfStatement(node)
  && node.expression.getText(parsed) === "primitive.badgeStyle === 'local-judgment'");
const paint = new Function('host', 'primitive', 'blockingCrossSegments', 'checkMarkPath',
  ts.transpile(branch.getText(parsed), { target: ts.ScriptTarget.ES2023 }));
const decorateDeclaration = find(node => ts.isVariableDeclaration(node)
  && node.name.getText(parsed) === 'decorateRelationElement');
const decorate = new Function('planItemRelationRefs', ts.transpile(
  `return ${decorateDeclaration.initializer.getText(parsed)};`, { target: ts.ScriptTarget.ES2023 }))(planItemRelationRefs);
const zoomStatement = find(node => ts.isExpressionStatement(node)
  && node.getText(parsed).startsWith("g.selectAll<SVGGElement, unknown>('.vr-overlay-marker').attr('transform', function"));
const refineZoom = new Function('g', 'event', ts.transpile(zoomStatement.getText(parsed), { target: ts.ScriptTarget.ES2023 }));
class Element {
  constructor(tag, parent) { this.tag = tag; this.parent = parent; this.attrs = {}; this.children = []; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  get classList() {
    const toggle = (name, on) => {
      const classes = new Set((this.attrs.class || '').split(' ').filter(Boolean));
      if (on) classes.add(name); else classes.delete(name);
      this.attrs.class = [...classes].join(' ');
    };
    return { add: name => toggle(name, true), toggle };
  }
  get dataset() { return { vrX: this.attrs['data-vr-x'], vrY: this.attrs['data-vr-y'] }; }
}
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const hasClass = (node, name) => (node.attrs.class || '').split(' ').includes(name);
class Selection {
  constructor(nodes) { this.nodes = nodes; }
  append(tag) {
    return new Selection(this.nodes.map(parent => { const child = new Element(tag, parent); parent.children.push(child); return child; }));
  }
  attr(name, value) {
    this.nodes.forEach(node => { const result = typeof value === 'function' ? value.call(node) : value;
      if (result !== undefined && result !== null) node.setAttribute(name, result); });
    return this;
  }
  selectAll(selector) { return new Selection(this.nodes.flatMap(descendants).filter(node => hasClass(node, selector.slice(1)))); }
}
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
    const host = new Element('g', root); root.children.push(host);
    decorate(host, plan.frames[0].items[primitive.itemIndex], 'active');
    paint(new Selection([host]), primitive, blockingCrossSegments, checkMarkPath);
    return host;
  });
  return { root, marks, hosts };
};

test('shared blocking-cross helper preserves both native callers coordinate for coordinate', () => {
  for (const point of [{ x: 0, y: 0 }, { x: 123.45, y: 987.65 }, { x: -91, y: 27 }]) {
    const old = [[-17, -17, 17, 17], [17, -17, -17, 17]].map(([x1, y1, x2, y2]) => ({
      x1: point.x + x1, y1: point.y + y1, x2: point.x + x2, y2: point.y + y2
    }));
    assert.deepEqual(blockingCrossSegments(point), old);
  }
});

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
    refineZoom(new Selection([root]), { transform: { k } });
    assert.deepEqual(snapshot(), before);
    assert.equal(hosts[0].attrs['data-vr-owner-refs'], '0:0');
    assert.equal(hosts[1].attrs['data-vr-owner-refs'], '0:1');
    const screenAnchor = { x: 91 + marks[0].x * k, y: 37 + marks[0].y * k };
    const screenEndpoint = { x: 91 + (marks[0].x - 17) * k, y: 37 + (marks[0].y - 17) * k };
    assert.equal((screenEndpoint.x - screenAnchor.x) / k, -17);
    assert.equal((screenEndpoint.y - screenAnchor.y) / k, -17);
  }
});

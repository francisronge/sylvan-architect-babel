import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const parse = path => ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = parse('../App.tsx');
const visualizer = parse('../components/TreeVisualizer.tsx');
const find = (root, predicate) => {
  if (predicate(root)) return root;
  return ts.forEachChild(root, node => find(node, predicate));
};
const initializer = name => find(app, node => ts.isVariableDeclaration(node)
  && node.name.getText(app) === name)?.initializer.getText(app);
const treeSvg = find(visualizer, node => ts.isJsxSelfClosingElement(node)
  && node.tagName.getText(visualizer) === 'svg'
  && node.attributes.properties.some(prop => prop.name?.getText(visualizer) === 'ref'
    && prop.initializer?.getText(visualizer) === '{svgRef}'));
assert.ok(treeSvg, 'the rendered tree SVG must exist');
const treeAttributes = Object.fromEntries(treeSvg.attributes.properties
  .filter(prop => prop.initializer && ts.isStringLiteral(prop.initializer))
  .map(prop => [prop.name.getText(visualizer), prop.initializer.text]));

// The production capture runs against ordered SVG candidates. Browser checks
// cover actual DOM selection, geometry, rasterization and IndexedDB persistence.
const element = (tag, attrs, textContent, parent = null, computed = {}) => ({
  tag, attrs: { ...attrs }, textContent, parent,
  computed,
  styles: {},
  children: [],
  get style() { return { setProperty: (key, value) => { this.styles[key] = value; } }; },
  get firstChild() { return null; },
  cloneNode() {
    const clone = element(this.tag, this.attrs, this.textContent);
    clone.children = this.children.map(child => child.cloneNode());
    return clone;
  },
  setAttribute(name, value) { this.attrs[name] = value; },
  insertBefore() {},
  querySelector() { return null; },
  querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
});
const matches = (node, selector) => {
  const tag = selector.match(/^[a-z]+/u)?.[0];
  const className = selector.match(/\.([\w-]+)/u)?.[1];
  const attribute = selector.match(/\[([\w-]+)(?:="([^"]*)")?\]/u);
  return (!tag || node.tag === tag)
    && (!className || (node.attrs.class || '').split(' ').includes(className))
    && (!attribute || (attribute[2] === undefined
      ? attribute[1] in node.attrs : node.attrs[attribute[1]] === attribute[2]));
};
const select = (nodes, selector) => {
  const parts = selector.trim().split(/\s+/u);
  return nodes.find(node => {
    if (!matches(node, parts.at(-1))) return false;
    let ancestor = node.parent;
    for (const part of parts.slice(0, -1).reverse()) {
      while (ancestor && !matches(ancestor, part)) ancestor = ancestor.parent;
      if (!ancestor) return false;
      ancestor = ancestor.parent;
    }
    return true;
  }) ?? null;
};
const capture = (nodes, serialized = []) => {
  const document = {
    querySelector: selector => select(nodes, selector),
    createElementNS: (_namespace, tag) => element(tag, {}, '')
  };
  const XMLSerializer = class { serializeToString(node) { serialized.push(node); return node.textContent; } };
  const getComputedStyle = node => ({ getPropertyValue: property => node.computed[property] || '' });
  const code = ts.transpile(`const encodeUtf8ToBase64 = ${initializer('encodeUtf8ToBase64')};
    return (${initializer('captureVisibleTreeSnapshot')})();`, { target: ts.ScriptTarget.ES2023 });
  return new Function('document', 'XMLSerializer', 'getComputedStyle', code)(document, XMLSerializer, getComputedStyle);
};

test('Tree Bank preview captures syntax when Replay toolbar icons precede it', () => {
  const canvas = element('div', { class: 'tree-canvas-bg' }, '');
  const button = element('button', {}, '', canvas);
  const icon = element('svg', { class: 'lucide lucide-scan' }, 'Fit icon', button);
  const tree = element('svg', treeAttributes, 'CP → Which book did John buy? ∅', canvas);
  const before = { ...tree.attrs };
  const snapshot = capture([icon, tree]);
  assert.equal(Buffer.from(snapshot.split(',')[1], 'base64').toString('utf8'), tree.textContent);
  assert.deepEqual(tree.attrs, before, 'capturing must not mutate the live tree');
});

test('Tree Bank preview does not substitute an icon when no tree is mounted', () => {
  const canvas = element('div', { class: 'tree-canvas-bg' }, '');
  const icon = element('svg', { class: 'lucide lucide-scan' }, 'Fit icon', canvas);
  assert.equal(capture([icon]), undefined);
});

test('Tree Bank preview keeps stylesheet-only paint and hidden syntax without changing geometry', () => {
  const tree = element('svg', treeAttributes, 'tree');
  const path = element('path', { d: 'M 0 0 L 20 20' }, '', tree,
    { fill: 'none', stroke: 'rgb(52, 211, 153)', 'stroke-width': '2px' });
  const hidden = element('text', { transform: 'translate(20,30)' }, 'later', tree,
    { opacity: '0', fill: 'rgb(236, 253, 245)', 'font-size': '14px' });
  tree.children = [path, hidden];
  const serialized = [];
  capture([tree], serialized);
  const [savedPath, savedHidden] = serialized[0].children;
  assert.equal(savedPath.styles.fill, 'none', 'open paths must not become filled polygons');
  assert.equal(savedPath.styles.stroke, path.computed.stroke);
  assert.equal(savedPath.styles['stroke-width'], '2px');
  assert.equal(savedHidden.styles.opacity, '0', 'unrevealed syntax must stay hidden');
  assert.equal(savedHidden.styles.fill, hidden.computed.fill);
  assert.equal(savedHidden.styles['font-size'], '14px');
  assert.deepEqual(savedHidden.attrs, hidden.attrs);
  assert.equal('transform' in savedHidden.styles, false, 'paint must not override the geometry transform');
  assert.deepEqual(path.styles, {}, 'the live tree must remain untouched');
});

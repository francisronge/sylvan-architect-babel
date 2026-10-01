import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { identityLightSites, identityLightTargets, mergeIdentityOwners } from '../components/identityForestLight.ts';

test('shared terminal ownership keeps both relation moments after repeated decoration', () => {
  const first = { stageIndex: 0, relationIndex: 1, relation: 'First chain' };
  const second = { stageIndex: 1, relationIndex: 0, relation: 'Later chain' };
  assert.deepEqual(mergeIdentityOwners([first], [second, first]), [first, second]);
});

test('overlapping identity claims light each exact terminal once at its strongest emphasis', () => {
  assert.deepEqual(identityLightTargets([
    { occurrencePools: [['word', 'word'], ['copy']], emphasis: 'quiet' },
    { occurrencePools: [['word'], ['other']], emphasis: 'active' },
    { occurrencePools: [['copy']], emphasis: 'quiet' }
  ]), [
    { nodeId: 'word', index: 0, intensity: 1 },
    { nodeId: 'copy', index: 1, intensity: 0.3 },
    { nodeId: 'other', index: 1, intensity: 1 }
  ]);
});

test('identity light follows actual terminal text and wordless witnesses through camera transforms', () => {
  let zoom = 1;
  const label = (id, kind, x, y, width = 40) => ({
    kind,
    getAttribute: name => name === (kind === 'terminal' ? 'data-node-id' : 'data-category-node-id') ? id : null,
    getBoundingClientRect: () => ({ left: 20 + x * zoom, top: 30 + y * zoom, width: width * zoom, height: 20 * zoom })
  });
  const labels = [label('the', 'terminal', 0, 100), label('parcel', 'terminal', 100, 200),
    label('trace', 'category', 300, 80), label('the', 'category', 0, 0), label('hidden', 'terminal', 0, 0, 0)];
  const svg = { querySelectorAll: selector => labels.filter(l => selector.startsWith(`.${l.kind === 'terminal' ? 'terminal' : 'category'}-label`)) };
  const pools = [['the', 'parcel', 'the'], ['trace'], ['unavailable', 'hidden']];
  assert.deepEqual(identityLightSites(svg, { left: 20, top: 30 }, pools), [
    [{ x: 20, y: 110 }, { x: 120, y: 210 }], [{ x: 320, y: 90 }], []
  ]);
  zoom = 2;
  assert.deepEqual(identityLightSites(svg, { left: 20, top: 30 }, pools), [
    [{ x: 40, y: 220 }, { x: 240, y: 420 }], [{ x: 640, y: 180 }], []
  ]);
});

test('production lighting stays idle and coalesces camera and resize invalidations', () => {
  const source = readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('TreeVisualizer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'startIdentityForestLight') initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert(initializer);
  const pending = new Map();
  let nextId = 0, paints = 0, resize;
  const context = new Proxy({}, { get: (_, key) => key === 'clearRect' ? () => paints++
    : key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  const canvas = { style: {}, isConnected: true, getContext: () => context };
  const mount = { appendChild() {}, getBoundingClientRect: () => ({ width: 1200, height: 800, left: 0, top: 0 }) };
  const svg = { querySelector: () => ({ getScreenCTM: () => ({ a: 1, b: 0 }) }) };
  const window = { devicePixelRatio: 1,
    requestAnimationFrame: fn => { pending.set(++nextId, fn); return nextId; } };
  const Observer = class { constructor(callback) { resize = callback; } observe() {} };
  const start = new Function('containerRef', 'svgRef', 'identityForestLightFamilies', 'identityLightTargets',
    'identityLightSites', 'document', 'window', 'ResizeObserver', ts.transpile(`
      let forestLightFrame = null, forestLightCanvas = null, forestLightResize = null, refreshIdentityForestLight = null;
      const start = ${initializer.getText(tree)};
      start();
      return () => refreshIdentityForestLight();
    `, { target: ts.ScriptTarget.ES2023 }));
  const refresh = start({ current: mount }, { current: svg }, [
    { occurrencePools: [['word']], emphasis: 'active' }
  ], identityLightTargets, () => [[{ x: 200, y: 300 }]], { createElement: () => canvas }, window, Observer);
  assert.equal(paints, 1);
  assert.equal(pending.size, 0, 'a static identity frame schedules no recurring work');
  refresh(); refresh(); resize();
  assert.equal(pending.size, 1, 'multiple invalidations share one paint');
  const [id, callback] = [...pending][0];
  pending.delete(id); callback();
  assert.equal(paints, 2);
  assert.equal(pending.size, 0, 'the repaint does not schedule another frame');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as d3 from 'd3';
import ts from 'typescript';
import { advanceFittedCamera, availableTreeViewport, containCamera } from '../components/treeViewport.ts';

const source = ts.createSourceFile('TreeVisualizer.tsx',
  fs.readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['stageFitContainmentBounds', 'applyFittedCamera', 'fitToRenderedBounds']);
const declarations = new Map();
const visit = node => {
  if (ts.isVariableDeclaration(node) && names.has(node.name.getText(source))) {
    declarations.set(node.name.getText(source), node.initializer.getText(source));
  }
  ts.forEachChild(node, visit);
};
visit(source);
assert.equal(declarations.size, names.size, 'execute the production containment and fit functions');

function camera(input) {
  let painted;
  const dependencies = {
    d3, advanceFittedCamera, containCamera,
    stageCameraBounds: input.bounds,
    stagePlaqueContainmentBounds: input.plaques ?? null,
    fitLeft: input.view.left, fitRight: input.view.right,
    fitTop: input.view.top, fitBottom: input.view.bottom,
    derivationFrameFitNodes: [{}], overlayFitBounds: null,
    minimumInitialScale: input.width < 500 ? 0.02 : 0.06,
    animated: true, autoCameraRef: input.auto, completedReplayStep: undefined,
    cameraAnimationRef: { current: null }, svg: { attr() {} },
    animateFittedCamera: transform => { painted = transform; },
    manualCameraRef: input.manual ?? { current: null },
    data: input.data, derivationStagesSignature: 'saved-stage-records',
    fitRevision: 0, containerWidth: input.width, containerHeight: input.height,
    activeStepIndex: input.step,
    g: { selectAll: () => ({ attr() {} }) },
    fitFallbackOverlays: undefined,
    applyCameraTransform: transform => { painted = transform; }
  };
  const body = [...declarations].map(([name, expression]) => `const ${name} = ${expression};`).join('\n');
  new Function(...Object.keys(dependencies), ts.transpile(`${body}\nfitToRenderedBounds();`,
    { target: ts.ScriptTarget.ES2023 }))(...Object.values(dependencies));
  return painted;
}

const enclosed = (transform, bounds, view) => {
  assert(transform.x + bounds.minX * transform.k >= view.left - 1e-7);
  assert(transform.x + bounds.maxX * transform.k <= view.right + 1e-7);
  assert(transform.y + bounds.minY * transform.k >= view.top - 1e-7);
  assert(transform.y + bounds.maxY * transform.k <= view.bottom + 1e-7);
};

for (const [width, height, panelTop] of [[1596, 996, 721], [390, 844, 585]]) {
  for (const withPlaques of [false, true]) {
    test(`${width}px: sequential Replay keeps both edge-label margins${withPlaques ? ' and plaques' : ''}`, () => {
      const view = availableTreeViewport(width, height, { headerBottom: 64, panelTop });
      // Saved French geometry; the left-edge control mirrors the same failure
      // observed in the saved parasitic-gap Replay.
      const bounds = { minX: 290, maxX: 6670, minY: 0, maxY: 2470 };
      const plaques = withPlaques ? { ...bounds, maxY: 2725 } : null;
      const envelope = { minX: 70, maxX: 6890, minY: -160, maxY: withPlaques ? 2725 : 2630 };
      const data = {};
      const input = { bounds, plaques, width, height, view, data, step: 0, auto: { current: null } };
      const direct = camera(input);
      enclosed(direct, envelope, view);
      for (const side of ['left', 'right']) {
        const previous = { ...direct, x: side === 'left'
          ? view.left - bounds.minX * direct.k
          : view.right - bounds.maxX * direct.k };
        const auto = { current: { ...input.auto.current, transform: previous } };
        const next = camera({ ...input, auto, step: 1 });
        enclosed(next, envelope, view);
        assert.equal(next.k, direct.k, 'recover the margin by panning, without shrinking');
        assert.notEqual(next.x, previous.x, 'a terminal centre at the edge is insufficient containment');
        for (let step = 2; step < 7; step++) {
          assert.deepEqual(camera({ ...input, auto, step }), next, 'one camera throughout the same authored stage');
        }
      }
    });
  }

  test(`${width}px: containment preserves a user-controlled camera`, () => {
    const data = {}, view = availableTreeViewport(width, height, { headerBottom: 64, panelTop });
    const bounds = { minX: 290, maxX: 6670, minY: 0, maxY: 2470 };
    const transform = d3.zoomIdentity.translate(-450, 98).scale(0.7);
    const manual = { current: { data, signature: 'saved-stage-records', width, height, transform } };
    const input = { bounds, plaques: { ...bounds, maxY: 2725 }, width, height, view,
      data, step: 0, auto: { current: null }, manual };
    assert.deepEqual(camera(input), transform);
    assert.deepEqual(camera({ ...input, step: 1 }), transform, 'Next does not replace manual pan or zoom');
  });
}

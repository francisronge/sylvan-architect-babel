import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { buildStageCameraBounds, measureStagePlaqueSpace } from '../replay/stageCamera.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildRenderableDerivationCanvasData } from '../replay/replayCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';

const forest = [{ id: 'ip', label: 'IP', children: [
  { id: 'v', label: 'V', word: 'قرأت' },
  { id: 'subject', label: 'NP', word: 'ماري' },
  { id: 'object', label: 'NP', word: 'الكتاب' }
] }];
const stages = [{ workspaceForest: forest, statement: 'A complete clause.', stageRecord: 'Authored order is verb, subject, object.',
  relations: [{ relation: 'An open assignment', anchors: { assigner: 'v', recipient: 'object' }, values: { case: 'accusative' } }]
}];

test('RTL reflects positions while preserving authored order, glyphs, IDs and every tree edge', () => {
  const before = structuredClone(forest);
  const ltr = layoutSyntaxTree(d3.hierarchy(forest[0]), [900, 400]);
  const rtl = layoutSyntaxTree(d3.hierarchy(forest[0]), [900, 400], 'rtl');
  assert.deepEqual(rtl.links().map(n => [n.source.data.id, n.target.data.id]), ltr.links().map(n => [n.source.data.id, n.target.data.id]));
  rtl.descendants().forEach((node, index) => {
    assert.equal(node.x, 900 - ltr.descendants()[index].x);
    assert.equal(node.y, ltr.descendants()[index].y);
    assert.deepEqual(node.data, ltr.descendants()[index].data);
  });
  assert.deepEqual(forest, before);
});

for (const [width, height] of [[1596, 1016], [390, 844]]) test(`RTL reservation, relation anchors and Fit share one coordinate system at ${width}px`, () => {
  const prepared = prepareReplay({ derivationStages: stages, sentence: 'قرأت ماري الكتاب', includePlayback: true });
  const input = { steps: prepared.playbackSteps, stageIndex: 0, completedCanvas: buildRenderableDerivationCanvasData(forest),
    plan: prepared.relationRenderPlan, width, height };
  const ltr = measureStagePlaqueSpace(input).nodes;
  const rtl = measureStagePlaqueSpace({ ...input, direction: 'rtl' }).nodes;
  const offsets = rtl.map((node, i) => node.x + ltr[i].x);
  offsets.forEach(offset => assert(Math.abs(offset - offsets[0]) < 1e-8));
  const byId = new Map(rtl.map(node => [node.data.id, node]));
  assert(byId.get('v').x > byId.get('subject').x && byId.get('subject').x > byId.get('object').x);
  const bound = bindRelationPlanFrame(prepared.relationRenderPlan, 0, id => byId.get(id) ?? null);
  assert(bound.primitives.length > 0);
  const bounds = buildStageCameraBounds({ ...input, direction: 'rtl' });
  assert(bounds && Object.values(bounds).every(Number.isFinite));
  rtl.forEach(node => assert(node.x >= bounds.minX && node.x <= bounds.maxX));
});

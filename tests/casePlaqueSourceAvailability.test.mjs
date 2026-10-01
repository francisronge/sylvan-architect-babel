import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { caseAssignmentClears, placeStagePlaques, prepareStagePlaqueRequests } from '../replay/relations/plaquePlacement.ts';
import { buildReplayPlaqueSchedule, buildStageLayoutGroups, measureStagePlaqueSpace, selectReplayPlaqueLayout } from '../replay/stageCamera.ts';

const forest = [{ id: 'root', label: 'TP', children: [
  { id: 'assigner', label: 'T' }, { id: 'recipient', label: 'DP', word: 'they' }
] }];
const all = d3.tree().nodeSize([600, 300])(d3.hierarchy(forest[0])).descendants();
const recipient = all.filter(node => node.data.id === 'recipient');
const source = all.filter(node => node.data.id === 'assigner');
const stage = relations => ({ statement: 'Case', stageRecord: 'Authored state.', workspaceForest: forest, relations });
const native = compileRelationRenderPlan([stage([{
  relation: 'CaseAssignment', anchors: { assigner: 'assigner', bearer: 'recipient' }, values: { feature: 'Case', value: 'NOM' }
}])]).frames[0].items;
const recovered = compileRelationRenderPlan([stage([{
  relation: 'A licensing claim', anchors: { licensor: 'assigner', recipient: 'recipient' }, values: { case: 'nominative' }
}])]).frames[0].items;

test('native and recovered Case wait for their exact assigning source to become available', () => {
  assert(recipient[0].parent.children.some(node => node.data.id === 'assigner'),
    'the source exists in the hidden canvas, but not in the visible scene');
  for (const items of [native, recovered]) {
    assert(items.some(item => item.pathStyle === 'case-assignment'));
    assert.equal(prepareStagePlaqueRequests(items, recipient).filter(request => request.caseAssignment).length, 0);
    assert.equal(placeStagePlaques(items, recipient).size, 0);
    const request = prepareStagePlaqueRequests(items, all).find(request => request.caseAssignment);
    assert(request);
    assert.equal(placeStagePlaques(items, all).get(request.index).attachmentNodeId, 'assigner');
  }
});

test('Case reservation can start at the exact source before its recipient appears', () => {
  const request = prepareStagePlaqueRequests(native, source).find(request => request.caseAssignment);
  assert(request);
  assert.equal(placeStagePlaques(native, source).get(request.index).attachmentNodeId, 'assigner');
});

test('a neutral one-anchor plaque needs no assigning source', () => {
  const plaque = { kind: 'node-plaque', plaqueStyle: 'feature', anchorNodeIds: ['recipient'],
    rows: [{ label: 'literal', value: 'unknown content' }], relationRef: { stageIndex: 0, relationIndex: 0 } };
  assert.equal(prepareStagePlaqueRequests([plaque], recipient).length, 1);
  assert.equal(placeStagePlaques([plaque], recipient).get(0).attachmentNodeId, 'recipient');
});

test('a feature collection keeps its own host reservation before its goal appears', () => {
  const items = compileRelationRenderPlan([stage([{
    relation: 'An open collection', anchors: { collector: 'assigner', goal: 'recipient' }, values: { number: 'plural' }
  }])]).frames[0].items;
  for (const nodes of [all, source]) {
    const requests = prepareStagePlaqueRequests(items, nodes);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].collectionRows.length, 1);
    assert.equal(placeStagePlaques(items, nodes).get(requests[0].index).attachmentNodeId, 'assigner');
  }
});

test('Icelandic transferred Case waits for tI, then reserves clear arrows through the final frame', () => {
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/case-source-transfer.json', import.meta.url)));
  const stages = record.derivationStages;
  const prepared = prepareReplay({ sentence: record.sentence, inputTokens: record.inputTokens,
    derivationStages: stages, includePlayback: true });
  const steps = prepared.playbackSteps, plan = prepared.relationRenderPlan;
  const input = { steps, stageIndex: 2, completedCanvas: steps.at(-1).replayCanvasData, plan,
    width: 1200, height: 900, layoutGroups: buildStageLayoutGroups(steps, stages) };
  const schedule = buildReplayPlaqueSchedule(input), space = measureStagePlaqueSpace(input);
  const indices = plan.frames[2].items.flatMap((item, index) =>
    item.pathStyle === 'case-assignment' && item.fromNodeId === 'tI' ? [index] : []);
  assert.equal(indices.length, 2);
  for (const frame of [26, 27, 28]) for (const index of indices) {
    assert(!selectReplayPlaqueLayout(schedule, 2, frame - 1).has(index), `frame ${frame} allocated unavailable tI`);
  }
  for (const frame of [29, 30, 31, 36]) {
    const scene = space.scenes.find(scene => scene.stepIndices.includes(frame - 1));
    const anchor = scene.nodes.find(node => node.data.id === 'tI');
    assert(anchor);
    for (const index of indices) {
      const box = selectReplayPlaqueLayout(schedule, 2, frame - 1).get(index);
      assert.equal(box?.attachmentNodeId, 'tI');
      assert(caseAssignmentClears(anchor, box, scene.obstacles), `frame ${frame}, item ${index}: Case curve crosses label ink`);
    }
  }
});

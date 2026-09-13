import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { buildStageLayoutGroups, stageTreeLayoutSize, buildStageCameraBounds, buildStagePlaqueLayout } from '../replay/stageCamera.ts';
import { buildRenderableDerivationCanvasData } from '../replay/replayCompiler.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
const astra = records.find(record => record.name === 'astra-xbar');
const steps = buildReplayPlayback({ sentence: astra.sentence, analyses: [astra] }).steps;
const layoutGroups = buildStageLayoutGroups(steps, astra.derivationStages);
const tree = (step, size) => d3.tree().size(size).separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(d3.hierarchy(step.replayCanvasData));

test('saved do-support keeps every existing node at its exact preceding coordinates', () => {
  assert.deepEqual(layoutGroups, [[0], [1], [2], [3], [4, 5]]);
  const original = JSON.stringify(steps);
  const before = steps[34], after = steps[35];
  for (const [width, height] of [[1596, 1016], [1100, 800], [386, 698]]) {
    const oldSize = stageTreeLayoutSize(steps, 4, width, height);
    assert.deepEqual(stageTreeLayoutSize(steps, 4, width, height, layoutGroups), oldSize, 'keep accepted preceding dimensions');
    assert.deepEqual(stageTreeLayoutSize(steps, 5, width, height, layoutGroups), oldSize);
    const next = new Map(tree(after, oldSize).descendants().map(node => [node.data.id, node]));
    for (const node of tree(before, oldSize).descendants()) {
      const match = next.get(node.data.id);
      assert(match, `${node.data.id} survives`);
      assert.deepEqual([match.x, match.y], [node.x, node.y], `${node.data.id} stays put`);
    }
    assert(next.has('raisedI::__leaf'), 'did still appears');
    assert(!tree(before, oldSize).descendants().some(node => node.data.id === 'raisedI::__leaf'), 'did never appears early');
  }
  assert.equal(JSON.stringify(steps), original);
  assert.deepEqual(buildStageLayoutGroups([...steps].reverse(), astra.derivationStages), layoutGroups);
});

test('do-support preserves the preceding fit with either overlay policy and in either traversal direction', () => {
  const plan = compileRelationRenderPlan(astra.derivationStages);
  for (const includeOverlays of [false, true]) {
    const input = { steps, stageIndex: 4, width: 1596, height: 1016, plan, includeOverlays,
      completedCanvas: steps[34].replayCanvasData };
    const original = buildStageCameraBounds(input);
    assert.deepEqual(buildStageCameraBounds({ ...input, layoutGroups }), original);
    assert.deepEqual(buildStageCameraBounds({ ...input, stageIndex: 5, layoutGroups }), original);
    assert.deepEqual(buildStageCameraBounds({ ...input, stageIndex: 5, layoutGroups, steps: [...steps].reverse() }), original);
  }
});

test('new large plaques reserve their full height before their relation moment', () => {
  const plan = compileRelationRenderPlan(astra.derivationStages);
  const pf = plan.frames[5].items.find(item => item.kind === 'node-plaque' && item.familyId === 'pf.realization');
  pf.rows = Array.from({ length: 60 }, (_, index) => ({ label: `Row ${index}`, value: 'A long authored explanation remains available in full.' }));
  const input = { steps, stageIndex: 4, layoutGroups, width: 1596, height: 1016, plan,
    completedCanvas: steps[34].replayCanvasData };
  const before = buildStageCameraBounds(input);
  const after = buildStageCameraBounds({ ...input, stageIndex: 5 });
  assert.deepEqual(after, before, 'future content must not trigger a refit at reveal');
  const placements = buildStagePlaqueLayout({ ...input, stageIndex: 5 });
  const placement = placements.get(plan.frames[5].items.indexOf(pf));
  assert(placement.height > 2000);
  assert(placement.y + placement.height <= before.maxY, 'the whole plaque contributes to the layout');
});

const forest = word => [{ id: 'root', label: 'XP', children: [
  { id: 'head', label: 'X', ...(word ? { word } : {}) },
  { id: 'phrase', label: 'YP', children: [{ id: 'bar', label: "Y'", children: [{ id: 'noun', label: 'N', word: 'word' }] }] }
] }];
const stage = workspaceForest => ({ statement: 'Open statement', stageRecord: 'Open prose',
  relations: [{ relation: 'Arbitrary relation wording', anchors: { arbitraryRole: 'head' } }], workspaceForest });
const mockSteps = stages => stages.map((stage, replayFrameIndex) => ({ replayFrameIndex, replayKind: 'macro',
  replayCanvasData: buildRenderableDerivationCanvasData(stage.workspaceForest) }));

test('the rule depends on exact structure and geometry, never relation names or ID suffixes', () => {
  const stages = [stage(forest('first')), stage(forest('second')), stage(forest('third'))];
  for (const s of stages) s.workspaceForest[0].children[0].id = 'authored::__leaf';
  const playback = mockSteps(stages);
  assert.deepEqual(buildStageLayoutGroups(playback, stages), [[0, 1, 2]]);
  const groups = buildStageLayoutGroups(playback, stages);
  assert.deepEqual(stageTreeLayoutSize(playback, 2, 1200, 900, groups), stageTreeLayoutSize(playback, 0, 1200, 900),
    'surface wording cannot resize unchanged syntax');
});

test('a compatible added word leaf cannot inflate the preceding layout budget', () => {
  const pair = [steps[34], steps[35]].map((step, replayFrameIndex) => ({ ...step, replayFrameIndex }));
  const groups = buildStageLayoutGroups(pair, astra.derivationStages.slice(4));
  assert.deepEqual(groups, [[0, 1]]);
  const original = stageTreeLayoutSize(pair, 0, 1596, 1016);
  assert.notDeepEqual(stageTreeLayoutSize(pair, 1, 1596, 1016), original, 'the old per-stage budget would grow');
  assert.deepEqual(stageTreeLayoutSize(pair, 1, 1596, 1016, groups), original);
});

for (const [name, change] of [
  ['new node identity', f => { f[0].children[0].id = 'new-head'; }],
  ['new category', f => { f[0].children[0].label = 'Z'; }],
  ['reordered siblings', f => { f[0].children.reverse(); }],
  ['new parent', f => { f[0].children[0] = { id: 'wrapper', label: 'W', children: [f[0].children[0]] }; }],
  ['new workspace', f => { f.push({ id: 'other', label: 'Other' }); }],
  ['duplicate identity', f => { f[0].children[0].id = 'root'; }],
  ['missing identity', f => { delete f[0].children[0].id; }]
]) test(`${name} starts a new layout group`, () => {
  const next = forest('appears'); change(next);
  const stages = [stage(forest()), stage(next)];
  assert.deepEqual(buildStageLayoutGroups(mockSteps(stages), stages), [[0], [1]]);
});

test('unchanged authored topology cannot bypass incompatible rendered positions or missing exact occurrences', () => {
  const stages = [stage(forest()), stage(forest('appears'))];
  const playback = mockSteps(stages);
  playback[1].replayCanvasData.children[1].children[0].children[0].children.push({ id: 'extra', label: 'extra' });
  assert.deepEqual(buildStageLayoutGroups(playback, stages), [[0], [1]]);
  const missing = mockSteps(stages);
  missing[1].replayCanvasData.children[0].id = 'replacement';
  missing[1].replayCanvasData.children[0].aliasIds = ['head'];
  assert.deepEqual(buildStageLayoutGroups(missing, stages), [[0], [1]], 'aliases cannot stand in for unchanged identity');
});

for (const record of records.filter(record => record !== astra)) test(`${record.name}: other saved layouts remain independent`, () => {
  const playback = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  assert.deepEqual(buildStageLayoutGroups(playback, record.derivationStages), record.derivationStages.map((_, index) => [index]));
});

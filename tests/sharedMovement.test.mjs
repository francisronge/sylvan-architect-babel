import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';

const record = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/shared-landing.json', import.meta.url)));
const nodes = forest => {
  const result = new Map();
  const visit = node => { result.set(node.id, node); node.children?.forEach(visit); };
  forest.forEach(visit); return result;
};

for (const renamed of [false, true]) test(`two exact sources reach one shared landing in one moment${renamed ? ' after renaming and independent list reordering' : ''}`, () => {
  const response = structuredClone(record);
  const id = value => renamed ? `opaque-${value}` : value;
  const stages = response.analyses[0].derivationStages;
  if (renamed) for (const stage of stages) {
    for (const node of nodes(stage.workspaceForest).values()) {
      node.id = id(node.id);
      if (node.lineageId) node.lineageId = id(node.lineageId);
    }
    for (const r of stage.relations) {
      r.relation = 'An unfamiliar authored claim';
      for (const block of [r.anchors, r.priorAnchors]) if (block) for (const key of Object.keys(block)) {
        block[key] = Array.isArray(block[key]) ? block[key].map(id) : id(block[key]);
      }
    }
    stage.realizations?.forEach(group => { group.nodeIds = group.nodeIds.map(id); });
  }
  if (renamed) stages[1].relations[0].priorAnchors.sourceOccurrences.reverse();
  const original = structuredClone(response);
  const dispatch = dispatchStageRelations(stages)[1][0];
  const movements = dispatch.facets.filter(f => f.recipe.id === 'movement.path');
  assert.equal(movements.length, 2);
  assert.deepEqual(new Set(movements.map(f => f.evidence.movement.sourceNodeId)), new Set([id('objectN'), id('objectE')]));
  assert(movements.every(f => f.evidence.movement.targetNodeId === id('objectHigh')));
  assert(!dispatch.facets.some(f => f.recipe.id === 'identity.occurrences'), 'source-list recognition must not add an extra identity rail to the movement');
  for (const field of ['anchors', 'priorAnchors']) {
    const entry = dispatch.evidenceCoverage.fields.find(f => f.field === field && f.key === 'sourceOccurrences');
    assert.deepEqual(entry.unrecoveredItemIndices, []);
    assert.deepEqual(new Set(entry.recognizedBy.flatMap(x => x.itemIndices)), new Set([0, 1]));
  }
  const plan = compileRelationRenderPlan(stages);
  const paths = plan.frames[1].items.filter(i => i.kind === 'trajectory' && i.relationRef.relationIndex === 0);
  assert.equal(paths.length, 2);
  assert(paths.every(p => p.relationRef.stageIndex === 1 && p.targetNodeId === id('objectHigh')));
  const playback = buildReplayPlayback(response);
  const moment = playback.steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
  assert(moment > 0);
  const before = playback.steps[moment - 1], after = playback.steps[moment];
  assert(!before.replayVisibleNodeIds.includes(id('objectHigh')));
  assert(!before.replayVisibleNodeIds.includes(id('raisedCoordination')));
  for (const source of ['objectN', 'objectE']) {
    assert(before.replayVisibleNodeIds.includes(id(source)));
    assert(after.replayVisibleNodeIds.includes(id(source)));
    assert.equal(nodes([before.replayCanvasData]).get(id(source)).silent, undefined);
    assert.equal(nodes([after.replayCanvasData]).get(id(source)).silent, true);
  }
  assert(after.replayVisibleNodeIds.includes(id('objectHigh')));
  assert(after.replayVisibleNodeIds.includes(id('raisedCoordination')));
  const links = after.replayRelationLinks.filter(l => l.authoredRelationKey === '1:0' && l.renderFamily === 'trajectory');
  assert.equal(links.length, 2);
  assert.deepEqual(new Set(links.map(l => l.sourceNodeId)), new Set([id('objectN'), id('objectE')]));
  assert(links.every(l => l.targetNodeId === id('objectHigh')));
  assert.deepEqual(response, original);
});

test('equivalent source and landing roles do not require the word shared', () => {
  for (const [source, prior, landing] of [['lowerCopies', 'priorSources', 'landing'], ['sources', 'sourceOccurrences', 'target']]) {
    const stages = structuredClone(record.analyses[0].derivationStages);
    const r = stages[1].relations[0];
    r.anchors = { [source]: ['objectE', 'objectN'], [landing]: 'objectHigh' };
    r.priorAnchors = { [prior]: ['objectN', 'objectE'] };
    r.relation = 'Unfamiliar';
    const d = dispatchStageRelations(stages)[1][0];
    assert.equal(d.facets.filter(f => f.recipe.id === 'movement.path').length, 2, JSON.stringify(r));
    const playback = buildReplayPlayback({ ...record, analyses: [{ derivationStages: stages }] });
    const moment = playback.steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
    assert(moment > 0);
    assert(!playback.steps[moment - 1].replayVisibleNodeIds.includes('objectHigh'));
    assert(playback.steps[moment].replayVisibleNodeIds.includes('objectHigh'));
  }
});

test('shared movement rejects missing, conflicting, repeated, or ambiguous source associations', () => {
  for (const mutate of [
    stages => { delete stages[1].relations[0].priorAnchors; },
    stages => { stages[1].relations[0].anchors.sourceOccurrences = ['objectN', 'objectN']; },
    stages => { stages[1].relations[0].priorAnchors.sourceOccurrences = ['objectN', 'objectN']; },
    stages => { stages[1].relations[0].anchors.sharedLandingOccurrence = ['objectHigh', 'objectN']; },
    stages => { nodes(stages[1].workspaceForest).get('objectE').lineageId = 'different'; },
    stages => { delete nodes(stages[1].workspaceForest).get('objectHigh').lineageId; },
    stages => { stages[1].workspaceForest.push({ id: 'objectN', label: 'D', lineageId: 'sharedObject' }); },
    stages => { stages[1].relations[0].relation = 'HeadMove'; },
    stages => { stages[1].relations[0].anchors.traceWitness = 'noraHigh'; }
  ]) {
    const stages = structuredClone(record.analyses[0].derivationStages);
    mutate(stages);
    const d = dispatchStageRelations(stages)[1][0];
    assert(!d.facets.some(f => f.recipe.id === 'movement.path'), JSON.stringify(stages[1].relations[0]));
  }
});

test('a later converging source keeps its preceding state until its own relation moment', () => {
  for (const sourceRole of ['sourceOccurrences', 'source', 'lowerCopy', 'origin']) {
  const response = structuredClone(record), stages = response.analyses[0].derivationStages;
  const shared = stages[1].relations[0];
  shared.anchors[sourceRole] = shared.anchors.sourceOccurrences;
  if (sourceRole !== 'sourceOccurrences') delete shared.anchors.sourceOccurrences;
  stages[1].relations = [{ relation: 'First source moves', anchors: { sourceOccurrence: 'objectN', landingOccurrence: 'objectHigh' },
    priorAnchors: { sourceOccurrence: 'objectN' } }, stages[1].relations[0]];
  const playback = buildReplayPlayback(response);
  const moments = playback.steps.filter(s => s.replayRelationIdentity?.stageIndex === 1);
  const first = nodes([moments[0].replayCanvasData]), second = nodes([moments[1].replayCanvasData]);
  assert.equal(first.get('objectN').silent, true);
  assert.equal(first.get('objectE').silent, undefined);
  assert.equal(second.get('objectN').silent, true);
  assert.equal(second.get('objectE').silent, true);
  assert(moments.every(moment => moment.replayVisibleNodeIds.includes('objectHigh')));
  assert.equal(moments[0].replayRelationLinks.filter(l => l.renderFamily === 'trajectory').length, 1);
  assert.equal(moments[1].replayRelationLinks.filter(l => l.renderFamily === 'trajectory').length, 2);
  }
});

test('shared movement validates and preserves host context and route instead of replacing them', () => {
  for (const [role, node, owned] of [['landingSite', 'raisedCoordination', true], ['hostHead', 'noraHigh', false]]) {
    const response = structuredClone(record), stages = response.analyses[0].derivationStages;
    const r = stages[1].relations[0];
    r.anchors[role] = node;
    r.values.route = 'orthogonal';
    const d = dispatchStageRelations(stages)[1][0];
    const movements = d.facets.filter(f => f.recipe.id === 'movement.path');
    assert.equal(movements.length, 2);
    assert(movements.every(f => f.evaluation.outputs.includes('Orthogonal movement')));
    assert.equal(d.evidenceCoverage.fields.find(f => f.key === role).unrecoveredItemIndices.length === 0, owned);
    const playback = buildReplayPlayback(response);
    const moment = playback.steps.find(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
    if (!owned) assert.match(moment.movementDiagnostics.join('\n'), /anchors.hostHead.*not-in-a-supported-head-complex/);
  }
});

test('one source may retain its ID at the shared landing while both prior positions are restored', () => {
  const response = structuredClone(record), stages = response.analyses[0].derivationStages;
  const rename = id => id === 'objectN' ? 'freshLowerN' : id === 'objectHigh' ? 'objectN' : id;
  for (const node of nodes(stages[1].workspaceForest).values()) node.id = rename(node.id);
  const r = stages[1].relations[0];
  for (const key of Object.keys(r.anchors)) r.anchors[key] = Array.isArray(r.anchors[key]) ? r.anchors[key].map(rename) : rename(r.anchors[key]);
  stages[1].relations = [r];
  const movements = dispatchStageRelations(stages)[1][0].facets.filter(f => f.recipe.id === 'movement.path');
  assert.equal(movements.length, 2);
  assert(movements.every(f => f.evidence.movement.transition && f.evidence.movement.targetNodeId === 'objectN'));
  const playback = buildReplayPlayback(response);
  const at = playback.steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
  const before = nodes([playback.steps[at - 1].replayCanvasData]);
  const after = nodes([playback.steps[at].replayCanvasData]);
  assert.equal(before.get('predicateN').children[1].id, 'objectN');
  assert.equal(before.get('objectN').silent, undefined);
  assert.equal(before.get('objectE').silent, undefined);
  assert(!playback.steps[at - 1].replayVisibleNodeIds.includes('freshLowerN'));
  assert.equal(after.get('predicateN').children[1].id, 'freshLowerN');
  assert.equal(after.get('freshLowerN').silent, true);
  assert.equal(after.get('objectE').silent, true);
  assert.equal(after.get('raisedCoordination').children[1].id, 'objectN');
  assert.equal(playback.steps[at].replayRelationLinks.filter(l => l.renderFamily === 'trajectory').length, 2);
});

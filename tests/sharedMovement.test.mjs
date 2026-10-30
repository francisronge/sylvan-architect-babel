import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { canonicalId } from './helpers/canonicalIds.mjs';

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
    stages => {
      delete stages[1].relations[0].priorAnchors;
      nodes(stages[1].workspaceForest).get('objectN').id = 'objectNLow';
      stages[1].relations[0].anchors.sourceOccurrences = ['objectNLow', 'objectE'];
    },
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

test('shared sources that keep their IDs match their preceding occurrences without prior anchors', () => {
  const stages = structuredClone(record.analyses[0].derivationStages);
  delete stages[1].relations[0].priorAnchors;
  const paths = dispatchStageRelations(stages)[1][0].facets.filter(f => f.recipe.id === 'movement.path');
  assert.deepEqual(paths.map(f => f.evidence.movement.sourceNodeId).sort(), ['objectE', 'objectN']);
  assert(paths.every(f => f.evidence.movement.targetNodeId === 'objectHigh'));
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
  // Replay reads the hop source-kept: the authored landing's objectN names the lower copy there.
  const renamed = prepareReplay({ derivationStages: stages, sentence: response.sentence, includePlayback: false });
  const landing = canonicalId(renamed, 'objectN', 1), lower = canonicalId(renamed, 'freshLowerN', 1);
  const fresh = landing === 'objectN' ? lower : landing;
  const at = playback.steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
  const before = nodes([playback.steps[at - 1].replayCanvasData]);
  const after = nodes([playback.steps[at].replayCanvasData]);
  assert.equal(before.get('predicateN').children[1].id, 'objectN');
  assert.equal(before.get('objectN').silent, undefined);
  assert.equal(before.get('objectE').silent, undefined);
  assert(!playback.steps[at - 1].replayVisibleNodeIds.includes(fresh));
  assert.equal(after.get('predicateN').children[1].id, lower);
  assert.equal(after.get(lower).silent, true);
  assert.equal(after.get('objectE').silent, true);
  assert.equal(after.get('raisedCoordination').children[1].id, landing);
  assert.equal(playback.steps[at].replayRelationLinks.filter(l => l.renderFamily === 'trajectory').length, 2);
});

const independentMovements = kinds => {
  const prior = kinds.map((kind, i) => ({ id: `domain-${i}`, label: 'TP', children: [
    { id: `tense-${i}`, label: 'T⁰', silent: true },
    { id: `predicate-${i}`, label: 'VP', children: [
      { id: `low-${i}`, label: kind === 'head' ? 'V⁰' : 'DP', lineageId: `chain-${i}`,
        ...(kind === 'head' ? { word: `word-${i}` } : { children: [{ id: `noun-${i}`, label: 'N', word: `word-${i}` }] }) },
      { id: `other-${i}`, label: kind === 'head' ? 'DP' : 'V⁰', word: `other-${i}` }
    ] }
  ] }));
  const current = structuredClone(prior).map((domain, i) => {
    const lower = domain.children[1].children[0];
    lower.silent = true;
    const upper = { ...structuredClone(prior[i].children[1].children[0]), id: `high-${i}` };
    if (upper.children) upper.children[0].id = `high-noun-${i}`;
    if (kinds[i] === 'head') {
      domain.children[0] = { id: `attachment-${i}`, label: 'T⁰', children: [upper, domain.children[0]] };
      return domain;
    }
    return { id: `attachment-${i}`, label: 'TP', children: [upper, domain] };
  });
  return { sentence: 'Independent dependencies', analyses: [{ derivationStages: [
    { statement: 'Establish the sources', stageRecord: 'Each source is present in its own clause.', relations: [], workspaceForest: prior },
    { statement: 'Move together', stageRecord: 'Each dependency is established at one simultaneous moment.', workspaceForest: current,
      relations: [{ relation: 'An unfamiliar dependency', anchors: { lowerOccurrences: kinds.map((_, i) => `low-${i}`),
        higherOccurrences: kinds.map((_, i) => `high-${i}`).reverse() },
        priorAnchors: { sources: kinds.map((_, i) => `low-${i}`).reverse() } }] }
  ] }] };
};

for (const kinds of [['phrasal', 'phrasal', 'phrasal'], ['head', 'head'], ['head', 'phrasal']])
test(`independent ${kinds.join('/')} movements share one atomic moment with independently reordered endpoints`, () => {
  const response = independentMovements(kinds), original = structuredClone(response);
  const stages = response.analyses[0].derivationStages;
  const dispatch = dispatchStageRelations(stages)[1][0];
  const paths = dispatch.facets.filter(f => f.recipe.id === 'movement.path');
  assert.equal(paths.length, kinds.length);
  for (let i = 0; i < kinds.length; i++) {
    const movement = paths.find(f => f.evidence.movement.sourceNodeId === `low-${i}`).evidence.movement;
    assert.equal(movement.targetNodeId, `high-${i}`);
    assert.equal(movement.trajectoryKind, kinds[i]);
  }
  for (const key of ['lowerOccurrences', 'higherOccurrences'])
    assert.deepEqual(dispatch.evidenceCoverage.fields.find(f => f.field === 'anchors' && f.key === key).unrecoveredItemIndices, []);
  const playback = buildReplayPlayback(response);
  const moments = playback.steps.filter(s => s.replayRelationIdentity?.stageIndex === 1);
  assert.equal(moments.length, 1);
  const at = playback.steps.indexOf(moments[0]), before = playback.steps[at - 1], after = moments[0];
  for (let i = 0; i < kinds.length; i++) {
    assert(!before.replayVisibleNodeIds.includes(`high-${i}`));
    assert(!before.replayVisibleNodeIds.includes(`attachment-${i}`));
    assert.equal(nodes([before.replayCanvasData]).get(`low-${i}`).silent, undefined);
    assert(after.replayVisibleNodeIds.includes(`high-${i}`));
    assert(after.replayVisibleNodeIds.includes(`attachment-${i}`));
    assert.equal(nodes([after.replayCanvasData]).get(`low-${i}`).silent, true);
  }
  assert.equal(after.replayRelationLinks.filter(l => l.renderFamily === 'trajectory').length, kinds.length);
  assert.deepEqual(response, original);
});

test('independent movement lists reject partial proof, ambiguous lineages, duplicates and unrelated context', () => {
  for (const mutate of [
    stages => { stages[1].relations[0].priorAnchors.sources.pop(); },
    stages => { stages[1].relations[0].anchors.higherOccurrences[1] = 'high-1'; },
    stages => { delete nodes(stages[1].workspaceForest).get('high-1').lineageId; },
    stages => { nodes(stages[1].workspaceForest).get('high-1').lineageId = 'chain-0'; },
    stages => { stages[1].workspaceForest.push(structuredClone(nodes(stages[1].workspaceForest).get('high-1'))); },
    stages => { stages[1].relations[0].anchors.traceWitness = 'other-0'; },
    stages => { stages[1].relations[0].relation = 'HeadMove'; }
  ]) {
    const response = independentMovements(['phrasal', 'phrasal']), stages = response.analyses[0].derivationStages;
    mutate(stages);
    assert(!dispatchStageRelations(stages)[1][0].facets.some(f => f.recipe.id === 'movement.path'), mutate.toString());
  }
});

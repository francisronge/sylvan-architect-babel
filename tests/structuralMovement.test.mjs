import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import {
  readDerivationStructuralMovement,
  readStageDisplacements,
  readStageStructuralOwnership,
  readStructuralMovementForStages
} from '../replay/relations/structuralMovement.ts';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { frameStructure } from './helpers/replayInvariants.mjs';

const SWITCH = 'BABEL_STRUCTURAL_MOVEMENT';
const withSwitch = (value, run) => {
  const before = process.env[SWITCH];
  if (value === undefined) delete process.env[SWITCH]; else process.env[SWITCH] = value;
  try { return run(); } finally { if (before === undefined) delete process.env[SWITCH]; else process.env[SWITCH] = before; }
};

const cat = (id = 'dp', extra = {}) => ({ id, label: 'DP', lineageId: 'cat', ...extra, children: [
  { id: `${id}-d`, label: 'D', word: 'the' }, { id: `${id}-n`, label: 'N', word: 'cat' }] });
const before = () => [{ id: 'tp', label: 'TP', children: [
  { id: 't', label: 'T', silent: true },
  { id: 'vp', label: 'VP', children: [cat(), { id: 'v', label: 'V', word: 'slept' }] }] }];
// The landing keeps its id; a new occurrence of its lineage holds its old slot.
const keptLanding = () => [{ id: 'tp2', label: 'TP', children: [cat(), { id: 'tbar', label: 'T′', children: [
  { id: 't', label: 'T', silent: true },
  { id: 'vp', label: 'VP', children: [{ id: 'trace', label: 'DP', lineageId: 'cat', silent: true }, { id: 'v', label: 'V', word: 'slept' }] }] }] }];
// Open wording no recognizer knows: Chinese role names and relation title.
const openClaim = { relation: '论元移位', anchors: { 着陆点: 'dp', 起点: 'trace' } };
const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Record', relations, workspaceForest });

test('a kept-id landing and the new occurrence in its old slot are one displacement', () => {
  const { displacements, refusals } = readStageDisplacements(before(), keptLanding());
  assert.deepEqual(refusals, []);
  assert.equal(displacements.length, 1);
  assert.deepEqual({ ...displacements[0] }, { identity: 'landing-kept', lineageId: 'cat', priorSourceNodeId: 'dp',
    sourceNodeId: 'trace', targetNodeId: 'dp', trajectoryKind: 'phrasal', commands: true, crossWorkspace: false });
  // The phrase's parts travel with it; they are not displacements of their own.
  assert.ok(!displacements.some(entry => entry.targetNodeId.startsWith('dp-')));
});

test('a kept-id lower occurrence and a new copy elsewhere are one displacement; other lineage stays identity', () => {
  const copy = [{ id: 'tp2', label: 'TP', children: [cat('high'), { id: 'tbar', label: 'T′', children: [
    { id: 't', label: 'T', silent: true }, { id: 'vp', label: 'VP', children: [cat('dp', { silent: true }), { id: 'v', label: 'V', word: 'slept' }] }] }] }];
  const [displacement] = readStageDisplacements(before(), copy).displacements;
  assert.equal(displacement.identity, 'lower-kept');
  assert.deepEqual([displacement.priorSourceNodeId, displacement.sourceNodeId, displacement.targetNodeId], ['dp', 'dp', 'high']);
  // A new node of the lineage over different material, beside an unchanged
  // occurrence, is identity or reference, not a displacement.
  const resumptive = structuredClone(before());
  resumptive[0].children.unshift({ id: 'it', label: 'D', word: 'it', lineageId: 'cat' });
  const reading = readStageDisplacements(before(), resumptive);
  assert.deepEqual(reading.displacements, []);
  assert.equal(reading.refusals[0].reason, 'lineage-only-new-material');
});

test('only the earliest claim anchoring both ends owns a displacement', () => {
  const caseClaim = { relation: 'Case', anchors: { assigner: 't', recipient: 'dp' } };
  const restatement = { relation: '链', anchors: { 上: 'dp', 下: 'trace' } };
  const ownership = readStageStructuralOwnership([caseClaim, openClaim, restatement], before(), keptLanding());
  assert.deepEqual([...ownership.owners], [[1, 0]]);
  assert.deepEqual(ownership.claims[0], { named: [], touched: [0] });
  assert.deepEqual(ownership.claims[2], { named: [0], touched: [] });
  // The preceding source can supply the lower end.
  const prior = { relation: 'x', anchors: { a: 'dp' }, priorAnchors: { b: 'dp' } };
  assert.deepEqual([...readStageStructuralOwnership([prior], before(), keptLanding()).owners], [[0, 0]]);
});

test('a chain grows from its newest copy; parallel copies of a shared landing are refused', () => {
  const s1 = [{ id: 'tp', label: 'TP', children: [cat('mid'), { id: 'tbar', label: 'T′', children: [
    { id: 't', label: 'T', silent: true }, { id: 'vp', label: 'VP', children: [cat('dp', { silent: true }), { id: 'v', label: 'V', word: 'slept' }] }] }] }];
  const s2 = [{ id: 'cp', label: 'CP', children: [cat('top'), { id: 'c', label: 'C', silent: true }, { id: 'tp', label: 'TP', children: [
    cat('mid', { silent: true }), s1[0].children[1]] }] }];
  const stages = [stage(before()), stage(s1, [{ relation: 'a', anchors: { p: 'mid', q: 'dp' } }]), stage(s2, [{ relation: 'b', anchors: { p: 'top', q: 'mid' } }])];
  const [, first, second] = readDerivationStructuralMovement(stages);
  assert.equal(first.displacements[0].sourceNodeId, 'dp');
  assert.deepEqual([second.displacements[0].sourceNodeId, second.displacements[0].targetNodeId], ['mid', 'top']);
  assert.deepEqual([...second.owners], [[0, 0]]);
  // Two copies in separate conjuncts, introduced independently, under one landing.
  const conjunct = id => ({ id: `${id}P`, label: 'VP', children: [{ id: `${id}V`, label: 'V', word: id }, cat(id)] });
  const atbBefore = [{ id: 'and', label: '&P', children: [conjunct('bought'), conjunct('sold')] }];
  const atbAfter = [{ id: 'top', label: 'CP', children: [cat('high'), { id: 'and', label: '&P', children: [conjunct('bought'), conjunct('sold')] }] }];
  const reading = readStageDisplacements(atbBefore, atbAfter);
  assert.deepEqual(reading.displacements, []);
  assert.deepEqual(reading.refusals.map(refusal => refusal.reason), ['shared-landing']);
});

test('head adjunction in the host slot reads as head movement; explicit phrase notation stays phrasal', () => {
  const prior = [{ id: 'tp', label: 'TP', children: [{ id: 't', label: 'T', silent: true },
    { id: 'vp', label: 'VP', children: [{ id: 'v', label: 'V', word: 'read', lineageId: 'verb' }, { id: 'obj', label: 'DP', word: 'it' }] }] }];
  const current = host => [{ id: 'tp', label: 'TP', children: [{ id: 'complex', label: 'T', children: [host, { id: 't', label: 'T', silent: true }] },
    { id: 'vp', label: 'VP', children: [{ id: 'vTrace', label: 'V', lineageId: 'verb', silent: true }, { id: 'obj', label: 'DP', word: 'it' }] }] }];
  const head = readStageDisplacements(prior, current({ id: 'v', label: 'V', word: 'read', lineageId: 'verb' })).displacements[0];
  assert.deepEqual([head.identity, head.trajectoryKind], ['landing-kept', 'head']);
  const phrasePrior = structuredClone(prior);
  phrasePrior[0].children[1].children[0].label = 'NP [clitic]';
  const phraseCurrent = current({ id: 'v', label: 'NP [clitic]', word: 'read', lineageId: 'verb' });
  phraseCurrent[0].children[1].children[0].label = 'NP [clitic trace]';
  assert.notEqual(readStageDisplacements(phrasePrior, phraseCurrent).displacements[0]?.trajectoryKind, 'head');
});

test('a complex head beside a host built in the same stage, and a landing in another workspace, stay unread', () => {
  // The verbal complex adjoins to T, and T is new in this stage. Neither head
  // adjunction to a retained host nor a phrase merged above its source is
  // established, so a branching landing reads neither way.
  const complex = (id, silent) => ({ id, label: 'v[complex head]', lineageId: 'vc', ...(silent ? { silent } : {}), children: [
    { id: `${id}-V`, label: 'V', word: 'read', lineageId: 'verb', ...(silent ? { silent } : {}) },
    { id: `${id}-v`, label: 'v[transitive]', lineageId: 'little', silent: true }] });
  const vp = silent => ({ id: 'vp', label: 'v-projection', children: [complex('vc', silent),
    { id: 'VP', label: 'V-projection', children: [{ id: 'vBase', label: 'V', lineageId: 'verb', silent: true }, { id: 'obj', label: 'D', word: 'it' }] }] });
  const prior = [vp(false)];
  const current = [{ id: 'tp', label: 'T-projection', children: [{ id: 'tComplex', label: 'T[complex head]', children: [
    complex('vcT'), { id: 't', label: 'T[finite]', silent: true }] }, vp(true)] }];
  const [head] = readStageDisplacements(prior, current).displacements;
  assert.deepEqual([head.sourceNodeId, head.targetNodeId, head.trajectoryKind], ['vc', 'vcT', undefined]);
  const claim = { relation: 'v-T', anchors: { a: 'vcT', b: 'vc' } };
  assert.deepEqual([...readStageStructuralOwnership([claim], prior, current).neutral], [[0, 'landing-context-unread']]);
  // A new copy in a separate workspace reads as sideward movement or as a
  // parallel construction, never as one picture.
  const sidewardBefore = [{ id: 'adj', label: 'PP', children: [{ id: 'p', label: 'P', word: 'without' }, cat()] }];
  const sidewardAfter = [structuredClone(sidewardBefore[0]), { id: 'vp2', label: 'VP', children: [{ id: 'v2', label: 'V', word: 'file' }, cat('copy')] }];
  sidewardAfter[0].children[1].silent = true;
  const sideward = readStageStructuralOwnership([{ relation: 'x', anchors: { a: 'copy', b: 'dp' } }], sidewardBefore, sidewardAfter);
  assert.equal(sideward.displacements[0].crossWorkspace, true);
  assert.deepEqual([...sideward.owners], []);
  assert.deepEqual([...sideward.neutral], [[0, 'cross-workspace']]);
});

test('the switch is off by default; when on, an unrecognized claim draws the shared movement path', () => {
  const stages = [stage(before()), stage(keptLanding(), [openClaim])];
  assert.equal(recoverMovementEvidence(openClaim, keptLanding(), before()).movement, undefined, 'wording recognizes nothing');
  withSwitch(undefined, () => {
    assert.equal(readStructuralMovementForStages(stages), undefined);
    const dispatch = dispatchStageRelations(stages)[1][0];
    assert.equal(dispatch.structuralCarriedNodeIds, undefined);
    assert.equal(dispatch.evidence.movement, undefined);
    assert.ok(!compileRelationRenderPlan(stages).frames[1].items.some(item => item.kind === 'trajectory'));
  });
  withSwitch('1', () => {
    const dispatches = dispatchStageRelations(stages);
    assert.ok(dispatches[1][0].facets.some(facet => facet.recipe.id === 'movement.path'));
    const trajectory = compileRelationRenderPlan(stages).frames[1].items.find(item => item.kind === 'trajectory');
    assert.deepEqual([trajectory.sourceNodeId, trajectory.targetNodeId, trajectory.trajectoryKind, trajectory.tier2FacetId],
      ['trace', 'dp', 'phrasal', 'movement.path']);
    const steps = prepareReplay({ derivationStages: stages, sentence: 'the cat slept', includePlayback: true }).playbackSteps;
    const moment = steps.find(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 0);
    assert.ok(moment.replayRelationLinks.some(link => link.authoredRelationKey === '1:0' && link.movementTransition === true));
  });
});

test('saved relative pied-piping: the structural reading lets the phrasal landing own its contents', () => {
  // Stage 8 of "This is the man to whom I gave the book.": pp1 -> pp2 is the
  // displacement and wh2 sits inside pp2. With the switch on, the relative
  // Internal Merge owns pp2 with wh2, and the operator-variable dependency
  // keeps its drawing without a change of its own, so no timing cycle forms.
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/unrecognized-movement.json', import.meta.url))).cases[2];
  const original = structuredClone(record);
  const moments = steps => steps.filter(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === 7);
  const visible = (step, id) => frameStructure(step).visible.has(id);
  withSwitch('1', () => {
    const prepared = prepareReplay({ ...structuredClone(record), includePlayback: true });
    const [merge, dependency] = moments(prepared.playbackSteps);
    assert.ok(['pp2', 'p2', 'wh2'].every(id => visible(merge, id)));
    assert.ok(!prepared.playbackSteps.some(step => (step.movementDiagnostics ?? []).some(text => /RELATION_TIMING_CONFLICT/.test(text))));
    const trajectories = prepared.relationRenderPlan.frames[7].items.filter(item => item.kind === 'trajectory' && item.appearsAtStage === 7);
    assert.deepEqual(trajectories.map(item => [item.relationRef.relationIndex, item.sourceNodeId, item.targetNodeId]), [[0, 'pp1', 'pp2'], [1, 'wh0', 'wh2']]);
    assert.ok(visible(dependency, 'wh2'));
  });
  assert.deepEqual(record, original);
});

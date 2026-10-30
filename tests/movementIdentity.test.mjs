// Canonical movement identity: at every hop the occurrence at the source keeps
// the continuing id, whichever occurrence the model let keep it, and nothing
// but id strings changes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeMovementIdentity, renameTreeIds, stageIdRenames } from '../server/babelParser/movementIdentity.js';
import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { layoutCanopyVisualFrame, layoutVisualFrames, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { snapshotRecord, SNAPSHOT_VIEWPORT } from './helpers/layoutSnapshot.mjs';
import { buildReplayPanelContent } from '../replay/replayPanel.ts';
import { buildReplayDisplayDetailBlocks } from '../replay/replayPanelFormatting.ts';

const n = (id, label, children, extra = {}) => ({ id, label, ...extra, ...(children ? { children } : {}) });
const w = (id, label, word, extra = {}) => ({ id, label, word, ...extra, children: [] });
const stage = (workspaceForest, relations = [], extra = {}) => ({ statement: 's', stageRecord: 'r', relations, workspaceForest, ...extra });
const ids = forest => forest.flatMap(node => [node.id, ...ids(node.children ?? [])]);
/** Everything but id strings, in tree order. */
const shape = stages => JSON.stringify(stages, (key, value) => (key === 'id' || key === 'nodeIds' || key === 'anchors' || key === 'priorAnchors' ? undefined : value));

// "What did Mia see?": the wh-phrase moves from the object to Spec-CP.
const whStage0 = () => stage([n('tp', 'TP', [w('mia', 'DP', 'Mia'), n('vp', 'VP', [w('see', 'V', 'see'),
  n('what', 'DP', [w('whatD', 'D', 'what')], { lineageId: 'wh' })])])]);
const whLandingKept = () => [whStage0(), stage([n('cp', 'CP', [n('what', 'DP', [w('whatD', 'D', 'what')], { lineageId: 'wh' }),
  n('tp', 'TP', [w('mia', 'DP', 'Mia'), n('vp', 'VP', [w('see', 'V', 'see'), n('whatT', 'DP', [], { lineageId: 'wh', silent: true })])])])],
[{ relation: 'wh-movement', anchors: { landing: 'what', trace: 'whatT' }, priorAnchors: { source: 'what' } }],
{ realizations: [{ nodeIds: ['what'], tokenIndices: [0] }] })];

test('a landing-kept hop gives the continuing id to its source, and only ids change', () => {
  const input = whLandingKept(), before = JSON.stringify(input);
  const { stages, swappedHops, renames } = canonicalizeMovementIdentity(input);
  assert.equal(JSON.stringify(input), before, 'the input is never changed');
  assert.equal(swappedHops, 1);
  // The source keeps "what"; the landing is new, and so is everything it holds.
  assert.deepEqual(renames.map(rename => [rename.stageIndex, Object.fromEntries(rename.map)]),
    [[1, { what: 'whatT', whatT: 'what', whatD: 'whatT/whatD' }]]);
  assert.deepEqual(ids(stages[1].workspaceForest[0].children[0].children), ['whatT/whatD']);
  const [, landingRoot] = [stages[1].workspaceForest[0], stages[1].workspaceForest[0].children[0]];
  assert.equal(landingRoot.id, 'whatT');
  assert.equal(stages[1].workspaceForest[0].children[1].children[1].children[1].id, 'what', 'the source keeps "what"');
  // Anchors of the hop stage follow; its priorAnchors name the stage before and keep their ids.
  assert.deepEqual(stages[1].relations[0].anchors, { landing: 'whatT', trace: 'what' });
  assert.deepEqual(stages[1].relations[0].priorAnchors, { source: 'what' });
  assert.deepEqual(stages[1].realizations, [{ nodeIds: ['whatT'], tokenIndices: [0] }]);
  assert.equal(shape(stages), shape(input), 'labels, words, silence, lineage and relations are unchanged');
});

test('a node object shared between stages is renamed only where its hop is', () => {
  const object = n('what', 'DP', [w('whatD', 'D', 'what')], { lineageId: 'wh' });
  const stages = whLandingKept();
  stages[0].workspaceForest[0].children[1].children[1] = object;
  stages[1].workspaceForest[0].children[0] = object;
  const canonical = canonicalizeMovementIdentity(stages).stages;
  assert.deepEqual(ids(canonical[0].workspaceForest), ['tp', 'mia', 'vp', 'see', 'what', 'whatD'], 'the stage before the hop keeps its ids');
  assert.equal(canonical[1].workspaceForest[0].children[0].id, 'whatT');
});

test('an analysis without movement, or already source-kept, is returned as it is', () => {
  const still = [stage([w('a', 'D', 'a')]), stage([n('dp', 'DP', [w('a', 'D', 'a')])])];
  assert.equal(canonicalizeMovementIdentity(still).stages, still);
  const canonical = canonicalizeMovementIdentity(whLandingKept()).stages;
  const again = canonicalizeMovementIdentity(canonical);
  assert.equal(again.stages, canonical, 'canonicalizing twice is canonicalizing once');
  assert.equal(again.swappedHops, 0);
});

test('a chain renames each hop, and later priorAnchors follow the renamed stage', () => {
  // Successive cyclic movement: Spec-vP, then Spec-CP. The model keeps "who" at each landing.
  const s0 = stage([n('vp', 'VP', [w('see', 'V', 'see'), n('who', 'DP', [w('whoD', 'D', 'who')], { lineageId: 'w' })])]);
  const s1 = stage([n('vP', 'vP', [n('who', 'DP', [w('whoD', 'D', 'who')], { lineageId: 'w' }),
    n('vp', 'VP', [w('see', 'V', 'see'), n('t1', 'DP', [], { lineageId: 'w', silent: true })])])],
  [{ relation: 'edge movement', anchors: { landing: 'who', source: 't1' }, priorAnchors: { from: 'who' } }]);
  const s2 = stage([n('cp', 'CP', [n('who', 'DP', [w('whoD', 'D', 'who')], { lineageId: 'w' }),
    n('vP', 'vP', [n('t2', 'DP', [], { lineageId: 'w', silent: true }),
      n('vp', 'VP', [w('see', 'V', 'see'), n('t1', 'DP', [], { lineageId: 'w', silent: true })])])])],
  [{ relation: 'wh-movement', anchors: { landing: 'who', source: 't2', foot: 't1' }, priorAnchors: { from: 'who' } }]);
  const { stages, swappedHops } = canonicalizeMovementIdentity([s0, s1, s2]);
  assert.equal(swappedHops, 2);
  // Stage 1: the source keeps "who"; the landing is t1. Stage 2: the intermediate (t1) stays, the landing is t2.
  // Each landing's subtree is new: whoD at the first landing, then a copy of it at the second.
  assert.deepEqual(ids(stages[1].workspaceForest), ['vP', 't1', 't1/whoD', 'vp', 'see', 'who']);
  assert.deepEqual(ids(stages[2].workspaceForest), ['cp', 't2', 't2/t1/whoD', 'vP', 't1', 'vp', 'see', 'who']);
  assert.deepEqual(stages[1].relations[0], { relation: 'edge movement', anchors: { landing: 't1', source: 'who' }, priorAnchors: { from: 'who' } });
  // Stage 2's priorAnchors name stage 1, where the moving occurrence is now t1.
  assert.deepEqual(stages[2].relations[0], { relation: 'wh-movement', anchors: { landing: 't2', source: 't1', foot: 'who' }, priorAnchors: { from: 't1' } });
  assert.equal(canonicalizeMovementIdentity(stages).stages, stages);
});

test('head movement and a source-kept hop in one analysis: only the landing-kept hop is renamed', () => {
  const s0 = stage([n('tp', 'TP', [w('t', 'T', '-s'), n('vp', 'VP', [w('v', 'V', 'walk', { lineageId: 'verb' }),
    n('obj', 'DP', [w('objD', 'D', 'it')], { lineageId: 'o' })])])]);
  // V-to-T keeps "v" at the landing (landing-kept); object shift keeps "obj" at the source (source-kept).
  const s1 = stage([n('tp', 'TP', [n('tcx', 'T', [w('v', 'V', 'walk', { lineageId: 'verb' }), w('t', 'T', '-s')]),
    n('xp', 'XP', [n('obj2', 'DP', [w('objD2', 'D', 'it')], { lineageId: 'o' }),
      n('vp', 'VP', [w('vT', 'V', 'walk', { lineageId: 'verb', silent: true }), n('obj', 'DP', [w('objD', 'D', 'it', { silent: true })], { lineageId: 'o' })])])])],
  [{ relation: 'V-to-T', anchors: { head: 'v', trace: 'vT', host: 't' } }, { relation: 'object shift', anchors: { landing: 'obj2', source: 'obj' } }]);
  const { stages, renames } = canonicalizeMovementIdentity([s0, s1]);
  assert.deepEqual(renames.map(rename => Object.fromEntries(rename.map)), [{ v: 'vT', vT: 'v' }]);
  assert.deepEqual(stages[1].relations.map(relation => relation.anchors),
    [{ head: 'vT', trace: 'v', host: 't' }, { landing: 'obj2', source: 'obj' }]);
});

test('a full copy pairs node by node; a root merged beside a repeat is no hop', () => {
  const s0 = stage([n('vp', 'VP', [w('v', 'V', 'buy'), n('dp', 'DP', [w('d', 'D', 'the'), w('nn', 'N', 'book')], { lineageId: 'o' })])]);
  const s1 = stage([n('xp', 'XP', [n('dp', 'DP', [w('d', 'D', 'the'), w('nn', 'N', 'book')], { lineageId: 'o' }),
    n('vp', 'VP', [w('v', 'V', 'buy'), n('dp2', 'DP', [w('d2', 'D', 'the', { silent: true }), w('nn2', 'N', 'book', { silent: true })], { lineageId: 'o' })])])]);
  const { renames } = canonicalizeMovementIdentity([s0, s1]);
  assert.deepEqual(Object.fromEntries(renames[0].map), { dp2: 'dp', dp: 'dp2', d2: 'd', d: 'd2', nn2: 'nn', nn: 'nn2' });
  // A free root that is merged while a repeat appears elsewhere has no source slot: no occurrence stood where it moved from.
  const shared = [stage([w('wh', 'D', 'what', { lineageId: 's' }), w('buy', 'V', 'buy'), w('sell', 'V', 'sell')]),
    stage([n('co', '&P', [n('b', 'VP', [w('buy', 'V', 'buy'), w('wh', 'D', 'what', { lineageId: 's' })]),
      n('c', 'VP', [w('sell', 'V', 'sell'), w('wh2', 'D', 'what', { lineageId: 's' })])])])];
  const result = canonicalizeMovementIdentity(shared);
  assert.equal(result.stages, shared);
  assert.deepEqual(result.undecided, [{ stageIndex: 1, lineage: 's', reason: 'no-source-slot' }]);
});

test('normalization stores canonical ids, renames the final tree with them, and records the count', () => {
  const payload = { derivationStages: whLandingKept().map(({ realizations: _r, ...rest }) => rest) };
  const sentence = 'What Mia see';
  const [analysis] = normalizeParseBundle(structuredClone(payload), 'xbar', sentence, 'gemini', true, {}).analyses;
  assert.equal(analysis.provenance.movementIdentityCorrections, 1);
  const finalIds = ids(analysis.derivationStages.at(-1).workspaceForest);
  assert.deepEqual(ids(analysis.finalForest), finalIds);
  assert.equal(analysis.derivationStages[1].relations[0].anchors.landing, 'whatT');
  const canonicalPayload = { derivationStages: canonicalizeMovementIdentity(payload.derivationStages).stages };
  const [plain] = normalizeParseBundle(structuredClone(canonicalPayload), 'xbar', sentence, 'gemini', true, {}).analyses;
  assert.equal(plain.provenance.movementIdentityCorrections, undefined, 'a source-kept analysis needs no correction');
  assert.deepEqual(plain.derivationStages, analysis.derivationStages);
});

test('prepareReplay reads canonical stages and renames a final tree built from the authored ones', () => {
  const input = whLandingKept(), prepared = prepareReplay({ derivationStages: input, sentence: 'What Mia see', includePlayback: true });
  assert.deepEqual(prepared.derivationStages, canonicalizeMovementIdentity(input).stages);
  assert.deepEqual(prepared.finalStageIdRenames, { what: 'whatT', whatT: 'what', whatD: 'whatT/whatD' });
  const tree = renameTreeIds(input[1].workspaceForest[0], prepared.finalStageIdRenames);
  assert.deepEqual(ids([tree]), ids(prepared.derivationStages[1].workspaceForest));
  assert.deepEqual(stageIdRenames([], 3), {});
});

// Committed analyses, each in its own convention, the source-kept one and the
// landing-kept one, are one analysis to Babel.
const { records } = loadFixtureAnalyses();
const moving = records.filter(({ record }) => canonicalizeMovementIdentity(record.derivationStages, { keep: 'landing' }).swappedHops
  + canonicalizeMovementIdentity(record.derivationStages).swappedHops > 0);

test('every committed analysis has one canonical form whichever occurrence keeps each id', () => {
  assert.ok(moving.length > 100, `${moving.length} committed analyses move something`);
  for (const { id, record } of moving) {
    const canonical = canonicalizeMovementIdentity(record.derivationStages).stages;
    const landing = canonicalizeMovementIdentity(record.derivationStages, { keep: 'landing' }).stages;
    assert.equal(shape(landing), shape(record.derivationStages), `${id}: the landing-kept variant changes only ids`);
    assert.deepEqual(canonicalizeMovementIdentity(landing).stages, canonical, `${id}: the landing-kept variant canonicalizes alike`);
    assert.equal(canonicalizeMovementIdentity(canonical).stages, canonical, `${id}: canonical stages are a fixed point`);
  }
});

// Replay and the Canopy, as the layout snapshot fingerprints them, for a
// deterministic sample of both conventions. Before canonicalization most of
// these differed between the variants (the flip study measured about 96%).
const viewport = VIEWPORTS.find(({ name }) => name === SNAPSHOT_VIEWPORT);
const fingerprint = record => {
  const visual = prepareVisualRecord(record);
  return snapshotRecord(visual, layoutVisualFrames(visual, [viewport]), layoutCanopyVisualFrame(visual, viewport),
    { buildReplayPanelContent, buildReplayDisplayDetailBlocks });
};
const sample = [...moving.filter(({ record }) => canonicalizeMovementIdentity(record.derivationStages).swappedHops > 0).slice(0, 4),
  ...moving.filter(({ record }) => canonicalizeMovementIdentity(record.derivationStages).swappedHops === 0).slice(0, 4)];

test('Replay and the Canopy do not depend on which occurrence keeps the id', () => {
  assert.equal(sample.length, 8);
  for (const { id, record } of sample) {
    const original = fingerprint(record);
    for (const keep of ['source', 'landing']) {
      const variant = { ...record, derivationStages: canonicalizeMovementIdentity(record.derivationStages, { keep }).stages };
      assert.deepEqual(fingerprint(variant), original, `${id}: the ${keep}-kept variant`);
    }
  }
});

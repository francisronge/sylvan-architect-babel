import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { readStageDisplacements } from '../replay/relations/structuralMovement.ts';
import * as invariants from './helpers/replayInvariants.mjs';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';
import { withStructuralMovement } from './helpers/structuralMovementSwitch.mjs';

// Saved English past-affix lowering (spellout-v3-product t-en-possessive.sol,
// stage 4, "Mia's brother laughed."): the past affix leaves I and joins the
// verb head that already holds the root, beside it. Its labels are prose
// ("Past affix", "V root"), so no notation names the landing a head, and no
// new parent holds it: the copy appeared without an arrow.
const leaf = (id, label, word, extra = {}) => ({ id, label, ...(word === undefined ? {} : { word }), children: [], ...extra });
const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'Record', relations, workspaceForest });
const clause = (inflection, verbHead) => [{ id: 'clause', label: 'IP', children: [
  { id: 'subject', label: 'DP', children: [leaf('mia', 'D', 'Mia')] },
  { id: 'ibar', label: 'I′', children: [{ id: 'inflection', label: 'I [+finite, +past]', children: [inflection] },
    { id: 'vp', label: 'VP', children: [{ id: 'vbar', label: 'V′', children: [{ id: 'verbHead', label: 'V', children: verbHead }] }] }] }] }];
const root = () => leaf('laughRoot', 'V root', 'laugh');
const before = () => clause(leaf('pastBase', 'Past affix', '-ed', { lineageId: 'past' }), [root()]);
const after = () => clause(leaf('pastTrace', 't_I', undefined, { lineageId: 'past', silent: true }),
  [root(), leaf('pastLowered', 'Past affix', '-ed', { lineageId: 'past' })]);
// The saved claim's own fields; wording reads none of them as movement.
const claim = { relation: 'Past-affix lowering', anchors: { host: 'verbHead', loweredAffix: 'pastLowered', sourceTrace: 'pastTrace' },
  priorAnchors: { sourceAffix: 'pastBase', targetHead: 'verbHead' }, values: { operation: 'PF affix lowering from I to V', tense: 'past' } };
const stages = () => [stage(before()), stage(after(), [claim])];
const paths = value => withStructuralMovement(value, () => compileRelationRenderPlan(stages())).frames[1].items
  .filter(item => item.kind === 'trajectory' && item.relationRef.stageIndex === 1).map(item => `${item.sourceNodeId}->${item.targetNodeId}`);

test('a head joining a kept head beside its unchanged contents reads as head movement', () => {
  const [displacement] = readStageDisplacements(before(), after()).displacements;
  assert.deepEqual([displacement.sourceNodeId, displacement.targetNodeId, displacement.trajectoryKind], ['pastTrace', 'pastLowered', 'head']);
  assert.deepEqual(paths('0'), [], 'wording alone draws no arrow');
  assert.deepEqual(paths(), ['pastTrace->pastLowered']);
  const authored = { sentence: "Mia laugh -ed", derivationStages: stages() };
  const replay = prepareReplay({ ...structuredClone(authored), includePlayback: true });
  assert.deepEqual([...invariants.checkMovementShownAsMovement(replay, authored), ...invariants.checkNoEarlyReveal(replay),
    ...checkMovementUnrendered(replay, authored)], []);
});

test('a receiving head whose contents change, or a phrase-level receiver, does not read as a head landing', () => {
  const changed = after();
  changed[0].children[1].children[1].children[0].children[0].children[0].word = 'laughs';
  assert.notEqual(readStageDisplacements(before(), changed).displacements[0]?.trajectoryKind, 'head');
  const phrase = after(), host = phrase[0].children[1].children[1].children[0].children[0];
  host.label = 'VP';
  const earlier = before(); earlier[0].children[1].children[1].children[0].children[0].label = 'VP';
  assert.notEqual(readStageDisplacements(earlier, phrase).displacements[0]?.trajectoryKind, 'head');
  // In a forest of bare labels, V may be the phrase: this notation proves no
  // head, and the reading stays the one main already gives.
  const bare = tree => JSON.parse(JSON.stringify(tree).replaceAll('"IP"', '"I"').replaceAll('"I′"', '"I"').replaceAll('"VP"', '"V"')
    .replaceAll('"V′"', '"V"').replaceAll('"DP"', '"D"'));
  assert.notEqual(readStageDisplacements(bare(before()), bare(after())).displacements[0]?.trajectoryKind, 'head');
});

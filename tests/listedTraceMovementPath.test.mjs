import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkRelationMoments, frameStructure } from './helpers/replayInvariants.mjs';
import { checkMovementUnrendered } from './helpers/replayContractWarnings.mjs';
import { checkMarkPersistence, checkStepSemantics } from './helpers/replayStepInvariants.mjs';

// GPT-6.1 Sol (Codex qualification batch sol-120-20261026, n4-24) moved a relative
// operator a second time and named both its traces in one list field
// (`traces: [riptrace, rsubtrace]`), under an open field name. Structure proves the
// hop (the operator keeps its id; its new trace holds its old slot; the older trace
// is unchanged), but wording drew only a coindex over the chain's occurrences, and a
// claim that drew anything kept that drawing: the hop had no path, and the merge of
// the landing's parent stood as an empty step before the operator jumped in.
const leaf = (id, label, word, extra = {}) => ({ id, label, children: [], ...(word === null ? { silent: true } : { word }), ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const operator = () => node('op', 'DP', [leaf('who', 'D', 'who')], { lineageId: 'operator' });
const trace = id => leaf(id, 'DP', null, { lineageId: 'operator' });
const clause = (specifier, lower) => node('tp', 'TP', [...specifier ? [specifier] : [], node('tbar', "T'", [leaf('t', 'T', null),
  node('vp', 'VP', [lower, node('vbar', "V'", [leaf('v', 'V', 'left')])])])]);
const cp = (specifier, tp) => node('cp', 'CP', [...specifier ? [specifier] : [], node('cbar', "C'", [leaf('c', 'C', null), tp])]);
const stages = [
  { statement: 'Build the clause with the operator in its base position.', stageRecord: 'Base position.',
    relations: [{ relation: 'theta-assignment', anchors: { predicate: 'v', argument: 'op' } }],
    workspaceForest: [cp(null, clause(null, operator()))] },
  { statement: 'Move the operator to Spec-TP.', stageRecord: 'First hop.',
    relations: [{ relation: 'operator-chain', anchors: { operator: 'op', trace: 'lowTrace' } }],
    workspaceForest: [cp(null, clause(operator(), trace('lowTrace')))] },
  { statement: 'Move the operator on to Spec-CP.', stageRecord: 'Second hop.',
    relations: [{ relation: 'operator-chain', anchors: { operator: 'op', traces: ['highTrace', 'lowTrace'] } }],
    workspaceForest: [cp(operator(), clause(trace('highTrace'), trace('lowTrace')))] }
];
const record = { sentence: 'who left', derivationStages: stages };

test('a claim listing its new and its older trace draws the stage\'s hop at its own moment', () => {
  const replay = prepareReplay({ ...structuredClone(record), includePlayback: true }), steps = replay.playbackSteps;
  const items = replay.relationRenderPlan.frames[2].items.filter(item => item.relationRef.stageIndex === 2);
  assert.deepEqual(items.filter(item => item.kind === 'trajectory').map(item => [item.sourceNodeId, item.targetNodeId]), [['highTrace', 'op']],
    'the second hop draws its path');
  // The coindex and its forest light keep the whole chain, and no field is left to a neutral mark.
  assert.deepEqual(items.filter(item => item.kind === 'coindex').map(item => [item.familyId, item.tier2OutputPieces, item.nodeIds]),
    [['identity.occurrences', ['Coindex', 'Forest light'], ['op', 'highTrace', 'lowTrace']]]);
  assert.deepEqual(items.filter(item => item.kind === 'fallback'), [], 'no neutral leftover');
  const moment = steps.findIndex(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === 2);
  assert.equal(frameStructure(steps[moment - 1]).parent.get('op'), 'tp', 'the operator keeps its preceding place until its moment');
  assert.equal(frameStructure(steps[moment]).parent.get('op'), 'cp', 'the operator lands at its moment');
  assert(steps.slice(0, moment).every(step => !step.replayVisibleNodeIds.includes('highTrace')), 'the new trace waits for its moment');
  assert.deepEqual([...checkRelationMoments(replay, record), ...checkStepSemantics(replay, record), ...checkMarkPersistence(replay, record),
    ...checkMovementUnrendered(replay, record)], []);
});

// Claude Opus 5.5 (opus-parts batch: n3-15, n3-30, n3-56, n4-01, n4-03) named each hop
// `movement-chain` with open fields {head: landing, tail: trace}. Wording proves no
// movement from them and refuses none; it drew a coindex, which kept the hop's path off.
test('a chain claim naming only the hop under open fields draws the path beside its coindex', () => {
  const headTail = structuredClone(record);
  headTail.derivationStages[1].relations = [{ relation: 'movement-chain', anchors: { head: 'op', tail: 'lowTrace' } }];
  headTail.derivationStages[2].relations = [{ relation: 'movement-chain', anchors: { head: 'op', tail: 'highTrace' } }];
  const replay = prepareReplay({ ...structuredClone(headTail), includePlayback: true });
  for (const [stage, lower] of [[1, 'lowTrace'], [2, 'highTrace']]) {
    const items = replay.relationRenderPlan.frames[stage].items.filter(item => item.relationRef.stageIndex === stage);
    assert.deepEqual(items.filter(item => item.kind === 'trajectory').map(item => [item.sourceNodeId, item.targetNodeId]), [[lower, 'op']]);
    assert.deepEqual(items.filter(item => item.kind === 'coindex').map(item => item.nodeIds), [['op', lower]]);
    assert.deepEqual(items.filter(item => item.kind === 'fallback' && Object.keys(item.relationRef.anchors).length), [], 'no field is left to a neutral mark');
  }
  assert.deepEqual([...checkRelationMoments(replay, headTail), ...checkStepSemantics(replay, headTail), ...checkMarkPersistence(replay, headTail),
    ...checkMovementUnrendered(replay, headTail)], []);
});

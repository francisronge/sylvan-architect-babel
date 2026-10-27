import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import * as invariants from './helpers/replayInvariants.mjs';
import { checkMarkPersistence, checkStepSemantics } from './helpers/replayStepInvariants.mjs';
import { checkContractWarnings } from './helpers/replayContractWarnings.mjs';

// Claude Opus 5.5 (n4-10-en-quantifier-scope-long, 26 Oct 2026) authors LF
// Quantifier Raising in an overt-shaped tree: the raised QP keeps its ID and
// stays pronounced at the adjunction site, a fresh silent trace sharing its
// lineage takes the old slot, and a realization group restores surface order.
// Under the registered name the claim must draw the covert QR path at Tier 1
// in both the authored open role spelling and the registered one, and its
// moment must introduce the trace, landing and new IP segment together while
// the QP stays in its preceding position until then.
const leaf = (id, label, word) => ({ id, label, word });
const nodes = forest => forest.flatMap(node => [node, ...nodes(node.children ?? [])]);
const qp = () => ({ id: 'qp', label: 'DP', lineageId: 'every-film', children: [leaf('d', 'D', 'every'), leaf('n', 'N', 'film')] });
const clause = object => ({ id: 'ip', label: 'IP', children: [leaf('subj', 'DP', 'Mia'),
  { id: 'vp', label: 'VP', children: [leaf('v', 'V', 'saw'), object] }] });
const stage = (workspaceForest, relations, realizations) => ({
  statement: 'stage', stageRecord: 'stage', relations, workspaceForest, ...(realizations ? { realizations } : {})
});
const record = anchors => ({
  sentence: 'Mia saw every film.',
  inputTokens: ['Mia', 'saw', 'every film'],
  derivationStages: [
    stage([{ id: 'cp', label: 'CP', children: [leaf('c', 'C', null), clause(qp())] }], [
      { relation: 'theta-role assignment', anchors: { assigner: 'v', recipient: 'qp' }, values: { role: 'Theme' } }
    ]),
    stage([{ id: 'cp', label: 'CP', children: [leaf('c', 'C', null), { id: 'ipSeg', label: 'IP', children: [
      qp(), clause({ id: 't', label: 't', silent: true, lineageId: 'every-film' })] }] }], [
      { relation: 'Quantifier Raising', anchors, priorAnchors: { source: 'qp' } },
      { relation: 'PF realization at S-structure position', anchors: { realized: 'qp', sStructureSite: 't' }, values: { text: 'every film' } }
    ], [{ nodeIds: ['qp'], tokenIndices: [2] }])
  ]
});
const spellings = {
  open: { moved: 'qp', trace: 't', adjunctionSite: 'ip' },
  registered: { pronouncedQP: 't', lfQP: 'qp', scopeDomain: 'ip' }
};
const SPECIAL = new Set(['checkInputUnchanged', 'checkOneLetterPerLabel']);
const findings = (replay, authored) => [
  ...Object.entries(invariants).filter(([name, check]) => typeof check === 'function' && /^check/.test(name) && !SPECIAL.has(name))
    .flatMap(([, check]) => check(replay, authored)),
  ...checkStepSemantics(replay, authored), ...checkMarkPersistence(replay, authored), ...checkContractWarnings(replay, authored)
];

for (const [spelling, anchors] of Object.entries(spellings)) {
  test(`registered QR with a kept landing ID and a fresh trace draws the covert path at Tier 1 (${spelling} roles)`, () => {
    const authored = record(anchors), original = structuredClone(authored);
    const [prior, current] = authored.derivationStages;
    const dispatch = dispatchRelationClaims({ relation: current.relations[0], currentForest: current.workspaceForest,
      priorForest: prior.workspaceForest, currentRealizations: current.realizations, stageIndex: 1, relationIndex: 0 });
    assert.equal(dispatch.primaryClaim.tier, 1, JSON.stringify(dispatch.tier1Dispatch.signatureIssues));
    assert.equal(dispatch.primaryClaim.registryEntryId, 'qr.covert');
    const replay = prepareReplay({ ...structuredClone(authored), includePlayback: true });
    const items = replay.relationRenderPlan.frames[1].items.filter(item => item.relationRef.relationIndex === 0);
    const qr = items.filter(item => item.kind === 'quantifier-raising');
    assert.equal(qr.length, 1);
    assert.deepEqual([qr[0].pronouncedNodeId, qr[0].lfNodeId, qr[0].claimTier], ['t', 'qp', 1]);
    assert(!items.some(item => item.kind === 'trajectory'), 'QR is not also drawn as an ordinary movement arrow');
    const steps = replay.playbackSteps;
    const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 0);
    assert(moment > 0);
    for (const step of steps.slice(0, moment)) {
      assert(!['t', 'ipSeg'].some(id => step.replayVisibleNodeIds.includes(id)), 'the trace and new segment wait for the QR moment');
    }
    assert(steps[moment - 1].replayVisibleNodeIds.includes('qp'), 'the QP stays in its preceding position until its moment');
    assert(['t', 'ipSeg', 'qp', 'd', 'n'].every(id => steps[moment].replayVisibleNodeIds.includes(id)), 'the QR moment introduces trace and landing together');
    assert.deepEqual(findings(replay, authored).map(item => `${item.rule}:${item.subtype ?? ''} ${item.detail}`), []);
    assert.deepEqual(authored, original, 'recognition and Replay preserve the authored analysis');
  });
}

// The covert shape keeps the pronounced QP in place and adds a silent LF copy.
const covertRecord = anchors => {
  const authored = record(anchors), current = authored.derivationStages[1];
  const lf = { ...qp(), id: 'qpLF', silent: true, children: qp().children.map(child => ({ ...child, id: `${child.id}LF` })) };
  current.workspaceForest = [{ id: 'cp', label: 'CP', children: [leaf('c', 'C', null),
    { id: 'ipSeg', label: 'IP', children: [lf, clause(qp())] }] }];
  current.relations = [{ relation: 'Quantifier Raising', anchors }];
  delete current.realizations;
  return authored;
};

test('registered QR in the covert shape still draws its path at Tier 1 and plays cleanly in both role spellings', () => {
  for (const anchors of [{ lower: 'qp', upper: 'qpLF', adjunctionSite: 'ip' }, { pronouncedQP: 'qp', lfQP: 'qpLF', scopeDomain: 'ip' }]) {
    const authored = covertRecord(anchors), [prior, current] = authored.derivationStages;
    const dispatch = dispatchRelationClaims({ relation: current.relations[0], currentForest: current.workspaceForest,
      priorForest: prior.workspaceForest, stageIndex: 1, relationIndex: 0 });
    assert.equal(dispatch.primaryClaim.tier, 1, JSON.stringify(anchors));
    const replay = prepareReplay({ ...structuredClone(authored), includePlayback: true });
    const qr = replay.relationRenderPlan.frames[1].items.filter(item => item.kind === 'quantifier-raising');
    assert.deepEqual(qr.map(item => [item.pronouncedNodeId, item.lfNodeId, item.claimTier]), [['qp', 'qpLF', 1]]);
    const steps = replay.playbackSteps;
    const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1 && step.replayRelationIdentity.relationIndex === 0);
    assert(steps.slice(0, moment).every(step => !['qpLF', 'ipSeg'].some(id => step.replayVisibleNodeIds.includes(id))));
    assert(['qpLF', 'ipSeg', 'qp'].every(id => steps[moment].replayVisibleNodeIds.includes(id)));
    assert.deepEqual(findings(replay, authored).map(item => `${item.rule}:${item.subtype ?? ''} ${item.detail}`), [], JSON.stringify(anchors));
  }
});

test('open QR participants without a proved or established movement stay a neutral exact claim', () => {
  for (const [why, alter] of Object.entries({
    failed: current => { current.relations[0].values = { status: 'failed' }; },
    pending: current => { current.relations[0].values = { status: 'pending' }; },
    'trace without lineage': current => { delete nodes(current.workspaceForest).find(node => node.id === 't').lineageId; },
    'trace of another lineage': current => { nodes(current.workspaceForest).find(node => node.id === 't').lineageId = 'other'; }
  })) {
    const authored = record(spellings.open), [prior, current] = authored.derivationStages;
    alter(current);
    const dispatch = dispatchRelationClaims({ relation: current.relations[0], currentForest: current.workspaceForest,
      priorForest: prior.workspaceForest, stageIndex: 1, relationIndex: 0 });
    assert.equal(dispatch.primaryClaim.tier, 3, why);
    const items = prepareReplay({ ...authored, includePlayback: true }).relationRenderPlan.frames[1].items
      .filter(item => item.relationRef.relationIndex === 0);
    assert(!items.some(item => ['quantifier-raising', 'trajectory'].includes(item.kind)), why);
  }
});

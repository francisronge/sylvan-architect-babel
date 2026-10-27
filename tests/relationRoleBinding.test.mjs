import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dispatchRelation } from '../replay/relationDispatch/relationDispatch.js';
import { productionRelationRegistry } from '../replay/relationDispatch/productionRegistry.js';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { getFrameRelations } from '../replay/frameRelations.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';

const forest = [{ id: 'domain', label: 'TP', children: ['a', 'b', 'c'].map(id => ({ id, label: 'D', word: id })) }];
const stage = relations => ({ statement: 'test', stageRecord: 'test', workspaceForest: forest, relations });
const dispatch = relation => dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0 });
const tier1 = relation => dispatchRelation({ registry: productionRelationRegistry, relation, stageIndex: 0, relationIndex: 0 });
const geometry = plan => plan.frames.map(frame => frame.items.map(({ relationRef, ...item }) => item));
const examples = [
  ['Control', { controller: 'a', controllee: 'b', domain: 'domain' }, { controlSource: 'a', controlledSubject: 'b', localDomain: 'domain' }],
  ['Binding', { binder: 'a', bound: 'b', domain: 'domain' }, { bindingSource: 'a', bindingTarget: 'b', region: 'domain' }],
  ['CaseAssignment', { assigner: 'a', bearer: 'b' }, { featureSource: 'a', valuedNode: 'b' }],
  ['Agree', { probe: 'a', goal: 'b' }, { searcher: 'a', agreeGoal: 'b' }],
  ['PairMerge', { host: 'a', pairMember: 'b' }, { attachmentHost: 'a', pairMergedItem: 'b' }],
  ['TransferDomain', { phase: 'domain', edge: 'a', spellOutDomain: 'b' }, { phaseDomain: 'domain', escapeHatch: 'a', transferredComplement: 'b' }],
  ['IdiomChunkCointerpretation', { chunks: ['a', 'b'], domain: 'domain' }, { idiomChunks: ['a', 'b'], cointerpretationDomain: 'domain' }],
  ['FocusMarking', { focus: 'a', background: 'b', domain: 'domain' }, { prominentBranch: 'a', backgroundSister: 'b', region: 'domain' }]
];

test('registered theta assignment counts exact source occurrences without rewriting repeated entries', () => {
  for (const key of ['predicate', 'assigner', 'ASSIGNER']) {
    const relation = { relation: 'theta-role assignment',
      anchors: { [key]: ['a', 'a'], assignments: ['b', 'c'] },
      values: { assignments: ['Theme', 'Goal'] } };
    const original = structuredClone(relation);
    const result = dispatch(relation);
    assert.equal(result.primaryClaim.tier, 1, JSON.stringify(result.tier1Dispatch.signatureIssues));
    assert.deepEqual(result.boundPrimaryRelation.anchors.predicate, ['a', 'a']);
    assert.deepEqual(result.primaryRelation, original);
    assert.deepEqual(relation, original);
    const plan = compileRelationRenderPlan([stage([relation])]);
    const grid = plan.frames[0].items.find(item => item.plaqueStyle === 'theta-grid');
    assert.deepEqual(grid?.thetaRoles.map(({ nodeId, label }) => ({ nodeId, label })),
      [{ nodeId: 'b', label: 'Theme' }, { nodeId: 'c', label: 'Goal' }]);
    assert.deepEqual(grid.relationRef.anchors, original.anchors);

    const distinct = { ...relation, anchors: { ...relation.anchors, [key]: ['a', 'b'] } };
    const sameLineageForest = structuredClone(forest);
    sameLineageForest[0].children.forEach(node => { node.lineageId = 'one-chain'; });
    const rejected = dispatchRelationClaims({ relation: distinct, currentForest: sameLineageForest,
      stageIndex: 0, relationIndex: 0 });
    assert.equal(rejected.primaryClaim.tier, 3);
    assert.ok(rejected.tier1Dispatch.signatureIssues.some(issue => issue.kind === 'theta-assignments-unproven'));
    assert.equal(compileRelationRenderPlan([stage([distinct])]).frames[0].items
      .some(item => item.plaqueStyle === 'theta-grid'), false);
  }
  const unknown = dispatch({ relation: 'OpenAssignment',
    anchors: { assigner: ['a', 'a'], assignments: ['b', 'c'] }, values: { assignments: ['Theme', 'Goal'] } });
  assert.equal(unknown.primaryClaim.tier, 3, 'a registered contextual alias cannot classify an open relation');
  assert.equal(unknown.facets.some(facet => facet.recipe.id === 'theta-grid'), false);
});

test('licensing equivalents reach the same registered slots and preserve incomplete-signature refusal', () => {
  for (const source of ['licensor', 'licenser', 'licenseSource', 'licensing-head']) {
    for (const target of ['licensee', 'licensedItem', 'licensing_target']) {
      for (const [relation, canonical] of [
        ['CaseAssignment', { assigner: 'a', bearer: 'b' }],
        ['Agree', { probe: 'a', goal: 'b' }],
        ['StrongNPILicensing', { licensor: 'a', npi: 'b' }]
      ]) {
        const authored = { relation, anchors: { [source]: 'a', [target]: 'b' } };
        const original = structuredClone(authored);
        const result = dispatch(authored);
        assert.equal(result.primaryClaim.tier, 1, JSON.stringify(authored));
        assert.deepEqual(result.boundPrimaryRelation.anchors, dispatch({ relation, anchors: canonical }).boundPrimaryRelation.anchors);
        assert.deepEqual(authored, original);
        assert.equal(dispatch({ relation, anchors: { [source]: 'a' } }).primaryClaim.tier, 3);
      }
    }
  }
  const conflict = dispatch({ relation: 'CaseAssignment', anchors: { licenser: 'a', licensor: 'c', bearer: 'b' } });
  assert.equal(conflict.primaryClaim.tier, 3);
  assert.ok(conflict.tier1Dispatch.signatureIssues.some(issue => issue.kind === 'conflicting-role-bindings'));
});

for (const [relation, anchors, equivalents] of examples) {
  test(`${relation}: equivalent roles keep the drawing and original record`, () => {
    const original = { relation, anchors: equivalents, values: { note: 'authored text' } };
    const untouched = structuredClone(original);
    const result = dispatch(original);
    assert.equal(result.primaryClaim?.tier, 1, JSON.stringify(result.tier1Dispatch.signatureIssues));
    assert.deepEqual(result.primaryRelation, original);
    assert.deepEqual(result.tier1Dispatch.literalDisplays, tier1(original).literalDisplays);
    const canonicalPlan = compileRelationRenderPlan([stage([{ ...original, anchors }])]);
    const plan = compileRelationRenderPlan([stage([original])]);
    assert.ok(plan.frames[0].items.length);
    assert.deepEqual(geometry(plan), geometry(canonicalPlan));
    for (const item of plan.frames[0].items) assert.deepEqual(item.relationRef.anchors, equivalents);
    const [step] = getFrameRelations({ workspaceForest: forest, change: { details: { derivationStageRelations: [original] } } });
    assert.deepEqual(step.anchors, equivalents);
    for (const anchor of step.resolvedAnchors) {
      const binding = result.tier1Dispatch.roleBindings.find(b => b.authoredRole === (anchor.authoredRole || anchor.role));
      assert.equal(anchor.role, binding?.role || anchor.authoredRole || anchor.role);
      assert.ok(Object.hasOwn(equivalents, anchor.authoredRole || anchor.role));
    }
    assert.deepEqual(original, untouched);
  });
}

test('all registered role spellings preserve their exact signature requirements', () => {
  let checks = 0;
  for (const entry of productionRelationRegistry.entries) {
    const rules = { ...entry.signature.anchors.required, ...entry.signature.anchors.optional };
    // Exercise one role at a time, including incomplete signatures. Normalizing
    // its spelling must neither fill other requirements nor change arity.
    for (const [role, rule] of Object.entries(rules)) {
      const spaced = role.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
      for (const spelling of [spaced.toUpperCase(), spaced.replaceAll(' ', '_'), spaced.replaceAll(' ', '-')]) {
        const ids = Array.from({ length: rule.minItems }, (_, i) => `node${i}`);
        const value = rule.maxItems === 1 ? ids[0] : ids;
        const canonical = tier1({ relation: entry.identities[0].name, anchors: { [role]: value } });
        const variant = tier1({ relation: entry.identities[0].name, anchors: { [spelling]: value } });
        assert.equal(variant.outcome, canonical.outcome, `${entry.id}.${spelling}`);
        assert.deepEqual(variant.boundRelation.anchors, canonical.boundRelation.anchors, `${entry.id}.${spelling}`);
        checks++;
      }
    }
  }
  assert.ok(checks > 600);
});

test('Tier 1 still requires the whole Control drawing and does not salvage its connector', () => {
  const result = dispatch({ relation: 'Control', anchors: { controlSource: 'a', controlledSubject: 'b' } });
  assert.equal(result.primaryClaim.tier, 3);
  assert.ok(result.tier1Dispatch.signatureIssues.some(i => i.kind === 'missing-role' && i.role === 'domain'));
  assert.equal(result.facets.some(f => f.recipe.id.includes('control')), false);
});

test('unknown names remain unknown, even with familiar roles', () => {
  const result = dispatch({ relation: 'An unfamiliar claim', anchors: { controlSource: 'a', controlledSubject: 'b', localDomain: 'domain' } });
  assert.equal(result.tier1Dispatch.outcome, 'unregistered');
  assert.ok(result.claims.every(c => c.tier !== 1));
});

test('conflicting aliases fail independent of property order and preserve both references', () => {
  for (const anchors of [{ assigner: 'a', featureSource: 'c', bearer: 'b' }, { featureSource: 'c', bearer: 'b', assigner: 'a' }]) {
    const result = dispatch({ relation: 'CaseAssignment', anchors });
    assert.equal(result.primaryClaim.tier, 3);
    assert.ok(result.tier1Dispatch.signatureIssues.some(i => i.kind === 'conflicting-role-bindings'));
    assert.deepEqual(result.primaryRelation.anchors, anchors);
  }
});

test('an equivalent role does not hide invalid cardinality or a missing paired witness', () => {
  const tooMany = dispatch({ relation: 'CaseAssignment', anchors: { featureSource: ['a', 'c'], valuedNode: 'b' } });
  assert.equal(tooMany.primaryClaim.tier, 3);
  const paired = dispatch({ relation: 'AcrossTheBoardMovement', anchors: { inputSet: ['a', 'b'], lowerTrace: ['a'], destination: 'c' } });
  assert.equal(paired.primaryClaim.tier, 3);
});

test('a role with two different meanings never selects the first candidate', () => {
  for (const anchors of [{ filler: 'a', trace: 'b' }, { trace: 'b', filler: 'a' }]) {
    const result = dispatch({ relation: 'ParasiticGap', anchors });
    assert.equal(result.primaryClaim.tier, 3);
    assert.ok(result.tier1Dispatch.signatureIssues.some(i => i.kind === 'ambiguous-role-binding' && i.role === 'trace'));
  }
});

test('a phase head is not silently treated as its containing projection', () => {
  const result = dispatch({ relation: 'Phase', anchors: { phaseHead: 'a' } });
  assert.equal(result.primaryClaim.tier, 3);
  assert.deepEqual(result.boundPrimaryRelation.anchors, { phaseHead: 'a' });
  const unknown = dispatch({ relation: 'An unfamiliar claim', anchors: { phaseHead: 'a' } });
  assert.equal(unknown.facets.some(f => f.recipe.id === 'phase.domain'), false);
});

test('a bound primary does not absorb an independently complete verdict', () => {
  const result = dispatch({ relation: 'CaseAssignment', anchors: { featureSource: 'a', valuedNode: 'b', analysis: 'domain' }, values: { judgment: '*', label: 'case' } });
  assert.equal(result.primaryClaim.tier, 1);
  assert.ok(result.claims.some(c => c.tier === 2));
  assert.deepEqual(result.primaryRelation.anchors, { featureSource: 'a', valuedNode: 'b' });
});

test('Case and Agree composition uses bound roles without changing ownership', () => {
  const canonical = [{ relation: 'CaseAssignment', anchors: { assigner: 'a', bearer: 'b' } }, { relation: 'Agree', anchors: { probe: 'b', goal: 'c' } }];
  const variants = [{ relation: 'CaseAssignment', anchors: { featureSource: 'a', valuedNode: 'b' } }, { relation: 'Agree', anchors: { searcher: 'b', agreeGoal: 'c' } }];
  const plan = compileRelationRenderPlan([stage(variants)]);
  assert.deepEqual(geometry(plan), geometry(compileRelationRenderPlan([stage(canonical)])));
  const collection = plan.frames[0].items.find(i => i.pathStyle === 'case-agree');
  assert.equal(collection.relationRef.relationIndex, 1);
  assert.deepEqual(collection.relationRef.anchors, variants[1].anchors);
});

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
test('saved Astra head context is accepted only when its extra anchors identify the actual host and complex', () => {
  const c = saved.find(c => c.name === 'astra-minimalism');
  const current = c.derivationStages[5];
  const original = current.relations[0];
  for (const role of ['attractingHead', 'complexHead']) {
    const relation = structuredClone(original);
    relation.anchors[role] = 'raisedT';
    const result = dispatchRelationClaims({ relation, currentForest: current.workspaceForest, stageIndex: 5, relationIndex: 0 });
    assert.equal(result.primaryClaim.tier, 3);
    assert.ok(result.tier1Dispatch.signatureIssues.some(i => i.kind === 'head-context-unproven' && i.role === role));
  }
});

test('Replay recovers unfamiliar movement wording from the same vocabulary', () => {
  const c = saved.find(c => c.name === 'fable-minimalism');
  const result = recoverMovementEvidence({ relation: 'A new name', anchors: { departure: 'd_john', destination: 'd_john_hi' } }, c.derivationStages[2].workspaceForest, c.derivationStages[1].workspaceForest);
  assert.equal(result.movement?.sourceNodeId, 'd_john');
  assert.equal(result.movement?.targetNodeId, 'd_john_hi');
});

test('aliases do not take over deliberately open roles, regardless of property order', () => {
  for (const relation of [
    { relation: 'CooperStorage', anchors: { scope: 'domain', operator: 'a' } },
    { relation: 'CooperStorage', anchors: { scope: 'domain', clause: 'a', binder: 'b' } },
    { relation: 'Accord', anchors: { source: 'a', goal: 'b', exhaustifier: 'c' } },
    { relation: 'VocabularyInsertion', anchors: { terminal: 'a', word: 'b' } }
  ]) for (const anchors of [relation.anchors, Object.fromEntries(Object.entries(relation.anchors).reverse())]) {
    const result = dispatch({ ...relation, anchors });
    assert.equal(result.primaryClaim.tier, 1, JSON.stringify(result.tier1Dispatch.signatureIssues));
    assert.deepEqual(result.boundPrimaryRelation.anchors, anchors);
    assert.deepEqual(result.primaryRelation.anchors, anchors);
  }
});

test('a generic head is a landing only when the tree proves the occurrence identity', () => {
  const c = saved.find(c => c.name === 'astra-minimalism');
  const current = c.derivationStages[5];
  for (const [head, tier] of [['raisedT', 1], ['questionC', 3]]) {
    const relation = { relation: 'HeadMove', anchors: { source: 'finiteT', head } };
    const result = dispatchRelationClaims({ relation, currentForest: current.workspaceForest, stageIndex: 5, relationIndex: 0 });
    assert.equal(result.primaryClaim.tier, tier);
    if (tier === 3) assert.ok(result.tier1Dispatch.signatureIssues.some(i => i.kind === 'movement-landing-unproven'));
  }
});

test('scalar and plural alternatives retain the same one-participant drawing', () => {
  for (const role of ['goal', 'goals', 'target']) {
    const original = { relation: 'MultipleAgree', anchors: { probe: 'a', [role]: 'b' } };
    assert.equal(dispatch(original).primaryClaim.tier, 1);
    assert.deepEqual(geometry(compileRelationRenderPlan([stage([original])])),
      geometry(compileRelationRenderPlan([stage([{ relation: 'MultipleAgree', anchors: { probe: 'a', goal: 'b' } }])])));
  }
});

test('blocked extraction does not produce successful-movement diagnostics', () => {
  const relation = { relation: 'BlockedExtraction', anchors: { lowerOccurrence: 'a', landingSite: 'b', adjunctDomain: 'domain' } };
  const [step] = getFrameRelations({ workspaceForest: forest, change: { details: { derivationStageRelations: [relation] } } });
  assert.equal(step.recoveredMovement, undefined);
  assert.equal(step.movementDiagnostics, undefined);
});

const compoundRoles = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/compound-movement-roles.json', import.meta.url))).cases;
const savedClaim = (caseIndex, stageIndex, relationIndex, anchors = {}) => {
  const stages = compoundRoles[caseIndex].derivationStages, original = stages[stageIndex].relations[relationIndex];
  const relation = { ...structuredClone(original), anchors: { ...original.anchors, ...anchors } };
  return { relation, result: dispatchRelationClaims({ relation, currentForest: stages[stageIndex].workspaceForest,
    priorForest: stages[stageIndex - 1].workspaceForest, stageIndex, relationIndex }) };
};

test('a compound head field the tree proves to be host or carried context does not compete for the endpoint', () => {
  for (const [caseIndex, stageIndex, relationIndex, context] of [[0, 5, 0, ['targetHead']], [1, 4, 1, ['landingLexicalHead', 'sourceLexicalHead']]]) {
    const { relation, result } = savedClaim(caseIndex, stageIndex, relationIndex);
    const original = structuredClone(relation);
    assert.equal(result.primaryClaim.tier, 1, JSON.stringify(result.tier1Dispatch.signatureIssues));
    assert.equal(result.tier1Dispatch.roleBindings.some(binding => context.includes(binding.authoredRole)), false);
    assert.deepEqual(relation, original);
  }
  // Pointed at a head outside the landing complex, the same field is a competing landing again.
  const unrelated = savedClaim(0, 5, 0, { targetHead: 'a_pred' }).result;
  assert.equal(unrelated.primaryClaim.tier, 3);
  assert.ok(unrelated.tier1Dispatch.signatureIssues.some(issue => issue.kind === 'conflicting-role-bindings'));
  const uncarried = savedClaim(1, 4, 1, { sourceLexicalHead: 'V0' }).result;
  assert.equal(uncarried.primaryClaim.tier, 3);
  assert.ok(uncarried.tier1Dispatch.signatureIssues.some(issue => issue.kind === 'conflicting-role-bindings'
    && issue.roles.includes('sourceLexicalHead')));
});

test('a phrase\'s target head may be the complex head movement built, but only beside the landing', () => {
  const stages = compoundRoles[1].derivationStages, original = stages[5].relations[0];
  const recover = targetHead => recoverMovementEvidence({ ...original, anchors: { ...original.anchors, targetHead } },
    stages[5].workspaceForest, stages[4].workspaceForest);
  const complex = recover('ht');
  assert.deepEqual([complex.movement?.sourceNodeId, complex.movement?.targetNodeId], ['dpO1', 'dpO2']);
  assert.equal(recover('c0').failure, 'MOVEMENT_ENDPOINTS_UNRESOLVED');
});

// Subject raising as GPT-6.1 Sol wrote it in sol-120-20261026 n4-04 a1 (stage 3):
// an open-named moved nominal and trace, beside the clauses it leaves and lands in.
const raisingSubject = { id: 'committee', label: 'DP', lineageId: 'committee', children: [{ id: 'd', label: 'D', word: 'the' }, { id: 'n', label: 'N', word: 'committee' }] };
const raisingClause = subject => ({ id: 'perfectIP', label: 'IP', children: [subject, { id: 'ibar', label: "I'", children: [
  { id: 'to', label: 'I', word: 'to' }, { id: 'vp', label: 'VP', children: [{ id: 'win', label: 'V', word: 'win' }] }] }] });
const raisingMatrix = complement => ({ id: 'seemsBar', label: "I'", children: [{ id: 'seemsI', label: 'I', word: 'seems' }, complement] });
const raisingStages = anchors => [
  { statement: 'test', stageRecord: 'test', workspaceForest: [raisingMatrix(raisingClause(raisingSubject))], relations: [] },
  { statement: 'test', stageRecord: 'test', relations: [{ relation: 'A-movement', anchors,
    priorAnchors: { movedNominal: 'committee', sourceClause: 'perfectIP' }, values: { type: 'subject raising' } }],
  workspaceForest: [{ id: 'matrixIP', label: 'IP', children: [raisingSubject,
    raisingMatrix(raisingClause({ id: 'committeeTrace', label: 'DP', lineageId: 'committee', silent: true }))] }] }
];
const raisingAnchors = { movedNominal: 'committee', trace: 'committeeTrace', landingClause: 'matrixIP', sourceClause: 'perfectIP' };
const raisingClaim = stages => dispatchRelationClaims({ relation: stages[1].relations[0], currentForest: stages[1].workspaceForest,
  priorForest: stages[0].workspaceForest, stageIndex: 1, relationIndex: 0 });

test('clauses beside a proven movement are context, not its arrow\'s endpoints', () => {
  const stages = raisingStages(raisingAnchors);
  const plan = compileRelationRenderPlan(stages);
  assert.deepEqual(plan.frames[1].items.filter(item => item.kind === 'trajectory')
    .map(item => [item.claimTier, item.sourceNodeId, item.targetNodeId, item.witnessNodeId]),
  [[1, 'committeeTrace', 'committee', 'committeeTrace']]);
  assert.equal(raisingClaim(stages).tier1Dispatch.roleBindings.some(binding =>
    ['landingClause', 'sourceClause'].includes(binding.authoredRole)), false);
  assert.deepEqual(stages, raisingStages(raisingAnchors), 'the authored claim is unchanged');
  // A field naming a node that holds no endpoint still competes for the slot.
  assert.ok(raisingClaim(raisingStages({ ...raisingAnchors, sourceClause: 'vp' })).tier1Dispatch.roleBindings
    .some(binding => binding.authoredRole === 'sourceClause' && binding.concept === 'movement.source'));
});

// A registered landing word (target, landing site) naming where a proven
// movement lands, beside another field the tree proves to be the landing:
// Sol's A-movement {landingOccurrence, sourceTrace, target} (sol-parts-20261026
// n3-35-no-v2-adverb a1 4:0), Opus's wh-movement {landing, lowerCopy, target}
// (opus-parts n4-05 12:0) and {mover, trace, landingSite} (n3-28 4:0, n3-76
// 5:0), and {mover, source, target} naming the landing's sister (n3-59 2:0).
const siteSubject = (id, extra = {}) => ({ id, label: 'DP', lineageId: 'kim', word: 'Kim', ...extra });
// The preceding subject keeps its id as the landing (Sol's Kari, Opus's
// dp_whose) or as the silent lower copy (Opus's who_1).
const siteStages = (anchors, priorId = 'kimHigh') => [
  { statement: 'test', stageRecord: 'test', relations: [], workspaceForest: [{ id: 'tbar', label: "T'", children: [
    { id: 't', label: 'T', word: 'will' }, { id: 'vp', label: 'VP', children: [siteSubject(priorId), { id: 'v', label: 'V', word: 'sing' }] }] }] },
  { statement: 'test', stageRecord: 'test', relations: [{ relation: 'A-movement', anchors }], workspaceForest: [{ id: 'tp', label: 'TP', children: [
    siteSubject('kimHigh'), { id: 'tbar', label: "T'", children: [{ id: 't', label: 'T', word: 'will' },
      { id: 'vp', label: 'VP', children: [siteSubject('kimTrace', { word: undefined, silent: true }), { id: 'v', label: 'V', word: 'sing' }] }] }] }] }
];
const sitePaths = stages => compileRelationRenderPlan(stages).frames[1].items.filter(item => item.kind === 'trajectory')
  .map(item => [item.claimTier, item.sourceNodeId, item.targetNodeId]);
const siteClaim = stages => dispatchRelationClaims({ relation: stages[1].relations[0], currentForest: stages[1].workspaceForest,
  priorForest: stages[0].workspaceForest, stageIndex: 1, relationIndex: 0 });

test('a registered landing word naming a proven movement\'s site is context, not a second landing', () => {
  for (const [anchors, priorId] of [
    [{ landing: 'kimHigh', lowerCopy: 'kimTrace', target: 'tp' }],
    [{ landingOccurrence: 'kimHigh', sourceTrace: 'kimTrace', target: 'tp' }],
    [{ mover: 'kimHigh', trace: 'kimTrace', landingSite: 'tp' }],
    [{ mover: 'kimHigh', source: 'kimTrace', target: 'tbar' }, 'kimTrace']
  ]) {
    const stages = siteStages(anchors, priorId), authored = structuredClone(stages);
    assert.deepEqual(sitePaths(stages), [[1, 'kimTrace', 'kimHigh']], JSON.stringify(anchors));
    assert.equal(siteClaim(stages).tier1Dispatch.roleBindings.some(binding => ['target', 'landingSite'].includes(binding.authoredRole)), false);
    assert.deepEqual(stages, authored, 'the authored claim is unchanged');
  }
  // Pointed at a node that is not where the landing went, it competes for the slot again.
  for (const anchors of [{ landing: 'kimHigh', lowerCopy: 'kimTrace', target: 'v' }, { mover: 'kimHigh', trace: 'kimTrace', landingSite: 'vp' }]) {
    const stages = siteStages(anchors);
    assert.equal(sitePaths(stages).some(([tier, , target]) => tier === 1 && target === 'kimHigh'), false, JSON.stringify(anchors));
  }
  const conflicting = siteClaim(siteStages({ landing: 'kimHigh', lowerCopy: 'kimTrace', target: 'v' }));
  assert.equal(conflicting.primaryClaim.tier, 3);
  assert.ok(conflicting.tier1Dispatch.signatureIssues.some(issue => issue.kind === 'conflicting-role-bindings'));
});

// Opus's head movement {mover, trace, target} (opus-parts n3-68 6:0): `target`
// names the I head the verb adjoins to, beside an openly named landing.
test('a registered landing word naming a head movement\'s host binds as that host beside an open landing', () => {
  const stages = [
    { statement: 'test', stageRecord: 'test', relations: [], workspaceForest: [{ id: 'ibar', label: "I'", children: [
      { id: 'iHead', label: 'I' }, { id: 'vp', label: 'VP', children: [{ id: 'are', label: 'V', word: 'are', lineageId: 'verb' }] }] }] },
    { statement: 'test', stageRecord: 'test', relations: [{ relation: 'head movement', anchors: { mover: 'are', trace: 'verbTrace', target: 'iHead' } }],
      workspaceForest: [{ id: 'ibar', label: "I'", children: [{ id: 'iComplex', label: 'I', children: [
        { id: 'are', label: 'V', word: 'are', lineageId: 'verb' }, { id: 'iHead', label: 'I' }] },
      { id: 'vp', label: 'VP', children: [{ id: 'verbTrace', label: 'V', lineageId: 'verb', silent: true }] }] }] }
  ];
  assert.deepEqual(sitePaths(stages), [[1, 'verbTrace', 'are']]);
  assert.ok(siteClaim(stages).tier1Dispatch.roleBindings.some(binding => binding.authoredRole === 'target' && binding.role === 'hostHead'));
});

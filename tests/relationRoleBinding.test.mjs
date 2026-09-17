import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dispatchRelation, productionRelationRegistry } from '../replay/relationDispatch/index.js';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { getFrameRelations } from '../replay/replayCompiler.ts';
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

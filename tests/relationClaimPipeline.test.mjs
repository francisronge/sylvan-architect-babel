import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTier2FacetEvidence, dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { compileTier2RelationOutputs } from '../replay/relations/tier2RenderPlanCompiler.ts';
import { buildTier2SynonymIndex } from '../replay/relations/tier2Synonyms.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';

const leaf = (id, extra = {}) => ({ id, label: 'D', word: id, ...extra });
const node = (id, children, extra = {}) => ({ id, label: 'XP', children, ...extra });
const forest = [node('root', [leaf('controller'), node('domain', [leaf('subject'), leaf('a'), leaf('b')]), leaf('extra')])];
const record = (anchors, values, relation = 'Open relation') => ({ relation, anchors, ...(values ? { values } : {}) });
const stage = (workspaceForest, relations = []) => ({ statement: 'State', stageRecord: 'The authored state.', workspaceForest, relations });
const inspect = (relation, currentForest = forest, priorForest) => {
  const original = structuredClone(relation);
  const stages = [...(priorForest ? [stage(priorForest)] : []), stage(currentForest, [relation])];
  const dispatch = dispatchRelationClaims({ relation, currentForest, priorForest, stageIndex: stages.length - 1, relationIndex: 0 });
  const plan = compileRelationRenderPlan(stages);
  assert.deepEqual(relation, original);
  return { dispatch, plan, items: plan.frames.at(-1).items, facets: dispatch.facets.map(f => f.recipe.id) };
};
const covertSource = node('source', [leaf('source-word')], { lineageId: 'q' });
const covertTarget = node('target', [leaf('target-word', { silent: true })], { lineageId: 'q', silent: true });
const prior = [node('clause', [covertSource, leaf('predicate')])];
const current = [node('scope-root', [covertTarget, prior[0]])];

const smaller = [
  { id: 'control.dependency', anchors: { controller: 'controller', controlledSubject: 'subject' },
    domainKey: 'domain', domain: 'domain', absent: 'Rectangular domain', present: 'Control connector', tree: forest },
  { id: 'idiom.chunks', anchors: { idiomChunks: ['a', 'b'] },
    domainKey: 'idiomDomain', domain: 'domain', absent: 'Domain bracket', present: 'Underline', tree: forest },
  { id: 'scope.movement', anchors: { source: 'source', covertLanding: 'target' },
    domainKey: 'scopeDomain', domain: 'scope-root', absent: 'Scope domain', present: 'Covert path', tree: current },
  { id: 'transfer.domain', anchors: { transferredDomain: 'domain' },
    domainKey: 'phase', domain: 'root', present: 'Transfer arcs', tree: forest }
];

for (const c of smaller) {
  test(`${c.id}: an independent smaller claim stays Tier 2 and preserves the exact anchors`, () => {
    const result = inspect(record(c.anchors), c.tree);
    assert(result.facets.includes(c.id));
    assert(result.dispatch.claims.every(claim => claim.tier === 2));
    const items = result.items.filter(item => item.tier2FacetId === c.id);
    assert(items.some(item => item.tier2OutputPieces.includes(c.present)));
    assert(!items.some(item => item.tier2OutputPieces.includes(c.absent)));
    assert(!items.some(item => item.kind === 'domain-mark'));
    assert(items.every(item => item.tier2OutputIdentities.length));
    assert(inspect(record({ ...c.anchors, [c.domainKey]: c.domain }), c.tree).facets.includes(c.id));
  });

  test(`${c.id}: absent and malformed optional evidence are different`, () => {
    for (const bad of ['', [], 'missing-node', ['missing-node'], 'extra']) {
      const result = inspect(record({ ...c.anchors, [c.domainKey]: bad }), c.tree);
      assert(!result.facets.includes(c.id), `${JSON.stringify(bad)} was silently ignored`);
      assert(result.dispatch.claims.some(claim => claim.tier === 3));
      assert.deepEqual(result.dispatch.evidence.authoredCurrentAnchors.find(entry => entry.key === c.domainKey).items,
        Array.isArray(bad) ? bad : [bad]);
      assert(result.dispatch.facetDiagnostics.some(d => d.facetId === c.id));
    }
  });

  test(`${c.id}: relation naming and field order cannot decide the drawing`, () => {
    const base = inspect(record(c.anchors), c.tree);
    for (const name of ['Unfamiliar claim', 'This title mentions Control, Transfer and movement']) {
      const reversed = Object.fromEntries(Object.entries(c.anchors).reverse());
      const result = inspect(record(reversed, undefined, name), c.tree);
      assert.deepEqual(result.facets, base.facets);
      assert.deepEqual(result.dispatch.facets.map(f => f.outputIdentities), base.dispatch.facets.map(f => f.outputIdentities));
    }
  });
}

test('generic aliases and lineage alone cannot establish Control, idiom, covert movement or Transfer', () => {
  for (const [anchors, tree, forbidden] of [
    [{ antecedent: 'controller', silentSubject: 'subject', domain: 'domain' }, forest, 'control.dependency'],
    [{ chunks: ['a', 'b'], domain: 'domain' }, forest, 'idiom.chunks'],
    [{ cointerpretedChunks: ['a', 'b'] }, forest, 'idiom.chunks'],
    [{ source: 'source', target: 'target', scopeDomain: 'scope-root' }, current, 'scope.movement'],
    [{ pronouncedQP: 'source', lfQP: 'target' }, current, 'scope.movement'],
    [{ phase: 'root', complement: 'domain', edge: 'controller' }, forest, 'transfer.domain']
  ]) {
    const result = inspect(record(anchors), tree);
    assert(!result.facets.includes(forbidden));
    assert(result.dispatch.claims.some(claim => claim.tier === 3));
    assert(result.dispatch.facetDiagnostics.some(d => d.facetId === forbidden && d.failures.some(f => f.startsWith('meaning:'))));
  }
});

test('the smaller recipe never repairs an incomplete registered Tier 1 claim', () => {
  for (const [name, anchors, id, tree] of [
    ['Control', { controller: 'controller', controllee: 'subject' }, 'control.dependency', forest],
    ['IdiomChunkCointerpretation', { chunks: ['a', 'b'] }, 'idiom.chunks', forest],
    ['TransferDomain', { transferredDomain: 'domain' }, 'transfer.domain', forest]
  ]) {
    const result = inspect(record(anchors, undefined, name), tree);
    assert.equal(result.dispatch.tier1Dispatch.outcome, 'signature-incomplete', name);
    assert(!result.facets.includes(id));
    assert.equal(result.dispatch.primaryClaim.tier, 3);
  }
});

test('distinct idiom groups and competing paired arrays are not silently concatenated', () => {
  for (const anchors of [
    { idiomChunks: ['a', 'b'], idiomaticChunks: ['subject', 'extra'] },
    { predicate: 'controller', arguments: ['a'], thematicArguments: ['b'] }
  ]) {
    const result = inspect(record(anchors, { thetaRole: ['Agent', 'Theme'] }));
    assert(!result.facets.includes('idiom.chunks'));
    assert(!result.facets.includes('theta-grid'));
    assert.deepEqual(result.dispatch.primaryRelation.anchors, anchors);
  }
  assert(inspect(record({ idiomChunks: ['a', 'b'], idiomaticChunks: ['a', 'b'] })).facets.includes('idiom.chunks'));
  const unpaired = inspect(record({ predicate: 'controller', arguments: ['a', 'b'] }, { thetaRole: ['Agent'], roles: ['Theme'] }));
  assert(!unpaired.facets.includes('theta-grid'));
  assert.deepEqual(unpaired.dispatch.primaryRelation.values, { thetaRole: ['Agent'], roles: ['Theme'] });
});

test('different alias groups cannot earn one identity drawing or a partial rescue', () => {
  for (const copies of [['subject', 'extra'], ['b', 'a'], ['a', 'b', 'b']]) {
    const anchors = { occurrences: ['a', 'b'], copies, accessibleSubject: 'controller' };
    for (const entries of [Object.entries(anchors), Object.entries(anchors).reverse()]) {
      const relation = record(Object.fromEntries(entries));
      const result = inspect(relation);
      assert.deepEqual(result.dispatch.evidence.currentAnchors.occurrences, []);
      assert(!result.facets.includes('identity.occurrences'));
      assert(result.facets.includes('phase.edge'));
      assert(result.dispatch.claims.some(claim => claim.tier === 3));
      for (const key of ['occurrences', 'copies']) {
        const field = result.dispatch.evidenceCoverage.fields.find(field => field.key === key);
        assert.deepEqual(field.unrecoveredItemIndices, relation.anchors[key].map((_, i) => i));
      }
      const failure = result.dispatch.facetDiagnostics.find(d => d.facetId === 'identity.occurrences');
      assert(failure.failures.some(f => f.startsWith('ambiguous-group:anchors:occurrences:')));
      assert(failure.failures.some(f => f.includes('copies') && f.includes('occurrences')));
      assert(!failure.failures.some(f => f.includes('missing-or-empty')), 'present but conflicting lists are not missing fields');
    }
  }
});

test('equivalent aliases preserve one ordered group, without losing repeated items in the evidence', () => {
  const relation = record({ occurrences: ['a', 'b'], copies: ['a', 'b'] });
  const result = inspect(relation);
  assert(result.facets.includes('identity.occurrences'));
  assert.deepEqual(result.dispatch.evidence.currentAnchors.occurrences, ['a', 'b']);
  for (const items of [['a', 'b', 'a'], ['b', 'a']]) {
    const evidence = buildTier2FacetEvidence({ relation: record({ occurrences: items, copies: items }), currentForest: forest });
    assert.deepEqual(evidence.currentAnchors.occurrences, items);
    assert.deepEqual(evidence.authoredCurrentAnchors.map(entry => entry.items), [items, items]);
  }
});

test('conflicting lists stay separate in prior anchors and literal values too', () => {
  const relation = {
    ...record({ terminal: 'a' }, { thetaRole: ['Agent', 'Theme'], roles: ['Goal', 'Source'] }),
    priorAnchors: { source: ['a', 'b'], origin: ['subject', 'extra'] }
  };
  const evidence = buildTier2FacetEvidence({ relation, currentForest: forest, priorForest: forest });
  assert.deepEqual(evidence.priorAnchors['movement.source'], []);
  assert.deepEqual(evidence.values['role.label'], []);
  assert.deepEqual(evidence.authoredPriorAnchors.map(entry => entry.items), [['a', 'b'], ['subject', 'extra']]);
  assert.deepEqual(evidence.authoredValues.map(entry => entry.items), [['Agent', 'Theme'], ['Goal', 'Source']]);
});

test('separately named accessible participants still earn their independent outlines', () => {
  const result = inspect(record({ accessibleWhOccurrence: ['a', 'b'], accessibleSubject: 'subject' }));
  assert.deepEqual(result.dispatch.evidence.currentAnchors['phase.edge'], ['a', 'b', 'subject']);
  assert(result.facets.includes('phase.edge'));
  assert(result.dispatch.claims.every(claim => claim.tier === 2));
  assert.deepEqual(result.dispatch.evidenceCoverage.fields.map(field => field.unrecoveredItemIndices), [[], []]);
});

test('prior and current order columns keep their different meanings and original rows', () => {
  // Orders are node lists: current in anchors, prior in priorAnchors. Babel
  // renders the precedence rows from them; it never parses order text.
  const relation = { ...record({ order: ['b', 'a'] }), priorAnchors: { order: ['a', 'b'] } };
  const result = inspect(relation, forest, forest);
  assert(result.facets.includes('pf.linearization'));
  const content = result.items.find(item => item.nativeContent?.kind === 'linearization').nativeContent;
  assert.deepEqual(content.priorRows, ['a < b']);
  assert.deepEqual(content.currentRows, ['b < a']);
  const conflicting = inspect({ ...relation, priorAnchors: { order: ['a', 'b'], 'precedence order': ['b', 'a'] } }, forest, forest);
  assert(!conflicting.facets.includes('pf.linearization'));
  assert(conflicting.dispatch.facetDiagnostics.some(d => d.facetId === 'pf.linearization'
    && d.failures.some(f => f.startsWith('ambiguous-group:priorAnchors:order:'))));
});

test('literal plaques keep independent field names and lists without inventing pairings', () => {
  const relation = record({ realizationHost: 'a' }, { tense: ['past', 'past'], exponent: 'did' });
  const result = inspect(relation);
  assert(result.facets.includes('pf.structured'));
  const plaque = result.items.find(item => item.tier2FacetId === 'pf.structured');
  assert.deepEqual(plaque.rows, [
    { label: 'tense', value: 'past' }, { label: 'tense', value: 'past' }, { label: 'exponent', value: 'did' }
  ]);
  const changed = inspect(record({ realizationHost: 'a' }, { realization: ['past', 'past'], exponent: 'did' }));
  assert.notEqual(result.dispatch.facets.find(f => f.recipe.id === 'pf.structured').facetIdentity,
    changed.dispatch.facets.find(f => f.recipe.id === 'pf.structured').facetIdentity,
    'different literal field meanings must not collapse to the same drawing identity');
});

test('one envelope keeps complete Tier 1, independent Tier 2 and unknown Tier 3 content', () => {
  const relation = record({ probe: 'a', goal: 'b', transferredDomain: 'domain', unexplainedParticipant: ['extra', 'extra'] },
    { note: 'Keep this exact wording.' }, 'Agree');
  const result = inspect(relation);
  assert.deepEqual(result.dispatch.claims.map(claim => claim.tier), [1, 2, 3]);
  const residual = result.items.find(item => item.kind === 'fallback');
  assert.deepEqual(residual.relationRef.anchors, { unexplainedParticipant: ['extra', 'extra'] });
  assert(result.items.some(item => item.claimTier === 1));
  assert.equal(JSON.parse(result.dispatch.primaryClaim.canonicalClaimIdentity).anchors.unexplainedParticipant, undefined);
  assert(result.items.filter(item => item.claimTier === 1).every(item => item.relationRef.anchors.unexplainedParticipant === undefined));
  assert(result.items.some(item => item.tier2FacetId === 'transfer.domain'));
  assert.equal(result.dispatch.primaryRelation.values.note, relation.values.note);
  for (const key of Object.keys(relation.anchors)) {
    const owners = result.dispatch.claims.filter(claim => claim.consumedEvidence.some(ref => ref.field === 'anchors' && ref.key === key));
    assert.equal(owners.length, 1, `wrong ownership for ${key}`);
  }
});

test('lowering uses the accepted interpretation instead of looking up roles again', () => {
  const synonymIndex = buildTier2SynonymIndex();
  synonymIndex.set('test participant', [{ scope: 'role', concept: 'plaque.anchor' }]);
  const relation = record({ 'test participant': 'a' }, { rows: 'Literal content' });
  const dispatch = dispatchRelationClaims({ relation, currentForest: forest, stageIndex: 0, relationIndex: 0, synonymIndex });
  const result = compileTier2RelationOutputs({ dispatch, currentForest: forest, relationRef: { ...relation, stageIndex: 0, relationIndex: 0 } });
  assert.deepEqual(result.items.find(item => item.kind === 'node-plaque').anchorNodeIds, ['a']);
});

test('covert drawing and Replay agree on the authored landing moment without an overt arrow', () => {
  const relation = record({ source: 'source', covertLanding: 'target' });
  const result = inspect(relation, current, prior);
  assert.deepEqual(result.dispatch.facets.find(f => f.recipe.id === 'scope.movement').evaluation.earnedTransitions, ['movement']);
  const { steps } = buildReplayPlayback({ sentence: 'test', analyses: [{ derivationStages: [stage(prior), stage(current, [relation])] }] });
  const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1 && s.replayRelationIdentity.relationIndex === 0);
  assert(moment > 0);
  assert(!steps.slice(0, moment).some(s => s.replayVisibleNodeIds.includes('target')));
  assert(steps[moment].replayVisibleNodeIds.includes('target'));
  assert(steps[moment].replayVisibleNodeIds.includes('scope-root'));
  assert(!steps[moment].replayRelationLinks.some(link => link.renderFamily === 'trajectory'));
  assert.equal(result.items.find(item => item.kind === 'quantifier-raising').scopeDomainNodeId, undefined);
  assert.deepEqual(inspect(relation, current, current).dispatch.facets.find(f => f.recipe.id === 'scope.movement').evaluation.earnedTransitions, []);
  const conflict = inspect({ ...relation, priorAnchors: { source: 'predicate' } }, current, prior);
  assert(!conflict.facets.includes('scope.movement'));
  assert.deepEqual(conflict.dispatch.primaryRelation.priorAnchors, { source: 'predicate' });
  assert(conflict.plan.diagnostics.some(d => d.candidateFailures?.some(candidate => candidate.facetId === 'scope.movement'
    && candidate.failures.some(failure => failure.includes('predicate') && failure.includes('conflicts-with-current-source')))));
});

test('a residual fallback never borrows backward witnesses from its Tier 1 neighbour', () => {
  const relation = { ...record({ probe: 'a', goal: 'b', unexplained: 'controller' }, undefined, 'Agree'), priorAnchors: { probe: 'a' } };
  const result = inspect(relation, forest, forest);
  const fallback = result.items.find(item => item.kind === 'fallback');
  assert.equal(fallback.backward, false);
  assert.deepEqual(fallback.priorWitnessNodeIds, []);
  assert.equal(fallback.relationRef.priorAnchors, undefined);
});

test('previous-stage witnesses stay attached to the covert claim and unresolved witnesses cannot prove continuity', () => {
  const relation = record({ source: 'source', covertLanding: 'target' });
  const continuing = inspect({ ...relation, priorAnchors: { covertLanding: 'target' } }, current, current);
  const facet = continuing.dispatch.facets.find(f => f.recipe.id === 'scope.movement');
  assert.deepEqual(facet.evaluation.earnedTransitions, []);
  assert.equal(JSON.parse(facet.facetIdentity).priorAnchors['scope.landing'][0].id, 'target');
  assert.deepEqual(continuing.items.find(item => item.kind === 'quantifier-raising').priorWitnessNodeIds, ['target']);

  for (const key of ['covertLanding', 'scopeDomain']) {
    const incomplete = inspect({ ...relation, priorAnchors: { [key]: 'missing-prior-node' } }, current, prior);
    const item = incomplete.items.find(item => item.kind === 'quantifier-raising');
    assert.deepEqual(item.relationRef.priorAnchors, { [key]: 'missing-prior-node' });
    assert.equal(item.backward, false);
    assert.deepEqual(item.priorWitnessNodeIds, []);
    assert.equal(item.replacementPredecessorGroup, undefined);
    assert(incomplete.plan.diagnostics.some(d => d.stageIndex === 1 && d.relationIndex === 0
      && d.kind === 'prior-anchor-unresolved' && d.detail.includes(`${key} -> missing-prior-node`)));
  }
});

test('open Tier 1 prior witnesses remain literal payload, not a new current-stage facet', () => {
  for (const id of ['controller', 'missing-prior-node']) {
    const relation = { ...record({ probe: 'a', goal: 'b' }, undefined, 'Agree'), priorAnchors: { earlierWitness: id } };
    const result = inspect(relation, forest, forest);
    assert.deepEqual(result.dispatch.claims.map(claim => claim.tier), [1]);
    assert.deepEqual(JSON.parse(result.dispatch.primaryClaim.canonicalClaimIdentity).priorAnchors, relation.priorAnchors);
    assert(result.items.filter(item => item.claimTier === 1).every(item =>
      JSON.stringify(item.relationRef.priorAnchors) === JSON.stringify(relation.priorAnchors)));
    if (id === 'missing-prior-node') {
      assert(result.items.every(item => !item.backward));
      assert(result.plan.diagnostics.some(d => d.kind === 'prior-anchor-unresolved'
        && d.detail.includes('earlierWitness -> missing-prior-node')));
    }
  }
});

test('every leftover field keeps its complete authored context and original array positions', () => {
  const relation = record({ judgedAnchor: 'a', unknownParticipant: 'b' }, { outcome: ['blocked', 'model qualification', 'other qualification'] });
  const result = inspect(relation);
  const coverage = result.dispatch.evidenceCoverage;
  assert.deepEqual(coverage.authoredRelation, relation);
  const outcomes = coverage.fields.find(f => f.field === 'values' && f.key === 'outcome');
  assert.deepEqual(outcomes.unrecoveredItemIndices, [1, 2]);
  assert(outcomes.recognizedBy.some(owner => owner.itemIndices.includes(0)));
  const leftover = result.dispatch.claims.find(c => c.tier === 3);
  assert.deepEqual(leftover.consumedEvidence.find(ref => ref.field === 'values' && ref.key === 'outcome').itemIndices, [1, 2]);
  const diagnostic = result.plan.diagnostics.find(d => d.kind === 'claim-evidence');
  assert.deepEqual(diagnostic.evidenceCoverage, coverage);
  assert.match(diagnostic.detail, /anchors.unknownParticipant: no supported field meaning/);
});

test('Tier 1 context and an independent Tier 2 literal both keep their original array positions', () => {
  const relation = record({ probe: 'a', goal: 'b', judgedAnchor: 'controller' },
    { outcome: ['blocked', 'qualification retained by the primary'] }, 'Agree');
  const result = inspect(relation);
  const entry = result.dispatch.evidenceCoverage.fields.find(f => f.field === 'values' && f.key === 'outcome');
  assert.deepEqual(entry.recognizedBy.find(owner => owner.tier === 1).itemIndices, [1]);
  assert.deepEqual(entry.recognizedBy.find(owner => owner.tier === 2).itemIndices, [0]);
  assert.deepEqual(entry.unrecoveredItemIndices, []);
  assert.deepEqual(result.dispatch.claims.find(c => c.tier === 1).consumedEvidence.find(ref => ref.key === 'outcome').itemIndices, [1]);
});

test('independent Tier 2 judgments cannot remove the outcome used by the registered primary', () => {
  for (const outcome of ['blocked', 'licensed']) {
    for (const key of ['outcome', 'status', 'result', 'judgment']) {
      const relation = record({ binder: 'controller', bound: 'subject', domain: 'root', judgedAnchor: 'extra' }, { [key]: outcome }, 'Binding');
      const result = inspect(relation);
      assert.equal(result.dispatch.primaryRelation.values[key], outcome);
      assert(result.items.some(item => item.kind === 'binding-domain' && item.outcome === (outcome === 'blocked' ? 'failed' : 'licensed')));
      const field = result.dispatch.evidenceCoverage.fields.find(f => f.key === key);
      assert.deepEqual(field.recognizedBy.map(owner => owner.tier), [1, 2]);
      assert.deepEqual(field.unrecoveredItemIndices, []);
    }
  }
});

test('operator-variable roles do not also invent a second Binding claim', () => {
  const relation = record({ operator: 'controller', variable: 'subject', domain: 'root', lexicalGovernor: 'extra' });
  const result = inspect(relation);
  assert(!result.facets.includes('binding.dependency'));
  assert(result.facets.includes('operator-binding'));
  const coverage = result.dispatch.evidenceCoverage;
  assert.deepEqual(coverage.authoredRelation.anchors, relation.anchors);
  const operator = coverage.fields.find(f => f.key === 'operator');
  assert(!operator.recognizedBy.some(owner => owner.claim === 'binding.dependency'));
  assert(operator.recognizedBy.some(owner => owner.claim === 'operator-binding'));
  assert.deepEqual(coverage.fields.find(f => f.key === 'lexicalGovernor').unrecoveredItemIndices, [0]);
});

test('ambiguous binding meanings stay neutral while an independent outline and diagnostics survive', () => {
  const relation = record({ binder: 'controller', variable: 'subject', domain: 'root', accessibleSubject: 'extra' });
  const result = inspect(relation);
  assert(!result.facets.includes('binding.dependency'));
  assert(!result.facets.includes('operator-binding'));
  assert(result.facets.includes('phase.edge'));
  assert(result.plan.diagnostics.some(d => d.kind === 'tier2-collision' && d.detail.includes('binding-or-operator-reading')));
  for (const key of ['binder', 'variable', 'domain']) {
    assert.deepEqual(result.dispatch.evidenceCoverage.fields.find(f => f.key === key).unrecoveredItemIndices, [0]);
  }
});

for (const [id, name, anchors, blockingKey, blockingAlias] of [
  ['transfer.access', 'PostTransferAccess', { source: 'controller', target: 'a', transferredDomain: 'domain' }, 'target', 'inaccessibleGoal'],
  ['intervention', 'Intervention', { probe: 'controller', target: 'a', intervener: 'b' }, 'intervener', 'blocker'],
  ['blocked-extraction', null, { source: 'a', target: 'controller', adjunctDomain: 'domain' }, 'adjunctDomain', 'blockedDomain']
]) {
  test(`${id}: geometry alone cannot assert failure, but authored blocking roles and outcomes can`, () => {
    for (const relationName of ['Unfamiliar relation', ...(name ? [name] : [])]) {
      const absent = inspect(record(anchors, undefined, relationName));
      assert(!absent.facets.includes(id));
      assert(absent.dispatch.claims.some(c => c.tier === 3));
      assert(!absent.items.some(item => item.kind === 'blocked-access-lane'
        || (item.kind === 'directed-path' && ['intervention', 'blocked-extraction'].includes(item.pathStyle))));
      for (const outcome of ['blocked', 'prevented', 'unlicensed']) {
        const supported = inspect(record(anchors, { status: outcome }, relationName));
        assert(supported.facets.includes(id) || supported.dispatch.primaryClaim?.tier === 1);
      }
      const explicit = Object.fromEntries(Object.entries(anchors).map(([key, value]) => [key === blockingKey ? blockingAlias : key, value]));
      const supported = inspect(record(explicit, undefined, relationName));
      assert(supported.facets.includes(id) || supported.dispatch.primaryClaim?.tier === 1);
      for (const outcome of ['licensed', 'allowed', 'not blocked']) {
        const conflicting = inspect(record(explicit, { outcome }, relationName));
        assert(!conflicting.facets.includes(id), `${relationName}: ${outcome}`);
        assert.notEqual(conflicting.dispatch.primaryClaim?.tier, 1);
      }
    }
  });
}

test('unknown, missing, empty and prior-only evidence have inspectable fallback diagnostics', () => {
  for (const relation of [
    record({ neverSeenRole: 'a' }),
    record({ controller: 'controller' }),
    record({ neverSeenRole: [] }),
    record({}, { note: 'Literal context with no drawable anchor.' }),
    { ...record({}), priorAnchors: { witness: 'a' } }
  ]) {
    const result = inspect(relation);
    const diagnostic = result.plan.diagnostics.find(d => d.kind === 'claim-evidence');
    assert(diagnostic, JSON.stringify(relation));
    assert.deepEqual(diagnostic.evidenceCoverage.authoredRelation, relation);
    assert.equal(result.plan.diagnostics.filter(d => d.kind === 'claim-evidence').length, 1);
    assert.deepEqual(diagnostic.candidateFailures, result.dispatch.facetDiagnostics);
    if (relation.anchors.controller) assert(result.dispatch.facetDiagnostics.some(d =>
      d.facetId === 'control.dependency' && d.failures.some(f => f.includes('controllee'))));
  }
});

test('Transfer follows an authored head through its own projection, not through unrelated ancestors', () => {
  for (const category of ['C', 'v', 'P', 'Z']) {
    const head = node('head', [], { label: category });
    const complement = node('complement', [leaf('object')], { label: 'TP' });
    const tree = [node('projection', [leaf('edge1'), node('inner', [leaf('edge2'),
      node('core', [node('complex', [leaf('raised'), head], { label: category }), complement], { label: `${category}'` })
    ], { label: `${category}P` })], { label: `${category}P` })];
    const relation = record({ phaseHead: 'head', transferredDomain: 'complement', accessibleDPs: ['edge1', 'edge2'] });
    const good = inspect(relation, tree);
    assert(good.facets.includes('transfer.domain'), category);
    assert(good.items.some(i => i.componentLabel === 'SOD' && i.headNodeId === 'complement'));
    assert.deepEqual(good.items.filter(i => i.domainStyle === 'transfer-edge').map(i => i.rootNodeId), ['edge1', 'edge2']);
    for (const badTree of [
      [node('unrelated', [head, complement, leaf('edge1'), leaf('edge2')], { label: 'QP' })],
      [node('outer', [node('buried', [head], { label: 'NP' }), complement, leaf('edge1'), leaf('edge2')], { label: `${category}P` })],
      [node('one', [head], { label: `${category}P` }), node('two', [complement, leaf('edge1'), leaf('edge2')], { label: `${category}P` })]
    ]) {
      const bad = inspect(relation, badTree);
      assert(!bad.facets.includes('transfer.domain'), category);
      assert(bad.dispatch.facetDiagnostics.some(d => d.facetId === 'transfer.domain'
        && d.failures.some(f => f.includes('head head has no unique same-category projection with domain complement'))));
    }
    assert(!inspect(record({ phaseHead: 'head', transferredDomain: 'complement', accessibleDPs: ['object'] }), tree).facets.includes('transfer.domain'));
    assert(!inspect(record({ phaseHead: 'head', complementDomain: 'complement', accessibleDPs: ['edge1'] }), tree).facets.includes('transfer.domain'));
    const nested = [node('higherProjection', [leaf('higherEdge'), node('higherBar', [node('higherHead', [], { label: category }), tree[0]], { label: `${category}'` })], { label: `${category}P` })];
    assert(!inspect(record({ ...relation.anchors, accessibleDPs: ['higherEdge'] }), nested).facets.includes('transfer.domain'));
    assert(inspect(relation, nested).facets.includes('transfer.domain'));
  }
});

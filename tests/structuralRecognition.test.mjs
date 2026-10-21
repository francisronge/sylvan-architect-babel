import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import {
  SAFE_STRUCTURAL_RULES,
  recognizeStructurally,
  structuralRecognitionRules
} from '../replay/relations/structuralRecognition.ts';
import { structuralSignature } from '../replay/relations/structuralSignature.ts';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
// Pin structure-only recognition to its default rules, whatever the shell sets;
// assertions that need it off or named say so.
process.env.BABEL_STRUCTURAL_RECOGNITION = '1';

const leaf = (id, label, extra = {}) => ({ id, label, word: id, children: [], ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const stage = (workspaceForest, relations = []) => ({ statement: 'state', stageRecord: 'record', relations, workspaceForest });
const reading = (relation, current, prior) => recognizeStructurally(structuralSignature({ relation, currentForest: current, priorForest: prior }), relation);
const rules = (result) => result.claims.map(claim => claim.rule);
const withSwitch = (value, run) => {
  const previous = process.env.BABEL_STRUCTURAL_RECOGNITION;
  if (value === undefined) delete process.env.BABEL_STRUCTURAL_RECOGNITION;
  else process.env.BABEL_STRUCTURAL_RECOGNITION = value;
  try { return run(); } finally {
    if (previous === undefined) delete process.env.BABEL_STRUCTURAL_RECOGNITION;
    else process.env.BABEL_STRUCTURAL_RECOGNITION = previous;
  }
};

// Explicit X-bar adjunction: VP over VP and AdvP, built in this stage.
const host = () => node('vp1', 'VP', [leaf('run', 'V')]);
const adverb = () => node('adv', 'AdvP', [leaf('fast', 'Adv')]);
const adjoined = [node('vp2', 'VP', [host(), adverb()])];
const beforeAdjunction = [host(), adverb()];

test('the safe rules apply unless switched off, and the switch is read in one place', () => {
  // The fork is measured safe but stays off: structure cannot tell an adjunct from a scope domain.
  const defaults = ['identity.shared-lineage', 'plaque.single-host'];
  assert.ok(defaults.every(rule => SAFE_STRUCTURAL_RULES.includes(rule)));
  assert.deepEqual(withSwitch(undefined, () => [...structuralRecognitionRules()]), defaults);
  assert.equal(withSwitch('0', () => structuralRecognitionRules().size), 0);
  assert.deepEqual(withSwitch('1', () => [...structuralRecognitionRules()]), defaults);
  assert.deepEqual(withSwitch('fork.two-segment,unknown', () => [...structuralRecognitionRules()]), ['fork.two-segment']);
});

test('a two-segment adjunction reads as a fork whatever the relation and roles are called', () => {
  for (const [name, anchors] of [
    ['UnregisteredModification', { modifier: 'adv', modifiedPredicate: 'vp1' }],
    ['时间修饰', { 修饰语: 'adv', 被修饰对象: 'vp1' }],
    ['x', { p: 'vp1', q: 'adv' }]
  ]) {
    const result = reading({ relation: name, anchors }, adjoined, beforeAdjunction);
    assert.deepEqual(rules(result), ['fork.two-segment'], name);
    assert.deepEqual(result.claims[0].picture, { family: 'fork', nodes: ['adv', 'vp1'] });
  }
});

test('unmarked sister projections and head-complement pairs stay neutral', () => {
  // Bare Phrase Structure labels do not distinguish a specifier from an adjunct.
  const bare = [node('v2', 'V', [node('v1', 'V', [leaf('see', 'V'), leaf('it', 'D')]), leaf('now', 'Adv')])];
  const unmarked = reading({ relation: 'r', anchors: { a: 'v1', b: 'now' } }, bare);
  assert.deepEqual(rules(unmarked), []);
  assert.equal(unmarked.abstentions[0].configuration, 'unmarked-sister-projection');
  const complement = reading({ relation: 'r', anchors: { a: 'see', b: 'it' } }, bare);
  assert.deepEqual(rules(complement), []);
  assert.equal(complement.abstentions[0].configuration, 'head-complement');
});

test('a same-category specifier beside a projection of its mother is not an adjunction', () => {
  // DP over a possessor DP and D′: the DP daughter repeats the mother's level, but D′ projects the mother.
  const possessive = [node('dp', 'DP', [node('poss', 'DP', [leaf('kim', 'D')]), node('dbar', "D'", [leaf('s', 'D'), leaf('book', 'NP')])])];
  const result = reading({ relation: 'r', anchors: { a: 'poss', b: 'dbar' } }, possessive, possessive);
  assert.deepEqual(rules(result), []);
  assert.equal(result.abstentions[0].configuration, 'same-category-sisters');
});

test('without a previous stage, occurrences of a multi-occurrence lineage may be created here', () => {
  const tree = [node('cp', 'CP', [leaf('wh', 'DP', { lineageId: 'w' }), node('tp', 'TP', [leaf('t', 'DP', { lineageId: 'w', silent: true })])])];
  const identity = reading({ relation: 'r', anchors: { upper: 'wh', lower: 't' } }, tree);
  assert.deepEqual(rules(identity), []);
  assert(identity.abstentions.some(entry => entry.configuration === 'lineage-at-occurrence-creation'));
  // An adjoined phrase whose lineage has another occurrence may be a landing.
  const scrambled = [node('tp2', 'TP', [leaf('obj', 'DP', { lineageId: 'o' }), node('tp1', 'TP', [leaf('v', 'V'), leaf('low', 'DP', { lineageId: 'o', silent: true })])])];
  const landing = reading({ relation: 'r', anchors: { a: 'tp1', b: 'obj' } }, scrambled);
  assert.deepEqual(rules(landing), []);
  assert.equal(landing.abstentions[0].configuration, 'lineage-at-occurrence-creation');
  assert.deepEqual(rules(reading({ relation: 'r', anchors: { a: 'tp1', b: 'obj' } }, scrambled, scrambled)), ['fork.two-segment']);
});

test('values on one host form a plaque; values without a structural owner stay unattributed', () => {
  const tree = [node('tp', 'TP', [leaf('subj', 'DP'), node('tbar', "T'", [leaf('t', 'T[past]'), leaf('vp', 'VP')])])];
  const single = reading({ relation: 'r', anchors: { head: 't' }, values: { tense: 'past', note: 'prose' } }, tree);
  assert.deepEqual(single.claims.map(claim => [claim.rule, claim.picture.nodes, claim.values.map(value => value.key)]),
    [['plaque.single-host', ['t'], ['tense', 'note']]]);
  const pair = reading({ relation: 'r', anchors: { probe: 't', goal: 'subj' }, values: { features: 'phi' } }, tree);
  assert.deepEqual(rules(pair), []);
  assert(pair.abstentions.some(entry => entry.configuration === 'unattributed-values'));
  // The contract pairs a values entry with the anchor entry of the same name.
  const paired = reading({ relation: 'r', anchors: { goal: 'subj', probe: 't' }, values: { goal: 'nominative' } }, tree);
  assert.deepEqual(paired.claims.map(claim => [claim.rule, claim.picture.nodes]), [['plaque.paired-entry', ['subj']]]);
});

test('occurrences of one lineage read as identity only when this stage does not create one', () => {
  const prior = [node('cp', 'CP', [leaf('wh', 'DP', { lineageId: 'w' }), node('tp', 'TP', [leaf('t', 'DP', { lineageId: 'w', silent: true })])])];
  const relation = { relation: 'r', anchors: { upper: 'wh', lower: 't' } };
  assert.deepEqual(rules(reading(relation, prior, prior)), ['identity.shared-lineage']);
  const created = reading(relation, prior, [node('tp', 'TP', [leaf('t', 'DP', { lineageId: 'w' })])]);
  assert.deepEqual(rules(created), []);
  // The silenced lower copy is a chain member, not an ellipsis site.
  assert.deepEqual(created.abstentions.map(entry => entry.configuration), ['silenced-chain-member', 'lineage-at-occurrence-creation']);
});

test('the fork draws only when named; by default the adjunction stays neutral', () => {
  const stages = [stage(beforeAdjunction), stage(adjoined, [{ relation: 'UnregisteredModification', anchors: { 修饰语: 'adv', 被修饰对象: 'vp1' } }])];
  const off = withSwitch('0', () => compileRelationRenderPlan(stages));
  const own = (plan) => plan.frames[1].items.filter(item => item.relationRef.stageIndex === 1);
  assert.deepEqual(own(off).map(item => item.kind), ['fallback']);
  assert.deepEqual(own(withSwitch(undefined, () => compileRelationRenderPlan(stages))), own(off));
  const on = withSwitch('fork.two-segment', () => compileRelationRenderPlan(stages));
  const fork = own(on).find(item => item.claimTier === 2);
  assert.equal(fork.tier2FacetId, 'pair-merge');
  assert.deepEqual(fork.tier2OutputPieces, ['Branch overlay']);
  assert.deepEqual(fork.pairs, [{ fromNodeId: 'adv', toNodeId: 'vp1' }]);
  // An explicit empty rule set overrides the environment.
  const explicit = withSwitch('fork.two-segment', () => dispatchStageRelations(stages, { structuralRules: new Set() }));
  assert.deepEqual(explicit[1][0].facets, []);
});

test('structure never adds to a registered relation or to an envelope that already earned a claim', () => {
  const stages = [stage(beforeAdjunction), stage(adjoined, [{ relation: 'PairMerge', anchors: { a: 'adv', b: 'vp1' } }])];
  const off = withSwitch('0', () => JSON.stringify(compileRelationRenderPlan(stages)));
  assert.equal(withSwitch('all', () => JSON.stringify(compileRelationRenderPlan(stages))), off);
});

test('structure never draws a repeated anchor list or a claim its author denies, requires, supposes or conditions', () => {
  const hostOnly = [node('vp', 'VP', [leaf('verb', 'V')])];
  const plaques = relation => compileRelationRenderPlan([stage(hostOnly, [relation])]).frames[0].items
    .filter(item => item.kind === 'node-plaque');
  const record = { relation: 'An open note', anchors: { host: 'verb' }, values: { note: 'opaque' } };
  assert.equal(plaques(record).length, 1);
  assert.equal(reading({ ...record, anchors: { host: ['verb', 'verb'] } }, hostOnly).abstentions[0].configuration,
    'unresolved-or-repeated-anchor');
  for (const relation of ['No open note', 'Failed open note', 'Possible open note', 'Required open note',
    'open note was never established', 'open note if licensed'])
    assert.equal(plaques({ ...record, relation }).length, 0, relation);
  assert.equal(plaques({ ...record, values: { ...record.values, status: 'pending' } }).length, 0);
  assert.equal(plaques({ ...record, anchors: { host: ['verb', 'verb'] } }).length, 0);
});

test('a structure-only plaque yields to another relation that anchors its host and draws', () => {
  const forest = [node('tp', 'TP', [leaf('t', 'T'), leaf('subj', 'DP')])];
  const plan = relations => compileRelationRenderPlan([stage(forest, relations)]).frames[0].items;
  const note = { relation: 'An open note', anchors: { host: 'subj' }, values: { note: 'opaque' } };
  const caseClaim = { relation: 'CaseAssignment', anchors: { assigner: 't', bearer: 'subj' }, values: { feature: 'Case', value: 'NOM' } };
  assert.ok(plan([note]).some(item => item.kind === 'node-plaque' && item.relationRef.relationIndex === 0));
  const shared = plan([note, caseClaim]);
  assert.ok(!shared.some(item => item.kind === 'node-plaque' && item.relationRef.relationIndex === 0), 'the note yields');
  assert.ok(shared.some(item => item.kind === 'fallback' && item.relationRef.relationIndex === 0));
  assert.deepEqual(shared.filter(item => item.relationRef.relationIndex === 1),
    withSwitch('0', () => plan([note, caseClaim])).filter(item => item.relationRef.relationIndex === 1), 'the drawing claim is unchanged');
});

test('identity needs separate occurrences, and a fork needs each daughter in its own entry', () => {
  // One occurrence of the lineage inside another is a part of it, not a second occurrence.
  const nested = [node('cp', 'CP', [node('outer', 'DP', [leaf('inner', 'DP', { lineageId: 'w' })], { lineageId: 'w' }), leaf('c', 'C')])];
  assert.deepEqual(rules(reading({ relation: 'r', anchors: { upper: 'outer', lower: 'inner' } }, nested, nested)), []);
  // The same three nodes read as a fork only when the host is its entry's sole item.
  assert.deepEqual(rules(reading({ relation: 'r', anchors: { a: 'vp1', b: 'adv', c: 'vp2' } }, adjoined, beforeAdjunction)), ['fork.two-segment']);
  assert.deepEqual(rules(reading({ relation: 'r', anchors: { a: ['vp1', 'vp2'], b: 'adv' } }, adjoined, beforeAdjunction)), []);
});


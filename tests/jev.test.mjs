import assert from 'node:assert/strict';
import test from 'node:test';

import { buildJevRequest, readJevReply } from '../contractQualification/jev.js';
import { neutralJevClaims } from '../replay/jevClaims.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { JEV_TIER2_FAMILIES, jevFamilies, jevTerms, validateJevAnswer } from '../replay/relations/jev.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

const { records } = loadFixtureAnalyses();
const fixture = id => records.find(record => record.id === id).record;
// "selection and internal theta-role" {selector, argument; thetaRole: Theme}: worded recognition leaves it neutral.
const THETA = { id: 'replay-regressions/plaque-hold-pockets.json#/cases/4', claim: 's2r1' };
const THETA_READING = { family: 'theta-grid', roles: { selector: 'predicate', argument: 'theta.arguments' }, values: { thetaRole: 'role.label' } };

const claimOf = ({ id, claim }) => neutralJevClaims(fixture(id).derivationStages).find(candidate => candidate.id === claim);
const recordFor = (claim, answer) => ({ version: 1, mappings: [{
  stageIndex: claim.stageIndex, relationIndex: claim.relationIndex, terms: jevTerms(claim.relation), answer }] });
const claimItems = (plan, claim) => plan.frames.flatMap(frame => frame?.items ?? []).filter(item =>
  item.relationRef?.stageIndex === claim.stageIndex && item.relationRef?.relationIndex === claim.relationIndex);
const plan = (record, jev) => prepareReplay({ ...record, includePlayback: false, ...(jev ? { jev } : {}) }).relationRenderPlan;

test('the closed-set validator rejects every answer outside the claim\'s sets', () => {
  const { relation } = claimOf(THETA);
  assert.deepEqual(validateJevAnswer(relation, THETA_READING), { ok: true, answer: THETA_READING });
  assert.equal(validateJevAnswer(relation, { family: 'none', roles: { selector: 'none' }, values: {} }).ok, true);
  const nodeId = Object.values(relation.anchors).flat()[0];
  const outside = {
    'an invented family': { ...THETA_READING, family: 'selection.arrow' },
    'a registered family for an unregistered name': { ...THETA_READING, family: 'theta.grid' },
    'a movement family': { family: 'movement.path', roles: { selector: 'movement.source' }, values: {} },
    'an invented role key': { ...THETA_READING, roles: { ...THETA_READING.roles, selectee: 'theta.arguments' } },
    'an invented value key': { ...THETA_READING, values: { role: 'role.label' } },
    'a slot of another family': { ...THETA_READING, roles: { selector: 'controller', argument: 'theta.arguments' } },
    'a node id as slot': { ...THETA_READING, roles: { selector: nodeId, argument: 'theta.arguments' } },
    'a role slot in values': { ...THETA_READING, values: { thetaRole: 'theta.arguments' } },
    'a non-string slot': { ...THETA_READING, roles: { selector: ['predicate'], argument: 'theta.arguments' } },
    'slots under no family': { family: 'none', roles: { selector: 'predicate' }, values: {} },
    'an extra field': { ...THETA_READING, note: 'Theme of the verb' },
    'a non-object block': { ...THETA_READING, roles: 'predicate' },
    'a missing family': { roles: THETA_READING.roles, values: THETA_READING.values },
    'a list': [THETA_READING],
    'text': 'theta-grid'
  };
  for (const [what, answer] of Object.entries(outside))
    assert.equal(validateJevAnswer(relation, answer).ok, false, what);
  const registered = { relation: 'Agree', anchors: { probe: 'T', target: 'DP' } };
  assert.deepEqual(jevFamilies(registered).map(family => family.id), ['agree.plaque']);
  assert.equal(validateJevAnswer(registered, { family: 'agree.plaque', roles: { target: 'goal' }, values: {} }).ok, true);
  assert.equal(validateJevAnswer(registered, { family: 'feature.dependency', roles: { target: 'feature.target' }, values: {} }).ok, false,
    'Tier 2 never stands in for a registered name');
  assert.equal(validateJevAnswer({ relation: 'x', anchors: { headA: 'a', 'head-a': 'b' } },
    { family: 'pair-merge', roles: { headA: 'host', 'head-a': 'pair.member' }, values: {} }).ok, false, 'one spelling, two slots');
});

test('a reply is read only into checked answers', () => {
  const claim = claimOf(THETA);
  const claims = [{ ...claim, id: 'c1' }, { ...claim, id: 'c2' }, { ...claim, id: 'c3' }];
  const reply = JSON.stringify({ claims: [{ id: 'c1', ...THETA_READING },
    { id: 'c2', ...THETA_READING, family: 'invented' }, { id: 'c9', ...THETA_READING }] });
  const { results, unknownIds } = readJevReply(reply, claims);
  assert.deepEqual(results.map(result => result.status), ['proposal', 'out-of-set', 'no-answer']);
  assert.deepEqual(unknownIds, ['c9']);
  assert.deepEqual(readJevReply('Here is the mapping: {}', claims).results.map(result => result.status),
    ['unreadable-reply', 'unreadable-reply', 'unreadable-reply']);
});

test('the request carries the claim\'s words and Babel\'s closed sets, never the tree', () => {
  const claim = claimOf(THETA);
  const { body, question } = buildJevRequest({ claims: [claim] });
  assert.deepEqual(buildJevRequest({ claims: [claim] }).body, body, 'deterministic');
  const text = body.input[0].content[0].text;
  for (const id of Object.values(claim.relation.anchors).flat()) assert.equal(text.includes(JSON.stringify(id)), false, id);
  assert.deepEqual(question.claims, [{ id: 's2r1', relation: claim.relation.relation,
    roleKeys: Object.keys(claim.relation.anchors), values: jevTerms(claim.relation).values }]);
  assert.deepEqual(question.families.map(family => family.id), JEV_TIER2_FAMILIES.map(family => family.id));
  assert.equal(body.store, false);
  assert.equal(body.text, undefined, 'no provider response schema');
});

test('a saved reading makes a neutral fixture claim draw through the ordinary checks', () => {
  const claim = claimOf(THETA);
  const record = fixture(THETA.id);
  assert.deepEqual([...new Set(claimItems(plan(record), claim).map(item => item.claimTier))], [3]);
  const items = claimItems(plan(record, recordFor(claim, THETA_READING)), claim);
  assert.deepEqual([...new Set(items.filter(item => item.claimTier !== 3).map(item => `${item.claimTier} ${item.tier2FacetId}`))], ['2 theta-grid']);
  assert.equal(items[0].relationRef.anchors.selector, claim.relation.anchors.selector, 'the authored claim is unchanged');
  assert.ok(items.some(item => item.badges?.some(badge => badge.nodeId === claim.relation.anchors.argument)));
});

test('a reading the structure does not support stays neutral', () => {
  const claim = claimOf(THETA);
  const record = fixture(THETA.id);
  const baseline = JSON.stringify(plan(record));
  // In the closed sets, but the two anchors share no lineage, so no identity is drawn.
  const identity = { family: 'identity.occurrences', roles: { selector: 'occurrences', argument: 'occurrences' }, values: {} };
  assert.equal(validateJevAnswer(claim.relation, identity).ok, true);
  assert.equal(JSON.stringify(plan(record, recordFor(claim, identity))), baseline);
  // A reading whose checks would draw a different family than the one named does not stand either.
  const misnamed = { ...THETA_READING, family: 'predication.dependency', roles: { selector: 'predicate' }, values: {} };
  assert.equal(JSON.stringify(plan(record, recordFor(claim, misnamed))), baseline);
});

test('without an applicable saved reading every plan is byte-identical', () => {
  const claim = claimOf(THETA);
  const stale = recordFor({ ...claim, relation: { ...claim.relation, relation: 'theta-role assignment' } }, THETA_READING);
  const edited = recordFor(claim, { ...THETA_READING, family: 'invented' });
  const moved = { version: 1, mappings: [{ ...recordFor(claim, THETA_READING).mappings[0], relationIndex: claim.relationIndex + 1 }] };
  const otherVersion = { ...recordFor(claim, THETA_READING), version: 2 };
  const record = fixture(THETA.id);
  const baseline = JSON.stringify(plan(record));
  for (const jev of [stale, edited, moved, otherVersion]) assert.equal(JSON.stringify(plan(record, jev)), baseline);
  // Across every committed fixture analysis: an empty record and an all-"none" record change nothing.
  for (const { id, record: analysis } of records) {
    let none;
    try { none = { version: 1, mappings: neutralJevClaims(analysis.derivationStages).map(neutral => ({
      stageIndex: neutral.stageIndex, relationIndex: neutral.relationIndex, terms: jevTerms(neutral.relation),
      answer: { family: 'none', roles: {}, values: {} } })) }; } catch { continue; }
    const expected = JSON.stringify(plan(analysis));
    assert.equal(JSON.stringify(plan(analysis, { version: 1, mappings: [] })), expected, id);
    assert.equal(JSON.stringify(plan(analysis, none)), expected, id);
  }
});

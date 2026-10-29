import assert from 'node:assert/strict';
import test from 'node:test';

import { readTypeSafeApiKey } from '../contractQualification/jev.js';
import {
  DEFAULT_JEV_MODEL, JEV_MAX_READINGS, TYPESAFE_SYSTEMONE_URL, anchorIdsReachRequest, askableFamilies, buildFamilyRequest,
  buildReadingRequest, choiceConfidence, jevClaimResult, jevReadings, jevValueReadings,
  jevRecordFrom, readChoiceAnswer, readSystemOneResponse, requestJev
} from '../server/babelParser/jev.js';
import { JEV_FAMILY_DESCRIPTIONS } from '../server/babelParser/jevDescriptions.js';
import { neutralJevClaims } from '../replay/jevClaims.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import {
  JEV_CONFIDENCE_THRESHOLD, JEV_FAMILIES, jevFamilies, jevReadingGap, jevTerms, validateJevAnswer
} from '../replay/relations/jev.ts';
import { JEV_RECORD_VERSION } from '../replay/jevRecord.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

const { records } = loadFixtureAnalyses();
const fixture = id => records.find(record => record.id === id).record;
// "selection and internal theta-role" {selector, argument; thetaRole: Theme}: worded recognition leaves it neutral.
const THETA = { id: 'replay-regressions/plaque-hold-pockets.json#/cases/4', claim: 's2r1' };
const THETA_READING = { family: 'theta-grid', roles: { selector: 'predicate', argument: 'theta.arguments' }, values: { thetaRole: 'role.label' } };

const claimOf = ({ id, claim }) => neutralJevClaims(fixture(id).derivationStages).find(candidate => candidate.id === claim);
const recordFor = (claim, answer, confidence = 1) => ({ version: JEV_RECORD_VERSION, mappings: [{
  stageIndex: claim.stageIndex, relationIndex: claim.relationIndex, terms: jevTerms(claim.relation), answer, confidence }] });
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
  // An exactly registered name is never offered a family: re-reading a malformed registered claim would repair it.
  const registered = { relation: 'Agree', anchors: { probe: 'T', target: 'DP' } };
  assert.deepEqual(jevFamilies(registered), []);
  assert.equal(validateJevAnswer(registered, { family: 'feature.dependency', roles: { target: 'feature.target' }, values: {} }).ok, false);
  assert.equal(validateJevAnswer(registered, { family: 'agree.plaque', roles: { target: 'goal' }, values: {} }).ok, false);
  assert.equal(neutralJevClaims([{ statement: 's', stageRecord: 'r', workspaceForest: [{ id: 'T', label: 'T', children: [{ id: 'DP', label: 'DP', word: 'it' }] }],
    relations: [{ relation: 'Agree', anchors: { probe: 'T', target: 'DP' } }] }]).length, 0, 'not asked about');
  assert.equal(validateJevAnswer({ relation: 'x', anchors: { headA: 'a', 'head-a': 'b' } },
    { family: 'pair-merge', roles: { headA: 'host', 'head-a': 'pair.member' }, values: {} }).ok, false, 'one spelling, two slots');
});

test('a reading must read every anchor key, and one-participant slots take one key', () => {
  const { relation } = claimOf(THETA);
  assert.equal(jevReadingGap(relation, THETA_READING), undefined);
  assert.match(jevReadingGap(relation, { ...THETA_READING, roles: { selector: 'predicate' } }), /left unread: argument/);
  assert.match(jevReadingGap(relation, { ...THETA_READING, roles: { selector: 'predicate', argument: 'predicate' } }), /one-participant slot: predicate/);
  // Several keys may share a slot that holds several participants.
  const split = { relation: 'split reference', anchors: { firstAntecedent: 'a', secondAntecedent: 'b', pronoun: 'c' } };
  assert.equal(jevReadingGap(split, { family: 'coreference.coindex', roles: { firstAntecedent: 'coreference.participants',
    secondAntecedent: 'coreference.participants', pronoun: 'coreference.participants' }, values: {} }), undefined);
  assert.match(jevReadingGap(split, { family: 'coreference.coindex', roles: { firstAntecedent: 'coreference.participants',
    secondAntecedent: 'coreference.participants' }, values: {} }), /left unread: pronoun/);
});

/** A Choice answer as TypeSafe returns it: probabilities over every option, confidence by the documented formula. */
const choiceAnswer = (options, chosen, p = 1) => {
  const rest = options.length > 1 ? (1 - p) / (options.length - 1) : 0;
  const probabilities = Object.fromEntries(options.map(option => [option, option === chosen ? p : rest]));
  return { type: 'choice', choice: chosen, confidence: choiceConfidence(probabilities), probabilities };
};
const answerAll = (questions, pick, p = 1) => ({ model: DEFAULT_JEV_MODEL, usage: { input_tokens: 100, output_tokens: 10 },
  answers: Object.fromEntries(Object.entries(questions).map(([id, question]) =>
    [id, choiceAnswer(Object.keys(question.criteria), pick(id, question), p)])) });

test('a Choice answer is accepted only inside the options asked', () => {
  const options = ['none', 'theta-grid', 'feature.dependency'];
  const good = { type: 'choice', choice: 'theta-grid', confidence: 0.7, probabilities: { none: 0.15, 'theta-grid': 0.8, 'feature.dependency': 0.05 } };
  assert.deepEqual(readChoiceAnswer(good, options), { ok: true, choice: 'theta-grid', confidence: 0.7, probabilities: good.probabilities });
  // The documented examples (https://docs.typesafe.ai/primitives/choice.md) pass the confidence check.
  assert.equal(readChoiceAnswer({ type: 'choice', choice: 'b', confidence: 0.42, probabilities: { a: 0.04, c: 0.35, b: 0.61 } }, ['a', 'b', 'c']).ok, true);
  assert.equal(readChoiceAnswer({ type: 'choice', choice: 'r', confidence: 0.2, probabilities: { x: 0.34, r: 0.4, i: 0.02, e: 0.24 } }, ['x', 'r', 'i', 'e']).ok, true);
  const bad = {
    'a choice not offered': { ...good, choice: 'selection.arrow' },
    'a node id as choice': { ...good, choice: 'n12' },
    'a probability missing': { ...good, probabilities: { none: 0.2, 'theta-grid': 0.8 } },
    'a probability for an option not offered': { ...good, probabilities: { ...good.probabilities, extra: 0 } },
    'a probability above one': { ...good, probabilities: { none: -0.3, 'theta-grid': 1.3, 'feature.dependency': 0 } },
    'a non-finite probability': { ...good, probabilities: { ...good.probabilities, none: Number.NaN } },
    'probabilities not summing to one': { ...good, probabilities: { none: 0.5, 'theta-grid': 0.8, 'feature.dependency': 0.05 } },
    'a choice that is not the most probable': { ...good, choice: 'none', confidence: 0.7 },
    'a confidence that does not follow': { ...good, confidence: 0.95 },
    'a confidence outside 0 to 1': { ...good, confidence: 1.5 },
    'another answer type': { ...good, type: 'score' },
    'not an object': 'theta-grid'
  };
  for (const [what, answer] of Object.entries(bad)) assert.equal(readChoiceAnswer(answer, options).ok, false, what);
  // Seen live: a choice trailing the rounded top probability by one cent is the rounding, not another choice.
  const live = { type: 'choice', choice: 'none', confidence: 0.1, probabilities: { none: 0.39, 'feature.rows': 0.4, index: 0.21 } };
  assert.equal(readChoiceAnswer(live, ['none', 'feature.rows', 'index']).ok, true);
  assert.equal(readChoiceAnswer({ ...live, probabilities: { none: 0.38, 'feature.rows': 0.41, index: 0.21 }, confidence: 0.115 },
    ['none', 'feature.rows', 'index']).ok, false, 'three cents is another choice');
  const questions = { family: { type: 'choice', criteria: Object.fromEntries(options.map(option => [option, null])) } };
  assert.equal(readSystemOneResponse({ answers: { family: good } }, questions).ok, true);
  assert.equal(readSystemOneResponse({ answers: {} }, questions).ok, false, 'an unanswered question');
  assert.equal(readSystemOneResponse({ answers: { family: good, other: good } }, questions).ok, false, 'an answer to a question not asked');
  assert.equal(readSystemOneResponse('{}', questions).ok, false, 'no answers object');
});

test('every family and slot Jev chooses between is described', () => {
  for (const family of JEV_FAMILIES) {
    const described = JEV_FAMILY_DESCRIPTIONS[family.id];
    assert.ok(described?.means && described.draws, family.id);
    for (const slot of [...family.roles, ...family.values]) assert.ok(described.slots[slot], `${family.id} ${slot}`);
  }
  assert.deepEqual(Object.keys(JEV_FAMILY_DESCRIPTIONS).sort(), JEV_FAMILIES.map(family => family.id).sort(), 'no stale descriptions');
});

test('a complete reading gives every anchor key a slot the recipe can draw', () => {
  const operatorBinding = JEV_FAMILIES.find(family => family.id === 'operator-binding');
  // A relative operator and its head: operator binding has no slot for a head outside the clause,
  // so its only complete readings make one of them the variable.
  const relative = { relation: 'RelativeBinding', anchors: { operator: 'op', head: 'n' } };
  assert.deepEqual(jevReadings(relative, operatorBinding),
    [{ operator: 'operator', head: 'variable' }, { operator: 'variable', head: 'operator' }]);
  // Every reading passes the closed sets and the whole-claim rule and fills each required slot.
  for (const { relation } of neutralJevClaims(fixture(THETA.id).derivationStages)) for (const family of askableFamilies(relation)) {
    for (const roles of jevReadings(relation, family)) {
      const answer = { family: family.id, roles, values: {} };
      assert.equal(validateJevAnswer(relation, answer).ok, true);
      assert.equal(jevReadingGap(relation, answer), undefined);
      assert.ok(family.requiredRoles.every(slot => Object.values(roles).includes(slot)), family.id);
    }
    assert.ok(jevValueReadings(relation, family).every(values => Object.keys(values).length
      && family.requiredValues.every(slot => Object.values(values).includes(slot))), family.id);
  }
  // A family that cannot read the whole claim is not offered.
  assert.equal(askableFamilies(relative).some(family => family.id === 'ellipsis.site'), false, 'one slot, two keys');
  const theta = JEV_FAMILIES.find(family => family.id === 'theta-grid');
  const values = { relation: 'x', anchors: { a: 'a', b: 'b' }, values: { thetaRole: 'Theme', note: 'n' } };
  assert.deepEqual(jevValueReadings(values, theta), [{ note: 'role.label' }, { thetaRole: 'role.label' }, { thetaRole: 'role.label', note: 'role.label' }]);
  // Too many readings for one Choice: the family is not offered.
  const many = { relation: 'x', anchors: Object.fromEntries(Array.from({ length: 9 }, (_unused, index) => [`k${index}`, `n${index}`])) };
  const transfer = JEV_FAMILIES.find(family => family.id === 'transfer.domain');
  assert.equal(jevReadings(many, transfer), undefined);
  assert.equal(askableFamilies(many).some(family => family.id === 'transfer.domain'), false);
});

test('the requests are System One requests carrying only the claim\'s words', () => {
  const claim = claimOf(THETA);
  const family = buildFamilyRequest({ relation: claim.relation });
  assert.deepEqual(buildFamilyRequest({ relation: claim.relation }), family, 'deterministic');
  // https://docs.typesafe.ai/api/system-one.md: model, state and named questions; a Choice has type, instructions and criteria.
  assert.deepEqual(Object.keys(family), ['model', 'state', 'questions']);
  assert.equal(family.model, 'jev-1.14.0', 'a versioned model, since the threshold is calibrated against one version');
  const terms = jevTerms(claim.relation);
  assert.deepEqual(family.state, { claim: { relation: claim.relation.relation, roleKeys: terms.roles, values: terms.values } });
  assert.deepEqual(Object.keys(family.questions), ['family']);
  assert.deepEqual(Object.keys(family.questions.family), ['type', 'instructions', 'criteria']);
  const { type, instructions, criteria } = family.questions.family;
  assert.equal(type, 'choice');
  assert.ok(instructions.question);
  assert.deepEqual(Object.keys(criteria), ['none', ...askableFamilies(claim.relation).map(candidate => candidate.id)], 'none first');
  assert.ok(Object.keys(criteria).includes('theta-grid'));
  assert.equal(criteria['theta-grid'].means, JEV_FAMILY_DESCRIPTIONS['theta-grid'].means, 'each family is described');
  assert.equal(criteria['theta-grid'].roleSlots.predicate, JEV_FAMILY_DESCRIPTIONS['theta-grid'].slots.predicate, 'each slot is described');
  assert.ok(Object.keys(criteria).length <= JEV_MAX_READINGS + 1, 'the documented Choice option limit');
  const reading = buildReadingRequest({ relation: claim.relation, family: 'theta-grid' });
  assert.deepEqual(reading.body.state, family.state, 'both requests share one state');
  assert.deepEqual(Object.keys(reading.body.questions), ['reading', 'values']);
  const readingOptions = Object.keys(reading.body.questions.reading.criteria);
  assert.equal(readingOptions[0], 'none');
  assert.deepEqual([...reading.options.reading.values()].slice(1), jevReadings(claim.relation, JEV_FAMILIES.find(candidate => candidate.id === 'theta-grid')));
  const standing = readingOptions.find(name => reading.options.reading.get(name).selector === 'predicate');
  assert.equal(standing, 'argument → theta.arguments; selector → predicate', 'an option names its whole reading');
  assert.deepEqual(reading.body.questions.reading.criteria[standing], {
    argument: `theta.arguments: ${JEV_FAMILY_DESCRIPTIONS['theta-grid'].slots['theta.arguments']}`,
    selector: `predicate: ${JEV_FAMILY_DESCRIPTIONS['theta-grid'].slots.predicate}` });
  assert.ok(Object.keys(reading.body.questions.values.criteria).includes('thetaRole → role.label'));
  // A family without value slots asks nothing about value keys.
  assert.deepEqual(Object.keys(buildReadingRequest({ relation: claim.relation, family: 'predication.dependency' }).body.questions), ['reading']);
  assert.throws(() => buildReadingRequest({ relation: claim.relation, family: 'invented' }));
  assert.throws(() => buildReadingRequest({ relation: claim.relation, family: 'ellipsis.site' }), /No family/u, 'not askable');
  for (const question of [family.questions.family, ...askableFamilies(claim.relation).flatMap(candidate =>
    Object.values(buildReadingRequest({ relation: claim.relation, family: candidate.id }).body.questions))])
    assert.ok(Object.keys(question.criteria).length <= JEV_MAX_READINGS + 1);
  // No anchor id leaves Babel, in either request.
  for (const text of [JSON.stringify(family), ...askableFamilies(claim.relation).map(candidate =>
    JSON.stringify(buildReadingRequest({ relation: claim.relation, family: candidate.id }).body))])
    for (const id of Object.values(claim.relation.anchors).flat()) assert.equal(text.includes(JSON.stringify(id)), false, id);
  // The requests are built from the claim's words alone, even when an id is spelled like one of them.
  const coincident = { relation: 'agent-identification', anchors: { voice: 'voice', agent: ['DP', 'washed'] }, values: { form: 'washed' } };
  assert.equal(anchorIdsReachRequest(coincident, relation => buildFamilyRequest({ relation })), false);
  for (const candidate of askableFamilies(coincident))
    assert.equal(anchorIdsReachRequest(coincident, relation => buildReadingRequest({ relation, family: candidate.id }).body), false, candidate.id);
  // The check itself catches a request that would carry an id.
  assert.equal(anchorIdsReachRequest(coincident, relation => ({ ...buildFamilyRequest({ relation }), leak: relation.anchors })), true);
  // An exactly registered name is never asked.
  assert.deepEqual(Object.keys(buildFamilyRequest({ relation: { relation: 'Agree', anchors: { probe: 'T', target: 'DP' } } }).questions.family.criteria), ['none']);
});

test('one claim reads into a checked answer with the least confidence of its parts', () => {
  const { relation } = claimOf(THETA);
  const family = buildFamilyRequest({ relation });
  const second = buildReadingRequest({ relation, family: 'theta-grid' });
  const familyRead = readSystemOneResponse(answerAll(family.questions, () => 'theta-grid', 0.97), family.questions);
  const nameOf = (options, wanted) => [...options].find(([, assignment]) => JSON.stringify(assignment) === JSON.stringify(wanted))[0];
  const pick = id => (id === 'reading' ? nameOf(second.options.reading, Object.fromEntries(jevTerms(relation).roles.map(key => [key, THETA_READING.roles[key]])))
    : nameOf(second.options.values, THETA_READING.values));
  const readingRead = readSystemOneResponse(answerAll(second.body.questions, pick, 0.95), second.body.questions);
  const result = jevClaimResult(relation, familyRead, { read: readingRead, options: second.options });
  assert.equal(result.status, 'proposal');
  assert.deepEqual(result.answer, THETA_READING);
  const parts = [familyRead.answers.family, ...Object.values(readingRead.answers)].map(part => part.confidence);
  assert.equal(result.confidence, Math.min(...parts), 'the least confident part');
  assert.ok(result.confidence < familyRead.answers.family.confidence);
  // None as family ends the claim after one request; none as reading leaves it neutral.
  const none = readSystemOneResponse(answerAll(family.questions, () => 'none'), family.questions);
  assert.deepEqual(jevClaimResult(relation, none), { status: 'no-drawing', answer: { family: 'none', roles: {}, values: {} }, confidence: 1 });
  const noReading = readSystemOneResponse(answerAll(second.body.questions, () => 'none'), second.body.questions);
  assert.equal(jevClaimResult(relation, familyRead, { read: noReading, options: second.options }).answer.family, 'none');
  // An answer outside the options rejects the claim.
  const outside = answerAll(second.body.questions, pick);
  outside.answers.reading = { ...outside.answers.reading, choice: 'selector → predicate' };
  assert.equal(jevClaimResult(relation, familyRead, { read: readSystemOneResponse(outside, second.body.questions), options: second.options }).status, 'out-of-set');
  const record = jevRecordFrom({ claims: [{ stageIndex: 1, relationIndex: 0, relation }], results: [result] });
  assert.deepEqual(record, { version: JEV_RECORD_VERSION, mappings: [{ stageIndex: 1, relationIndex: 0, terms: jevTerms(relation),
    answer: THETA_READING, confidence: result.confidence }] });
});

test('the transport posts the saved body once with the bearer key, and the key loader fails closed', async () => {
  const calls = [];
  const ok = await requestJev({ body: { model: 'm', state: {}, questions: {} }, apiKey: 'key-1',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response('{"answers":{}}', { status: 200 }); } });
  assert.equal(ok.status, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TYPESAFE_SYSTEMONE_URL);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer key-1');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.body, JSON.stringify({ model: 'm', state: {}, questions: {} }));
  const limited = await requestJev({ body: {}, apiKey: 'k', fetchImpl: async () => new Response('{"detail":"slow down"}', { status: 429 }) });
  assert.deepEqual([limited.status, limited.httpStatus], ['failed', 429], 'no retry');
  assert.equal(readTypeSafeApiKey({ keyFile: '/k', readFile: () => ' key-2\n' }), 'key-2');
  assert.equal(readTypeSafeApiKey({ run: (_command, argv) => (argv.includes('Babel TypeSafe API') ? 'key-3\n' : '') }), 'key-3');
  const missing = () => { throw new Error('not found'); };
  assert.throws(() => readTypeSafeApiKey({ run: missing }), /--key-file PATH.*Babel TypeSafe API/u);
  assert.throws(() => readTypeSafeApiKey({ keyFile: '/k', readFile: missing }), /--key-file PATH.*Keychain/u);
  assert.throws(() => readTypeSafeApiKey({ keyFile: '/k', readFile: () => '\n' }), /empty/u);
  assert.throws(() => readTypeSafeApiKey({ service: 'Other item', run: () => '' }), /"Other item"/u);
});

test('a saved reading applies only at or above the confidence threshold', () => {
  const claim = claimOf(THETA);
  const record = fixture(THETA.id);
  const baseline = JSON.stringify(plan(record));
  const drawn = jev => claimItems(plan(record, jev), claim).some(item => item.claimTier === 2);
  assert.equal(drawn(recordFor(claim, THETA_READING, JEV_CONFIDENCE_THRESHOLD)), true);
  assert.equal(drawn(recordFor(claim, THETA_READING, 1)), true);
  for (const confidence of [JEV_CONFIDENCE_THRESHOLD - 0.01, 0, 1.01, Number.NaN, '0.99'])
    assert.equal(JSON.stringify(plan(record, recordFor(claim, THETA_READING, confidence))), baseline, String(confidence));
  // A mapping without confidence, in this version or the earlier one, never applies.
  const { confidence: _dropped, ...unscored } = recordFor(claim, THETA_READING).mappings[0];
  assert.equal(JSON.stringify(plan(record, { version: JEV_RECORD_VERSION, mappings: [unscored] })), baseline);
  assert.equal(JSON.stringify(plan(record, { version: 1, mappings: [unscored] })), baseline);
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
  // A reading that leaves an anchor key unread is not applied.
  const partial = { ...THETA_READING, roles: { selector: 'predicate' } };
  assert.equal(validateJevAnswer(claim.relation, partial).ok, true);
  assert.equal(JSON.stringify(plan(record, recordFor(claim, partial))), baseline);
  // A complete reading whose checks draw a different family than the one named does not stand either:
  // read this way the claim would draw a theta grid, not a predication connector.
  const misnamed = { family: 'predication.dependency', roles: { selector: 'predicate', argument: 'predicand' }, values: {} };
  assert.equal(jevReadingGap(claim.relation, misnamed), undefined);
  assert.equal(JSON.stringify(plan(record, recordFor(claim, misnamed))), baseline);
});

test('without an applicable saved reading every plan is byte-identical', () => {
  const claim = claimOf(THETA);
  const stale = recordFor({ ...claim, relation: { ...claim.relation, relation: 'theta-role assignment' } }, THETA_READING);
  const edited = recordFor(claim, { ...THETA_READING, family: 'invented' });
  const moved = { version: JEV_RECORD_VERSION, mappings: [{ ...recordFor(claim, THETA_READING).mappings[0], relationIndex: claim.relationIndex + 1 }] };
  const otherVersion = { ...recordFor(claim, THETA_READING), version: JEV_RECORD_VERSION + 1 };
  const record = fixture(THETA.id);
  const baseline = JSON.stringify(plan(record));
  for (const jev of [stale, edited, moved, otherVersion]) assert.equal(JSON.stringify(plan(record, jev)), baseline);
  // Across every committed fixture analysis: an empty record and an all-"none" record change nothing.
  for (const { id, record: analysis } of records) {
    let none;
    try { none = { version: JEV_RECORD_VERSION, mappings: neutralJevClaims(analysis.derivationStages).map(neutral => ({
      stageIndex: neutral.stageIndex, relationIndex: neutral.relationIndex, terms: jevTerms(neutral.relation),
      answer: { family: 'none', roles: {}, values: {} }, confidence: 1 })) }; } catch { continue; }
    const expected = JSON.stringify(plan(analysis));
    assert.equal(JSON.stringify(plan(analysis, { version: JEV_RECORD_VERSION, mappings: [] })), expected, id);
    assert.equal(JSON.stringify(plan(analysis, none)), expected, id);
  }
});

import { JEV_RECORD_VERSION } from '../../replay/jevRecord.ts';
import { JEV_NONE, jevFamilies, jevReadingGap, jevTerms, validateJevAnswer } from '../../replay/relations/jev.ts';
import { JEV_FAMILY_DESCRIPTIONS } from './jevDescriptions.js';

/**
 * Jev's questions, asked of TypeSafe's System One model Jev (https://docs.typesafe.ai).
 *
 * One claim is asked in at most two requests over the same state, the claim's
 * own words (`jevState`):
 *
 * 1. `family`: one Choice among the families that can read the whole claim
 *    (`askableFamilies`), each described in words (`jevDescriptions.js`).
 * 2. Only when a family was chosen: `reading`, one Choice among the complete
 *    readings of the claim's anchor keys in that family (`jevReadings`), and,
 *    when the claim has value keys the family has slots for, `values`, one
 *    Choice among the readings of its value keys (`jevValueReadings`).
 *
 * A complete reading assigns every anchor key a slot, as the whole-claim rule
 * requires, fills every slot the recipe needs and puts at most one key in a
 * one-participant slot. Asking for whole readings lets Jev weigh the keys
 * together; questions about one key each are answered in isolation. The
 * options depend on the family, which is why there is a second request.
 * Every option list has `none` first, and at most 255 options.
 *
 * Answers are read only through `readChoiceAnswer`, which accepts nothing
 * outside the options asked. A reading's confidence is the least confidence
 * of the answers it is made of; Replay applies it only at or above
 * `JEV_CONFIDENCE_THRESHOLD` (replay/relations/jev.ts).
 */
export const JEV_PROMPT_VERSION = 'jev-ts-2';
export const TYPESAFE_SYSTEMONE_URL = 'https://api.typesafe.ai/v1/systemone';
/** A versioned id, not `jev-latest`: the threshold is calibrated against one model version. */
export const DEFAULT_JEV_MODEL = 'jev-1.14.0';
/** The documented Choice limit is 255 options; `none` is one of them. */
export const JEV_MAX_READINGS = 254;

const POSITION_RULE = 'A key that names only a position or a category, such as head, specifier or complement, does not say which participant it is: when `claim.roleKeys` has such a key, choose none.';
const QUALIFIER_RULE = 'A key whose name qualifies its participant (potential, possible, candidate, failed, blocked, excluded, denied, would-be, intended, non-) is not that participant: no reading may give it that participant\'s slot.';
const WORDS_ONLY = 'Read only the words in `claim`. Do not judge whether the claim is right; Babel checks the structure itself.';

/** The state every question about one claim refers to: its words, never the tree, nodes, labels, sentence or ids. */
export const jevState = relation => {
  const terms = jevTerms(relation);
  return { claim: { relation: terms.relation, roleKeys: terms.roles, values: terms.values } };
};

const replaceIds = anchors => anchors && Object.fromEntries(Object.entries(anchors).map(([key, value]) =>
  [key, Array.isArray(value) ? value.map((_id, index) => `\u0000id${index}`) : '\u0000id']));

/** Whether any anchor id reaches a request: the request built from the claim must equal the
 * one built with every anchor id replaced. A substring search would also flag ids that happen
 * to be spelled like one of the claim's own words, which Jev is meant to read. */
export const anchorIdsReachRequest = (relation, build) => JSON.stringify(build(relation))
  !== JSON.stringify(build({ ...relation, anchors: replaceIds(relation.anchors), priorAnchors: replaceIds(relation.priorAnchors) }));

const describe = (family, slot) => JEV_FAMILY_DESCRIPTIONS[family.id].slots[slot];

/** Every complete reading of the claim's anchor keys in one family, in a fixed order, or
 * `undefined` when there are more than one Choice can offer. */
export const jevReadings = (relation, family) => {
  const keys = jevTerms(relation).roles;
  const readings = [];
  const extend = (index, roles) => {
    if (readings.length > JEV_MAX_READINGS) return;
    if (index === keys.length) {
      const answer = { family: family.id, roles, values: {} };
      const filled = new Set(Object.values(roles));
      if (family.requiredRoles.every(slot => filled.has(slot)) && validateJevAnswer(relation, answer).ok
        && !jevReadingGap(relation, answer)) readings.push(roles);
      return;
    }
    for (const slot of family.roles) {
      if (family.singleRoles.includes(slot) && Object.values(roles).includes(slot)) continue;
      extend(index + 1, { ...roles, [keys[index]]: slot });
    }
  };
  if (keys.length) extend(0, {});
  return readings.length > JEV_MAX_READINGS ? undefined : readings;
};

/** Every reading of the claim's value keys in one family other than reading none of them:
 * each key fills a value slot or none, every value slot the recipe needs is filled, and a
 * slot read as one value takes one key. `undefined` when there are too many to offer. */
export const jevValueReadings = (relation, family) => {
  const keys = Object.keys(jevTerms(relation).values);
  if (!keys.length || !family.values.length) return [];
  const readings = [];
  const extend = (index, values) => {
    if (readings.length > JEV_MAX_READINGS) return;
    if (index === keys.length) {
      const filled = Object.values(values);
      if (filled.length && family.requiredValues.every(slot => filled.includes(slot))
        && validateJevAnswer(relation, { family: family.id, roles: {}, values }).ok) readings.push(values);
      return;
    }
    extend(index + 1, values);
    for (const slot of family.values) {
      if (family.singleValues.includes(slot) && Object.values(values).includes(slot)) continue;
      extend(index + 1, { ...values, [keys[index]]: slot });
    }
  };
  extend(0, {});
  return readings.length > JEV_MAX_READINGS ? undefined : readings;
};

/** The families offered for a claim: those with at least one complete reading of its anchor
 * keys and few enough readings, of anchors and of values, for one Choice each. */
export const askableFamilies = relation => jevFamilies(relation).filter(family => {
  const readings = jevReadings(relation, family);
  return readings?.length && jevValueReadings(relation, family) !== undefined;
});

const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });

const familyCriterion = family => {
  const { means, draws } = JEV_FAMILY_DESCRIPTIONS[family.id];
  return { means, draws, roleSlots: Object.fromEntries(family.roles.map(slot => [slot, describe(family, slot)])),
    ...(family.values.length ? { valueSlots: Object.fromEntries(family.values.map(slot => [slot, describe(family, slot)])) } : {}) };
};

export const familyQuestion = relation => choice({
  question: 'Which kind of relation does `claim` describe, judged by its relation name, its role keys and its values?',
  rules: [
    'Choose the family whose meaning is what `claim.relation` names, and whose slots can hold every key in `claim.roleKeys` with the meaning that key has.',
    'Choose none when no family means what the claim says, even if its slot names look similar.',
    POSITION_RULE, QUALIFIER_RULE, WORDS_ONLY
  ]
}, { [JEV_NONE]: 'None of these families means what the claim says.',
  ...Object.fromEntries(askableFamilies(relation).map(family => [family.id, familyCriterion(family)])) });

const readingName = assignment => Object.entries(assignment).map(([key, slot]) => `${key} → ${slot}`).join('; ');
const readingCriterion = (family, assignment) => Object.fromEntries(Object.entries(assignment).map(([key, slot]) =>
  [key, `${slot}: ${describe(family, slot)}`]));

/** The second request's questions and, for each, the assignment each option name stands for. */
export const readingQuestions = (relation, familyId) => {
  const family = askableFamilies(relation).find(candidate => candidate.id === familyId);
  if (!family) throw new Error(`No family ${JSON.stringify(familyId)} for this claim.`);
  const { means, draws } = JEV_FAMILY_DESCRIPTIONS[family.id];
  const options = { reading: new Map([[JEV_NONE, {}]]), values: new Map([[JEV_NONE, {}]]) };
  for (const roles of jevReadings(relation, family)) options.reading.set(readingName(roles), roles);
  for (const values of jevValueReadings(relation, family)) options.values.set(readingName(values), values);
  const asked = { family: family.id, means, draws };
  const questions = {
    reading: choice({
      question: 'Which reading says what each key in `claim.roleKeys` is, in this family?', ...asked,
      rules: ['Choose the reading in which every key is the participant its slot describes.',
        'Choose none when no reading says what the keys mean.', POSITION_RULE, QUALIFIER_RULE, WORDS_ONLY]
    }, { [JEV_NONE]: 'No reading says what the keys mean.',
      ...Object.fromEntries([...options.reading].slice(1).map(([name, roles]) => [name, readingCriterion(family, roles)])) })
  };
  if (options.values.size > 1) questions.values = choice({
    question: 'Which reading says what each key of `claim.values` holds, in this family?', ...asked,
    rules: ['Choose the reading in which every listed key holds what its slot describes; keys not listed hold none of them.',
      'Choose none when no key of `claim.values` holds what any value slot describes.', WORDS_ONLY]
  }, { [JEV_NONE]: 'No key of claim.values holds any of these.',
    ...Object.fromEntries([...options.values].slice(1).map(([name, values]) => [name, readingCriterion(family, values)])) });
  return { questions, options };
};

const body = (relation, questions, model) => ({ model, state: jevState(relation), questions });

export const buildFamilyRequest = ({ relation, model = DEFAULT_JEV_MODEL }) =>
  body(relation, { family: familyQuestion(relation) }, model);

export const buildReadingRequest = ({ relation, family, model = DEFAULT_JEV_MODEL }) => {
  const { questions, options } = readingQuestions(relation, family);
  return { body: body(relation, questions, model), options };
};

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
// Answers are rounded to two decimals; the sum of rounded probabilities drifts by half a cent per option.
const sumTolerance = options => Math.max(0.02, 0.005 * options);
const CONFIDENCE_TOLERANCE = 0.02;
const ROUNDING = 0.0100001;

/** Choice confidence as TypeSafe documents it (https://docs.typesafe.ai/confidence.md):
 * how far the top probability stands above an even split. */
export const choiceConfidence = probabilities => {
  const values = Object.values(probabilities);
  const n = values.length;
  return n < 2 ? 1 : (Math.max(...values) - 1 / n) / (1 - 1 / n);
};

/** Accepts one Choice answer only when everything in it lies in the options asked:
 * the choice, a probability for exactly those options that sums to one, the
 * choice being the most probable, and a confidence that follows from them. */
export const readChoiceAnswer = (answer, options) => {
  const errors = [];
  if (!isRecord(answer)) return { ok: false, errors: ['answer is not an object'] };
  if (answer.type !== 'choice') errors.push(`answer type is ${JSON.stringify(answer.type)}`);
  if (!options.includes(answer.choice)) errors.push(`choice not offered: ${JSON.stringify(answer.choice)}`);
  if (!unit(answer.confidence)) errors.push(`confidence is not a number from 0 to 1: ${JSON.stringify(answer.confidence)}`);
  const probabilities = answer.probabilities;
  if (!isRecord(probabilities)) errors.push('probabilities is not an object');
  else {
    const keys = Object.keys(probabilities);
    const missing = options.filter(option => !Object.hasOwn(probabilities, option));
    const extra = keys.filter(key => !options.includes(key));
    if (missing.length) errors.push(`no probability for: ${missing.join(', ')}`);
    if (extra.length) errors.push(`probability for an option not offered: ${extra.join(', ')}`);
    const bad = keys.filter(key => !unit(probabilities[key]));
    if (bad.length) errors.push(`probability is not a number from 0 to 1: ${bad.join(', ')}`);
    if (!missing.length && !extra.length && !bad.length) {
      const sum = options.reduce((total, option) => total + probabilities[option], 0);
      if (Math.abs(sum - 1) > sumTolerance(options.length)) errors.push(`probabilities sum to ${sum}`);
      const top = Math.max(...options.map(option => probabilities[option]));
      // Probabilities are rounded to two decimals, so a choice may trail the rounded top by a cent.
      if (options.includes(answer.choice) && probabilities[answer.choice] < top - ROUNDING) errors.push('choice is not the most probable option');
      if (unit(answer.confidence) && Math.abs(choiceConfidence(probabilities) - answer.confidence) > CONFIDENCE_TOLERANCE)
        errors.push(`confidence ${answer.confidence} does not follow from the probabilities`);
    }
  }
  return errors.length ? { ok: false, errors }
    : { ok: true, choice: answer.choice, confidence: answer.confidence, probabilities: { ...probabilities } };
};

/** The answers of one System One response, checked against the questions it was sent with. */
export const readSystemOneResponse = (response, questions) => {
  if (!isRecord(response) || !isRecord(response.answers)) return { ok: false, errors: ['response has no answers object'] };
  const asked = Object.keys(questions);
  const errors = [];
  const unknown = Object.keys(response.answers).filter(id => !asked.includes(id));
  if (unknown.length) errors.push(`answers to questions not asked: ${unknown.join(', ')}`);
  const answers = {};
  for (const id of asked) {
    if (!Object.hasOwn(response.answers, id)) { errors.push(`${id}: no answer`); continue; }
    const read = readChoiceAnswer(response.answers[id], Object.keys(questions[id].criteria));
    if (read.ok) answers[id] = read;
    else errors.push(...read.errors.map(error => `${id}: ${error}`));
  }
  return errors.length ? { ok: false, errors } : { ok: true, answers, model: response.model, usage: response.usage };
};

/** One claim's result from its checked responses. `family` is the first response read, `second`
 * the reading response with its options, absent when the family was none. The answer goes through
 * the claim's closed sets once more; its confidence is the least of the answers it is made of. */
export const jevClaimResult = (relation, family, second) => {
  if (!family.ok) return { status: 'out-of-set', errors: family.errors };
  const chosen = family.answers.family;
  const none = confidence => ({ answer: { family: JEV_NONE, roles: {}, values: {} }, confidence });
  if (chosen.choice === JEV_NONE) return { status: 'no-drawing', ...none(chosen.confidence) };
  if (!second) return { status: 'unanswered', family: chosen.choice };
  if (!second.read.ok) return { status: 'out-of-set', errors: second.read.errors };
  const { reading, values } = second.read.answers;
  const confidence = Math.min(chosen.confidence, reading.confidence, values?.confidence ?? 1);
  if (reading.choice === JEV_NONE) return { status: 'no-reading', family: chosen.choice, ...none(confidence) };
  const raw = { family: chosen.choice, roles: { ...second.options.reading.get(reading.choice) },
    values: { ...(values ? second.options.values.get(values.choice) : {}) } };
  const checked = validateJevAnswer(relation, raw);
  return checked.ok ? { status: 'proposal', answer: checked.answer, confidence } : { status: 'out-of-set', errors: checked.errors };
};

/** The record saved beside the analysis: each claim's words with Jev's checked answer and its confidence. */
export const jevRecordFrom = ({ claims, results, provenance }) => ({
  version: JEV_RECORD_VERSION,
  mappings: claims.flatMap((claim, index) => {
    const result = results[index];
    return result?.answer ? [{ stageIndex: claim.stageIndex, relationIndex: claim.relationIndex,
      terms: jevTerms(claim.relation), answer: result.answer, confidence: result.confidence }] : [];
  }),
  ...(provenance ? { provenance } : {})
});

/** One request, no retries. The body is sent exactly as saved; the received bytes are returned as text. */
export const requestJev = async ({ body: requestBody, apiKey, fetchImpl = fetch, signal }) => {
  let http;
  try {
    http = await fetchImpl(TYPESAFE_SYSTEMONE_URL, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    return { status: 'failed', httpStatus: null, text: '', error: `transport: ${error?.name ?? 'Error'}` };
  }
  const text = await http.text().catch(() => '');
  if (!http.ok) return { status: 'failed', httpStatus: http.status, text, error: `HTTP ${http.status}` };
  try { return { status: 'completed', httpStatus: http.status, text, json: JSON.parse(text) }; }
  catch { return { status: 'failed', httpStatus: http.status, text, error: 'response is not JSON' }; }
};


/** How one claim is asked, shared by the server's pass (`jevPass.js`) and the qualification
 * runner (`scripts/runJev.mjs`). `send(name, body)` posts one request and resolves to
 * `requestJev`'s result; the caller owns transport, time and saving. A claim no family can
 * read is not sent, and one whose request would carry an anchor id is withheld. */
export const askJevClaim = async ({ relation, model = DEFAULT_JEV_MODEL, send }) => {
  if (!askableFamilies(relation).length) return { result: { status: 'no-family-can-read' }, sent: [] };
  const family = buildFamilyRequest({ relation, model });
  if (anchorIdsReachRequest(relation, candidate => buildFamilyRequest({ relation: candidate, model })))
    return { result: { status: 'withheld' }, sent: [] };
  const first = await send('family', family);
  if (first.status !== 'completed') return { result: { status: 'transport-failed' }, sent: [first] };
  const familyRead = readSystemOneResponse(first.json, family.questions);
  const chosen = familyRead.ok ? familyRead.answers.family.choice : JEV_NONE;
  if (chosen === JEV_NONE) return { result: jevClaimResult(relation, familyRead), familyRead, sent: [first] };
  const reading = buildReadingRequest({ relation, family: chosen, model });
  if (anchorIdsReachRequest(relation, candidate => buildReadingRequest({ relation: candidate, family: chosen, model }).body))
    return { result: { status: 'withheld' }, familyRead, sent: [first] };
  const second = await send('reading', reading.body);
  if (second.status !== 'completed') return { result: { status: 'transport-failed' }, familyRead, sent: [first, second] };
  const readingRead = readSystemOneResponse(second.json, reading.body.questions);
  return { result: jevClaimResult(relation, familyRead, { read: readingRead, options: reading.options }),
    familyRead, readingRead, sent: [first, second] };
};

import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { JEV_NONE, JEV_RECORD_VERSION, jevFamilies, jevTerms, validateJevAnswer } from '../replay/relations/jev.ts';

/**
 * Jev's questions, asked of TypeSafe's System One model Jev (https://docs.typesafe.ai).
 *
 * One claim is asked in at most two requests over the same state, the claim's
 * own words (`jevState`): first a Choice of family, then, only when a family
 * was chosen, one Choice per authored key over that family's slots. The slot
 * options depend on the family, which is the documented reason for a second
 * request; asking every family's slots at once would make the median claim 129
 * questions and the largest 497. Every option list includes `none`, listed first.
 *
 * Answers are read only through `readChoiceAnswer`, which accepts nothing
 * outside the options asked. The reading's confidence is the least confidence
 * of the answers it is made of; Replay applies it only at or above
 * `JEV_CONFIDENCE_THRESHOLD` (replay/relations/jev.ts).
 */
export const JEV_PROMPT_VERSION = 'jev-ts-1';
export const TYPESAFE_SYSTEMONE_URL = 'https://api.typesafe.ai/v1/systemone';
/** A versioned id, not `jev-latest`: the threshold is calibrated against one model version. */
export const DEFAULT_JEV_MODEL = 'jev-1.14.0';
export const DEFAULT_TYPESAFE_KEYCHAIN_SERVICE = 'Babel TypeSafe API';

/** Published per-token price (https://docs.typesafe.ai/models.md, read 2026-10-29): input only; output is free. */
export const JEV_PRICE = { asOf: '2026-10-29', source: 'https://docs.typesafe.ai/models.md', currency: 'USD',
  models: { 'jev-1.14.0': { inputPerMillion: 0.042, outputPerMillion: 0 }, 'jev-1.13.0': { inputPerMillion: 0.042, outputPerMillion: 0 } } };

const POSITION_RULE = 'A key that names only a position or a category, such as head, specifier or complement, says nothing about which participant it is: none.';
const QUALIFIER_RULE = 'A key whose name qualifies its participant (potential, possible, candidate, failed, blocked, excluded, denied, would-be, intended, non-) is not that participant: none.';
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

const familyCriterion = family => ({ draws: family.draws, roleSlots: family.roles, valueSlots: family.values });

const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });

export const familyQuestion = relation => choice({
  question: 'Which Babel drawing family do the names in `claim` describe?',
  rules: [
    'Choose the family whose role slots mean what every key in `claim.roleKeys` says, and whose value slots mean what the keys of `claim.values` say.',
    'Choose a family only when every key in `claim.roleKeys` names one of its role slots. Otherwise choose none.',
    POSITION_RULE, QUALIFIER_RULE, WORDS_ONLY
  ]
}, { [JEV_NONE]: 'No family\'s slots mean what the claim\'s keys say.',
  ...Object.fromEntries(jevFamilies(relation).map(family => [family.id, familyCriterion(family)])) });

const slotQuestion = (family, block, key, values) => choice({
  question: block === 'roles'
    ? `Which role slot of the family ${family.id} does the role key \`${key}\` of \`claim.roleKeys\` name?`
    : `Which value slot of the family ${family.id} does the value key \`${key}\` of \`claim.values\` fill?`,
  key, ...(values ? { values } : {}), family: { id: family.id, draws: family.draws },
  rules: ['Choose a slot only when the key\'s own words say what the slot says. Otherwise choose none.',
    ...(block === 'roles' ? [POSITION_RULE, QUALIFIER_RULE] : []), WORDS_ONLY]
}, { [JEV_NONE]: 'The key names none of these slots.', ...Object.fromEntries(family[block].map(slot => [slot, null])) });

/** The second request: one question per authored key the family has slots for. `keys` maps each
 * question id, which the model never sees, back to its block and key. */
export const slotQuestions = (relation, familyId) => {
  const family = jevFamilies(relation).find(candidate => candidate.id === familyId);
  if (!family) throw new Error(`No family ${JSON.stringify(familyId)} for this claim.`);
  const terms = jevTerms(relation);
  const questions = {}, keys = {};
  terms.roles.forEach((key, index) => {
    questions[`role.${index}`] = slotQuestion(family, 'roles', key);
    keys[`role.${index}`] = { block: 'roles', key };
  });
  if (family.values.length) Object.entries(terms.values).forEach(([key, values], index) => {
    questions[`value.${index}`] = slotQuestion(family, 'values', key, values);
    keys[`value.${index}`] = { block: 'values', key };
  });
  return { questions, keys };
};

const body = (relation, questions, model) => ({ model, state: jevState(relation), questions });

export const buildFamilyRequest = ({ relation, model = DEFAULT_JEV_MODEL }) =>
  body(relation, { family: familyQuestion(relation) }, model);

export const buildSlotRequest = ({ relation, family, model = DEFAULT_JEV_MODEL }) => {
  const { questions, keys } = slotQuestions(relation, family);
  return { body: body(relation, questions, model), keys };
};

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
// Answers are rounded to two decimals; the sum of rounded probabilities drifts by half a cent per option.
const sumTolerance = options => Math.max(0.02, 0.005 * options);
const CONFIDENCE_TOLERANCE = 0.02;

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
      if (options.includes(answer.choice) && probabilities[answer.choice] < top) errors.push('choice is not the most probable option');
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

/** One claim's result from its checked responses. `family` is the first response read, `slots`
 * the second with its question keys, absent when the family was none. The answer goes through the
 * claim's closed sets once more; its confidence is the least of the answers it is made of. */
export const jevClaimResult = (relation, family, slots) => {
  if (!family.ok) return { status: 'out-of-set', errors: family.errors };
  const chosen = family.answers.family;
  if (chosen.choice === JEV_NONE)
    return { status: 'no-drawing', answer: { family: JEV_NONE, roles: {}, values: {} }, confidence: chosen.confidence };
  if (!slots) return { status: 'unanswered', family: chosen.choice };
  if (!slots.read.ok) return { status: 'out-of-set', errors: slots.read.errors };
  const raw = { family: chosen.choice, roles: {}, values: {} };
  let confidence = chosen.confidence;
  for (const [id, { block, key }] of Object.entries(slots.keys)) {
    raw[block][key] = slots.read.answers[id].choice;
    confidence = Math.min(confidence, slots.read.answers[id].confidence);
  }
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

/** TypeSafe bills input tokens only. Without usage (a dry run), `estimatedInputTokens` prices an estimate. */
export const estimateJevCost = (model, { inputTokens }) => {
  const rate = JEV_PRICE.models[model];
  if (!rate || !Number.isFinite(inputTokens)) return { status: 'unavailable', model, estimatedUsd: null };
  return { status: 'estimated', model, inputTokens, estimatedUsd: inputTokens * rate.inputPerMillion / 1e6,
    pricingAsOf: JEV_PRICE.asOf, source: JEV_PRICE.source };
};

const keyHelp = service => `Pass --key-file PATH (a file holding only the key), or add it to the macOS Keychain with: security add-generic-password -a "$USER" -s "${service}" -w`;

/** Reads the TypeSafe API key into memory, from `keyFile` when given, otherwise from the
 * macOS Keychain item `service`. The key is never written or logged. */
export const readTypeSafeApiKey = ({ keyFile, service = DEFAULT_TYPESAFE_KEYCHAIN_SERVICE,
  account = os.userInfo().username, run = execFileSync, readFile = fs.readFileSync } = {}) => {
  let key;
  if (keyFile) {
    try { key = String(readFile(keyFile, 'utf8')).trim(); }
    catch { throw new Error(`Cannot read the TypeSafe key file ${keyFile}. ${keyHelp(service)}`); }
    if (!key) throw new Error(`The TypeSafe key file ${keyFile} is empty. ${keyHelp(service)}`);
  } else {
    try {
      key = String(run('/usr/bin/security', ['find-generic-password', '-a', account, '-s', service, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim();
    } catch { key = ''; }
    if (!key) throw new Error(`No TypeSafe API key in the Keychain under "${service}". ${keyHelp(service)}`);
  }
  if (/\s/u.test(key)) throw new Error('The TypeSafe API key holds whitespace; the key source must hold only the key.');
  return key;
};

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


import { resolveResearchModelSelection } from '../server/babelParser/researchModelCatalog.js';
import { JEV_NONE, JEV_RECORD_VERSION, JEV_TIER2_FAMILIES, jevFamilies, jevTerms, validateJevAnswer } from '../replay/relations/jev.ts';
import { DEFAULT_CODEX_QUALIFICATION_MODEL } from './codexOAuth.js';

/**
 * Jev's request: the words of one analysis's neutral claims and the closed
 * sets they may be read into. It carries no tree, node, word or sentence.
 * Sent only through the Codex subscription transport (`codexOAuth.js`).
 */
export const JEV_PROMPT_VERSION = 'jev-2';

export const JEV_INSTRUCTIONS = [
  'You are Jev, a terminology reader inside Babel. Another model wrote syntactic claims; Babel did not recognise their words.',
  'For each claim, translate its words into Babel\'s words:',
  '- Pick the one family offered for that claim (its own "families" if it has them, otherwise the shared "families"), whose slot names mean what the claim\'s role and value keys say. If no family fits, the family is "none".',
  '- Map each role key to one role slot of that family, or "none". Map each value key to one value slot of that family, or "none". Several keys may share a slot.',
  '- Map a key only when its own words say what the slot says. A key that names only a position or a category, such as head, specifier or complement, says nothing about which role it plays: map it to "none".',
  '- Translate names only. Do not judge whether the claim is right and do not add anything it does not say. Babel checks the structure itself.',
  'Reply with JSON only: {"claims":[{"id":"...","family":"...","roles":{"<role key>":"<slot>"},"values":{"<value key>":"<slot>"}}]}, one entry per claim, keys exactly as given.'
].join('\n');

const familyEntry = family => ({ id: family.id, ...(family.draws.length ? { draws: family.draws } : {}),
  roleSlots: Object.keys(family.roles), valueSlots: Object.keys(family.values) });

/** claims: [{ id, relation }] with relations as Replay dispatches them. A
 * claim with an exactly registered name lists its own one family inline; every
 * other claim is offered the shared Tier-2 families. */
export const buildJevQuestion = claims => ({
  families: JEV_TIER2_FAMILIES.map(familyEntry),
  claims: claims.map(({ id, relation }) => {
    const terms = jevTerms(relation);
    const own = jevFamilies(relation);
    return { id, relation: terms.relation, roleKeys: terms.roles, values: terms.values,
      ...(own === JEV_TIER2_FAMILIES ? {} : { families: own.map(familyEntry) }) };
  })
});

export const buildJevRequest = ({ claims, model = DEFAULT_CODEX_QUALIFICATION_MODEL, effort = 'high' }) => {
  const selection = resolveResearchModelSelection(model, { 'reasoning.effort': effort });
  if (selection.provider !== 'openai') throw new Error('Jev runs only through the Codex subscription transport.');
  const question = buildJevQuestion(claims);
  return {
    selection,
    question,
    body: {
      model: selection.providerModel,
      instructions: JEV_INSTRUCTIONS,
      input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(question) }] }],
      reasoning: { effort: selection.nativeSettings['reasoning.effort'] },
      store: false,
      stream: true
    }
  };
};

/** Reads Jev's reply into one result per asked claim. Only answers inside the
 * closed sets become mappings; everything else is reported and dropped. */
export const readJevReply = (text, claims) => {
  let reply;
  try { reply = JSON.parse(String(text).trim()); }
  catch { reply = undefined; }
  const answers = Array.isArray(reply?.claims) ? reply.claims : undefined;
  const asked = new Set(claims.map(claim => claim.id));
  const unknownIds = (answers ?? []).map(answer => answer?.id).filter(id => !asked.has(id));
  const results = claims.map(({ id, relation }) => {
    if (!answers) return { id, status: 'unreadable-reply' };
    const matching = answers.filter(answer => answer?.id === id);
    if (matching.length !== 1) return { id, status: matching.length ? 'repeated-answer' : 'no-answer' };
    const { id: _id, ...raw } = matching[0];
    const checked = validateJevAnswer(relation, raw);
    if (!checked.ok) return { id, status: 'out-of-set', errors: checked.errors, raw };
    return { id, status: checked.answer.family === JEV_NONE ? 'no-drawing' : 'proposal', answer: checked.answer };
  });
  return { results, unknownIds };
};

/** The record saved beside the analysis: each claim's words with Jev's checked answer. */
export const jevRecordFrom = ({ claims, results, provenance }) => ({
  version: JEV_RECORD_VERSION,
  mappings: results.flatMap(result => {
    if (!result.answer) return [];
    const claim = claims.find(candidate => candidate.id === result.id);
    return [{ stageIndex: claim.stageIndex, relationIndex: claim.relationIndex, terms: jevTerms(claim.relation), answer: result.answer }];
  }),
  ...(provenance ? { provenance } : {})
});

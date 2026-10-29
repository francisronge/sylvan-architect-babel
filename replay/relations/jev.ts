/**
 * Jev: the part of recognition that reads the model's own terms.
 *
 * The frozen vocabulary in `tier2Synonyms.ts` reads the role and value names
 * Babel already knows. Jev, run once after generation, reads the names it
 * cannot: for one neutral claim it maps each authored role or value key to a
 * slot name of one Babel drawing family, or to nothing. Jev sees only the
 * claim's words (relation name, keys and value strings), never the tree, and
 * it chooses only from the closed sets this module builds for that claim.
 *
 * A saved answer is a per-claim alias layer over the synonym index
 * (`jevSynonymIndex`). It applies only when it reads every anchor key of the
 * claim (`jevReadingGap`). The claim is then dispatched exactly like any
 * other, so Babel's existing structure checks alone decide whether it draws.
 * A claim with no saved answer is dispatched as before.
 *
 * Exactly registered (Tier-1) names are never offered: re-reading the keys of
 * a malformed registered claim would repair it.
 */
import type { DerivationStageRelation } from '../../types.ts';
import { productionRelationRegistry } from '../relationDispatch/productionRegistry.js';
import { findRelationRegistryEntry } from '../relationDispatch/relationRegistry.js';
import type { RelationClaimDispatch } from './relationClaims.ts';
import { TIER2_FACET_RECIPES } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym, type Tier2SynonymIndex, type Tier2SynonymScope } from './tier2Synonyms.ts';

/** The one answer that is always in the closed set: no Babel slot or family. */
export const JEV_NONE = 'none';

export const JEV_RECORD_VERSION = 1;

/** The claim's own words: everything Jev reads, and the identity its answer is saved under. */
export type JevTerms = {
  relation: string;
  roles: string[];
  values: Record<string, string[]>;
};

export type JevAnswer = {
  family: string;
  roles: Record<string, string>;
  values: Record<string, string>;
};

export type JevMapping = { stageIndex: number; relationIndex: number; terms: JevTerms; answer: JevAnswer };

/** Saved beside an analysis. `provenance` records the request that produced the answers. */
export type JevRecord = { version: typeof JEV_RECORD_VERSION; mappings: JevMapping[]; provenance?: Record<string, unknown> };

/** One Tier-2 drawing family a claim may be read as. Slot names are the
 * recipe's own concept ids, which the synonym index reads as themselves. */
export type JevFamily = {
  id: string;
  /** Pieces the family draws, shown to Jev so slot names carry their purpose. */
  draws: string[];
  roles: string[];
  values: string[];
  /** Role slots the recipe fills with one participant; two keys cannot share one. */
  singleRoles: string[];
};

// Movement is recognised from the tree (`structuralMovement.ts`); its
// endpoints are read by the movement reader's own vocabulary, which an alias
// does not reach, so movement families are not offered.
const isMovementConcept = (concept: string) => concept.startsWith('movement.') || concept.startsWith('scope.source')
  || concept.startsWith('scope.landing');

/** The families every unregistered claim is offered. */
export const JEV_FAMILIES: readonly JevFamily[] = TIER2_FACET_RECIPES
  .filter(recipe => recipe.kind === 'claim' && !recipe.anchors.some(anchor => isMovementConcept(anchor.role)))
  .map(recipe => ({
    id: recipe.id,
    draws: [...new Set(recipe.outputs.map(output => output.piece))],
    roles: [...new Set(recipe.anchors.map(anchor => anchor.role))],
    values: [...new Set(recipe.values.map(value => value.value))],
    singleRoles: recipe.anchors.filter(anchor => anchor.max === 1).map(anchor => anchor.role)
  }));

const textItems = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).map(item => String(item ?? ''));

export const jevTerms = (relation: DerivationStageRelation): JevTerms => ({
  relation: String(relation.relation ?? ''),
  roles: [...new Set([...Object.keys(relation.anchors ?? {}), ...Object.keys(relation.priorAnchors ?? {})])],
  values: Object.fromEntries(Object.entries(relation.values ?? {}).map(([key, value]) => [key, textItems(value)]))
});

/** The families one claim may be read as: none for an exactly registered name. */
export const jevFamilies = (relation: DerivationStageRelation, registry = productionRelationRegistry): readonly JevFamily[] =>
  findRelationRegistryEntry(registry, relation.relation) ? [] : JEV_FAMILIES;

const ANSWER_FIELDS: Record<keyof JevAnswer, true> = { family: true, roles: true, values: true };
/** Each answer block and the synonym scope its slots are read in. */
const SCOPES: Record<'roles' | 'values', Tier2SynonymScope> = { roles: 'role', values: 'value' };
const BLOCKS = Object.keys(SCOPES) as (keyof typeof SCOPES)[];

export type JevValidation = { ok: true; answer: JevAnswer } | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Accepts an answer only when every part lies in the claim's closed sets:
 * a family offered for it (or none), its own authored keys, and that family's
 * slot names (or none). Anything else rejects the whole answer. */
export const validateJevAnswer = (relation: DerivationStageRelation, raw: unknown,
  families: readonly JevFamily[] = jevFamilies(relation)): JevValidation => {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    errors.push('answer is not an object');
    return { ok: false, errors };
  }
  const extra = Object.keys(raw).filter(key => !Object.hasOwn(ANSWER_FIELDS, key));
  if (extra.length) errors.push(`unknown answer fields: ${extra.join(', ')}`);
  const family = families.find(candidate => candidate.id === raw.family);
  if (raw.family !== JEV_NONE && !family) errors.push(`family not offered: ${JSON.stringify(raw.family)}`);
  const terms = jevTerms(relation);
  const authored = { roles: terms.roles, values: Object.keys(terms.values) };
  const answer: JevAnswer = { family: family?.id ?? JEV_NONE, roles: {}, values: {} };
  for (const field of BLOCKS) {
    const block = raw[field] ?? {};
    if (!isRecord(block)) { errors.push(`${field} is not an object`); continue; }
    const slots = family?.[field] ?? [];
    const bySpelling = new Map<string, unknown>();
    for (const [key, slot] of Object.entries(block)) {
      const spelling = normalizeTier2Synonym(key);
      if (!authored[field].includes(key)) errors.push(`${field} key not authored: ${JSON.stringify(key)}`);
      else if (slot !== JEV_NONE && !(typeof slot === 'string' && slots.includes(slot)))
        errors.push(`${field}.${key}: slot not in family: ${JSON.stringify(slot)}`);
      else if (bySpelling.has(spelling) && bySpelling.get(spelling) !== slot)
        errors.push(`${field}.${key}: one spelling read as two slots`);
      else {
        bySpelling.set(spelling, slot);
        if (slot !== JEV_NONE) answer[field][key] = slot;
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, answer };
};

/** Why a closed-set answer still cannot be a reading of the whole claim, if it
 * cannot: a reading names a slot for every anchor key, since a key left out
 * would keep its old meaning beside the new ones, and no two keys share a slot
 * the recipe fills with one participant. */
export const jevReadingGap = (relation: DerivationStageRelation, answer: JevAnswer): string | undefined => {
  const family = jevFamilies(relation).find(candidate => candidate.id === answer.family);
  if (!family) return 'no family';
  const unread = jevTerms(relation).roles.filter(key => !Object.hasOwn(answer.roles, key));
  if (unread.length) return `anchor keys left unread: ${unread.join(', ')}`;
  const shared = family.singleRoles.filter(slot => Object.values(answer.roles).filter(mapped => mapped === slot).length > 1);
  return shared.length ? `keys share a one-participant slot: ${shared.join(', ')}` : undefined;
};

/** The saved answer for this exact claim: same position and the same words Jev
 * read, still inside the closed sets and reading every anchor key. */
export const jevAnswerFor = (record: JevRecord | undefined, stageIndex: number, relationIndex: number,
  relation: DerivationStageRelation): JevAnswer | undefined => {
  if (record?.version !== JEV_RECORD_VERSION) return undefined;
  const terms = JSON.stringify(jevTerms(relation));
  const mapping = record.mappings.find(candidate => candidate.stageIndex === stageIndex
    && candidate.relationIndex === relationIndex && JSON.stringify(candidate.terms) === terms);
  if (!mapping) return undefined;
  // A saved record is re-validated, so a hand-edited or stale answer cannot widen the closed sets.
  const checked = validateJevAnswer(relation, mapping.answer);
  return checked.ok && !jevReadingGap(relation, checked.answer) ? checked.answer : undefined;
};

/** The synonym index this claim is read with: each mapped authored key reads
 * as its slot's concept and nothing else. Every other spelling is unchanged. */
export const jevSynonymIndex = (base: Tier2SynonymIndex, relation: DerivationStageRelation, answer: JevAnswer): Tier2SynonymIndex => {
  const family = jevFamilies(relation).find(candidate => candidate.id === answer.family);
  const index: Tier2SynonymIndex = new Map(base);
  if (!family) return index;
  for (const field of BLOCKS) {
    const scope = SCOPES[field];
    for (const [key, slot] of Object.entries(answer[field])) {
      const spelling = normalizeTier2Synonym(key);
      index.set(spelling, [...(index.get(spelling) ?? []).filter(candidate => candidate.scope !== scope),
        { scope, concept: slot }]);
    }
  }
  return index;
};

/** Whether the aliased reading stands: it draws, and only the family Jev named. */
export const jevReadingDraws = (dispatch: RelationClaimDispatch, answer: JevAnswer): boolean => {
  const drawn = dispatch.claims.filter(claim => claim.tier !== 3);
  return drawn.length > 0 && drawn.every(claim => claim.tier === 2 && claim.facet.recipe.id === answer.family);
};

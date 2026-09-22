import type { SyntaxNode } from '../../types.ts';
import { categoryLabel } from '../categoryLabel.ts';

/**
 * Shared renderer-side vocabulary for registered role binding, Tier-2 facet
 * recognition and Replay. Candidate meanings still need the owning recipe.
 *
 * These terms are invisible to the model. Lookup is exact after declared
 * Unicode/case/separator normalization. A collision returns every candidate;
 * the complete facet signature must disambiguate it. Vocabulary order never
 * selects a winner. Qualified assignment roles compose through the explicit
 * domain/direction rules below; there is no fuzzy or title/prose matching.
 */

export type Tier2SynonymScope = 'role' | 'value';

export type Tier2SynonymGroup = {
  scope: Tier2SynonymScope;
  concept: string;
  aliases: readonly string[];
  /** Valid slot aliases only after the claim's meaning is established. */
  contextualAliases?: readonly string[];
};

const group = (
  scope: Tier2SynonymScope,
  concept: string,
  aliases: readonly string[],
  contextualAliases: readonly string[] = []
): Tier2SynonymGroup => ({ scope, concept, aliases: [concept, ...aliases, ...contextualAliases], contextualAliases });

export const normalizeTier2Synonym = (value: unknown): string => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
  .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
  .toLocaleLowerCase('en-US')
  .replace(/[\s_-]+/gu, ' ')
  .replace(/\s+/gu, ' ');

// Equivalent licensing roles must have the same candidates in every recipe and
// in qualified assignment roles. They supply direction, not proof of Agree or
// Case: those meanings still require the owning recipe's evidence checks.
const licensingSources = ['licensor', 'licenser', 'license source', 'licensing head'];
const licensingTargets = ['licensee', 'licensed item', 'licensed phrase', 'licensed constituent', 'licensed nominal', 'licensing target'];
export const FEATURE_DIMENSION_KEYS = new Set(['person', 'number', 'gender']);

/** Scalar argument/role fields can name the same qualified slot without using
 * the same suffix. Lists still require the contract's exact-name pairing. */
export const thematicSlotQualifier = (key: string, kind: 'anchor' | 'value'): string | undefined => {
  const pattern = kind === 'anchor' ? /^(.+?) (?:argument(?: position)?|thematic position|theta position)$/u
    : /^(.+?) (?:(?:theta|thematic) )?role$/u;
  return pattern.exec(normalizeTier2Synonym(key))?.[1]
    ?? (kind === 'anchor' ? normalizeTier2Synonym(key) : undefined);
};

// Inflect only declared role nouns. This does not stem arbitrary open names.
const singularRole = (key: string) => key.replace(/\b(assigners|sources|targets|goals|recipients|assignees|bearers|governors|licensors|licensers|predicates|arguments|heads|introducers)$/u,
  noun => noun.slice(0, -1));

export const TIER2_ROLE_SYNONYMS: readonly Tier2SynonymGroup[] = [
  group('role', 'movement.source', ['source', 'origin', 'from', 'lower copy', 'lower occurrence', 'intermediate occurrence', 'base copy', 'base position', 'departure', 'moved from', 'real gap', 'variable', 'foot']),
  group('role', 'movement.witness', ['trace witness', 'lower witness', 'source witness', 'gap witness', 'trace', 'lower trace', 'departure witness']),
  group('role', 'movement.landing', ['landing', 'landing site', 'target', 'to', 'destination', 'pronounced copy', 'higher copy', 'higher occurrence', 'upper occurrence', 'raised copy', 'raised head', 'moved head', 'moved phrase', 'filler', 'operator', 'head']),
  group('role', 'movement.host', ['host head', 'attracting head', 'landing head', 'receiving head']),
  group('role', 'movement.complex', ['complex head', 'head complex']),
  group('role', 'movement.carrier', ['carrier', 'moved carrier', 'containing phrase', 'remnant', 'smuggled phrase', 'transported constituent']),
  group('role', 'gap', ['gap', 'trace', 'empty position', 'lower gap', 'ordinary gap', 'real gap', 'gap site']),
  group('role', 'occurrences', ['occurrences', 'copies', 'identity family', 'chain occurrences', 'coindexed occurrences']),
  group('role', 'association.particle', ['particle', 'focus particle', 'association particle', 'additive', 'additive particle']),
  group('role', 'association.associate', ['associate', 'focus associate', 'associated constituent']),
  group('role', 'facet.anchors', ['anchors', 'participants', 'relation anchors', 'facet anchors', 'witnesses']),

  group('role', 'controller', ['controller', 'control source'], ['antecedent', 'matrix argument']),
  group('role', 'controllee', ['controllee', 'controlee', 'controlled', 'controlled subject'], ['pro', 'silent subject']),
  group('role', 'domain', ['domain', 'region', 'scope', 'constituent domain', 'local domain']),
  group('role', 'binder', ['binder', 'antecedent', 'binding source'], ['operator']),
  group('role', 'dependent', ['dependent', 'bound', 'anaphor', 'pronoun', 'binding target'], ['variable']),
  group('role', 'predicand', ['predicand', 'subject', 'predicate subject'], ['theme']),
  group('role', 'predicate', ['predicate', 'predicates', 'predicate phrase', 'secondary predicate', 'lexical predicate']),
  group('role', 'primary.path', ['primary path', 'ordinary path', 'main path', 'circular path', 'real path']),
  group('role', 'secondary.path', ['secondary path', 'parasitic path', 'square path', 'dependent path']),
  group('role', 'filler', ['filler', 'operator', 'wh filler', 'pronounced filler', 'antecedent']),
  group('role', 'ordinary.gap', ['ordinary gap', 'real gap', 'primary gap', 'object gap', 'trace']),
  group('role', 'parasitic.gap', ['parasitic gap', 'parasitic gaps', 'secondary gap', 'pg']),
  group('role', 'boundary', ['boundary', 'boundaries', 'bounding node', 'bounding nodes', 'barrier', 'crossed boundary']),

  group('role', 'ellipsis.site', ['ellipsis site', 'elided site', 'ellipsis domain', 'deleted domain'], ['site', 'silent site', 'unpronounced domain']),
  group('role', 'correspondence.source', ['correspondence source', 'source correlate', 'antecedent', 'antecedent member', 'left correlate']),
  group('role', 'correspondence.sources', ['correspondence sources', 'sources', 'antecedents', 'input set', 'source set']),
  group('role', 'correspondence.target', ['correspondence target', 'target correlate', 'site', 'remnant', 'right correlate']),
  group('role', 'correspondence.targets', ['correspondence targets', 'targets', 'sites', 'outputs', 'target set']),
  group('role', 'deleted.material', ['deleted material', 'deleted', 'deletion target', 'deleted subconstituent']),
  group('role', 'constituent', ['constituent', 'phrase', 'shell', 'carrier', 'occurrence', 'subtree']),

  group('role', 'host', ['host', 'pair host', 'merge host', 'attachment host']),
  group('role', 'pair.member', ['pair member', 'adjunct', 'member', 'pair merged item']),
  group('role', 'parents', ['parents', 'mothers', 'dominators', 'shared parents']),
  group('role', 'shared', ['shared', 'shared node', 'shared constituent', 'multidominated node']),
  group('role', 'predicate.domains', ['predicate domains', 'domains', 'serial predicates', 'argument domains']),
  group('role', 'shared.argument', ['shared argument', 'shared object', 'shared subject', 'shared goal'], ['argument']),
  group('role', 'chunks', ['idiom chunks', 'idiomatic chunks'], ['chunks', 'chunk anchors', 'cointerpreted chunks']),
  group('role', 'interpretation.domain', ['idiom domain'], ['interpretation domain', 'cointerpretation domain', 'domain']),

  group('role', 'plaque.anchor', ['plaque anchor', 'anchor', 'participant', 'terminal', 'word', 'predicate']),
  group('role', 'feature.bearers', ['feature bearers', 'bearers', 'participants', 'feature holders', 'sharing members']),
  group('role', 'probe', ['probe', 'searcher', 'agree probe', 'feature source'], licensingSources),
  group('role', 'goal', ['goal', 'goals', 'agree goal', 'agreement goal', 'goal at agreement', 'feature target'], ['target', ...licensingTargets]),
  group('role', 'feature.source', ['feature source', 'source', 'probe', 'assigner', 'collector', ...licensingSources]),
  group('role', 'feature.target', ['feature target', 'target', 'goal', 'bearer', 'recipient', 'valued node', ...licensingTargets]),
  group('role', 'feature.hierarchy', ['feature hierarchy', 'hierarchy', 'feature tree', 'feature sequence', 'feature links']),

  group('role', 'phase', ['phase', 'phase domain', 'phase phrase']),
  group('role', 'phase.head', ['phase head']),
  group('role', 'phase.edge', ['phase edge', 'edge', 'escape hatch', 'edge position', 'phase periphery', 'accessible DPs', 'accessible subject', 'accessible wh occurrence']),
  group('role', 'transfer.domain', ['transfer domain', 'spell out domain', 'spellout domain', 'transferred domain', 'transferred complement'], ['complement', 'complement domain']),
  group('role', 'access.source', ['access source', 'source', 'probe', 'search source', 'higher probe']),
  group('role', 'access.target', ['access target', 'target', 'goal', 'inaccessible goal', 'embedded target']),

  group('role', 'licensed.hosts', ['licensed hosts', 'licensed landing hosts', 'allowed hosts', 'valid candidates']),
  group('role', 'rejected.hosts', ['rejected hosts', 'rejected landing hosts', 'blocked hosts', 'invalid candidates']),
  group('role', 'analysis.anchor', ['analysis', 'analysis anchor', 'judged analysis', 'configuration']),
  group('role', 'judged.anchor', ['judged anchor', 'candidate', 'target']),
  group('role', 'intervention.target', ['intervention target', 'target', 'source', 'lower target', 'dependency source']),
  group('role', 'intervention.landing', ['intervention landing', 'landing', 'probe', 'intended landing', 'dependency target']),
  group('role', 'intervener', ['intervener', 'closer goal', 'closer phrase', 'blocker', 'intervening node', 'intervening operator', 'intervening head', 'intervening phrase']),
  group('role', 'extraction.source', ['extraction source', 'source', 'embedded source', 'lower occurrence', 'gap']),
  group('role', 'extraction.target', ['extraction target', 'target', 'landing site', 'landing', 'higher occurrence']),
  group('role', 'adjunct.domain', ['adjunct domain', 'adjunct', 'island domain', 'blocked domain', 'extraction domain']),

  group('role', 'focus', ['focus', 'focused', 'focus constituent', 'prominent branch']),
  group('role', 'background', ['background', 'background sister', 'nonfocus', 'weak branch']),
  group('role', 'accent.bearer', ['accent bearer', 'accented', 'pitch accent bearer', 'prosodic head']),
  group('role', 'projection.nodes', ['projection nodes', 'projections', 'focus projections', 'f marked nodes', 'inheritance path']),
  group('role', 'licensor', [...licensingSources, 'operator', 'exhaustifier']),
  group('role', 'licensee', [...licensingTargets, 'npi', 'goal']),
  group('role', 'polarity.item', ['negative polarity item', 'polarity item', 'npi', 'minimizer']),

  group('role', 'scope', ['scope', 'scope anchor', 'sentence', 'clause', 'storage host']),
  group('role', 'scope.source', ['covert source', 'covert movement source'], ['scope source', 'pronounced qp', 'source', 'lower qp', 'surface quantifier']),
  group('role', 'scope.landing', ['covert landing', 'covert movement landing'], ['scope landing', 'lf qp', 'target', 'higher qp']),
  group('role', 'scope.domain', ['scope domain', 'domain', 'interpreted scope', 'semantic domain']),
  group('role', 'operator', ['operator', 'quantifier', 'scope taker'], ['binder']),
  group('role', 'variable', ['variable', 'bound variable'], ['pronoun', 'trace', 'dependent']),

  group('role', 'theta.arguments', ['theta arguments', 'arguments', 'argument', 'internal argument', 'external argument', 'role bearers', 'thematic arguments']),
  group('role', 'rewrite.input', ['rewrite input', 'input', 'prior terminal', 'source form', 'underlying form']),
  group('role', 'rewrite.output', ['rewrite output', 'output', 'current terminal', 'surface form', 'exponent', 'supported head', 'supported tense', 'tense host', 'realization host']),
  group('role', 'pf.host', ['supported tense', 'tense host', 'realization host']),
  group('role', 'rewrite.outputs', ['rewrite outputs', 'outputs', 'current terminals', 'surface forms', 'exponents']),
  group('role', 'pf.contributors', ['contributors', 'realization contributors', 'realization participants']),
  group('role', 'terminal', ['terminal', 'target terminal', 'word', 'morpheme', 'feature terminal']),
  group('role', 'sequence', ['sequence', 'order', 'items', 'pieces', 'linear sequence']),
  group('role', 'order', ['order', 'precedence order', 'linearization', 'ordering statements', 'sequence']),
  group('role', 'large.anchor.array', ['large anchor array', 'anchor array', 'members', 'participants', 'ordered anchors'])
];

export const TIER2_VALUE_SYNONYMS: readonly Tier2SynonymGroup[] = [
  group('value', 'outcome', ['outcome', 'result', 'status', 'verdict', 'judgment']),
  group('value', 'movement.route', ['route', 'movement route', 'path shape', 'trajectory shape', 'movement geometry']),
  group('value', 'verdict', ['verdict', 'judgment', 'judgment glyph', 'verdict glyph', 'outcome glyph', 'failure face', 'success face']),
  group('value', 'index', ['index', 'coindex', 'chain index', 'relation index', 'ordinal']),
  group('value', 'label', ['label', 'annotation', 'caption', 'literal label']),
  group('value', 'role.label', ['role label', 'roles', 'argument role', 'theta role', 'function label']),
  group('value', 'case.literal', ['case', 'case value', 'case label', 'valued case', 'abstract case', 'structural case', 'inherent case']),
  group('value', 'feature.label', ['feature label', 'feature', 'feature notation', 'feature mark']),
  group('value', 'accent.label', ['accent label', 'accent', 'pitch accent', 'tone mark']),
  group('value', 'cycle', ['cycle', 'round', 'pass', 'iteration', 'search cycle', 'derivational cycle']),
  group('value', 'step', ['step']),
  group('value', 'feature.rows', ['feature rows', 'features', 'feature bundle', 'valuations', 'feature values', 'agreement', 'agreement features', 'checked features', 'phi', 'φ', 'phi features', ...FEATURE_DIMENSION_KEYS]),
  group('value', 'plaque.rows', ['plaque rows', 'rows', 'fields', 'entries', 'record values']),
  group('value', 'pf.rows', ['pf rows', 'pf plate rows', 'morphology rows', 'realization plate rows', 'pf entries', 'realization', 'tense', 'exponent']),
  group('value', 'pf.surface', ['surface form', 'realized form', 'surface realization', 'surface word', 'surface token', 'input token', 'realization']),
  group('value', 'fission.input', ['input features']),
  group('value', 'fission.output', ['output features', 'outputs features', 'bundle features']),
  group('value', 'feature.hierarchy', ['feature hierarchy']),
  group('value', 'pf.sources', ['sources']),
  group('value', 'pf.exponents', ['exponents']),
  group('value', 'storage.category', ['category']),
  group('value', 'storage.qstore', ['qstore']),
  group('value', 'storage.retrieved', ['retrieved']),
  group('value', 'rewrite.rows', ['rewrite rows', 'mapping', 'input output rows', 'realization rows']),
  group('value', 'delink.position', ['delink position', 'delink after', 'removed link', 'crossed link'])
];

// Candidate lookup stays shared with Tier 1. This narrower question concerns
// what the authored wording establishes without a registered relation name.
export const isExplicitTier2Role = (concept: string, key: string): boolean => {
  const entry = TIER2_ROLE_SYNONYMS.find(group => group.concept === concept);
  const normalized = normalizeTier2Synonym(key);
  return [...qualifiedControlConcepts(normalized), ...qualifiedReferenceConcepts(normalized), ...qualifiedMemberConcepts(normalized)].includes(concept) || Boolean(entry?.aliases.some(alias => normalizeTier2Synonym(alias) === normalized)
    && !entry.contextualAliases?.some(alias => normalizeTier2Synonym(alias) === normalized));
};

export type Tier2SynonymCandidate = {
  scope: Tier2SynonymScope;
  concept: string;
};

export type Tier2SynonymIndex = Map<string, Tier2SynonymCandidate[]>;

// Native scalar slots and structural recovery share the same literal meanings.
// A value name supplies a candidate, never the rest of a drawing's signature.
export const NATIVE_VALUE_CONCEPTS: Readonly<Record<string, string>> = {
  feature: 'feature.label', accent: 'accent.label', role: 'role.label', case: 'case.literal',
  featureHierarchy: 'feature.hierarchy', delinkAfter: 'delink.position',
  category: 'storage.category', qstore: 'storage.qstore', retrieved: 'storage.retrieved'
};

export const buildTier2SynonymIndex = (): Tier2SynonymIndex => {
  const index: Tier2SynonymIndex = new Map();
  const groups = [
    ...TIER2_ROLE_SYNONYMS,
    ...TIER2_VALUE_SYNONYMS,
    ...Object.entries(NATIVE_VALUE_CONCEPTS).map(([key, concept]) => group('value', concept, [key]))
  ];

  groups.forEach(({ scope, concept, aliases }) => {
    new Set(aliases.map(normalizeTier2Synonym).filter(Boolean)).forEach((alias) => {
      const candidates = index.get(alias) ?? [];
      if (!candidates.some((candidate) => candidate.scope === scope && candidate.concept === concept)) {
        candidates.push({ scope, concept });
      }
      candidates.sort((left, right) => (
        left.scope.localeCompare(right.scope, 'en-US')
        || left.concept.localeCompare(right.concept, 'en-US')
      ));
      index.set(alias, candidates);
    });
  });
  return index;
};

export const lookupTier2SynonymCandidates = (
  index: Tier2SynonymIndex,
  scope: Tier2SynonymScope,
  literal: unknown
): string[] => (index.get(normalizeTier2Synonym(literal))
  ?? (scope === 'role' ? index.get(singularRole(normalizeTier2Synonym(literal))) : undefined) ?? [])
  .filter((candidate) => candidate.scope === scope)
  .map((candidate) => candidate.concept);

/** Interpret qualified assignment roles as a domain plus a direction, never from titles or prose. */
const assignmentDirection = (role: string): 'source' | 'target' | undefined =>
  ['assigner', 'source', ...licensingSources].includes(role) || /^assigning (?:head|predicate)$/u.test(role) ? 'source'
    : ['target', 'recipient', 'assignee', 'bearer', 'marked', ...licensingTargets].includes(role)
      || /^licensed [\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u.test(role) ? 'target' : undefined;

// A position or occurrence qualifier preserves an explicit control role. It
// never chooses an occurrence from a chain or makes a bare PRO its controllee.
const qualifiedControlConcepts = (role: string): string[] =>
  /^controller (?:(?:theta|thematic|chain) )?(?:position|occurrence|head)$/u.test(role) ? ['controller']
    : /^controlled (?:pro|subject|nominal|argument|np|dp|phrase|constituent|occurrence)$/u.test(role) ? ['controllee'] : [];

// The noun identifies the anchored object; its binding qualification keeps the
// declared role. A trace by itself supplies neither binding nor an operator.
const qualifiedReferenceConcepts = (role: string): string[] =>
  /^(?:bound|anaphoric) (?:trace|occurrence|copy|expression|nominal|pronoun)$/u.test(role) ? ['dependent']
    : /^(?:argument|bound|scope) variable$/u.test(role) || /^(?:bound )?variable (?:occurrence|position)$/u.test(role) ? ['variable']
      : /^(?:operator|quantifier) (?:occurrence|position)$/u.test(role) ? ['operator'] : [];

const qualifiedMemberConcepts = (role: string): string[] =>
  /^(?:idiom|idiomatic) (?:verb|noun|nominal|head|phrase|constituent|member|chunk|component)s?$/u.test(role) ? ['chunks']
    : /^(?:licensing (?:head|dp|np|phrase|nominal|operator)|c commanding licen[cs](?:or|er))$/u.test(role) ? ['licensor']
      : /^parasitic (?:gap|object|argument|position|occurrence)s?$/u.test(role) ? ['parasitic.gap'] : [];

const qualifiedPredicateRole = (role: string) => /^(?:active|passive|causative|applicative|verbal|nominal|adjectival) predicate$/u.test(role);

const thematicIntroducer = (role: string) => role === 'introducer' || /^introducing (?:head|predicate)$/u.test(role);

export const qualifiedAssignmentConcepts = (key: string): string[] => {
  const [domain, ...rest] = singularRole(normalizeTier2Synonym(key)).split(' ');
  const role = rest.join(' ');
  const source = assignmentDirection(role) === 'source' || (domain === 'case' && role === 'governor');
  const target = assignmentDirection(role) === 'target';
  if (['theta', 'thematic', 'θ'].includes(domain)) {
    return source || ['head', 'predicate'].includes(role) || thematicIntroducer(role) ? ['predicate']
      : target || role === 'argument' ? ['theta.arguments'] : [];
  }
  if (['case', 'feature'].includes(domain)) return source ? ['feature.source'] : target ? ['feature.target'] : [];
  return [];
};

// Conventional abbreviations compare authored Case labels without changing them.
// Other labels compare literally, so this vocabulary does not restrict Case values.
const CASE_NOTATION = new Map([
  ['nom', 'nominative'], ['acc', 'accusative'], ['gen', 'genitive'], ['dat', 'dative'],
  ['erg', 'ergative'], ['abs', 'absolutive'], ['ins', 'instrumental'], ['loc', 'locative'],
  ['obl', 'oblique'], ['voc', 'vocative']
]);
const caseLiteralIdentity = (value: string) => {
  const normalized = normalizeTier2Synonym(value);
  return CASE_NOTATION.get(normalized) ?? normalized;
};

// Direction is insufficient: the qualifier must itself identify Case or match
// an independently authored Case value. A spatial/semantic goal is not a Case goal.
const qualifiedCaseDirection = (role: string, literals: readonly string[], index: Tier2SynonymIndex): 'source' | 'target' | undefined => {
  const match = /^([\p{L}\p{N} ]+) (assigner|source|licensor|licenser|goal|recipient|assignee|bearer)$/u.exec(role);
  if (!match || (!lookupTier2SynonymCandidates(index, 'value', match[1]).includes('case.literal')
    && !literals.some(value => caseLiteralIdentity(value) === caseLiteralIdentity(match[1])))) return undefined;
  return ['assigner', 'source', 'licensor', 'licenser'].includes(match[2]) ? 'source' : 'target';
};

/** Feature-property modifiers preserve their literal row labels. A qualified
 * participant property needs one complete dependency and no competing owner. */
export const relationValueConcepts = (index: Tier2SynonymIndex, key: string,
  context: { anchors?: Record<string, unknown>; values?: Record<string, unknown>; relation?: string } = {}): string[] => {
  const concepts = new Set(lookupTier2SynonymCandidates(index, 'value', key));
  const normalized = normalizeTier2Synonym(key);
  if (normalized === 'status' && isWholeClauseJudgmentRelation(context.relation ?? '')) concepts.add('verdict');
  if (/(?:^| )role$/u.test(normalized)
    && Object.keys(context.anchors ?? {}).some(role => lookupTier2SynonymCandidates(index, 'role', role).includes('predicate'))
    && Object.keys(context.anchors ?? {}).some(role => typeof context.values?.[key] === 'string'
      && normalizeTier2Synonym(context.values[key]) === normalizeTier2Synonym(role)))
    concepts.add('role.label');
  if (/^(?:overt|covert|checked|valued) agreement$/u.test(normalized)) concepts.add('feature.rows');
  const match = /^(.+?) (?:features|feature bundle)$/u.exec(normalized);
  if (match && !concepts.has('feature.rows')) {
    const entries = Object.entries(context.anchors ?? {});
    const roleConcepts = (role: string) => [...lookupTier2SynonymCandidates(index, 'role', role), ...qualifiedAssignmentConcepts(role)];
    const sources = entries.filter(([role]) => roleConcepts(role).some(c => ['feature.source', 'probe'].includes(c)));
    const targets = entries.filter(([role]) => roleConcepts(role).some(c => ['feature.target', 'goal'].includes(c)));
    const single = (group: typeof entries) => group.length === 1 && typeof group[0][1] === 'string';
    if (single(sources) && single(targets) && sources[0][1] !== targets[0][1]) {
      const owners = entries.filter(([role]) => normalizeTier2Synonym(role) === match[1]);
      if (owners.length === 1 && [sources[0][1], targets[0][1]].includes(owners[0][1])
        || owners.length === 0 && entries.length === 2) concepts.add('feature.rows');
    }
  }
  return [...concepts];
};

export const isWholeClauseJudgmentRelation = (name: string): boolean =>
  /\b(?:grammaticality|convergence)\b/u.test(normalizeTier2Synonym(name))
  || /\b(?:derivational|derivation|analysis|well formedness)\b.*\b(?:judgment|assessment)\b/u
    .test(normalizeTier2Synonym(name));

export const relationRoleConcepts = (
  index: Tier2SynonymIndex,
  key: string,
  context: { relation?: string; anchors?: Record<string, unknown>; values?: Record<string, unknown>; forest?: readonly SyntaxNode[] } = {}
): string[] => {
  // An explicit controller owns the endpoint; additional descriptions of its
  // chain/thematic occurrences stay contextual. Qualified roles fill an absent slot.
  const directController = Object.keys(context.anchors ?? {}).some(role =>
    !qualifiedControlConcepts(normalizeTier2Synonym(role)).length
    && isExplicitTier2Role('controller', role));
  const qualifiedControl = qualifiedControlConcepts(normalizeTier2Synonym(key))
    .filter(concept => concept !== 'controller' || !directController);
  const concepts = new Set([...lookupTier2SynonymCandidates(index, 'role', key), ...qualifiedAssignmentConcepts(key),
    ...qualifiedControl, ...qualifiedReferenceConcepts(normalizeTier2Synonym(key)), ...qualifiedMemberConcepts(normalizeTier2Synonym(key))]);
  const spelling = singularRole(normalizeTier2Synonym(key));
  // The authored NPI claim identifies what a generic "licensee" is here.
  // Generic licensing alone does not license a polarity drawing.
  if (spelling === 'licensee' && /\b(?:npi|negative polarity)\b/u.test(normalizeTier2Synonym(context.relation ?? '')))
    concepts.add('polarity.item');
  // A whole-clause judgment may call its exact target "root" or "clause".
  // These broad names carry verdict meaning only in an authored judgment.
  const relationName = normalizeTier2Synonym(context.relation ?? '');
  if (['root', 'clause', 'sentence', 'candidate', 'completed root', 'analysis root', 'completed structure'].includes(spelling)
    && isWholeClauseJudgmentRelation(relationName))
    concepts.add('analysis.anchor');
  // A position/occurrence names the anchored instance of an existing role.
  // It does not identify another point in that role's chain.
  const positioned = /^(subject|finite head) (?:position|occurrence)$/u.exec(spelling)?.[1];
  if (positioned === 'subject') concepts.add('predicand');
  if (qualifiedPredicateRole(spelling)) concepts.add('predicate');
  const currentEntries = Object.entries(context.anchors ?? {});
  const singleton = (value: unknown) => typeof value === 'string' || Array.isArray(value) && value.length === 1;
  const antecedents = currentEntries.filter(([role, value]) => ['antecedent', 'antecedent domain'].includes(normalizeTier2Synonym(role)) && singleton(value));
  const ellipsisSites = currentEntries.filter(([role, value]) => isExplicitTier2Role('ellipsis.site', role) && singleton(value));
  if (antecedents.length === 1 && ellipsisSites.length === 1) {
    if (key === antecedents[0][0]) concepts.add('correspondence.source');
    if (key === ellipsisSites[0][0]) concepts.add('correspondence.target');
  }
  const hasParasiticRole = Object.keys(context.anchors ?? {}).some(role =>
    qualifiedMemberConcepts(normalizeTier2Synonym(role)).includes('parasitic.gap'));
  if (hasParasiticRole && /^wh licen[cs](?:or|er)$/u.test(spelling)) concepts.add('filler');
  if (hasParasiticRole && /^(?:matrix|ordinary|primary) (?:gap|object|argument|position|occurrence)$/u.test(spelling)) concepts.add('ordinary.gap');
  // Direction plus an occurrence type supplies a candidate role. The movement
  // reader must still prove exact lineage, the preceding slot and the landing.
  const movementSpelling = spelling.replace(/^(?:shared|prior) /u, '')
    .replace(/\b(occurrences|copies|sources|heads|phrases|constituents)$/u, noun => noun === 'copies' ? 'copy' : noun.slice(0, -1));
  if (movementSpelling !== normalizeTier2Synonym(key)) lookupTier2SynonymCandidates(index, 'role', movementSpelling)
    .filter(concept => concept.startsWith('movement.')).forEach(concept => concepts.add(concept));
  const occurrence = /^(?:movement )?(source|lower|base|intermediate|landing|target|higher|upper|raised|moved) (head|phrase|constituent|occurrence|copy|complex)$/.exec(movementSpelling);
  if (occurrence && ![...concepts].some(concept => concept.startsWith('movement.'))) concepts.add(['source', 'lower', 'base', 'intermediate'].includes(occurrence[1])
    ? 'movement.source' : 'movement.landing');
  // A domain-qualified role retains the direction of its existing role word.
  if (spelling.startsWith('movement ')) {
    lookupTier2SynonymCandidates(index, 'role', spelling.slice('movement '.length))
      .filter(concept => concept.startsWith('movement.')).forEach(concept => concepts.add(concept));
  }
  // Searching and valuing are the more specific roles of a feature dependency.
  if (concepts.has('probe')) concepts.add('feature.source');
  if (concepts.has('goal')) concepts.add('feature.target');
  const nonBlankLiteral = (value: unknown) => (Array.isArray(value) ? value : [value])
    .some(item => typeof item === 'string' && item.trim());
  const hasLiteral = (concept: string) => Object.entries(context.values ?? {}).some(([key, value]) =>
    relationValueConcepts(index, key, context).includes(concept)
      && nonBlankLiteral(value));
  const caseLiterals = Object.entries(context.values ?? {}).filter(([key]) =>
    lookupTier2SynonymCandidates(index, 'value', key).includes('case.literal'))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  const caseDirection = (role: string) => hasLiteral('case.literal')
    && lookupTier2SynonymCandidates(index, 'role', role).length === 0
    && qualifiedAssignmentConcepts(role).length === 0
    ? qualifiedCaseDirection(singularRole(normalizeTier2Synonym(role)), caseLiterals, index) : undefined;
  const currentCaseDirection = caseDirection(key);
  if (currentCaseDirection) concepts.add(currentCaseDirection === 'source' ? 'feature.source' : 'feature.target');
  const explicitThematicPredicate = Object.keys(context.anchors ?? {}).some(role =>
    lookupTier2SynonymCandidates(index, 'role', role).includes('predicate') || qualifiedAssignmentConcepts(role).includes('predicate')
      || qualifiedPredicateRole(normalizeTier2Synonym(role)));
  const thematicParticipant = (role: string) => ['agent', 'theme', 'patient', 'experiencer', 'beneficiary', 'instrument', 'location'].includes(normalizeTier2Synonym(role))
    || explicitThematicPredicate && ['recipient', 'goal'].includes(normalizeTier2Synonym(role));
  const explicitlyNamedThematicParticipant = (role: string) => {
    const name = normalizeTier2Synonym(role);
    if (!name || ['predicate', 'introducer', 'subject'].includes(name)) return false;
    return Object.entries(context.values ?? {}).some(([valueKey, literal]) =>
      /^(?:theta|thematic|θ) role$/u.test(normalizeTier2Synonym(valueKey))
      && typeof literal === 'string'
      && ` ${normalizeTier2Synonym(literal)} `.includes(` ${name} `));
  };
  const namedThematicValue = (role: string) => thematicParticipant(role) && Object.entries(context.values ?? {}).some(([valueKey, literal]) =>
    normalizeTier2Synonym(valueKey) === normalizeTier2Synonym(role) && nonBlankLiteral(literal));
  const valueNamesThematicParticipant = (role: string) => explicitThematicPredicate
    && Object.entries(context.values ?? {}).some(([valueKey, literal]) =>
      /(?:^| )role$/u.test(normalizeTier2Synonym(valueKey))
      && typeof literal === 'string'
      && normalizeTier2Synonym(literal) === normalizeTier2Synonym(role));
  const thetaDomain = Object.keys(context.anchors ?? {}).some(role => namedThematicValue(role) ||
    valueNamesThematicParticipant(role) ||
    qualifiedAssignmentConcepts(role).some(concept => concept === 'predicate' || concept === 'theta.arguments'))
    || Object.entries(context.values ?? {}).some(([key, value]) => /^(theta|thematic|θ) /.test(normalizeTier2Synonym(key))
      && lookupTier2SynonymCandidates(index, 'value', key).includes('role.label') && nonBlankLiteral(value))
    || (hasLiteral('role.label') && Object.keys(context.anchors ?? {}).some(role =>
      lookupTier2SynonymCandidates(index, 'role', role).includes('theta.arguments') || thematicParticipant(role)
        || explicitlyNamedThematicParticipant(role)
        || explicitThematicPredicate && ['subject', 'subject position', 'subject occurrence'].includes(normalizeTier2Synonym(role))));
  const featureDomain = hasLiteral('case.literal') || hasLiteral('feature.rows') || hasLiteral('feature.label')
    || Object.keys(context.anchors ?? {}).some(role => qualifiedAssignmentConcepts(role).includes('feature.target')
      || qualifiedAssignmentConcepts(role).includes('feature.source'));
  if (featureDomain && /^(?:goal|recipient|assignee|bearer|licensed (?:item|nominal)) (?:position|occurrence)$/u.test(spelling))
    concepts.add('feature.target');
  if (hasLiteral('case.literal') && /^(?:finite|matrix|embedded|local) licen[cs]or$/u.test(spelling))
    concepts.add('feature.source');
  const thetaSlot = thematicSlotQualifier(key, 'anchor');
  if (thetaSlot && Object.entries(context.values ?? {}).some(([role, literal]) =>
    thematicSlotQualifier(role, 'value') === thetaSlot && !Array.isArray(literal) && nonBlankLiteral(literal))) {
    concepts.add('theta.arguments');
  }
  const competingThetaArgument = Object.keys(context.anchors ?? {}).some(role => role !== key
    && lookupTier2SynonymCandidates(index, 'role', role).includes('theta.arguments'));
  if (thetaDomain && !featureDomain && (['subject', 'subject position', 'subject occurrence', 'nominal restrictor'].includes(spelling)
    || explicitlyNamedThematicParticipant(spelling)
    || valueNamesThematicParticipant(spelling)
    || thematicParticipant(spelling) && (!competingThetaArgument || namedThematicValue(spelling)))) {
    concepts.delete('predicand');
    concepts.add('theta.arguments');
  }
  // Explicit domain evidence supplies meaning; generic roles supply direction.
  // A competing feature interpretation cannot silently become theta assignment.
  const direction = assignmentDirection(spelling);
  if (direction && thetaDomain !== featureDomain) {
    concepts.add(thetaDomain
      ? direction === 'source' ? 'predicate' : 'theta.arguments'
      : direction === 'source' ? 'feature.source' : 'feature.target');
  }
  // An introducer supplies a thematic source only in a thematic claim. The
  // same word alone can describe structural introduction or other relations.
  if (thematicIntroducer(spelling) && thetaDomain && !featureDomain) concepts.add('predicate');
  // An explicitly assigning/introducing role identifies the source. A separate
  // predicate names its lexical context, just as a Case exponent is not a licenser.
  const explicitThetaSource = thetaDomain && !featureDomain && Object.keys(context.anchors ?? {}).some(role => {
    const normalized = singularRole(normalizeTier2Synonym(role));
    return thematicIntroducer(normalized)
      || qualifiedAssignmentConcepts(role).includes('predicate') && !/ (?:head|predicate)$/u.test(normalized)
      || assignmentDirection(normalized) === 'source';
  });
  if (explicitThetaSource && (['predicate', 'lexical predicate', 'head', 'theta predicate', 'thematic predicate', 'theta head', 'thematic head'].includes(spelling)
    || qualifiedPredicateRole(spelling))) {
    concepts.delete('predicate');
    concepts.add('predicate.context');
  }
  const pairedCase = Object.keys(context.anchors ?? {}).some(role =>
    /^case /.test(normalizeTier2Synonym(role)) && qualifiedAssignmentConcepts(role).includes('feature.target')
    && nonBlankLiteral(context.values?.[role]));
  const nominalTopic = (role: string) => {
    if (normalizeTier2Synonym(role) !== 'topic' || !context.forest) return false;
    const ids = Object.entries(context.anchors ?? {}).filter(([key]) => normalizeTier2Synonym(key) === 'topic')
      .flatMap(([, value]) => Array.isArray(value) ? value : [value]);
    if (!ids.length) return false;
    const occurrences = new Map<string, SyntaxNode[]>();
    const visit = (node: SyntaxNode) => {
      if (node.id && ids.includes(node.id)) occurrences.set(node.id, [...(occurrences.get(node.id) ?? []), node]);
      node.children?.forEach(visit);
    };
    context.forest.forEach(visit);
    return ids.every(id => typeof id === 'string' && occurrences.get(id)?.length === 1
      && ['N', 'NP', 'D', 'DP', 'K', 'KP'].includes(categoryLabel(occurrences.get(id)![0].label).replace(/(?:\^?0|⁰)$/u, '')));
  };
  const nominalParticipant = (role: string) => ['nominal', 'subject', 'object'].includes(normalizeTier2Synonym(role))
    || lookupTier2SynonymCandidates(index, 'role', role).includes('theta.arguments') || nominalTopic(role);
  const ownIds = context.anchors?.[key];
  const ownCount = Array.isArray(ownIds) ? ownIds.length : typeof ownIds === 'string' ? 1 : 0;
  const pairedNominalValue = nominalParticipant(spelling) && Object.entries(context.values ?? {}).some(([valueKey, literal]) =>
    normalizeTier2Synonym(valueKey) === normalizeTier2Synonym(key)
      && (Array.isArray(literal) ? literal.length : 1) === ownCount && ownCount > 0
      && (Array.isArray(literal) ? literal : [literal]).every(item => typeof item === 'string' && item.trim()));
  const qualifiedCaseValue = ownCount === 1 && Object.entries(context.values ?? {}).some(([valueKey, literal]) =>
    normalizeTier2Synonym(valueKey) === `${normalizeTier2Synonym(key)} case`
      && typeof literal === 'string' && literal.trim());
  const explicitCaseRecipient = Object.keys(context.anchors ?? {}).some(role =>
    qualifiedAssignmentConcepts(role).includes('feature.target')
      || isExplicitTier2Role('feature.target', role)
      || caseDirection(role) === 'target'
      || assignmentDirection(singularRole(normalizeTier2Synonym(role))) === 'target');
  if (spelling === 'governor' && (hasLiteral('case.literal') || pairedCase) && Object.keys(context.anchors ?? {}).some(role =>
    qualifiedAssignmentConcepts(role).includes('feature.target')
      || isExplicitTier2Role('feature.target', role) || assignmentDirection(singularRole(normalizeTier2Synonym(role))) === 'target'
      || caseDirection(role) === 'target'
      || nominalParticipant(role))) {
    concepts.add('feature.source');
  }
  // An explicitly directed recipient owns the slot. Otherwise a named nominal,
  // subject, object or argument may fill it with a Case literal and independent licenser.
  // Competing nominal references still fail binding; exponents remain context.
  if ((qualifiedCaseValue || nominalParticipant(spelling) && !explicitCaseRecipient && (hasLiteral('case.literal') || pairedNominalValue)) && Object.keys(context.anchors ?? {}).some(role =>
    assignmentDirection(singularRole(normalizeTier2Synonym(role))) === 'source'
      || qualifiedAssignmentConcepts(role).includes('feature.source')
      || caseDirection(role) === 'source'
      || isExplicitTier2Role('feature.source', role)
      || singularRole(normalizeTier2Synonym(role)) === 'governor')) concepts.add('feature.target');
  const hasAgreementController = Object.keys(context.anchors ?? {}).some(role =>
    normalizeTier2Synonym(role) === 'agreement controller');
  const roles = new Set(Object.keys(context.anchors ?? {}).map(normalizeTier2Synonym));
  const scalarRole = (role: string) => {
    const fields = Object.entries(context.anchors ?? {}).filter(([key]) => normalizeTier2Synonym(key) === role);
    return fields.length === 1 && typeof fields[0][1] === 'string' && fields[0][1].trim().length > 0;
  };
  const nominalAgreementPairs = [['determiner', 'nominal controller'], ['possessive head', 'possessor']]
    .filter(pair => pair.every(scalarRole));
  const inflectionHead = (role: string) => ['finite head', 'finite head position', 'finite head occurrence', 'inflection', 'inflectional head'].includes(role);
  const hasInflectionHead = [...roles].some(inflectionHead);
  const hasAgreementMediator = [...roles].some(role => /^(?:(?:agreement|feature) )?mediator$/u.test(role));
  const qualifiedAgreementHost = (role: string) => /^(?:verbal|agreement) (?:target|host|bearer)$/u.test(role);
  const qualifiedHosts = [...roles].filter(qualifiedAgreementHost);
  const hasQualifiedHost = qualifiedHosts.length > 0;
  const hasQualifiedAgreementPair = qualifiedHosts.length === 1 && scalarRole(qualifiedHosts[0])
    && scalarRole('controller') && !hasAgreementMediator
    && !Object.keys(context.anchors ?? {}).some(role => isExplicitTier2Role('controllee', role));
  const scalarId = (role: string) => Object.entries(context.anchors ?? {})
    .find(([key]) => normalizeTier2Synonym(key) === role)?.[1];
  const hasNamedAgreementTarget = /\bagreement\b/u.test(relationName)
    && roles.has('controller') && roles.has('target');
  const namedAgreementPair = hasNamedAgreementTarget
    && scalarRole('controller') && scalarRole('target') && !hasAgreementMediator
    && scalarId('controller') !== scalarId('target');
  const participialHost = (role: string) => !hasAgreementMediator && ['participle', 'participial head'].includes(role);
  const controllerEntries = Object.entries(context.anchors ?? {}).filter(([role]) => normalizeTier2Synonym(role) === 'controller');
  const headedAgreementController = !hasQualifiedHost && !hasNamedAgreementTarget && (hasInflectionHead || [...roles].some(participialHost)) && controllerEntries.length === 1
    && (Array.isArray(controllerEntries[0][1]) ? controllerEntries[0][1].length === 1 : typeof controllerEntries[0][1] === 'string')
    && !Object.keys(context.anchors ?? {}).some(role => isExplicitTier2Role('controllee', role));
  if (hasLiteral('feature.rows')) {
    if (namedAgreementPair) {
      if (spelling === 'target') {
        concepts.delete('feature.target');
        concepts.delete('goal');
        concepts.add('feature.source');
        concepts.add('probe');
      }
      if (spelling === 'controller') { concepts.add('feature.target'); concepts.add('goal'); }
    }
    // A named agreement target is the feature host. A separately named finite
    // head is contextual here; it cannot replace the explicit target.
    if (hasQualifiedAgreementPair) {
      if (qualifiedAgreementHost(spelling)) { concepts.add('feature.source'); concepts.add('probe'); }
      if (spelling === 'controller') { concepts.add('feature.target'); concepts.add('goal'); }
    }
    if (nominalAgreementPairs.some(([host]) => spelling === host)) {
      concepts.add('feature.source');
      concepts.add('probe');
    }
    if (nominalAgreementPairs.some(([, controller]) => spelling === controller)) {
      concepts.add('feature.target');
      concepts.add('goal');
    }
    // In a complete probe/goal claim, a separately named feature origin may
    // describe material within the goal. Preserve that exact occurrence as
    // context; it neither becomes a second collector nor redirects the row.
    if (spelling === 'feature source' && context.forest) {
      const explicitIds = (concept: string) => [...new Set(Object.entries(context.anchors ?? {})
        .filter(([role]) => normalizeTier2Synonym(role) !== 'feature source' && isExplicitTier2Role(concept, role))
        .flatMap(([, value]) => Array.isArray(value) ? value : [value]))];
      const probes = explicitIds('probe'), goals = explicitIds('goal');
      const origin = context.anchors?.[key];
      const origins = Array.isArray(origin) ? origin : [origin];
      if (probes.length === 1 && goals.length === 1 && probes[0] !== goals[0] && origins.length === 1) {
        const matches = new Map<unknown, SyntaxNode[]>();
        const visit = (node: SyntaxNode) => {
          if ([...probes, ...goals, ...origins].includes(node.id)) matches.set(node.id, [...(matches.get(node.id) ?? []), node]);
          node.children?.forEach(visit);
        };
        context.forest.forEach(visit);
        const contains = (node: SyntaxNode): boolean => node.id === origins[0] || Boolean(node.children?.some(contains));
        if ([...probes, ...goals, ...origins].every(id => typeof id === 'string' && matches.get(id)?.length === 1)
          && origins[0] !== probes[0] && contains(matches.get(goals[0])![0])) {
          concepts.delete('feature.source');
          concepts.delete('probe');
          concepts.add('feature.origin-context');
        }
      }
    }
    // Literal features and complete participant roles establish collection.
    // A separate mediator prevents treating the participle as the collector.
    if (!hasQualifiedHost && (hasAgreementController || headedAgreementController || (hasInflectionHead && [...roles].some(role => ['subject', 'subject position', 'subject occurrence'].includes(role))))) {
      if (spelling === 'agreement controller' || ['subject', 'subject position', 'subject occurrence'].includes(spelling) || spelling === 'controller' && headedAgreementController) concepts.add('feature.target');
      if (inflectionHead(spelling) || participialHost(spelling)) concepts.add('feature.source');
    }
    if (headedAgreementController) {
      if (inflectionHead(spelling) || participialHost(spelling)) concepts.add('probe');
      if (spelling === 'controller') concepts.add('goal');
    }
    if (roles.has('head') && roles.has('specifier') && Object.keys(context.values ?? {}).some(key =>
      ['agreement', 'agreement features', 'phi features'].includes(normalizeTier2Synonym(key)))) {
      if (spelling === 'head') concepts.add('feature.source');
      if (spelling === 'specifier') concepts.add('feature.target');
    }
  }
  if (hasLiteral('case.literal')) {
    const governedTarget = (role: string) => /^governed (?:complement|argument|nominal|phrase|constituent|np|dp|kp|xp)$/u.test(role);
    const governingHead = (role: string) => /^governing (?:(?:lower|higher|lexical) )?head$/u.test(role);
    if (governedTarget(spelling)) concepts.add('feature.target');
    if (governingHead(spelling) || spelling === 'governor' && [...roles].some(governedTarget)) concepts.add('feature.source');
  }
  return [...concepts];
};

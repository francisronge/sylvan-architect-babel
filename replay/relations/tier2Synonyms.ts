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

export const TIER2_ROLE_SYNONYMS: readonly Tier2SynonymGroup[] = [
  group('role', 'movement.source', ['source', 'origin', 'from', 'lower copy', 'lower occurrence', 'intermediate occurrence', 'base copy', 'base position', 'departure', 'moved from', 'real gap', 'variable', 'foot']),
  group('role', 'movement.witness', ['trace witness', 'lower witness', 'source witness', 'gap witness', 'trace', 'lower trace', 'departure witness']),
  group('role', 'movement.landing', ['landing', 'landing site', 'target', 'to', 'destination', 'pronounced copy', 'higher copy', 'higher occurrence', 'upper occurrence', 'raised copy', 'raised head', 'moved head', 'moved phrase', 'filler', 'operator', 'head']),
  group('role', 'movement.host', ['host head', 'attracting head', 'landing head', 'receiving head']),
  group('role', 'movement.complex', ['complex head', 'head complex']),
  group('role', 'movement.carrier', ['carrier', 'moved carrier', 'containing phrase', 'remnant', 'smuggled phrase', 'transported constituent']),
  group('role', 'gap', ['gap', 'trace', 'empty position', 'lower gap', 'ordinary gap', 'real gap', 'gap site']),
  group('role', 'occurrences', ['occurrences', 'copies', 'identity family', 'chain occurrences', 'coindexed occurrences']),
  group('role', 'facet.anchors', ['anchors', 'participants', 'relation anchors', 'facet anchors', 'witnesses']),

  group('role', 'controller', ['controller', 'control source'], ['antecedent', 'matrix argument']),
  group('role', 'controllee', ['controllee', 'controlled', 'controlled subject'], ['pro', 'silent subject']),
  group('role', 'domain', ['domain', 'region', 'scope', 'constituent domain', 'local domain']),
  group('role', 'binder', ['binder', 'antecedent', 'binding source'], ['operator']),
  group('role', 'dependent', ['dependent', 'bound', 'anaphor', 'pronoun', 'binding target'], ['variable']),
  group('role', 'predicand', ['predicand', 'subject', 'predicate subject', 'theme']),
  group('role', 'predicate', ['predicate', 'predicates', 'predicate phrase', 'secondary predicate']),
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
  group('role', 'shared.argument', ['shared argument', 'argument', 'shared object', 'shared subject', 'shared goal']),
  group('role', 'chunks', ['idiom chunks', 'idiomatic chunks'], ['chunks', 'chunk anchors', 'cointerpreted chunks']),
  group('role', 'interpretation.domain', ['idiom domain'], ['interpretation domain', 'cointerpretation domain', 'domain']),

  group('role', 'plaque.anchor', ['plaque anchor', 'anchor', 'participant', 'terminal', 'word', 'predicate']),
  group('role', 'feature.bearers', ['feature bearers', 'bearers', 'participants', 'feature holders', 'sharing members']),
  group('role', 'probe', ['probe', 'searcher', 'agree probe', 'feature source'], ['licensor']),
  group('role', 'goal', ['goal', 'goals', 'agree goal', 'feature target'], ['target', 'licensee']),
  group('role', 'feature.source', ['feature source', 'source', 'probe', 'assigner', 'licensor', 'collector']),
  group('role', 'feature.target', ['feature target', 'target', 'goal', 'bearer', 'recipient', 'licensee', 'valued node']),
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
  group('role', 'intervention.target', ['intervention target', 'target', 'lower target', 'dependency source']),
  group('role', 'intervention.landing', ['intervention landing', 'landing', 'probe', 'intended landing', 'dependency target']),
  group('role', 'intervener', ['intervener', 'closer goal', 'closer phrase', 'blocker', 'intervening node']),
  group('role', 'extraction.source', ['extraction source', 'source', 'embedded source', 'lower occurrence', 'gap']),
  group('role', 'extraction.target', ['extraction target', 'target', 'landing site', 'landing', 'higher occurrence']),
  group('role', 'adjunct.domain', ['adjunct domain', 'adjunct', 'island domain', 'blocked domain', 'extraction domain']),

  group('role', 'focus', ['focus', 'focused', 'focus constituent', 'prominent branch']),
  group('role', 'background', ['background', 'background sister', 'nonfocus', 'weak branch']),
  group('role', 'accent.bearer', ['accent bearer', 'accented', 'pitch accent bearer', 'prosodic head']),
  group('role', 'projection.nodes', ['projection nodes', 'projections', 'focus projections', 'f marked nodes', 'inheritance path']),
  group('role', 'licensor', ['licensor', 'license source', 'operator', 'exhaustifier', 'licensing head']),
  group('role', 'licensee', ['licensee', 'licensed item', 'npi', 'goal', 'licensing target']),

  group('role', 'scope', ['scope', 'scope anchor', 'sentence', 'clause', 'storage host']),
  group('role', 'scope.source', ['covert source', 'covert movement source'], ['scope source', 'pronounced qp', 'source', 'lower qp', 'surface quantifier']),
  group('role', 'scope.landing', ['covert landing', 'covert movement landing'], ['scope landing', 'lf qp', 'target', 'higher qp']),
  group('role', 'scope.domain', ['scope domain', 'domain', 'interpreted scope', 'semantic domain']),
  group('role', 'operator', ['operator', 'quantifier', 'scope taker'], ['binder']),
  group('role', 'variable', ['variable', 'bound variable'], ['pronoun', 'trace', 'dependent']),

  group('role', 'theta.arguments', ['theta arguments', 'arguments', 'argument', 'role bearers', 'thematic arguments']),
  group('role', 'rewrite.input', ['rewrite input', 'input', 'prior terminal', 'source form', 'underlying form']),
  group('role', 'rewrite.output', ['rewrite output', 'output', 'current terminal', 'surface form', 'exponent', 'supported head', 'supported tense', 'tense host', 'realization host']),
  group('role', 'pf.host', ['supported tense', 'tense host', 'realization host']),
  group('role', 'rewrite.outputs', ['rewrite outputs', 'outputs', 'current terminals', 'surface forms', 'exponents']),
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
  group('value', 'case.literal', ['case', 'case value', 'case label']),
  group('value', 'feature.label', ['feature label', 'feature', 'feature notation', 'feature mark']),
  group('value', 'accent.label', ['accent label', 'accent', 'pitch accent', 'tone mark']),
  group('value', 'cycle', ['cycle', 'round', 'pass', 'iteration', 'search cycle', 'derivational cycle']),
  group('value', 'step', ['step']),
  group('value', 'feature.rows', ['feature rows', 'features', 'feature bundle', 'valuations', 'feature values']),
  group('value', 'plaque.rows', ['plaque rows', 'rows', 'fields', 'entries', 'record values']),
  group('value', 'pf.rows', ['pf rows', 'pf plate rows', 'morphology rows', 'realization plate rows', 'pf entries', 'realization', 'tense', 'exponent']),
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
  return Boolean(entry?.aliases.some(alias => normalizeTier2Synonym(alias) === normalized)
    && !entry.contextualAliases?.some(alias => normalizeTier2Synonym(alias) === normalized));
};

export type Tier2SynonymCandidate = {
  scope: Tier2SynonymScope;
  concept: string;
};

export type Tier2SynonymIndex = Map<string, Tier2SynonymCandidate[]>;

export const buildTier2SynonymIndex = (): Tier2SynonymIndex => {
  const index: Tier2SynonymIndex = new Map();
  const groups = [
    ...TIER2_ROLE_SYNONYMS,
    ...TIER2_VALUE_SYNONYMS
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
): string[] => (index.get(normalizeTier2Synonym(literal)) ?? [])
  .filter((candidate) => candidate.scope === scope)
  .map((candidate) => candidate.concept);

/** Interpret qualified assignment roles as a domain plus a direction, never from titles or prose. */
const assignmentDirection = (role: string): 'source' | 'target' | undefined =>
  ['assigner', 'source', 'licensor'].includes(role) ? 'source'
    : ['target', 'recipient', 'bearer', 'marked'].includes(role) ? 'target' : undefined;

export const qualifiedAssignmentConcepts = (key: string): string[] => {
  const [domain, ...rest] = normalizeTier2Synonym(key).split(' ');
  const role = rest.join(' ');
  const source = assignmentDirection(role) === 'source' || (domain === 'case' && role === 'governor');
  const target = assignmentDirection(role) === 'target';
  if (['theta', 'thematic', 'θ'].includes(domain)) {
    return source ? ['predicate'] : target || role === 'argument' ? ['theta.arguments'] : [];
  }
  if (['case', 'feature'].includes(domain)) return source ? ['feature.source'] : target ? ['feature.target'] : [];
  return [];
};

export const relationRoleConcepts = (
  index: Tier2SynonymIndex,
  key: string,
  context: { anchors?: Record<string, unknown>; values?: Record<string, unknown> } = {}
): string[] => {
  const concepts = new Set([...lookupTier2SynonymCandidates(index, 'role', key), ...qualifiedAssignmentConcepts(key)]);
  const spelling = normalizeTier2Synonym(key);
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
    lookupTier2SynonymCandidates(index, 'value', key).includes(concept)
      && nonBlankLiteral(value));
  const thetaDomain = Object.keys(context.anchors ?? {}).some(role =>
    qualifiedAssignmentConcepts(role).some(concept => concept === 'predicate' || concept === 'theta.arguments'))
    || Object.entries(context.values ?? {}).some(([key, value]) => /^(theta|thematic|θ) /.test(normalizeTier2Synonym(key))
      && lookupTier2SynonymCandidates(index, 'value', key).includes('role.label') && nonBlankLiteral(value))
    || (hasLiteral('role.label') && Object.keys(context.anchors ?? {}).some(role =>
      lookupTier2SynonymCandidates(index, 'role', role).includes('theta.arguments')));
  const featureDomain = hasLiteral('case.literal') || hasLiteral('feature.rows') || hasLiteral('feature.label')
    || Object.keys(context.anchors ?? {}).some(role => qualifiedAssignmentConcepts(role).includes('feature.target')
      || qualifiedAssignmentConcepts(role).includes('feature.source'));
  // Explicit domain evidence supplies meaning; generic roles supply direction.
  // A competing feature interpretation cannot silently become theta assignment.
  if (thetaDomain && !featureDomain) {
    const direction = assignmentDirection(spelling);
    if (direction) concepts.add(direction === 'source' ? 'predicate' : 'theta.arguments');
  }
  if (spelling === 'governor' && hasLiteral('case.literal') && Object.keys(context.anchors ?? {}).some(role =>
    normalizeTier2Synonym(role).startsWith('case ') && qualifiedAssignmentConcepts(role).includes('feature.target'))) {
    concepts.add('feature.source');
  }
  return [...concepts];
};

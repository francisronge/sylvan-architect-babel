import { NATIVE_VALUE_CONCEPTS, TIER2_ROLE_SYNONYMS, TIER2_VALUE_SYNONYMS, normalizeTier2Synonym } from '../relations/tier2Synonyms.ts';
import { PRODUCTION_RENDER_FAMILIES, PRODUCTION_SCALAR_VALUE_KEYS } from '../relations/renderFamilies.ts';

const movement = {
  lowerCopy: 'movement.source', source: 'movement.source', from: 'movement.source',
  variable: 'movement.source', realGap: 'movement.source', 'lower-occurrence': 'movement.source',
  pronouncedCopy: 'movement.landing', higherCopy: 'movement.landing', target: 'movement.landing',
  operator: 'movement.landing', filler: 'movement.landing', landing: 'movement.landing',
  to: 'movement.landing', 'landing-site': 'movement.landing',
  traceWitness: 'movement.witness', lowerWitness: 'movement.witness',
  hostHead: 'movement.host', complexHead: 'movement.complex'
};

// These select meanings, not extra requirements. Generic words such as source,
// domain and target mean different things in different approved drawings.
const contexts = {
  'scope.operator-variable': { scopeDomain: 'scope.domain', domain: 'scope.domain' },
  'trajectory.across-the-board': { sources: 'correspondence.sources', traceWitnesses: 'movement.witness', pronouncedCopy: 'movement.landing', target: 'movement.landing', landing: 'movement.landing' },
  'predication.paths': { predicates: 'predicate' },
  'binding.domain': { bound: 'dependent' },
  'split-antecedence.indices': { antecedents: 'correspondence.sources' },
  'parasitic-gap.composition': { filler: 'filler', operator: 'filler', realGap: 'ordinary.gap', gap: 'ordinary.gap', traceWitness: 'movement.witness', lowerWitness: 'movement.witness', parasiticGap: 'parasitic.gap', parasiticGaps: 'parasitic.gap', primaryPath: 'primary.path', secondaryPath: 'secondary.path' },
  'pair-merge.fork': { pairMember: 'pair.member', adjunct: 'pair.member' },
  'argument-sharing.domains': { domains: 'predicate.domains', shared: 'shared.argument' },
  'idiom-chunks.domain': { domain: 'interpretation.domain', interpretationDomain: 'interpretation.domain' },
  'multiple-agree.fanout': { goals: 'goal' },
  'cyclic-agree.paths': { searchDomain: 'domain' },
  'feature-sharing.vines': { bearers: 'feature.bearers' },
  'case-assignment.path': { assigner: 'feature.source', bearer: 'feature.target' },
  'accord.link': { source: 'licensor', goal: 'licensee' },
  'phase.arc': { edge: 'phase.edge' },
  'transfer.domain': { edge: 'phase.edge', spellOutDomain: 'transfer.domain', complement: 'transfer.domain' },
  'transfer.blocked-access': { source: 'access.source', target: 'access.target', spellOutDomain: 'transfer.domain', domain: 'transfer.domain' },
  'anti-locality.paths': { source: 'movement.source', traceWitness: 'movement.witness', landing: 'movement.landing' },
  'improper-movement.landing': { source: 'movement.source', traceWitness: 'movement.witness', licensedLanding: 'movement.landing', licensedLandingHosts: 'licensed.hosts', rejectedLandingHosts: 'rejected.hosts' },
  'blocked-extraction.diagnostic': { source: 'extraction.source', extractionSource: 'extraction.source', target: 'extraction.target', landingSite: 'extraction.target', adjunctDomain: 'adjunct.domain', domain: 'adjunct.domain' },
  'intervention.blocked-path': { target: 'intervention.target', landing: 'intervention.landing', probe: 'intervention.landing' },
  'analysis.illicit': { analysis: 'analysis.anchor' },
  'ellipsis.ghosting': { antecedent: 'correspondence.source', domain: 'ellipsis.site', site: 'ellipsis.site' },
  'ellipsis.deletion': { domain: 'ellipsis.site', site: 'ellipsis.site' },
  'copy.multiple-pronunciation': { higherCopy: 'movement.landing', lowerCopy: 'movement.source' },
  'copy.partial-deletion': { deletedSubconstituent: 'deleted.material', deleted: 'deleted.material' },
  'pf.vocabulary-insertion': { target: 'terminal', input: 'rewrite.input', output: 'rewrite.output' },
  'pf.phrasal-spellout': { phrase: 'constituent', domain: 'constituent', exponent: 'rewrite.output' },
  'pf.correspondence': { word: 'terminal', sources: 'correspondence.sources', exponents: 'rewrite.outputs' },
  'pf.fission': { input: 'rewrite.input', outputs: 'rewrite.outputs' },
  'pf.impoverishment': { featureHierarchy: 'feature.hierarchy' },
  'pf.cyclic-linearization': { edgePosition: 'phase.edge' },
  'qr.covert': { pronouncedQP: 'scope.source', source: 'scope.source', lfQP: 'scope.landing', target: 'scope.landing', scopeDomain: 'scope.domain', domain: 'scope.domain' },
  'cooper-storage.ledger': { quantifier: 'operator', quantifiers: 'operator' },
  'accord.strong-npi': { npi: 'licensee' },
  'focus.f-projection': { accentBearer: 'accent.bearer', projections: 'projection.nodes' },
  'gapping.alignment': { correlates: 'correspondence.sources', remnants: 'correspondence.targets' }
};

const groups = new Map(TIER2_ROLE_SYNONYMS.map(group => [group.concept, group]));
const literalConcepts = new Map(TIER2_ROLE_SYNONYMS.map(group => [normalizeTier2Synonym(group.concept.replaceAll('.', ' ')), group.concept]));

export const withProductionRoleVocabulary = (entryId, signature) => {
  const meanings = contexts[entryId] || (entryId.startsWith('trajectory.') ? movement : {});
  const roles = block => Object.fromEntries(Object.entries(block || {}).map(([role, rule]) => {
    const concept = meanings[role] || literalConcepts.get(normalizeTier2Synonym(role));
    return [role, { ...rule, aliases: [role, ...(groups.get(concept)?.aliases || [])], ...(concept ? { concept } : {}) }];
  }));
  return { ...signature, required: roles(signature.required), optional: roles(signature.optional) };
};

const nativeValueKeys = {
  'dependent-case': ['step'],
  impoverishment: ['featureHierarchy', 'delinkAfter'],
  'cooper-storage': ['category', 'qstore', 'retrieved'],
  'phrasal-spellout': ['exponent']
};
const valueGroups = new Map(TIER2_VALUE_SYNONYMS.map(group => [group.concept, group]));

// Bind only the slots this drawing reads. Open rows keep their authored keys;
// outcome/judgment interpretation remains with the shared outcome resolver.
export const productionValueRules = entryId => {
  const family = PRODUCTION_RENDER_FAMILIES[entryId]?.family;
  const keys = [...(PRODUCTION_SCALAR_VALUE_KEYS[family] || []), ...(nativeValueKeys[family] || [])]
    .filter(key => key !== 'outcome' && key !== 'judgment');
  return Object.fromEntries(keys.map(key => {
    const concept = NATIVE_VALUE_CONCEPTS[key] || key;
    return [key, { minItems: 0, maxItems: null, concept,
      aliases: [key, ...(valueGroups.get(concept)?.aliases || [])] }];
  }));
};

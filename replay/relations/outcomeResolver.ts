import { normalizeTier2Synonym, TIER2_VALUE_SYNONYMS } from './tier2Synonyms.ts';

/**
 * Renderer-only interpretation of authored outcome literals.
 *
 * The Replay bar keeps the exact authored literal. This resolver supplies
 * a finite drawing concept after exact normalization. It does not perform
 * fuzzy matching or collapse distinct judgments into one result.
 */

export const OUTCOME_CONCEPTS = [
  'blocked',
  'failed',
  'crashed',
  'illicit',
  'rejected',
  'unlicensed',
  'impossible',
  'violation',
  'licensed',
  'successful',
  'allowed',
  'accepted',
  'valid',
  'converged',
  'well-formed',
  'grammatical'
] as const;

export type OutcomeConcept = typeof OUTCOME_CONCEPTS[number];

export type OutcomeAliasGroup = {
  concept: OutcomeConcept;
  aliases: readonly string[];
};

export type OutcomeResolution = {
  /** Exact authored text for display and diagnostics. */
  literal: string;
  /** Deterministic lookup key. */
  normalized: string;
  /** Null means the literal remains visible but earns no styled outcome. */
  concept: OutcomeConcept | null;
};

const group = (
  concept: OutcomeConcept,
  aliases: readonly string[] = []
): OutcomeAliasGroup => ({ concept, aliases: [concept, ...aliases] });

export const OUTCOME_ALIAS_GROUPS: readonly OutcomeAliasGroup[] = [
  group('blocked', [
    'block', 'blocks', 'blocking',
    'prevented', 'prevents', 'preventing',
    'barred', 'bars',
    'prohibited', 'prohibits',
    'disallowed', 'not allowed',
    'inaccessible', 'not accessible'
  ]),
  group('failed', [
    'fail', 'fails', 'failure', 'failures',
    'unsuccessful', 'not successful',
    'did not succeed', 'does not succeed'
  ]),
  group('crashed', [
    'crash', 'crashes',
    'nonconvergent',
    'did not converge', 'does not converge', 'failed to converge'
  ]),
  group('illicit', [
    'illegal', 'ill-formed',
    'ungrammatical', 'not grammatical', 'deviant', 'invalid'
  ]),
  group('rejected', [
    'reject', 'rejects', 'rejection',
    'ruled out', 'excluded', 'inadmissible'
  ]),
  group('unlicensed', [
    'not licensed', 'lacks licensing', 'lacking licensing'
  ]),
  group('impossible', ['cannot occur', 'could not occur']),
  group('violation', [
    'violated', 'violates', 'constraint violation', 'violates constraint'
  ]),
  group('licensed', ['license', 'licenses']),
  group('successful', ['success', 'succeeds', 'succeeded']),
  group('allowed', ['allow', 'allows', 'permitted', 'permit', 'permits']),
  group('accepted', ['accept', 'accepts', 'acceptance']),
  group('valid', ['legitimate']),
  group('converged', ['converge', 'converges', 'convergence']),
  group('well-formed'),
  group('grammatical')
];

export const normalizeOutcomeLiteral = (value: unknown): string => String(value ?? '')
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase('en-US')
  .replace(/[\s_-]+/gu, ' ')
  .replace(/\s+/gu, ' ');

const outcomeConceptByAlias: ReadonlyMap<string, OutcomeConcept> = (() => {
  const index = new Map<string, OutcomeConcept>();
  OUTCOME_ALIAS_GROUPS.forEach(({ concept, aliases }) => {
    new Set(aliases.map(normalizeOutcomeLiteral).filter(Boolean)).forEach((alias) => {
      const prior = index.get(alias);
      if (prior && prior !== concept) {
        throw new Error(`Outcome alias "${alias}" is assigned to both ${prior} and ${concept}.`);
      }
      index.set(alias, concept);
    });
  });
  return index;
})();

export const resolveOutcomeLiteral = (value: unknown): OutcomeResolution | null => {
  const literal = typeof value === 'string' ? value : String(value ?? '');
  const normalized = normalizeOutcomeLiteral(literal);
  if (!normalized) return null;
  return {
    literal,
    normalized,
    concept: outcomeConceptByAlias.get(normalized) ?? null
  };
};

export const acceptedOutcomeConcept = (
  resolution: OutcomeResolution | null,
  accepted: readonly OutcomeConcept[]
): OutcomeConcept | undefined => (
  resolution?.concept && accepted.includes(resolution.concept)
    ? resolution.concept
    : undefined
);

const outcomeRoles = new Set(TIER2_VALUE_SYNONYMS.find(group => group.concept === 'outcome')!.aliases.map(normalizeTier2Synonym));

export const authoredOutcomeLiterals = (values: Record<string, string | string[]> | undefined): string[] =>
  Object.entries(values ?? {}).filter(([key]) => outcomeRoles.has(normalizeTier2Synonym(key)))
    .flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).filter(literal =>
      !['judgment', 'verdict'].includes(normalizeTier2Synonym(key)) || resolveOutcomeLiteral(literal)?.concept));

/** A blocking drawing needs an authored negative claim, not just a possible obstacle. */
export const negativeClaimFailure = (
  outcomes: readonly string[],
  participantRoles: readonly string[]
): string | undefined => {
  const negative: readonly OutcomeConcept[] = ['blocked', 'failed', 'crashed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'];
  if (outcomes.length) {
    const concepts = outcomes.map(value => resolveOutcomeLiteral(value)?.concept);
    return concepts.every(concept => concept && negative.includes(concept))
      ? undefined : 'outcome-does-not-establish-blocking';
  }
  const explicitRoles = new Set(['blocker', 'inaccessible goal', 'blocked domain']);
  return participantRoles.some(role => explicitRoles.has(normalizeTier2Synonym(role)))
    ? undefined : 'no-authored-negative-outcome-or-blocking-role';
};

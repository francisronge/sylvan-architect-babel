import { normalizeTier2Synonym, relationLabelClauses, TIER2_VALUE_SYNONYMS } from './tier2Synonyms.ts';

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

/** These statuses assert neither success nor failure. Preserve them as outcome
 * evidence so an omitted outcome cannot turn a pending claim into a drawing. */
const unestablishedOutcomes = new Set([
  'pending', 'unresolved', 'undetermined', 'unestablished',
  'not established', 'not yet established', 'not determined', 'not yet determined',
  'absent', 'none', 'not applicable', 'possible', 'potential', 'hypothetical'
]);

export const isUnestablishedOutcomeLiteral = (value: unknown): boolean =>
  unestablishedOutcomes.has(normalizeOutcomeLiteral(value));

export type AssertionFamily = 'agreement' | 'binding' | 'case' | 'feature-sharing' | 'movement';

const assertionSubjects: Record<AssertionFamily, RegExp> = {
  agreement: /^(?:(?:t|i|infl|inflection|finite|subject|object|verbal|nominal|local|phi|φ|feature) )*(?:agree|agreement|concord)(?: dependency| relation)?$/u,
  binding: /^(?:(?:a|a bar|operator variable|variable|anaphoric|local) )?binding(?: dependency| relation)?$/u,
  case: /^(?:(?:structural|abstract|inherent|dependent|nominative|accusative|dative|genitive|ergative|absolutive) )?case(?: assignment| valuation| licensing| marking)?$/u,
  movement: /^(?:(?:interrogative|relative|phrasal|head|wh|successive cyclic) )*(?:internal merge|movement)(?: dependency| relation)?$/u,
  'feature-sharing': /^(?:shared features?|feature sharing|feature concord|nominal concord)$/u
};

/** A bounded failed/blocked label is itself an authored outcome of the named
 * claim, not an outcome of every sibling claim in the relation envelope. */
export function relationLabelOutcome(relationName: string | undefined, family: AssertionFamily): OutcomeConcept | undefined {
  const clauses = relationLabelClauses(relationName);
  const outcomes = clauses.flatMap(clause => {
    const prefix = /^(failed|blocked|unsuccessful|rejected|unlicensed|illicit) (.+)$/u.exec(clause);
    const suffix = /^(.+?)(?: is)? (failed|blocked|unsuccessful|rejected|unlicensed|illicit|failure|violation)$/u.exec(clause);
    const literal = prefix && assertionSubjects[family].test(prefix[2]) ? prefix[1]
      : suffix && assertionSubjects[family].test(suffix[1]) ? suffix[2] : undefined;
    return literal ? [resolveOutcomeLiteral(literal)?.concept].filter((value): value is OutcomeConcept => Boolean(value)) : [];
  });
  return outcomes.length && new Set(outcomes).size === 1 ? outcomes[0] : undefined;
}

/** Denial or failure is local to the named claim. In “failed agreement; Case
 * assignment”, failed agreement does not invalidate the independent Case claim.
 * Only complete label clauses are read; feature literals and arbitrary prose
 * are never searched for words such as “no” or “negative”. */
export function relationAssertionFailure(relationName: string | undefined, family: AssertionFamily): string | undefined {
  const clauses = relationLabelClauses(relationName);
  for (const clause of clauses) {
    const prefix = /^(?:no|absence of|lack of|without|pending|possible|potential|hypothetical|unestablished|unresolved|failed|blocked|unsuccessful|rejected|unlicensed) (.+)$/u.exec(clause);
    const suffix = /^(.+?)(?: is)? (?:absent|pending|unresolved|unestablished|not established|not yet established|failed|blocked|unsuccessful|rejected|unlicensed|failure|violation)$/u.exec(clause);
    if ([prefix?.[1], suffix?.[1]].some(subject => subject && assertionSubjects[family].test(subject)))
      return `${family}-not-established`;
  }
  return undefined;
}

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
  blockingRoles: readonly string[],
  participantRoles: readonly string[] = blockingRoles
): string | undefined => {
  const negative: readonly OutcomeConcept[] = ['blocked', 'failed', 'crashed', 'illicit', 'rejected', 'unlicensed', 'impossible', 'violation'];
  if (outcomes.length) {
    const concepts = outcomes.map(value => resolveOutcomeLiteral(value)?.concept
      ?? (participantAccessDenied(value, participantRoles) ? 'blocked' : null));
    return concepts.every(concept => concept && negative.includes(concept))
      ? undefined : 'outcome-does-not-establish-blocking';
  }
  const explicitRoles = new Set(['blocker', 'inaccessible goal', 'blocked domain']);
  return blockingRoles.some(role => explicitRoles.has(normalizeTier2Synonym(role)))
    ? undefined : 'no-authored-negative-outcome-or-blocking-role';
};

/** A negative access assertion can name its authored participant instead of
 * using a one-word outcome. Only the bounded declarative form below supplies
 * blocking; conditions, quotations and contrasting clauses remain literal. */
const participantAccessDenied = (literal: string, roles: readonly string[]): boolean => {
  const text = normalizeOutcomeLiteral(literal).replace(/\.$/u, '');
  const match = /^(?:the )?([\p{L}\p{N} ]+) cannot be (?:targeted|accessed|reached|licensed)(?: (?:across|through|within|by) ([\p{L}\p{N} ]+))?$/u.exec(text);
  return Boolean(match && roles.some(role => normalizeTier2Synonym(role) === match[1])
    && !/\b(?:if|unless|whether|but|or|not)\b/u.test(match[2] ?? ''));
};

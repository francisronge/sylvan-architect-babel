import type { DerivationStageRelation } from '../../types.ts';
import { scopeEvidence, type EvidenceScope } from './evidenceScopes.ts';
import { structuralSignature, type StructuralNodeFacts, type StructuralSignature, type StructuralSignatureInput } from './structuralSignature.ts';
import type { Tier2FacetEvidence, Tier2FacetId } from './tier2FacetTypes.ts';

/**
 * Experimental structure-only recognition (opt-in; see `structuralRecognitionRules`).
 *
 * A rule reads the relation's structural signature: the anchored nodes, how
 * they sit in the tree, what changed since the previous stage, and the
 * contract's own pairing of a values entry with the anchor entry of the same
 * name. It never reads what a relation name, role name or value literal means.
 * Literals are compared only for exact identity with other authored text (a
 * label annotation). A configuration that can be read more than one way earns
 * no picture; it is reported as an abstention with the readings it admits.
 *
 * Each rule names an existing Tier-2 recipe, so a recovered claim is drawn
 * with the same production primitives as Tier 2.
 */

export type StructuralRuleId =
  | 'fork.two-segment'
  | 'fork.two-segment-in-context'
  | 'plaque.single-host'
  | 'plaque.paired-entry'
  | 'plaque.annotation-owner'
  | 'ellipsis.silenced-site'
  | 'verdict.symbol-on-root'
  | 'identity.shared-lineage';

export type StructuralBinding = { key: string; indices: number[]; concept: string };

export type StructuralClaim = {
  rule: StructuralRuleId;
  recipe: Tier2FacetId;
  anchors: StructuralBinding[];
  values: StructuralBinding[];
  /** The drawing's family and its exact host nodes, for comparison with other tiers. */
  picture: { family: 'fork' | 'plaque' | 'ellipsis' | 'verdict' | 'coindex'; nodes: string[] };
};

export type StructuralAbstention = {
  configuration:
    | 'unresolved-or-repeated-anchor'
    | 'unmarked-sister-projection'
    | 'same-category-sisters'
    | 'head-complement'
    | 'exocentric-sisters'
    | 'c-command-pair'
    | 'container-and-members'
    | 'unattributed-values'
    | 'lineage-at-occurrence-creation'
    | 'silenced-chain-member'
    | 'separate-workspaces'
    | 'other';
  /** Pictures this configuration admits in the catalog; more than one means structure cannot choose. */
  readings: string[];
};

export type StructuralReading = { claims: StructuralClaim[]; abstentions: StructuralAbstention[] };

/** Rules that never chose a different host or a conflicting picture from a current
 * Tier-1/Tier-2 drawing in the October 2026 archive and fixture evaluation. A
 * single-host plaque can still be plainer than the PF plate or verdict glyph that
 * words choose for the same node. */
export const SAFE_STRUCTURAL_RULES: readonly StructuralRuleId[] = [
  'fork.two-segment', 'identity.shared-lineage', 'plaque.single-host'
];
export const ALL_STRUCTURAL_RULES: readonly StructuralRuleId[] = [
  ...SAFE_STRUCTURAL_RULES, 'fork.two-segment-in-context', 'ellipsis.silenced-site', 'plaque.paired-entry', 'plaque.annotation-owner', 'verdict.symbol-on-root'
];

/**
 * The single read point of the experiment switch. Off unless
 * `BABEL_STRUCTURAL_RECOGNITION` is set: `1` enables the safe rules, `all`
 * every measured rule, and a comma-separated list names rules exactly; `0` and
 * unknown names enable nothing. Browsers have no `process`, so they stay off.
 */
export const structuralRecognitionRules = (): ReadonlySet<StructuralRuleId> => {
  const setting = typeof process !== 'undefined' ? process.env?.BABEL_STRUCTURAL_RECOGNITION?.trim() : undefined;
  if (!setting || setting === '0') return new Set();
  if (setting === '1') return new Set(SAFE_STRUCTURAL_RULES);
  if (setting === 'all') return new Set(ALL_STRUCTURAL_RULES);
  return new Set(setting.split(',').map(rule => rule.trim())
    .filter((rule): rule is StructuralRuleId => (ALL_STRUCTURAL_RULES as readonly string[]).includes(rule)));
};

const SYMBOLIC_VERDICT_MAX = 3;

const entryItems = (signature: StructuralSignature, key: string) =>
  signature.anchorEntries.find(entry => entry.key === key)?.ids ?? [];

/** The authored anchor entries and positions that name one node. */
const bindingsFor = (signature: StructuralSignature, id: string, concept: string): StructuralBinding[] =>
  signature.anchorEntries.flatMap(entry => {
    const indices = entry.ids.flatMap((other, index) => other === id ? [index] : []);
    return indices.length ? [{ key: entry.key, indices, concept }] : [];
  });

const firstBindingFor = (signature: StructuralSignature, id: string, concept: string): StructuralBinding | undefined =>
  bindingsFor(signature, id, concept)[0];

/** Whether this stage may have added an occurrence to the node's lineage. Without
 * a previous stage every occurrence is created here, so any lineage with several
 * current occurrences counts. */
const lineageMayGainHere = (facts: StructuralNodeFacts): boolean => facts.change
  ? facts.change.lineageGained : (facts.lineageOccurrences ?? 0) > 1;
const occurrenceMayBeCreatedHere = (facts: StructuralNodeFacts): boolean => facts.change
  ? facts.change.isNew && facts.change.lineageGained : (facts.lineageOccurrences ?? 0) > 1;

/** Explicit X-bar adjunction: the parent has exactly the two anchored daughters,
 * one of them is a lower segment of the parent's category at the same marked
 * phrase or bar level, and the other is not a projection of that category at
 * all. Specifiers and complements never repeat the mother's marked level; a
 * same-category specifier (`DP` over `DP` and `D′`) has a projection of the
 * mother beside it. Bare Phrase Structure labels do not mark the level and are
 * reported as unmarked. */
const forkClaim = (signature: StructuralSignature, ids: string[], node: (id: string) => StructuralNodeFacts): StructuralClaim | StructuralAbstention | undefined => {
  let parentId: string | undefined, daughters: string[] = [];
  if (ids.length === 2 && signature.forkParentId) { parentId = signature.forkParentId; daughters = ids; }
  else if (ids.length === 3 && signature.anchoredForkParentId) {
    parentId = signature.anchoredForkParentId; daughters = ids.filter(id => id !== parentId);
  }
  let rule: StructuralRuleId = 'fork.two-segment';
  if (!parentId && ids.length > 3) {
    // The relation names a whole adjunction (its parent and both daughters)
    // beside other participants. Exactly one such anchored triple must exist.
    const triples = ids.flatMap(id => {
      const children = ids.filter(other => node(other).parentId === id);
      return children.length === 2 && node(children[0]).parent?.childCount === 2
        && children.filter(child => node(child).segmentOfParent).length === 1 ? [{ id, children }] : [];
    });
    if (triples.length !== 1) return undefined;
    ({ id: parentId, children: daughters } = triples[0]);
    rule = 'fork.two-segment-in-context';
  }
  if (!parentId || daughters.length !== 2) return undefined;
  const segments = daughters.filter(id => node(id).segmentOfParent);
  if (segments.length !== 1) {
    const same = daughters.filter(id => node(id).sameCategoryAsParent);
    if (same.length === 1 && node(same[0]).shape === 'terminal') return { configuration: 'head-complement', readings: ['selection', 'theta-grid', 'feature-path', 'plaque'] };
    if (same.length === 1) return { configuration: 'unmarked-sister-projection', readings: ['fork (adjunct)', 'theta-grid or feature-path (specifier)'] };
    return { configuration: 'exocentric-sisters', readings: ['predication', 'coordination', 'fork'] };
  }
  const host = segments[0], member = daughters.find(id => id !== host)!;
  if (node(member).sameCategoryAsParent) return { configuration: 'same-category-sisters', readings: ['specifier of the same category', 'head-complement', 'fork'] };
  if ([host, member].some(id => lineageMayGainHere(node(id)))) return { configuration: 'lineage-at-occurrence-creation', readings: ['movement', 'fork'] };
  const hostBinding = firstBindingFor(signature, host, 'host'), memberBinding = firstBindingFor(signature, member, 'pair.member');
  if (!hostBinding || !memberBinding || hostBinding.key === memberBinding.key) return undefined;
  if (entryItems(signature, hostBinding.key).length !== 1 || entryItems(signature, memberBinding.key).length !== 1) return undefined;
  return {
    rule, recipe: 'pair-merge',
    anchors: [hostBinding, memberBinding], values: [],
    picture: { family: 'fork', nodes: [member, host] }
  };
};

/** Values attributed to exact nodes by structure or by the contract's pairing. */
const valueOwners = (signature: StructuralSignature, ids: string[]) => {
  const owners = new Map<string, Array<{ key: string; index: number; rule: StructuralRuleId }>>();
  const unattributed: Array<{ key: string; index: number }> = [];
  const add = (id: string, key: string, index: number, rule: StructuralRuleId) => {
    if (!owners.has(id)) owners.set(id, []);
    owners.get(id)!.push({ key, index, rule });
  };
  for (const value of signature.values) {
    value.items.forEach((_, index) => {
      if (ids.length === 1) add(ids[0], value.key, index, 'plaque.single-host');
      else if (value.pairsWithAnchor && value.lengthMatchesPairedAnchor) add(entryItems(signature, value.key)[index], value.key, index, 'plaque.paired-entry');
      else if (value.annotationOf[index].length === 1) add(value.annotationOf[index][0], value.key, index, 'plaque.annotation-owner');
      else unattributed.push({ key: value.key, index });
    });
  }
  return { owners, unattributed };
};

const isAbstention = (value: StructuralClaim | StructuralAbstention | undefined): value is StructuralAbstention =>
  Boolean(value && 'configuration' in value);

const RULE_PRECEDENCE: StructuralRuleId[] = ['plaque.single-host', 'plaque.paired-entry', 'plaque.annotation-owner'];

export const recognizeStructurally = (
  signature: StructuralSignature,
  relation: Pick<DerivationStageRelation, 'relationContractFailure'> = {}
): StructuralReading => {
  const claims: StructuralClaim[] = [];
  const abstentions: StructuralAbstention[] = [];
  const node = (id: string) => signature.nodes[id];
  const ids = signature.anchorIds;
  if (relation.relationContractFailure || !ids.length
    || ids.some(id => !node(id).resolved || node(id).duplicate)) {
    return { claims, abstentions: [{ configuration: 'unresolved-or-repeated-anchor', readings: [] }] };
  }

  const fork = forkClaim(signature, ids, node);
  if (isAbstention(fork)) abstentions.push(fork);
  else if (fork) claims.push(fork);

  // Silence that this stage introduces over a whole anchored occurrence. Material
  // inside an occurrence whose lineage continues elsewhere is a chain copy, not a site.
  const silenced = ids.filter(id => node(id).change?.silencedTerminals.length && node(id).whollySilent);
  const chainCopies = silenced.filter(id => node(id).change!.silencedChainMembers.length);
  if (chainCopies.length) abstentions.push({ configuration: 'silenced-chain-member', readings: ['copy pronunciation', 'ellipsis'] });
  const sites = silenced.filter(id => !chainCopies.includes(id)
    && !silenced.some(other => other !== id && signature.pairs.some(pair => pair.a === other && pair.b === id && pair.relation === 'contains'
      || pair.a === id && pair.b === other && pair.relation === 'contained-by')));
  for (const site of sites) {
    const binding = firstBindingFor(signature, site, 'ellipsis.site');
    if (binding) claims.push({
      rule: 'ellipsis.silenced-site', recipe: 'ellipsis.site',
      anchors: [{ ...binding, indices: [binding.indices[0]] }], values: [],
      picture: { family: 'ellipsis', nodes: [site] }
    });
  }

  // The contract lineage asserts identity. Occurrences that all share one lineage,
  // none created at this stage, read one way: the same object.
  const lineages = ids.map(id => node(id).lineageId);
  if (ids.length >= 2 && lineages.every(lineage => lineage && lineage === lineages[0])
    && signature.pairs.every(pair => pair.relation !== 'contains' && pair.relation !== 'contained-by')) {
    if (ids.some(id => occurrenceMayBeCreatedHere(node(id)))) {
      abstentions.push({ configuration: 'lineage-at-occurrence-creation', readings: ['movement', 'coindex'] });
    } else claims.push({
      rule: 'identity.shared-lineage', recipe: 'identity.occurrences',
      anchors: signature.anchorEntries.map(entry => ({ key: entry.key, indices: entry.ids.map((_, index) => index), concept: 'occurrences' })),
      values: [], picture: { family: 'coindex', nodes: [...ids] }
    });
  }

  // A sole symbolic literal on a whole workspace is a verdict glyph; anything
  // spelled in words stays a plaque row because structure cannot read it.
  const valueCount = signature.values.reduce((sum, value) => sum + value.items.length, 0);
  if (ids.length === 1 && node(ids[0]).parentId === null && valueCount === 1 && signature.values[0].symbolic[0]
    && Array.from(signature.values[0].items[0].trim()).length <= SYMBOLIC_VERDICT_MAX && signature.values[0].items[0].trim()) {
    claims.push({
      rule: 'verdict.symbol-on-root', recipe: 'judgment.verdict',
      anchors: [firstBindingFor(signature, ids[0], 'analysis.anchor')!],
      values: [{ key: signature.values[0].key, indices: [0], concept: 'verdict' }],
      picture: { family: 'verdict', nodes: [ids[0]] }
    });
  } else if (valueCount) {
    const { owners, unattributed } = valueOwners(signature, ids);
    // Always the generic plaque: a pronunciation change in the same stage does not
    // make a row a PF statement, since feature claims on a newly realized head have
    // the same shape. One claim per host and attribution rule.
    for (const [owner, rows] of owners) for (const rule of RULE_PRECEDENCE) {
      const anchor = firstBindingFor(signature, owner, 'plaque.anchor');
      const ruleRows = rows.filter(row => row.rule === rule);
      if (!anchor || !ruleRows.length) continue;
      const byKey = new Map<string, number[]>();
      ruleRows.forEach(row => byKey.set(row.key, [...(byKey.get(row.key) ?? []), row.index]));
      claims.push({
        rule, recipe: 'plaque.structured',
        anchors: [{ ...anchor, indices: [anchor.indices[0]] }],
        values: [...byKey].map(([key, indices]) => ({ key, indices, concept: 'plaque.rows' })),
        picture: { family: 'plaque', nodes: [owner] }
      });
    }
    if (unattributed.length) abstentions.push({ configuration: 'unattributed-values', readings: ['plaque on any participant', 'path label', 'grid'] });
  }

  if (!claims.length && !abstentions.length) {
    const relations = new Set(signature.pairs.map(pair => pair.relation));
    if (signature.workspaceCount > 1) abstentions.push({ configuration: 'separate-workspaces', readings: ['sideward relation', 'neutral'] });
    else if (signature.containerIds.length) abstentions.push({ configuration: 'container-and-members', readings: ['binding domain', 'control domain', 'scope domain', 'idiom bracket', 'phase arc', 'selection'] });
    else if (ids.length === 2 && (relations.has('c-commands') || relations.has('c-commanded-by'))) abstentions.push({ configuration: 'c-command-pair', readings: ['case path', 'agreement path', 'binding path', 'control', 'predication', 'polarity licensing'] });
    else abstentions.push({ configuration: 'other', readings: [] });
  }
  return { claims, abstentions };
};

/**
 * Evidence scopes for the enabled structural claims of one relation, in the
 * form Tier-2 recipes evaluate. Bindings name authored fields and positions
 * exactly; the recipe still checks cardinality, nodes and structure.
 */
export const structuralClaimScopes = (
  evidence: Tier2FacetEvidence,
  input: StructuralSignatureInput & { relation: DerivationStageRelation },
  rules: ReadonlySet<StructuralRuleId>
): Array<EvidenceScope & { rule: StructuralRuleId }> => {
  if (!rules.size) return [];
  const reading = recognizeStructurally(structuralSignature(input), input.relation);
  return reading.claims.filter(claim => rules.has(claim.rule)).flatMap(claim => {
    const bind = (bindings: StructuralBinding[], entries: Tier2FacetEvidence['authoredCurrentAnchors']) => bindings.map(binding => {
      const entry = entries?.find(candidate => candidate.key === binding.key);
      return entry && binding.indices.every(index => index < entry.items.length)
        ? { entry, concept: binding.concept, indices: binding.indices } : undefined;
    });
    const anchors = bind(claim.anchors, evidence.authoredCurrentAnchors);
    const values = bind(claim.values, evidence.authoredValues);
    if ([...anchors, ...values].some(binding => !binding)) return [];
    return [{ ...scopeEvidence(evidence, claim.recipe, anchors as NonNullable<typeof anchors[number]>[],
      values as NonNullable<typeof values[number]>[]), rule: claim.rule }];
  });
};

import type { SyntaxNode } from '../../types.ts';
import type { NativePlaqueContent } from './nativeDrawingContent.ts';
import {
  authoredOutcomeLiterals,
  negativeClaimFailure,
  POSITIVE_OUTCOMES,
  resolveOutcomeLiteral
} from './outcomeResolver.ts';
import { TIER2_FACET_RECIPES } from './tier2FacetRecipes.ts';
import type { Tier2AnchorSource, Tier2AuthoredEvidenceEntry, Tier2FacetEvidence } from './tier2FacetTypes.ts';
import {
  FEATURE_DIMENSION_KEYS,
  namedThematicRole,
  normalizeTier2Synonym,
  thematicRoleLabel,
  thematicSlotQualifier
} from './tier2Synonyms.ts';

// Edge outlines are independent per node; organizational rails retain each
// authored role group. Neither drawing asserts one joint linguistic group.
export const INDEPENDENT_TIER2_ANCHOR_ROLES: ReadonlySet<string> = new Set(['phase.edge', 'large.anchor.array']);

export const independentIdiomMemberFields = (evidence: Pick<Tier2FacetEvidence, 'authoredCurrentAnchors'>): boolean => {
  const fields = evidence.authoredCurrentAnchors?.filter(entry => entry.concepts.includes('chunks')) ?? [];
  return fields.length > 1 && fields.every(entry => entry.items.length === 1
    && /^(?:idiom|idiomatic) (?:verb|noun|nominal|head|phrase|constituent|member|chunk|component)$/u.test(normalizeTier2Synonym(entry.key)))
    && new Set(fields.flatMap(entry => entry.items)).size === fields.length;
};

// These are rows of content, not competing alternative bindings of one slot.
// Their owning recipe must still establish participants and any dependency.
export const INDEPENDENT_TIER2_VALUE_ROLES: ReadonlySet<string> = new Set(['plaque.rows', 'pf.rows']);

/** Distinct scalar dimensions form one bundle; alternative bundles do not. */
export const independentFeatureDimensions = (entries: readonly Pick<Tier2AuthoredEvidenceEntry, 'key' | 'items'>[]) =>
  entries.length > 0 && entries.every(entry => (FEATURE_DIMENSION_KEYS.has(normalizeTier2Synonym(entry.key).replace(/^shared /u, ''))
    || /^(?:noun class|case|morphological case|definiteness)$/u.test(normalizeTier2Synonym(entry.key).replace(/^shared /u, ''))) && entry.items.length === 1)
  && new Set(entries.map(entry => normalizeTier2Synonym(entry.key).replace(/^shared /u, ''))).size === entries.length;

export type TreeIndex = {
  nodes: Map<string, SyntaxNode[]>;
  parentIds: Map<string, Set<string>>;
  workspaceIds: Map<string, Set<string>>;
};

export const buildTreeIndex = (forest: readonly SyntaxNode[] | undefined): TreeIndex => {
  const index: TreeIndex = {
    nodes: new Map(),
    parentIds: new Map(),
    workspaceIds: new Map()
  };

  const visit = (node: SyntaxNode, parentId: string | null, workspaceId: string) => {
    const id = String(node.id || '');
    if (id) {
      const nodes = index.nodes.get(id) ?? [];
      nodes.push(node);
      index.nodes.set(id, nodes);
      const workspaces = index.workspaceIds.get(id) ?? new Set<string>();
      workspaces.add(workspaceId);
      index.workspaceIds.set(id, workspaces);
      if (parentId) {
        const parents = index.parentIds.get(id) ?? new Set<string>();
        parents.add(parentId);
        index.parentIds.set(id, parents);
      }
    }
    (Array.isArray(node.children) ? node.children : []).forEach((child) => visit(child, id || parentId, workspaceId));
  };

  (Array.isArray(forest) ? forest : []).forEach((root, rootIndex) => {
    const workspaceId = String(root.id || '') || `workspace:${rootIndex}`;
    visit(root, null, workspaceId);
  });
  return index;
};

/** Shared only during one evaluation; callers must rebuild after changing either forest. */
export const indexTier2Forests = (evidence: Pick<Tier2FacetEvidence, 'currentForest' | 'priorForest'>) => ({
  currentIndex: buildTreeIndex(evidence.currentForest),
  priorIndex: buildTreeIndex(evidence.priorForest)
});

export type Tier2ForestIndexes = ReturnType<typeof indexTier2Forests>;

export const anchorIds = (
  evidence: Tier2FacetEvidence,
  role: string,
  source: Tier2AnchorSource = 'current'
): string[] => {
  const currentIds = [...(evidence.currentAnchors[role] ?? [])].map(String);
  const priorIds = [...(evidence.priorAnchors?.[role] ?? [])].map(String);
  if (source === 'current') return currentIds;
  if (source === 'prior') return priorIds;
  return [...new Set([...currentIds, ...priorIds])];
};

export const valueLiterals = (evidence: Tier2FacetEvidence, valueName: string): string[] =>
  [...(evidence.values[valueName] ?? [])].map(String);

// Feature heads have known meanings; their values stay literal. Explanatory
// prose is context, not evidence for or against a specialized assertion.
export const featureNotationStatus = (literal: string, tokens: readonly string[]): 'affirmative' | 'contradiction' | 'context' => {
  let notation = literal.normalize('NFKC').trim();
  const enclosure = notation.match(/^\[([^\[\]]*)\]$|^\(([^()]*)\)$/u);
  if (enclosure) notation = (enclosure[1] ?? enclosure[2]).trim();
  notation = notation.replace(/^([^():]+)\s*\(([^()]*)\)$/u, '$1:$2');
  const head = (text: string) => normalizeTier2Synonym(text).replace(/^u (pol|polarity)$/u, '$1');
  const denial = /^(?:no|not|non|without|none|absent|false|unassigned|unasserted)\b/u;
  const normalized = head(notation);
  if (tokens.includes(normalized)) return 'affirmative';
  const colon = notation.indexOf(':');
  if (colon >= 0) {
    const subject = head(notation.slice(0, colon));
    const payload = notation.slice(colon + 1).trim();
    const normalizedPayload = normalizeTier2Synonym(payload);
    if (subject === 'case' && tokens.includes('dependent case')) {
      if (normalizedPayload === 'dependent') return 'affirmative';
      if (/^(?:not|non) dependent$/u.test(normalizedPayload)) return 'contradiction';
    }
    if (tokens.includes(subject)) {
      if (denial.test(normalizedPayload)) return 'contradiction';
      return payload && !/^(?:unknown|unsupported)\b/u.test(normalizedPayload) ? 'affirmative' : 'context';
    }
  }
  const prefixed = normalized.match(/^(?:not|no|non|without)\s+(.+)$/u);
  if (prefixed && tokens.includes(head(prefixed[1].split(':')[0]))) return 'contradiction';
  const clause = normalized.match(/^(.+?)\s+(?:is\s+)?(not\b.*|absent|false|unassigned|unasserted)$/u);
  return clause && tokens.includes(head(clause[1])) ? 'contradiction' : 'context';
};

/**
 * Positional pairing is authored, never assumed. The contract says: a values
 * entry that lists one literal per item of an anchor entry carries the same
 * name and the same length. Only such an entry pairs by position. One anchor
 * item with one literal is unambiguous and pairs regardless of name. Any
 * other arrangement is not a pairing; the literals stay visible as residue.
 * Returns `[]` when no literals are authored, `undefined` when literals exist
 * but cannot be paired.
 */
export type PairedLiterals =
  | { status: 'paired' | 'none'; literals: string[] }
  /** Several normalized keys compete without an exact authored-name match. */
  | { status: 'ambiguous'; literals: string[] }
  /** A same-name values entry exists but its length differs from the anchor entry. */
  | { status: 'unequal'; literals: string[] }
  /** Literals exist under another name and more than one item is involved. */
  | { status: 'unpaired'; literals: string[] };

export const pairedLiteralsDetail = (
  evidence: Tier2FacetEvidence,
  role: string,
  valueConcept: string
): PairedLiterals => {
  const ids = anchorIds(evidence, role);
  const anchorEntries = (evidence.authoredCurrentAnchors ?? []).filter(entry =>
    entry.concepts.includes(role) && entry.items.length > 0);
  const candidates = anchorEntries.map(entry => sameNameValueEntries(evidence, entry, role));
  if (candidates.some(entries => entries.length > 1)) {
    return { status: 'ambiguous', literals: candidates.flatMap(entries => entries.flatMap(entry => [...entry.items])) };
  }
  const sameName = candidates.map(entries => entries[0])
    .map(entry => entry && sameNameEntryServes(entry, role, valueConcept) ? entry : undefined);
  if (anchorEntries.length > 0 && sameName.some(Boolean)) {
    if (sameName.every(entry => entry && entry.items.length === entry.anchorLength)) {
      const literals = sameName.flatMap(entry => [...entry!.items]);
      if (literals.length === ids.length) return { status: 'paired', literals };
    }
    return { status: 'unequal', literals: sameName.flatMap(entry => entry ? [...entry.items] : []) };
  }
  const literals = valueLiterals(evidence, valueConcept);
  if (role === 'theta.arguments' && valueConcept === 'role.label' && literals.length === 0
    && !evidence.authoredValues?.some(entry => entry.concepts.includes('role.label'))) {
    if (namedThetaInventory(evidence))
      return { status: 'paired', literals: anchorEntries.map(entry => namedThematicRole(entry.key)!) };
    const label = thematicRoleLabel(evidence.relationName);
    if (label.status === 'literal' && establishedThetaInventory(evidence)) {
      const participants = (evidence.authoredCurrentAnchors ?? []).filter(entry =>
        entry.concepts.includes(role) || namedThematicRole(entry.key));
      return { status: ids.length === 1 && participants.length === 1 ? 'paired' : 'unpaired', literals: [label.literal] };
    }
  }
  if (literals.length === 0) return { status: 'none', literals };
  // With no anchors there is nothing to pair; the anchor requirement reports that.
  if (ids.length === 0 || (ids.length === 1 && literals.length === 1)) return { status: 'paired', literals };
  return { status: 'unpaired', literals };
};

export const pairedLiterals = (
  evidence: Tier2FacetEvidence,
  role: string,
  valueConcept: string
): string[] | undefined => {
  const detail = pairedLiteralsDetail(evidence, role, valueConcept);
  return detail.status === 'paired' || detail.status === 'none' ? detail.literals : undefined;
};

export const sameNameValueEntries = (
  evidence: Pick<Tier2FacetEvidence, 'authoredValues'>,
  anchorEntry: Tier2AuthoredEvidenceEntry,
  role?: string
): (Tier2AuthoredEvidenceEntry & { anchorLength: number })[] => {
  const entries = evidence.authoredValues ?? [];
  const exact = entries.filter(candidate => candidate.key === anchorEntry.key);
  // A spelling-equivalent key may fill an absent slot, but cannot override an
  // exact authored pair or choose between competing fields by object order.
  const matches = exact.length ? exact : entries.filter(candidate =>
    normalizeTier2Synonym(candidate.key) === normalizeTier2Synonym(anchorEntry.key));
  const qualifier = (!role || role === 'theta.arguments') && anchorEntry.concepts.includes('theta.arguments') && anchorEntry.items.length === 1
    ? thematicSlotQualifier(anchorEntry.key, 'anchor') : undefined;
  const qualified = !matches.length && qualifier ? entries.filter(candidate => candidate.items.length === 1
    && thematicSlotQualifier(candidate.key, 'value') === qualifier) : [];
  const named = !matches.length && !qualified.length && (!role || role === 'theta.arguments')
    && anchorEntry.concepts.includes('theta.arguments') && anchorEntry.items.length === 1
    ? entries.filter(candidate => candidate.items.length === 1
      && /(?:^| )role$/u.test(normalizeTier2Synonym(candidate.key))
      && [normalizeTier2Synonym(anchorEntry.key), namedThematicRole(anchorEntry.key)].includes(normalizeTier2Synonym(candidate.items[0]))) : [];
  return (matches.length ? matches : qualified.length ? qualified : named)
    .map(entry => ({ ...entry, anchorLength: anchorEntry.items.length }));
};

const establishedThetaInventory = (evidence: Pick<Tier2FacetEvidence, 'authoredValues'>): boolean =>
  authoredOutcomeLiterals(Object.fromEntries((evidence.authoredValues ?? []).map(entry => [entry.key, [...entry.items]])))
    .every(literal => POSITIVE_OUTCOMES.some(concept => concept === resolveOutcomeLiteral(literal)?.concept));

/** Separate argument fields form an inventory when each names its own role
 * literals. Unpaired aliases still compete for one binding. */
export const namedThetaInventory = (
  evidence: Pick<Tier2FacetEvidence, 'authoredCurrentAnchors' | 'authoredValues' | 'relationName'>
): boolean => {
  const entries = evidence.authoredCurrentAnchors?.filter(entry => entry.concepts.includes('theta.arguments')) ?? [];
  // Recipient and goal also name assignment endpoints. Another thematic slot
  // can establish an inventory; a lone direction word cannot name its role.
  const hasNamedRole = entries.some(entry => !['recipient', 'goal'].includes(namedThematicRole(entry.key) ?? ''));
  return thematicRoleLabel(evidence.relationName).status !== 'unresolved' && hasNamedRole
    && entries.length >= 1 && entries.every(entry => entry.items.length === 1 && namedThematicRole(entry.key))
    && establishedThetaInventory(evidence)
    && new Set(entries.map(entry => namedThematicRole(entry.key))).size === entries.length
    && new Set(entries.map(entry => entry.items[0])).size === entries.length
    && !(evidence.authoredValues ?? []).some(entry => entry.concepts.includes('role.label')
      || entries.some(anchor => sameNameValueEntries(evidence, anchor).some(value => value.key === entry.key)));
};

export const independentThetaArgumentFields = (
  evidence: Pick<Tier2FacetEvidence, 'authoredCurrentAnchors' | 'authoredValues' | 'relationName'>
): boolean => {
  const arguments_ = evidence.authoredCurrentAnchors?.filter(entry => entry.concepts.includes('theta.arguments')) ?? [];
  const ids = arguments_.flatMap(entry => [...entry.items]);
  return namedThetaInventory(evidence) || arguments_.length > 1
    && new Set(arguments_.map(entry => normalizeTier2Synonym(entry.key))).size === arguments_.length
    && new Set(ids).size === ids.length
    && arguments_.every(entry => {
      const values = sameNameValueEntries(evidence, entry);
      return entry.items.length > 0 && values.length === 1
        && values[0].items.length === entry.items.length
        && values[0].items.every(value => value.trim().length > 0);
    });
};

/** A prior block that restates independent current argument fields field by
 * field: each prior field shares its key and length with one current field, so
 * it names that participant's preceding occurrence, not a competing inventory. */
export const independentPriorThetaArgumentFields = (
  evidence: Pick<Tier2FacetEvidence, 'authoredCurrentAnchors' | 'authoredPriorAnchors' | 'authoredValues' | 'relationName'>
): boolean => {
  const current = evidence.authoredCurrentAnchors?.filter(entry => entry.concepts.includes('theta.arguments')) ?? [];
  const prior = evidence.authoredPriorAnchors?.filter(entry => entry.concepts.includes('theta.arguments')) ?? [];
  const ids = prior.flatMap(entry => [...entry.items]);
  return prior.length > 0 && independentThetaArgumentFields(evidence)
    && new Set(ids).size === ids.length
    && prior.every(entry => current.some(other => other.key === entry.key && other.items.length === entry.items.length));
};

export const independentThetaRoleValueFields =(evidence: Tier2FacetEvidence): boolean => {
  const entries = evidence.authoredValues?.filter(entry => entry.concepts.includes('role.label')) ?? [];
  const arguments_ = evidence.authoredCurrentAnchors?.filter(entry => entry.concepts.includes('theta.arguments')) ?? [];
  return entries.length > 1 && entries.length === arguments_.length
    && arguments_.every(argument => sameNameValueEntries(evidence, argument, 'theta.arguments').length === 1)
    && new Set(entries.map(entry => normalizeTier2Synonym(entry.key))).size === entries.length;
};

/** Every per-item literal concept a recipe pairs with this role, in recipe order. */
const pairedConceptsForRole = (role: string): string[] => {
  const concepts = TIER2_FACET_RECIPES.flatMap(recipe => recipe.checks.flatMap(check =>
    check.kind === 'paired-values' && check.role === role ? [check.value]
      : check.kind === 'feature-dependency' && role === 'feature.target' ? ['case.literal'] : []));
  return Array.from(new Set(concepts));
};

/**
 * One same-name entry carries one kind of literal. If its name also spells a
 * paired concept, it serves that concept; an opaque name serves the first
 * per-item concept a recipe pairs with the role.
 */
const sameNameEntryServes = (entry: Tier2AuthoredEvidenceEntry, role: string, valueConcept: string): boolean => {
  const paired = pairedConceptsForRole(role);
  const named = entry.concepts.filter(concept => paired.includes(concept));
  return named.length > 0 ? named.includes(valueConcept) : paired[0] === valueConcept;
};

export const unpairedReason = (role: string, valueConcept: string, status: PairedLiterals['status']): string =>
  status === 'ambiguous'
    ? `${valueConcept} literals for ${role} have ambiguous normalized field names`
    : status === 'unequal'
      ? `${valueConcept} literals for ${role} use the anchor entry's name but not its length`
      : `${valueConcept} literals are not paired with ${role}: pairing needs a values entry with the same name and length as the anchor entry`;

export const literalThetaRoles = (evidence: Tier2FacetEvidence): Array<{ nodeId: string; label: string }> | undefined => {
  const arguments_ = anchorIds(evidence, 'theta.arguments');
  const labels = pairedLiterals(evidence, 'theta.arguments', 'role.label');
  if (!arguments_.length || !labels || arguments_.length !== labels.length || labels.some(label => !label.trim())) return undefined;
  return arguments_.map((nodeId, index) => ({ nodeId, label: labels[index] }));
};

// Capitalises the first UTF-16 code unit, not the first code point as caseSurfaceInitial does.
const anchorNameRoleLabel = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

/** The exact ThetaAssignment contract also permits its open anchor names as role labels. */
export function nativeThetaRoles(evidence: Tier2FacetEvidence): { roles: Array<{ nodeId: string; label: string }>; error?: never } | { roles?: never; error: string } {
  const explicitArguments = evidence.currentAnchors['theta.arguments'];
  const explicitRoles = explicitArguments?.length ? literalThetaRoles(evidence)?.map(role => {
    if (!namedThetaInventory(evidence)) return role;
    const entry = evidence.authoredCurrentAnchors?.find(entry =>
      entry.concepts.includes('theta.arguments') && entry.items[0] === role.nodeId);
    return entry ? { ...role, label: anchorNameRoleLabel(entry.key) } : role;
  }) : undefined;
  if (explicitArguments?.length && !explicitRoles) return { error: 'Theta arguments require exactly one authored role label per argument' };
  const roles = [...(explicitRoles ?? [])];
  for (const entry of evidence.authoredCurrentAnchors ?? []) {
    if (entry.key.toLowerCase() === 'predicate' || entry.concepts.some(concept =>
      ['predicate', 'predicate.context', 'theta.arguments'].includes(concept))) continue;
    const matches = sameNameValueEntries(evidence, entry);
    if (matches.length > 1 || (matches.length === 1 && (matches[0].items.length !== entry.items.length || matches[0].items.some(label => !label.trim())))) {
      return { error: 'Theta role literals require one unambiguous same-name value per argument' };
    }
    entry.items.forEach((nodeId, index) => roles.push({
      nodeId,
      label: matches[0]?.items[index] ?? anchorNameRoleLabel(entry.key)
    }));
  }
  return roles.length ? { roles } : { error: 'A theta grid requires at least one authored role association' };
}

// Native plates require named groups. Only bound, consumed concepts get these
// internal field names; raw row labels remain available for literal display.
/**
 * Fission: two output terminals in anchors, one feature-bundle literal per
 * output paired by the same-name rule, and the input bundle as a list.
 */
export const prepareNativeFissionContent = (
  evidence: Tier2FacetEvidence
): Extract<NativePlaqueContent, { kind: 'fission' }> | undefined => {
  const outputs = anchorIds(evidence, 'rewrite.outputs');
  const bundles = pairedLiterals(evidence, 'rewrite.outputs', 'fission.output');
  const inputFeatures = valueLiterals(evidence, 'fission.input');
  if (outputs.length !== 2 || !bundles || bundles.length !== 2 || bundles.some(bundle => !bundle.trim()) || !inputFeatures.length) return;
  return { kind: 'fission', inputFeatures, outputFeatures: [[bundles[0]], [bundles[1]]] };
};

export const tier2NativePlaqueRows = (evidence: Tier2FacetEvidence): Array<{ label: string; value: string }> =>
  Object.entries({
    'feature.hierarchy': 'featureHierarchy', 'delink.position': 'delinkAfter',
    'pf.sources': 'sources', 'pf.exponents': 'exponents',
    'storage.category': 'category', 'storage.qstore': 'qstore', 'storage.retrieved': 'retrieved'
  }).flatMap(([concept, label]) => valueLiterals(evidence, concept).map(value => ({ label, value })));

export const findNodes = (index: TreeIndex, ids: readonly string[]): SyntaxNode[] =>
  ids.flatMap((id) => index.nodes.get(id) ?? []);

export const sharedRootLineage = (index: TreeIndex, ids: readonly string[]): string | undefined => {
  const lineages = ids.map(id => {
    const matches = index.nodes.get(id) ?? [];
    return matches.length === 1 ? matches[0].lineageId : undefined;
  });
  return lineages.length >= 2 && lineages.every(lineage => Boolean(lineage) && lineage === lineages[0])
    ? lineages[0] : undefined;
};

const descendantIds = (node: SyntaxNode): Set<string> => {
  const ids = new Set<string>();
  const visit = (currentNode: SyntaxNode) => {
    const id = String(currentNode.id || '');
    if (id) ids.add(id);
    (Array.isArray(currentNode.children) ? currentNode.children : []).forEach(visit);
  };
  visit(node);
  return ids;
};

export const nodeContainsAny = (
  index: TreeIndex,
  containerIds: readonly string[],
  memberIds: readonly string[]
): boolean => memberIds.every((memberId) => containerIds.some((containerId) =>
  (index.nodes.get(containerId) ?? []).some((node) => descendantIds(node).has(memberId))
));

export const subtreeNodes = (node: SyntaxNode): SyntaxNode[] => {
  const nodes: SyntaxNode[] = [];
  const visit = (currentNode: SyntaxNode) => {
    nodes.push(currentNode);
    (Array.isArray(currentNode.children) ? currentNode.children : []).forEach(visit);
  };
  visit(node);
  return nodes;
};

const subtreeLineages = (node: SyntaxNode): Set<string> => new Set(
  subtreeNodes(node).map((member) => String(member.lineageId || '')).filter(Boolean)
);

export const sharesLineage = (index: TreeIndex, roleIdGroups: readonly string[][]): boolean => {
  const lineageGroups = roleIdGroups.map((ids) => new Set(
    findNodes(index, ids).flatMap((node) => [...subtreeLineages(node)])
  ));
  if (lineageGroups.some((group) => group.size === 0)) return false;
  return [...lineageGroups[0]].some((lineage) => lineageGroups.slice(1).every((group) => group.has(lineage)));
};

export const hasAuthoredSilent = (index: TreeIndex, ids: readonly string[]): boolean =>
  findNodes(index, ids).some((node) => subtreeNodes(node).some((member) => member.silent === true));

const TRACE_SURFACE = /^(?:t(?:_[\p{L}\p{N}]+|[\d₀-₉ᵢⱼₖₗₘₙₒₚ]+)?|trace|gap)$/iu;

export const isAuthoredTraceOrGap = (index: TreeIndex, ids: readonly string[]): boolean =>
  ids.every((id) => {
    const matches = index.nodes.get(id) ?? [];
    if (matches.length !== 1) return false;
    const node = matches[0];
    if ((node.children ?? []).length > 0) return false;
    return node.silent === true || TRACE_SURFACE.test(String(node.word || node.label || '').trim());
  });

export const projectionChain = (evidence: Tier2FacetEvidence): string[] => {
  const accent = anchorIds(evidence, 'accent.bearer')[0];
  const projections = anchorIds(evidence, 'projection.nodes');
  return projections[0] === accent ? projections : [accent, ...projections];
};

export const focusParent = (evidence: Tier2FacetEvidence, index: TreeIndex): string | undefined => {
  const left = anchorIds(evidence, 'focus')[0];
  const right = anchorIds(evidence, 'background')[0];
  if (!left || !right || left === right) return undefined;
  const parents = [...(index.parentIds.get(left) ?? [])].filter(parent =>
    index.parentIds.get(right)?.has(parent)
    && nodeContainsAny(index, anchorIds(evidence, 'domain'), [parent]));
  return parents.length === 1 ? parents[0] : undefined;
};

export const negativeClaimEvidence = (evidence: Tier2FacetEvidence, roles: readonly string[]) => {
  const outcomes = evidence.authoredValues
    ? authoredOutcomeLiterals(Object.fromEntries(evidence.authoredValues.map(entry => [entry.key, [...entry.items]])))
    : valueLiterals(evidence, 'outcome');
  const failure = negativeClaimFailure(outcomes,
    (evidence.authoredCurrentAnchors ?? []).filter(entry => roles.some(role => entry.concepts.includes(role))).map(entry => entry.key),
    (evidence.authoredCurrentAnchors ?? []).map(entry => entry.key));
  return { outcomes, failure };
};


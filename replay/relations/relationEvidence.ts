import type { DerivationStageRelation, SurfaceRealization, SyntaxNode } from '../../types.ts';
import { recoverMovementEvidence } from './movementEvidence.ts';
import { nominalConcordMembers } from './nominalConcord.ts';
import { resolveOutcomeLiteral } from './outcomeResolver.ts';
import { INDEPENDENT_TIER2_ANCHOR_ROLES, INDEPENDENT_TIER2_VALUE_ROLES, independentFeatureDimensions, independentThetaArgumentFields, independentIdiomMemberFields, sameNameValueEntries,
  type Tier2AuthoredEvidenceEntry, type Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { buildTier2SynonymIndex, lookupTier2SynonymCandidates, normalizeTier2Synonym, relationRoleConcepts, relationValueConcepts,
  isWholeClauseJudgmentRelation, type Tier2SynonymIndex, type Tier2SynonymScope } from './tier2Synonyms.ts';
const DEFAULT_SYNONYM_INDEX = buildTier2SynonymIndex();

const authoredItems = (value: string | string[]): string[] => (
  (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? ''))
);

const appendItems = (
  target: Record<string, string[]>,
  concept: string,
  items: readonly string[]
) => {
  target[concept] = [...(target[concept] ?? []), ...items];
};

const normalizeBlock = (
  block: Record<string, string | string[]> | undefined,
  scope: Tier2SynonymScope,
  synonymIndex: Tier2SynonymIndex,
  context?: Parameters<typeof relationRoleConcepts>[2]
): {
  concepts: Record<string, string[]>;
  authored: Tier2AuthoredEvidenceEntry[];
} => {
  const normalized: Record<string, string[]> = {};
  const authored: Tier2AuthoredEvidenceEntry[] = [];
  const conceptBlocks = new Map<string, string[]>();
  Object.entries(block ?? {}).forEach(([authoredKey, value]) => {
    const items = authoredItems(value);
    const concepts = scope === 'role' ? relationRoleConcepts(synonymIndex, authoredKey, context)
      : relationValueConcepts(synonymIndex, authoredKey, context);
    const activeConcepts: string[] = [];
    const conceptItemIndices: Record<string, number[]> = {};
    concepts.forEach((concept) => {
      const conceptItems = scope === 'value' && concept === 'outcome'
        ? items.filter((item) => resolveOutcomeLiteral(item)?.concept)
        : scope === 'value' && concept === 'verdict'
          ? items.filter((item) => isWholeClauseJudgmentRelation(context?.relation ?? '') || !resolveOutcomeLiteral(item)?.concept)
          : items;
      if (conceptItems.length === 0) {
        if (items.length === 0) activeConcepts.push(concept);
        return;
      }
      activeConcepts.push(concept);
      conceptItemIndices[concept] = items.flatMap((item, index) => conceptItems.includes(item) ? [index] : []);
      const blockIdentity = JSON.stringify(conceptItems);
      const previousBlocks = conceptBlocks.get(concept) ?? [];
      if (!previousBlocks.includes(blockIdentity)) {
        const dimensions = scope === 'value' && concept === 'feature.rows' && independentFeatureDimensions([
          ...authored.filter(entry => entry.concepts.includes(concept)), { key: authoredKey, items }
        ]);
        if (previousBlocks.length === 0 || dimensions || (scope === 'role' ? INDEPENDENT_TIER2_ANCHOR_ROLES : INDEPENDENT_TIER2_VALUE_ROLES).has(concept)) {
          appendItems(normalized, concept, conceptItems);
        } else {
          normalized[concept] = [];
        }
      }
      conceptBlocks.set(concept, [...previousBlocks, blockIdentity]);
    });
    authored.push({
      key: authoredKey,
      concepts: activeConcepts,
      conceptItemIndices,
      items: [...items]
    });
  });
  return { concepts: normalized, authored };
};

export const buildTier2FacetEvidence = ({
  relation,
  currentForest,
  currentRealizations,
  priorForest,
  activeLens,
  synonymIndex = DEFAULT_SYNONYM_INDEX
}: { relation: DerivationStageRelation; currentForest: readonly SyntaxNode[]; currentRealizations?: readonly SurfaceRealization[];
  priorForest?: readonly SyntaxNode[]; activeLens?: boolean; synonymIndex?: Tier2SynonymIndex }): Tier2FacetEvidence => {
  const currentAnchors = normalizeBlock(relation.anchors, 'role', synonymIndex, { ...relation, forest: currentForest });
  const priorAnchors = normalizeBlock(relation.priorAnchors, 'role', synonymIndex, { ...relation, anchors: relation.priorAnchors ?? {}, forest: priorForest });
  const values = normalizeBlock(relation.values, 'value', synonymIndex, { ...relation, forest: currentForest });
  // A Case value qualified by the exact recipient role belongs to that one
  // participant. This cannot pair a subjectCase literal with a generic goal.
  const recipients = currentAnchors.authored.filter(entry => entry.concepts.includes('feature.target'));
  if (recipients.length === 1 && recipients[0].items.length === 1) {
    const role = normalizeTier2Synonym(recipients[0].key);
    const namedCases = values.authored.filter(entry => normalizeTier2Synonym(entry.key) === `${role} case` && entry.items.length === 1 && entry.items[0].trim());
    namedCases.forEach(entry => {
      entry.concepts = [...entry.concepts, 'case.literal'];
      entry.conceptItemIndices = { ...entry.conceptItemIndices, 'case.literal': [0] };
      appendItems(values.concepts, 'case.literal', entry.items);
    });
  }
  if (independentIdiomMemberFields({ authoredCurrentAnchors: currentAnchors.authored })) {
    currentAnchors.concepts.chunks = currentAnchors.authored.filter(entry => entry.concepts.includes('chunks')).flatMap(entry => entry.items);
  }
  const concord = nominalConcordMembers({ currentForest, authoredCurrentAnchors: currentAnchors.authored, authoredValues: values.authored });
  if (concord.length) {
    currentAnchors.concepts['feature.bearers'] = concord.flatMap(entry => entry.items);
    concord.forEach(entry => {
      entry.concepts = [...entry.concepts, 'feature.bearers'];
      entry.conceptItemIndices = { ...entry.conceptItemIndices, 'feature.bearers': entry.items.map((_, index) => index) };
    });
  }
  const declaredContributors = currentAnchors.authored.filter(entry => entry.concepts.includes('pf.contributors'));
  const contributors = declaredContributors.length ? declaredContributors : currentAnchors.authored;
  const surfaces = values.authored.filter(entry => entry.concepts.includes('pf.surface'));
  let realizationGroupAnchorKeys: string[] | undefined;
  // The entire authored realization group owns the plate. No member is chosen
  // as a lexical source, output head or morphological controller.
  if ((!declaredContributors.length || declaredContributors.length === 1) && surfaces.length === 1 && surfaces[0].items.length === 1
    && surfaces[0].items[0].trim() && !Object.hasOwn(currentAnchors.concepts, 'rewrite.output')) {
    const ids = contributors.flatMap(entry => entry.items);
    const groups = currentRealizations ?? [];
    const nodes = new Map<string, SyntaxNode[]>();
    const visit = (node: SyntaxNode) => {
      nodes.set(node.id, [...(nodes.get(node.id) ?? []), node]);
      node.children?.forEach(visit);
    };
    currentForest.forEach(visit);
    const contains = (node: SyntaxNode, id: string): boolean => node.id === id || Boolean(node.children?.some(child => contains(child, id)));
    const matches = groups.flatMap(group => {
      if (group.nodeIds.length === ids.length && new Set(group.nodeIds).size === ids.length
        && ids.every(id => group.nodeIds.includes(id))) return [{ group, carriers: [] as Tier2AuthoredEvidenceEntry[] }];
      // A realization may name the whole constituent while its relation names
      // the contained contributors. The carrier must also be explicitly anchored.
      if (!declaredContributors.length || group.nodeIds.length !== 1) return [];
      const carriers = currentAnchors.authored.filter(entry => !contributors.includes(entry)
        && entry.items.length === 1 && entry.items[0] === group.nodeIds[0]);
      const carrier = nodes.get(group.nodeIds[0]);
      return carriers.length === 1 && carrier?.length === 1 && ids.every(id => contains(carrier[0], id))
        ? [{ group, carriers }] : [];
    });
    const match = matches.length === 1 ? matches[0] : undefined;
    const group = match?.group;
    const exactGroup = ids.length > 0 && new Set(ids).size === ids.length && group
      && ids.every(id => nodes.get(id)?.length === 1)
      && group.tokenIndices.length > 0 && new Set(group.tokenIndices).size === group.tokenIndices.length
      && group.tokenIndices.every(index => Number.isInteger(index) && index >= 0)
      && groups.every(other => other === group || !other.tokenIndices.some(index => group.tokenIndices.includes(index)));
    if (exactGroup) {
      const owners = [...match!.carriers, ...contributors];
      realizationGroupAnchorKeys = owners.map(entry => entry.key);
      currentAnchors.concepts['rewrite.output'] = [...new Set(owners.flatMap(entry => entry.items))];
      owners.forEach(entry => {
        entry.concepts = [...entry.concepts, 'rewrite.output'];
        entry.conceptItemIndices = { ...entry.conceptItemIndices,
          'rewrite.output': entry.items.map((_, index) => index) };
      });
      if (!surfaces[0].concepts.includes('pf.rows')) appendItems(values.concepts, 'pf.rows', surfaces[0].items);
      surfaces[0].concepts = [...new Set([...surfaces[0].concepts, 'pf.rows'])];
      surfaces[0].conceptItemIndices = { ...surfaces[0].conceptItemIndices, 'pf.rows': [0] };
    }
  }
  if (independentThetaArgumentFields({ authoredCurrentAnchors: currentAnchors.authored, authoredValues: values.authored })) {
    const arguments_ = currentAnchors.authored.filter(entry => entry.concepts.includes('theta.arguments'));
    currentAnchors.concepts['theta.arguments'] = arguments_.flatMap(entry => [...entry.items]);
    const paired = arguments_.map(entry => sameNameValueEntries({ authoredValues: values.authored }, entry, 'theta.arguments')[0]);
    if (!values.concepts['role.label']?.length && paired.every(entry => entry?.concepts.includes('role.label'))) {
      values.concepts['role.label'] = paired.flatMap(entry => entry.items);
    }
  }
  // One current participant makes explicit record rows attachable without
  // interpreting its role or the relation title. Multiple participants still
  // need an authored recipient; this rule never earns a dependency.
  const participant = currentAnchors.authored.length === 1 ? currentAnchors.authored[0] : undefined;
  if (participant?.items.length === 1 && (values.concepts['plaque.rows']?.length || values.concepts['feature.rows']?.length)) {
    currentAnchors.concepts['plaque.anchor'] = [...participant.items];
    participant.concepts = [...new Set([...participant.concepts, 'plaque.anchor'])];
    participant.conceptItemIndices = { ...participant.conceptItemIndices, 'plaque.anchor': [0] };
    if (values.concepts['feature.rows']?.length) {
      appendItems(values.concepts, 'plaque.rows', values.concepts['feature.rows']);
      values.authored.filter(entry => entry.concepts.includes('feature.rows')).forEach(entry => {
        entry.concepts = [...entry.concepts, 'plaque.rows'];
        entry.conceptItemIndices = { ...entry.conceptItemIndices, 'plaque.rows': entry.items.map((_, index) => index) };
      });
    }
  }
  const realizationHost = (currentAnchors.concepts['pf.host']?.length ?? 0) > 0;
  if (realizationHost) {
    values.authored.filter(entry => normalizeTier2Synonym(entry.key) === 'notation').forEach(entry => {
      entry.concepts = [...entry.concepts, 'pf.rows'];
      entry.conceptItemIndices = { ...entry.conceptItemIndices, 'pf.rows': entry.items.map((_, index) => index) };
      appendItems(values.concepts, 'pf.rows', entry.items);
    });
  }
  const { movement, failure: movementFailure, diagnostics: movementDiagnostics } = recoverMovementEvidence(relation, currentForest, priorForest);
  if (movement) {
    currentAnchors.concepts['movement.source'] = [movement.sourceNodeId];
    currentAnchors.concepts['movement.witness'] = [movement.witnessNodeId];
    currentAnchors.concepts['movement.landing'] = [movement.targetNodeId];
    currentAnchors.authored.forEach(entry => {
      entry.concepts = entry.concepts.filter(c => !['movement.source', 'movement.witness', 'movement.landing'].includes(c));
      entry.concepts = [...entry.concepts, ...(movement.roles[normalizeTier2Synonym(entry.key)] || [])];
    });
    // Proven source context must not re-enter the recipe as a competing endpoint.
    if ('movement.source' in priorAnchors.concepts) {
      priorAnchors.authored.forEach(entry => {
        if (entry.items.length !== 1 || entry.items[0] !== movement.priorSourceNodeId) {
          entry.concepts = entry.concepts.filter(concept => concept !== 'movement.source');
        }
      });
      priorAnchors.concepts['movement.source'] = [...new Set(priorAnchors.authored
        .filter(entry => entry.concepts.includes('movement.source')).flatMap(entry => entry.items))];
    }
  }
  return {
    ...(realizationGroupAnchorKeys ? { realizationGroupAnchorKeys } : {}),
    movementDiagnostics,
    ...(movementFailure ? { movementFailure } : {}),
    ...(movement ? { movement } : {}),
    currentAnchors: currentAnchors.concepts,
    authoredCurrentAnchors: currentAnchors.authored,
    ...(relation.priorAnchors
      ? {
          priorAnchors: priorAnchors.concepts,
          authoredPriorAnchors: priorAnchors.authored
        }
      : {}),
    values: values.concepts,
    authoredValues: values.authored,
    currentForest,
    ...(priorForest ? { priorForest } : {}),
    ...(activeLens === undefined ? {} : { activeLens })
  };
};

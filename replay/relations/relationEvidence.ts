import type { DerivationStageRelation, SurfaceRealization, SyntaxNode } from '../../types.ts';
import { recoverMovementEvidence } from './movementEvidence.ts';
import { resolveOutcomeLiteral } from './outcomeResolver.ts';
import { INDEPENDENT_TIER2_ANCHOR_ROLES, INDEPENDENT_TIER2_VALUE_ROLES, independentFeatureDimensions, independentThetaArgumentFields,
  type Tier2AuthoredEvidenceEntry, type Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { buildTier2SynonymIndex, lookupTier2SynonymCandidates, normalizeTier2Synonym, relationRoleConcepts,
  type Tier2SynonymIndex, type Tier2SynonymScope } from './tier2Synonyms.ts';
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
      : lookupTier2SynonymCandidates(synonymIndex, scope, authoredKey);
    const activeConcepts: string[] = [];
    const conceptItemIndices: Record<string, number[]> = {};
    concepts.forEach((concept) => {
      const conceptItems = scope === 'value' && concept === 'outcome'
        ? items.filter((item) => resolveOutcomeLiteral(item)?.concept)
        : scope === 'value' && concept === 'verdict'
          ? items.filter((item) => !resolveOutcomeLiteral(item)?.concept)
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
  const values = normalizeBlock(relation.values, 'value', synonymIndex);
  const contributors = currentAnchors.authored.filter(entry => entry.concepts.includes('pf.contributors'));
  const surfaces = values.authored.filter(entry => entry.concepts.includes('pf.surface'));
  // The entire authored realization group owns the plate. No member is chosen
  // as a lexical source, output head or morphological controller.
  if (contributors.length === 1 && surfaces.length === 1 && surfaces[0].items.length === 1
    && surfaces[0].items[0].trim() && !Object.hasOwn(currentAnchors.concepts, 'rewrite.output')) {
    const ids = contributors[0].items;
    const groups = currentRealizations ?? [];
    const matches = groups.filter(group => group.nodeIds.length === ids.length
      && new Set(group.nodeIds).size === ids.length && ids.every(id => group.nodeIds.includes(id)));
    const group = matches.length === 1 ? matches[0] : undefined;
    const exactGroup = ids.length > 0 && new Set(ids).size === ids.length && group
      && group.tokenIndices.length > 0 && new Set(group.tokenIndices).size === group.tokenIndices.length
      && group.tokenIndices.every(index => Number.isInteger(index) && index >= 0)
      && groups.every(other => other === group || !other.tokenIndices.some(index => group.tokenIndices.includes(index)));
    if (exactGroup) {
      currentAnchors.concepts['rewrite.output'] = [...ids];
      contributors[0].concepts = [...contributors[0].concepts, 'rewrite.output'];
      contributors[0].conceptItemIndices = { ...contributors[0].conceptItemIndices,
        'rewrite.output': ids.map((_, index) => index) };
      appendItems(values.concepts, 'pf.rows', surfaces[0].items);
      surfaces[0].concepts = [...surfaces[0].concepts, 'pf.rows'];
      surfaces[0].conceptItemIndices = { ...surfaces[0].conceptItemIndices, 'pf.rows': [0] };
    }
  }
  if (independentThetaArgumentFields({ authoredCurrentAnchors: currentAnchors.authored, authoredValues: values.authored })) {
    currentAnchors.concepts['theta.arguments'] = currentAnchors.authored
      .filter(entry => entry.concepts.includes('theta.arguments')).flatMap(entry => [...entry.items]);
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

import type { Tier2ResolvedFacet } from './relationClaims.ts';
import type { Tier2VisualPrimitiveName } from './tier2FacetTypes.ts';
import { unique } from './tier2PlanValues.ts';

export const outputKeys = (
  facet: Tier2ResolvedFacet,
  pieces: readonly Tier2VisualPrimitiveName[]
): string[] => facet.outputIdentities
  .filter(({ piece }) => pieces.includes(piece))
  .map(({ key }) => key);

export const currentWitnessNodeIdsFromFacetIdentity = (
  facetIdentity: string
): string[] => {
  const nodeIds: string[] = [];
  const visitedIdentities = new Set<string>();
  const collect = (identity: string) => {
    if (visitedIdentities.has(identity)) return;
    visitedIdentities.add(identity);
    const record = JSON.parse(identity) as Record<string, unknown>;
    const currentAnchors = record.currentAnchors;
    if (currentAnchors && typeof currentAnchors === 'object' && !Array.isArray(currentAnchors)) {
      Object.values(currentAnchors as Record<string, unknown>).forEach((witnesses) => {
        if (!Array.isArray(witnesses)) return;
        witnesses.forEach((witness) => {
          if (!witness || typeof witness !== 'object') return;
          const nodeId = String((witness as { id?: unknown }).id ?? '');
          if (nodeId) nodeIds.push(nodeId);
        });
      });
    }
    if (Array.isArray(record.parents)) {
      record.parents.forEach((parentIdentity) => {
        if (typeof parentIdentity === 'string') collect(parentIdentity);
      });
    }
  };
  collect(facetIdentity);
  return unique(nodeIds);
};

const canonicalReplacementAnchors = (
  anchors: Readonly<Record<string, readonly string[]>>
): Record<string, string[]> => Object.fromEntries(
  Object.entries(anchors)
    .sort(([leftRole], [rightRole]) => leftRole.localeCompare(rightRole))
    .map(([role, ids]) => [role, [...ids]])
);

export const identityAnchorBlock = (
  facetIdentity: string,
  field: 'currentAnchors' | 'priorAnchors'
): Record<string, string[]> => {
  const record = JSON.parse(facetIdentity) as Record<string, unknown>;
  const block = record[field];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return {};
  return Object.fromEntries(
    Object.entries(block as Record<string, unknown>).map(([role, witnesses]) => [
      role,
      Array.isArray(witnesses)
        ? witnesses.flatMap((witness) => {
          if (!witness || typeof witness !== 'object') return [];
          const nodeId = String((witness as { id?: unknown }).id ?? '');
          return nodeId ? [nodeId] : [];
        })
        : []
    ])
  );
};

export const ownReplacementGroup = (
  facet: Tier2ResolvedFacet,
  stageIndex: number
): string => JSON.stringify({
  facet: facet.recipe.id,
  stageIndex,
  anchors: canonicalReplacementAnchors(identityAnchorBlock(facet.facetIdentity, 'currentAnchors'))
});

export const predecessorReplacementGroup = (
  facet: Tier2ResolvedFacet,
  stageIndex: number,
  priorAnchorBlockComplete: boolean
): string | undefined => {
  if (stageIndex <= 0 || !priorAnchorBlockComplete) return undefined;
  const anchors = identityAnchorBlock(facet.facetIdentity, 'priorAnchors');
  if (Object.keys(anchors).length === 0) return undefined;
  return JSON.stringify({
    facet: facet.recipe.id,
    stageIndex: stageIndex - 1,
    anchors: canonicalReplacementAnchors(anchors)
  });
};

const tier2Group = (group: string): { facet: string; stageIndex: number; anchors: string } | undefined => {
  if (!group.startsWith('{')) return undefined;
  try {
    const { facet, stageIndex, anchors } = JSON.parse(group) as Record<string, unknown>;
    return typeof facet === 'string' && Number.isInteger(stageIndex) && anchors && typeof anchors === 'object'
      ? { facet, stageIndex: stageIndex as number, anchors: JSON.stringify(anchors) } : undefined;
  } catch {
    return undefined;
  }
};

/** Whether a later claim's predecessor group names this earlier state. A Tier-2
 * predecessor names its facet over the exact prior anchors in the preceding
 * stage, so it continues every such state still live there, including one
 * first authored several stages earlier and its unchanged restatements. */
export const continuesReplacementGroup = (
  predecessorGroup: string | undefined,
  group: string | undefined
): boolean => {
  if (!predecessorGroup || !group) return false;
  if (predecessorGroup === group) return true;
  const predecessor = tier2Group(predecessorGroup), earlier = tier2Group(group);
  return Boolean(predecessor && earlier && predecessor.facet === earlier.facet
    && predecessor.anchors === earlier.anchors && earlier.stageIndex <= predecessor.stageIndex);
};

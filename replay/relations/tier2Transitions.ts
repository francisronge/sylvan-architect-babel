import type { SyntaxNode } from '../../types.ts';
import { prepareLocalDislocationContent } from './localDislocationContent.ts';
import type { TreeIndex } from './tier2EvidenceQueries.ts';
import { anchorIds, findNodes, sharedRootLineage, subtreeNodes } from './tier2EvidenceQueries.ts';
import type { Tier2FacetEvidence, Tier2FacetRecipe, Tier2TransitionRule } from './tier2FacetTypes.ts';

const terminalSurfaces = (node: SyntaxNode): string[] => subtreeNodes(node)
  .filter((member) => !Array.isArray(member.children) || member.children.length === 0)
  .map((member) => String(member.word || '').trim());

const nodeShape = (node: SyntaxNode): string => {
  const children = Array.isArray(node.children) ? node.children : [];
  return `${node.label}[${children.map(nodeShape).join(',')}]`;
};

const previousMatch = (node: SyntaxNode, priorIndex: TreeIndex): SyntaxNode | null => {
  const id = String(node.id || '');
  const idMatches = id ? priorIndex.nodes.get(id) ?? [] : [];
  if (idMatches.length === 1) return idMatches[0];
  if (idMatches.length > 1) return null;
  const lineage = String(node.lineageId || '');
  if (!lineage) return null;
  const lineageMatches = [...priorIndex.nodes.values()].flat().filter((candidate) => (
    String(candidate.lineageId || '') === lineage
  ));
  return lineageMatches.length === 1 ? lineageMatches[0] : null;
};

const lineageOccurrenceCount = (index: TreeIndex, lineage: string): number =>
  [...index.nodes.values()].flat().filter((node) => String(node.lineageId || '') === lineage).length;

const landingAlreadyOccupiedSamePosition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex,
  landingRole: string
): boolean => anchorIds(evidence, landingRole).some((id) => (
  priorIndex.nodes.has(id)
  && parentSignature(priorIndex, [id]) === parentSignature(currentIndex, [id])
  && [...(priorIndex.workspaceIds.get(id) ?? [])].sort().join('\u0000')
  === [...(currentIndex.workspaceIds.get(id) ?? [])].sort().join('\u0000')
));

/** Covert drawing endpoints may replace an existing LF occurrence while an
 * independent PF occurrence shares its lineage. Retain the exact movement
 * proof instead of resolving that lineage across every workspace again. */
export const recoveredCovertMovement = (evidence: Tier2FacetEvidence): Tier2FacetEvidence['movement'] => {
  const movement = evidence.movement;
  const sources = anchorIds(evidence, 'scope.source'), landings = anchorIds(evidence, 'scope.landing');
  return movement?.trajectoryKind === 'phrasal' && sources.length === 1 && landings.length === 1
    && sources[0] === movement.witnessNodeId && landings[0] === movement.targetNodeId ? movement : undefined;
};

const covertMovementTransition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  const recovered = recoveredCovertMovement(evidence);
  if (recovered) return recovered.transition;
  if (evidence.movementFailure && evidence.movementFailure !== 'MOVEMENT_PRIOR_SOURCE_UNPROVEN') return false;
  const sourceIds = anchorIds(evidence, 'scope.source');
  const lineage = sharedRootLineage(currentIndex, [...sourceIds, ...anchorIds(evidence, 'scope.landing')]);
  return Boolean(evidence.priorForest && lineage
    && lineageOccurrenceCount(currentIndex, lineage) > lineageOccurrenceCount(priorIndex, lineage)
    && !landingAlreadyOccupiedSamePosition(evidence, currentIndex, priorIndex, 'scope.landing')
    && findNodes(currentIndex, sourceIds).some(node => previousMatch(node, priorIndex)?.lineageId === lineage));
};

const pronunciationTransition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  if (!evidence.priorForest) return false;
  const candidates = [
    ...findNodes(currentIndex, anchorIds(evidence, 'plaque.anchor')),
    ...findNodes(currentIndex, anchorIds(evidence, 'rewrite.output'))
  ];
  return candidates.some((node) => {
    const before = previousMatch(node, priorIndex);
    return Boolean(
      before
      && nodeShape(before as SyntaxNode) === nodeShape(node)
      && terminalSurfaces(before as SyntaxNode).join('\u0000') !== terminalSurfaces(node).join('\u0000')
    );
  });
};

const deletionTransition = (
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  if (!evidence.priorForest) return false;
  const role = recipeEntry.id === 'ellipsis.site' ? 'ellipsis.site' : 'deleted.material';
  return findNodes(currentIndex, anchorIds(evidence, role)).some((node) => (
    subtreeNodes(node).some((member) => {
      const children = Array.isArray(member.children) ? member.children : [];
      if (children.length > 0 || member.silent !== true) return false;
      const before = previousMatch(member, priorIndex);
      if (!before) return false;
      const beforeChildren = Array.isArray(before.children) ? before.children : [];
      return beforeChildren.length === 0
        && before.silent !== true
        && Boolean(String(before.word || '').trim());
    })
  ));
};

const rewriteTransition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  if (!evidence.priorForest) return false;
  const currentNodes = [
    ...findNodes(currentIndex, anchorIds(evidence, 'rewrite.output')),
    ...findNodes(currentIndex, anchorIds(evidence, 'terminal'))
  ];
  if (currentNodes.some((node) => {
    const before = previousMatch(node, priorIndex);
    return Boolean(before && terminalSurfaces(before as SyntaxNode).join('\u0000') !== terminalSurfaces(node).join('\u0000'));
  })) return true;
  const priorInputIds = anchorIds(evidence, 'rewrite.input', 'prior');
  const currentOutputIds = anchorIds(evidence, 'rewrite.output');
  return priorInputIds.length > 0
    && priorInputIds.every((id) => priorIndex.nodes.has(id))
    && priorInputIds.every((id) => !currentIndex.nodes.has(id))
    && currentOutputIds.length > 0
    && currentOutputIds.every((id) => currentIndex.nodes.has(id))
    && currentOutputIds.every((id) => !priorIndex.nodes.has(id));
};

const fissionTransition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  const inputs = anchorIds(evidence, 'rewrite.input', 'prior');
  const outputs = anchorIds(evidence, 'rewrite.outputs');
  return Boolean(
    evidence.priorForest
    && inputs.length === 1
    && outputs.length >= 2
    && priorIndex.nodes.has(inputs[0])
    && outputs.every((id) => currentIndex.nodes.has(id))
    && !currentIndex.nodes.has(inputs[0])
  );
};

const terminalOrder = (forest: readonly SyntaxNode[] | undefined, sequence: ReadonlySet<string>): string[] => {
  const order: string[] = [];
  const visit = (node: SyntaxNode, withinSequence = false) => {
    const included = withinSequence || sequence.has(node.id);
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const word = String(node.word || '').trim();
      if (included && word) order.push(JSON.stringify([node.id, word]));
      return;
    }
    children.forEach(child => visit(child, included));
  };
  (Array.isArray(forest) ? forest : []).forEach(node => visit(node));
  return order;
};

const parentSignature = (index: TreeIndex, ids: readonly string[]): string => ids
  .map((id) => `${id}:${[...(index.parentIds.get(id) ?? [])].sort().join(',')}`)
  .join('|');

const rebracketingTransition = (
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  if (!evidence.priorForest) return false;
  const ids = anchorIds(evidence, 'sequence');
  const sequence = new Set(ids);
  return ids.length >= 2
    && ids.every(id => priorIndex.nodes.get(id)?.length === 1 && currentIndex.nodes.get(id)?.length === 1)
    && terminalOrder(evidence.priorForest, sequence).join('\u0000') === terminalOrder(evidence.currentForest, sequence).join('\u0000')
    && Boolean(prepareLocalDislocationContent({
      sequenceNodeIds: ids,
      currentForest: evidence.currentForest, priorForest: evidence.priorForest,
      values: Object.fromEntries((evidence.authoredValues ?? []).map(entry => [entry.key, entry.items]))
    }));
};

export const transitionEarned = (
  rule: Tier2TransitionRule,
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  priorIndex: TreeIndex
): boolean => {
  switch (rule.evidence) {
    case 'overt-movement-stage-difference':
      return evidence.movement?.transition === true;
    case 'covert-movement-stage-difference':
      return covertMovementTransition(evidence, currentIndex, priorIndex);
    case 'pronunciation-stage-difference':
      return pronunciationTransition(evidence, currentIndex, priorIndex);
    case 'deletion-stage-difference':
      return deletionTransition(recipeEntry, evidence, currentIndex, priorIndex);
    case 'rewrite-stage-difference':
      return rewriteTransition(evidence, currentIndex, priorIndex);
    case 'fission-stage-difference':
      return fissionTransition(evidence, currentIndex, priorIndex);
    case 'rebracketing-stage-difference':
      return rebracketingTransition(evidence, currentIndex, priorIndex);
  }
};

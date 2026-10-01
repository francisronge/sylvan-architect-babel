import type { DerivationStage, DerivationStageRelation, SyntaxNode } from '../types.ts';

interface InspectedStage {
  authoredStage: unknown;
  workspaceForest: SyntaxNode[] | null;
}

/** Display positions disambiguate drawing keys only. They never choose a target
 * for an authored relation or change the saved reference expansion. */
export const inspectionStageDisplay = (forest: SyntaxNode[] | null | undefined) => {
  const duplicateIds = duplicateStageNodeIds(forest);
  const identities: Array<{ displayId: string; authoredId: string | null; position: string }> = [];
  const visit = (node: SyntaxNode, position: string): SyntaxNode => {
    const displayId = `inspection:${position}`;
    identities.push({ displayId, authoredId: node.id ?? null, position });
    const { aliasIds: _aliases, replayOrigin: _origin, ...authored } = node;
    return { ...authored, id: displayId,
      ...(node.children ? { children: node.children.map((child, index) => visit(child, `${position}.${index + 1}`)) } : {}) };
  };
  return {
    forest: duplicateIds.length ? (forest ?? []).map((node, index) => visit(node, String(index + 1))) : structuredClone(forest ?? []),
    duplicateIds,
    identities
  };
};

export const duplicateStageNodeIds = (forest: SyntaxNode[] | null | undefined): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const visit = (node: SyntaxNode) => {
    if (node.id) {
      if (seen.has(node.id)) duplicates.add(node.id);
      seen.add(node.id);
    }
    node.children?.forEach(visit);
  };
  forest?.forEach(visit);
  return [...duplicates];
};

/** A readable final state does not imply that the preceding timeline is unambiguous. */
export const diagnosticFinalStage = <T extends InspectedStage>(stages: T[]): T | null => {
  const final = stages.at(-1);
  return final?.workspaceForest?.length && duplicateStageNodeIds(final.workspaceForest).length === 0 ? final : null;
};

const isReplayStage = (value: unknown): value is DerivationStage => {
  if (!value || typeof value !== 'object') return false;
  const stage = value as Record<string, unknown>;
  return typeof stage.statement === 'string'
    && typeof stage.stageRecord === 'string'
    && Array.isArray(stage.relations)
    && Array.isArray(stage.workspaceForest);
};

export interface DiagnosticReplayIdentity {
  stageIndex: number;
  displayId: string;
  authoredId: string;
  position: string;
}

interface DisplayOccurrence {
  node: SyntaxNode;
  position: string;
  ancestors: string[];
  displayId?: string;
}

const stageOccurrences = (forest: SyntaxNode[]): Map<string, DisplayOccurrence[]> => {
  const groups = new Map<string, DisplayOccurrence[]>();
  const visit = (node: SyntaxNode, position: string, ancestors: string[]) => {
    if (node.id) groups.set(node.id, [...(groups.get(node.id) ?? []), { node, position, ancestors }]);
    node.children?.forEach((child, index) => visit(child, `${position}.${index + 1}`, [`${node.id ?? position}:${index}`, ...ancestors]));
  };
  forest.forEach((node, index) => visit(node, String(index + 1), []));
  return groups;
};

const commonAncestors = (left: DisplayOccurrence, right: DisplayOccurrence) => {
  let count = 0;
  while (count < left.ancestors.length && count < right.ancestors.length
    && left.ancestors[count] === right.ancestors[count]) count += 1;
  return count;
};

/** Repeated authored IDs need separate drawing identities, not repaired syntax.
 * Ancestor continuity keeps an existing display occurrence stable; equal matches
 * use document order only as a drawing convention. Relation targets are resolved
 * independently and never use that tie-break to choose an ambiguous occurrence. */
export const diagnosticReplayProjection = (inspectedStages: InspectedStage[]) => {
  if (!inspectedStages.length || inspectedStages.some(stage => !stage.workspaceForest || !isReplayStage(stage.authoredStage))) return null;
  const repeated = new Set(inspectedStages.flatMap(stage => duplicateStageNodeIds(stage.workspaceForest)));
  const identities: DiagnosticReplayIdentity[] = [];
  const ambiguousRelations: Array<{ stageIndex: number; relationIndex: number; issues: Array<{ fieldPath: string; message: string }> }> = [];
  const originalGroups = inspectedStages.map(stage => stageOccurrences(stage.workspaceForest!));
  const reserved = new Set(originalGroups.flatMap(groups => [...groups.keys()]));
  const sequence = new Map<string, number>();
  const allocate = (authoredId: string) => {
    let ordinal = sequence.get(authoredId) ?? 0;
    let id: string;
    do { id = `inspection-replay:${encodeURIComponent(authoredId)}:${++ordinal}`; } while (reserved.has(id));
    sequence.set(authoredId, ordinal);
    reserved.add(id);
    return id;
  };
  const mappings: Array<Map<string, DisplayOccurrence[]>> = [];
  const forests = inspectedStages.map((stage, stageIndex) => {
    if (!repeated.size) { mappings.push(originalGroups[stageIndex]); return stage.workspaceForest!; }
    const forest = structuredClone(stage.workspaceForest!);
    const groups = stageOccurrences(forest);
    for (const [authoredId, occurrences] of groups) {
      if (!repeated.has(authoredId)) continue;
      const previous = mappings[stageIndex - 1]?.get(authoredId) ?? [];
      const pairs = occurrences.flatMap((current, currentIndex) => previous.map((prior, priorIndex) => ({
        current, prior, currentIndex, priorIndex, ancestors: commonAncestors(current, prior)
      }))).sort((left, right) => right.ancestors - left.ancestors || left.currentIndex - right.currentIndex || left.priorIndex - right.priorIndex);
      const used = new Set<DisplayOccurrence>();
      for (const pair of pairs) {
        if (pair.current.displayId || used.has(pair.prior)) continue;
        pair.current.displayId = pair.prior.displayId;
        used.add(pair.prior);
      }
      for (const occurrence of occurrences) {
        occurrence.displayId ??= allocate(authoredId);
        occurrence.node.id = occurrence.displayId;
        // An alias must not restore the same ambiguous authored lookup.
        delete occurrence.node.aliasIds;
        identities.push({ stageIndex, displayId: occurrence.displayId, authoredId, position: occurrence.position });
      }
    }
    mappings.push(groups);
    return forest;
  });
  const stages = inspectedStages.map((entry, stageIndex): DerivationStage => {
    const authored = entry.authoredStage as DerivationStage;
    const relations = authored.relations.map((relation, relationIndex): DerivationStageRelation => {
      const issues: Array<{ fieldPath: string; message: string }> = [];
      const anchors = (block: Record<string, string | string[]>, targetStage: number, field: string) =>
        Object.fromEntries(Object.entries(block).map(([role, value]) => {
          const resolve = (id: string) => {
            const occurrences = mappings[targetStage]?.get(id);
            if (occurrences && occurrences.length > 1) issues.push({
              fieldPath: `derivationStages[${stageIndex}].relations[${relationIndex}].${field}.${role}`,
              message: `${id} names ${occurrences.length} authored positions in stage ${targetStage + 1}; no single target was selected.`
            });
            return occurrences?.length === 1 ? occurrences[0].displayId ?? id : id;
          };
          return [role, Array.isArray(value) ? value.map(resolve) : resolve(value)];
        }));
      const projected = { ...structuredClone(relation), anchors: anchors(relation.anchors, stageIndex, 'anchors'),
        ...(relation.priorAnchors ? { priorAnchors: anchors(relation.priorAnchors, stageIndex - 1, 'priorAnchors') } : {}) };
      if (issues.length) {
        ambiguousRelations.push({ stageIndex, relationIndex, issues });
        projected.relationContractFailure = {
          raw: relation.relationContractFailure?.raw ?? structuredClone(relation),
          issues: [...(relation.relationContractFailure?.issues ?? []), ...issues]
        };
      }
      return projected;
    });
    const realizations = authored.realizations?.map(group => ({ ...group, nodeIds: group.nodeIds.map(id => {
      const occurrences = mappings[stageIndex].get(id);
      return occurrences?.length === 1 ? occurrences[0].displayId ?? id : id;
    }) }));
    return { ...authored, workspaceForest: forests[stageIndex], relations, ...(realizations ? { realizations } : {}) };
  });
  return { stages, identities, ambiguousRelations };
};

export const diagnosticReplayStages = (inspectedStages: InspectedStage[]): DerivationStage[] | null =>
  diagnosticReplayProjection(inspectedStages)?.stages ?? null;

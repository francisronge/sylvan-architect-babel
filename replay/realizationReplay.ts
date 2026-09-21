import type { DerivationStageRelation, SurfaceRealization, SyntaxNode } from '../types.ts';
import type { PlaybackStep, ReplayDerivationFrame } from './replayCompiler.ts';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from './displayIdentity.ts';

export const cloneRealizations = (groups: readonly SurfaceRealization[]): SurfaceRealization[] =>
  groups.map(group => ({ nodeIds: [...group.nodeIds], tokenIndices: [...group.tokenIndices] }));

const groupKey = (group: SurfaceRealization): string => JSON.stringify([
  [...group.nodeIds].sort(), [...group.tokenIndices].sort((a, b) => a - b)
]);

const anchorIds = (anchors?: DerivationStageRelation['anchors']): Set<string> =>
  new Set(Object.values(anchors || {}).flat());

const syntaxIds = (forest: readonly SyntaxNode[]): Set<string> => {
  const ids = new Set<string>();
  const visit = (node: SyntaxNode) => {
    if (node.id) ids.add(node.id);
    node.children?.forEach(visit);
  };
  forest.forEach(visit);
  return ids;
};

interface RealizationChange {
  before: SurfaceRealization[];
  after: SurfaceRealization[];
  relationIndex: number | null;
  candidateRelationIndices?: number[];
  diagnostic?: string;
}

/** A shared output is replaced atomically; shared source features may serve separate outputs. */
const changedGroups = (
  before: readonly SurfaceRealization[],
  after: readonly SurfaceRealization[]
): Array<Pick<RealizationChange, 'before' | 'after'>> => {
  const beforeKeys = new Set(before.map(groupKey));
  const afterKeys = new Set(after.map(groupKey));
  const entries = [
    ...before.filter(group => !afterKeys.has(groupKey(group))).map(group => ({ side: 'before' as const, group })),
    ...after.filter(group => !beforeKeys.has(groupKey(group))).map(group => ({ side: 'after' as const, group }))
  ];
  const parents = entries.map((_, index) => index);
  const find = (index: number): number => {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  };
  const tokenOwners = new Map<number, number>();
  entries.forEach(({ group }, index) => group.tokenIndices.forEach(token => {
    const previous = tokenOwners.get(token);
    if (previous !== undefined) parents[find(index)] = find(previous);
    tokenOwners.set(token, index);
  }));
  const components = new Map<number, Pick<RealizationChange, 'before' | 'after'>>();
  entries.forEach(({ side, group }, index) => {
    const key = find(index);
    if (!components.has(key)) components.set(key, { before: [], after: [] });
    components.get(key)![side].push(group);
  });
  return [...components.values()];
};

export const resolveRealizationChanges = (
  previous: ReplayDerivationFrame | undefined,
  current: ReplayDerivationFrame,
  stageIndex: number
): RealizationChange[] => {
  const changes = changedGroups(previous?.after?.realizations || [], current.after?.realizations || []);
  if (!changes.length) return [];
  const previousIds = syntaxIds(previous?.workspaceForest || []);
  const currentIds = syntaxIds(current.workspaceForest);
  const relations = (current.relations || []).map(relation => ({
    current: anchorIds(relation.anchors), prior: anchorIds(relation.priorAnchors)
  }));
  return changes.map(change => {
    const candidates = relations.flatMap((relation, index) => {
      const currentCovered = change.after.every(group => group.nodeIds.every(id =>
        currentIds.has(id) && relation.current.has(id)));
      const previousCovered = change.before.every(group => group.nodeIds.every(id =>
        previousIds.has(id) && (relation.prior.has(id) || (currentIds.has(id) && relation.current.has(id)))));
      return currentCovered && previousCovered ? [index] : [];
    });
    if (candidates.length === 1) return { ...change, relationIndex: candidates[0] };
    const reason = candidates.length === 0 ? 'MISSING_OWNER' : 'AMBIGUOUS_OWNER';
    return { ...change, relationIndex: null, candidateRelationIndices: candidates,
      diagnostic: `REALIZATION_${reason}: Stage ${stageIndex + 1}, input positions ${[...new Set([...change.before, ...change.after].flatMap(group => group.tokenIndices))].sort((a, b) => a - b).join(', ')}. ${candidates.length
        ? `Relations ${candidates.map(index => index + 1).join(', ')} cover the same change.`
        : 'No relation covers the complete change.'} The association becomes visible at the Stage Record.` };
  });
};

const authoredIds = (node: SyntaxNode): string[] => node.replayOrigin?.kind === 'lexical' && node.replayOrigin.authoredId
  ? [node.replayOrigin.authoredId]
  : [...(node.id ? [node.id] : []), ...(node.aliasIds || [])];

const missingSourceDomainIds = (
  groups: SurfaceRealization[],
  forest: SyntaxNode[],
  step: PlaybackStep
): string[] => {
  const expected = new Map<string, SyntaxNode>();
  const indexExpected = (node: SyntaxNode) => {
    if (node.id) expected.set(node.id, node);
    node.children?.forEach(indexExpected);
  };
  forest.forEach(indexExpected);
  const visible = new Set(step.replayVisibleNodeIds || []);
  const actual = new Map<string, d3.HierarchyNode<SyntaxNode> | null>();
  if (step.replayCanvasData) {
    const root = d3.hierarchy(step.replayCanvasData);
    applyVizIds(root);
    root.eachBefore(node => {
      if (!visible.has(getNodeId(node))) return;
      authoredIds(node.data).forEach(id => {
        if (!actual.has(id)) actual.set(id, node);
        else if (actual.get(id) !== node) actual.set(id, null);
      });
    });
  }
  const missing = new Set<string>();
  groups.forEach(group => group.nodeIds.forEach(id => {
    const source = expected.get(id);
    const renderedSource = actual.get(id);
    if (!source || !renderedSource) {
      missing.add(id);
      return;
    }
    // A visible parent cannot stand in for its unfinished current domain, nor
    // can a descendant that remains visible elsewhere satisfy that domain.
    const present = new Set(renderedSource.descendants()
      .filter(node => visible.has(getNodeId(node))).flatMap(node => authoredIds(node.data)));
    syntaxIds([source]).forEach(sourceId => {
      if (!present.has(sourceId)) missing.add(sourceId);
    });
  }));
  return [...missing];
};

/** Attach authored association state after scheduling; it cannot alter tree geometry or add moments. */
export const attachReplayRealizations = (
  steps: PlaybackStep[],
  frames: ReplayDerivationFrame[]
): PlaybackStep[] => {
  if (!frames.some(frame => frame.after?.realizations !== undefined)) return steps;
  const moments = new Set(steps.filter(step => step.replayKind === 'relation' && step.replayRelationIdentity)
    .map(step => `${step.replayRelationIdentity!.stageIndex}:${step.replayRelationIdentity!.relationIndex}`));
  const changesByStage = new Map<number, RealizationChange[]>();
  const states = new Map<number, SurfaceRealization[]>();
  const diagnostics = new Map<number, string[]>();
  return steps.map(step => {
    const stageIndex = step.replayFrameIndex ?? step.sourceFrameIndex;
    if (stageIndex === undefined || !frames[stageIndex]) return step;
    const frame = frames[stageIndex];
    if (!changesByStage.has(stageIndex)) {
      const changes = resolveRealizationChanges(frames[stageIndex - 1], frame, stageIndex);
      changesByStage.set(stageIndex, changes);
      states.set(stageIndex, cloneRealizations(frames[stageIndex - 1]?.after?.realizations || []));
      diagnostics.set(stageIndex, changes.flatMap(change => {
        if (change.diagnostic) return [change.diagnostic];
        return !moments.has(`${stageIndex}:${change.relationIndex}`)
          ? [`REALIZATION_OWNER_MOMENT_UNAVAILABLE: Stage ${stageIndex + 1}, relation ${change.relationIndex! + 1} has no available Replay moment. No realization moment was invented.`]
          : [];
      }));
    }
    let active = states.get(stageIndex)!;
    const stageDiagnostics = diagnostics.get(stageIndex)!;
    if (step.replayKind === 'macro') {
      active = cloneRealizations(frame.after?.realizations || []);
    } else if (step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === stageIndex) {
      changesByStage.get(stageIndex)!.filter(change => change.relationIndex === step.replayRelationIdentity!.relationIndex)
        .forEach(change => {
          const missing = missingSourceDomainIds(change.after, frame.workspaceForest, step);
          if (missing.length) {
            stageDiagnostics.push(`REALIZATION_PARTICIPANT_UNAVAILABLE: Stage ${stageIndex + 1}, relation ${change.relationIndex! + 1} requires unavailable syntax ${missing.join(', ')}. No realization moment was invented.`);
            return;
          }
          const removed = new Set(change.before.map(groupKey));
          active = [...active.filter(group => !removed.has(groupKey(group))), ...cloneRealizations(change.after)];
        });
    }
    states.set(stageIndex, active);
    return { ...step,
      replayRealizations: cloneRealizations(active),
      ...(stageDiagnostics.length ? { replayRealizationDiagnostics: [...stageDiagnostics] } : {})
    };
  });
};

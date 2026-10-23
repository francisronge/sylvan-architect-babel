import { getFrameStageRecordText } from './authoredFrames.ts';
/** Build user-facing Replay content from authored stages and compiled moments. */
import { type ResolvedRelationAnchor, type ResolvedRelationLink } from '../relationLinks.ts';
import {
  type DerivationStage,
  type DerivationStageRelation,
  type ReplayDetailBlock,
  type SyntaxNode
} from '../types.ts';
import { spaceAuthoredName } from './displayText.ts';
import { getFrameRelations, isRenderableReplayRelation } from './frameRelations.ts';
import {
  getActiveReplayRelationLinks,
  isHeadLikePlaybackStep,
  isResolvedMovementLink,
  relationMomentUsesMovementSupport,
  stepRepresentsMovement
} from './movementLinks.ts';
import { productionRelationRegistry } from './relationDispatch/productionRegistry.js';
import { findRelationRegistryEntry } from './relationDispatch/relationRegistry.js';
import { authoredRoleMatcher } from './relationAnchors.ts';
import { TRAJECTORY_SOURCE_ROLES, TRAJECTORY_TARGET_ROLES } from './relations/renderFamilies.ts';
import {
  describeReplayNodePosition,
  findReplayNodePathById,
  getReplayNodeAuthoredYieldFromCanvas,
  getReplayNodeCategoryFromCanvas,
  getReplayNodeDisplayFromCanvas,
  getReplayNodeOvertYieldFromCanvas
} from './replayNodeDescription.ts';
import {
  buildLiteralRelationValueLines,
  formatPlaybackOperationTitle,
  formatRelationAnchorRole,
  formatReplayInputsValue,
  formatReplaySupportValue,
  isGenericReplayStructuralLabel,
  mergeReplayDetailBlocks,
  normalizeReplayTargetLabel
} from './replayPanelFormatting.ts';
import { formatAuthoredWitnessSurface } from './replaySurfaceNotation.ts';
import { collectReplayCanvasNodes, findNodeByIdInForest } from './syntaxForest.ts';
import {
  type DerivationReplayPlanStage,
  type DerivationReplayPlanStep,
  type PlaybackStep,
  type ReplayAuthoredRelationLink,
  type ReplayDerivationFrame,
  type ReplayPanelContent,
  type ReplaySupportLine
} from './types.ts';

const formatRelationAnchorValue = (value: unknown, replayCanvasData?: SyntaxNode | null, role = ''): string => {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => {
      const nodeId = String(item || '');
      if (!nodeId)
        return '';
      return formatRelationParticipantValue({ role, nodeId, value: nodeId } as ResolvedRelationAnchor, replayCanvasData) || nodeId;
    })
    .filter(Boolean)
    .join(', ');
};

const getRegisteredRelationAnchorRoleOrder = (relationName: string): string[] => {
  const entry = findRelationRegistryEntry(productionRelationRegistry, relationName);
  if (!entry)
    return [];
  return [
    ...Object.keys(entry.signature.anchors.required),
    ...Object.keys(entry.signature.anchors.optional)
  ];
};

const STRUCTURAL_RELATION_ANCHOR_ROLES = new Set([
  'adjunctDomain',
  'boundary',
  'complement',
  'domain',
  'forbiddenRegion',
  'interpretationDomain',
  'licensedLandingHosts',
  'phase',
  'rejectedLandingHosts',
  'roof',
  'scopeDomain',
  'searchDomain',
  'spellOutDomain'
]);

const AUTHORED_WITNESS_RELATION_ANCHOR_ROLES = new Set([
  'traceWitness',
  'traceWitnesses',
  'variable'
]);

const getReplayNodeAuthoredWitnessYieldFromCanvas = (root: SyntaxNode | null | undefined, nodeId?: string): string => {
  const node = findNodeByIdInForest([root].filter(Boolean) as SyntaxNode[], String(nodeId || ''));
  if (!node)
    return '';
  const surfaces: string[] = [];
  const collect = (candidate: SyntaxNode) => {
    const children = Array.isArray(candidate.children) ? candidate.children : [];
    if (children.length > 0) {
      children.forEach(collect);
      return;
    }
    const surface = String(candidate.word || candidate.label || '').trim();
    if (surface)
      surfaces.push(formatAuthoredWitnessSurface(surface));
  };
  collect(node);
  return surfaces.join(' ').trim();
};

const formatRelationParticipantValue = (anchor: ResolvedRelationAnchor, replayCanvasData?: SyntaxNode | null): string => {
  const nodeId = String(anchor?.nodeId || '');
  if (nodeId) {
    const role = String(anchor?.role || '').trim();
    if (STRUCTURAL_RELATION_ANCHOR_ROLES.has(role)) {
      return getReplayNodeCategoryFromCanvas(replayCanvasData, nodeId) || '';
    }
    if (AUTHORED_WITNESS_RELATION_ANCHOR_ROLES.has(role)) {
      return getReplayNodeAuthoredWitnessYieldFromCanvas(replayCanvasData, nodeId)
        || getReplayNodeCategoryFromCanvas(replayCanvasData, nodeId)
        || '';
    }
    return (getReplayNodeOvertYieldFromCanvas(replayCanvasData, nodeId)
      || getReplayNodeAuthoredYieldFromCanvas(replayCanvasData, nodeId)
      || getReplayNodeDisplayFromCanvas(replayCanvasData, nodeId)
      || getReplayNodeCategoryFromCanvas(replayCanvasData, nodeId)
      || '');
  }
  return formatReplaySupportValue(String(anchor?.value || '').trim());
};

const getReplayContentRelationLinks = (step: PlaybackStep): ResolvedRelationLink[] => {
  const identity = step.replayRelationIdentity;
  if (!identity)
    return getActiveReplayRelationLinks(step);
  const key = `${identity.stageIndex}:${identity.relationIndex}`;
  return (step.replayRelationLinks ?? []).filter(link => (link as ReplayAuthoredRelationLink).authoredRelationKey === key);
};

const buildRelationParticipantSupportLines = (step: PlaybackStep): ReplaySupportLine[] => {
  if (step.replayKind !== 'relation')
    return [];
  const activeLinks = getReplayContentRelationLinks(step);
  if (activeLinks.length === 0)
    return [];
  const relationName = String(activeLinks[0]?.relation || step.operation || '').trim();
  const roleValues = new Map<string, string[]>();
  activeLinks.forEach((link) => {
    (Array.isArray(link?.anchors) ? link.anchors : []).forEach((anchor) => {
      const role = String(anchor?.authoredRole || anchor?.role || '').trim();
      const display = formatRelationParticipantValue(anchor, step.replayCanvasData);
      if (!role || !display)
        return;
      const values = roleValues.get(role) || [];
      if (!values.includes(display))
        values.push(display);
      roleValues.set(role, values);
    });
  });
  const registeredOrder = getRegisteredRelationAnchorRoleOrder(relationName);
  const roleOrder = [
    ...registeredOrder.filter((role) => roleValues.has(role)),
    ...Array.from(roleValues.keys()).filter((role) => !registeredOrder.includes(role))
  ];
  const lines = roleOrder.map((role) => ({
    label: formatRelationAnchorRole(role),
    value: (roleValues.get(role) || []).join(', ')
  })).filter((line) => line.label && line.value);
  return lines;
};

const buildAuthoredRelationAnchorLines = (
  step: PlaybackStep,
  relation: DerivationStageRelation,
  movementLines: ReplaySupportLine[] = [],
  priorForest: readonly SyntaxNode[] = []
): ReplaySupportLine[] => {
  const links = getReplayContentRelationLinks(step);
  const endpointIsCovered = (role: string, value: string | string[]) => {
    if (Array.isArray(value))
      return false;
    return links.some(link => {
      if (!isResolvedMovementLink(link))
        return false;
      const anchor = link.anchors?.find(item => (item.authoredRole || item.role) === role && item.nodeId === value);
      if (!anchor)
        return false;
      return (movementLines.some(line => line.label === 'Source') && link.sourceNodeId === value
        && authoredRoleMatcher(TRAJECTORY_SOURCE_ROLES)(anchor.role))
        || (movementLines.some(line => line.label === 'Landing') && link.targetNodeId === value
          && authoredRoleMatcher(TRAJECTORY_TARGET_ROLES)(anchor.role));
    });
  };
  const current = Object.entries(relation.anchors ?? {}).flatMap(([role, value]) => {
    const ids = Array.isArray(value) ? value : [value];
    const authoredValue = relation.values?.[role];
    const literals = typeof authoredValue === 'string' ? [authoredValue] : authoredValue;
    // Pair only exact authored names and equal lengths. Prior entries remain separate.
    const paired = ids.length > 0 && literals?.length === ids.length;
    if (!paired && endpointIsCovered(role, value))
      return [];
    if (!ids.length)
      return [{ label: role, value: '[]', emptyList: true as const }];
    return ids.map((nodeId, index) => {
      const anchor = links.flatMap(link => link.anchors ?? []).find(item => (item.authoredRole || item.role) === role && item.nodeId === nodeId);
      const display = formatRelationParticipantValue(anchor ?? { role, nodeId, value: nodeId }, step.replayCanvasData);
      return {
        label: role,
        value: display || nodeId,
        ...(!display ? { referenceStatus: 'unavailable' as const } : {}),
        ...(paired ? { literal: literals![index] } : {})
      };
    });
  });
  const prior = Object.entries(relation.priorAnchors ?? {}).flatMap(([role, value]) => {
    const ids = Array.isArray(value) ? value : [value];
    if (!ids.length)
      return [{ label: role, value: '[]', scope: 'previous' as const, emptyList: true as const }];
    return ids.map(nodeId => {
      const matches = priorForest.flatMap(collectReplayCanvasNodes).filter(node => node.id === nodeId);
      const display = matches.length === 1
        ? formatRelationParticipantValue({ role, nodeId, value: nodeId }, matches[0]) : '';
      return {
        label: role, value: display || nodeId, scope: 'previous' as const,
        ...(!display ? { referenceStatus: matches.length > 1 ? 'ambiguous' as const : 'unavailable' as const } : {})
      };
    });
  });
  return [...current, ...prior];
};

const buildRelationReplayLine = (relation: DerivationReplayPlanStep, replayCanvasData?: SyntaxNode | null): string => {
  const relationLabel = spaceAuthoredName(formatReplaySupportValue(String(relation?.relation || '').trim()), { snakeCase: true });
  const anchors = relation?.anchors && typeof relation.anchors === 'object' && !Array.isArray(relation.anchors)
    ? relation.anchors
    : {};
  const anchorParts = Object.entries(anchors)
    .map(([role, value]) => {
      const display = formatRelationAnchorValue(value, replayCanvasData, role);
      if (!display)
        return '';
      const roleLabel = formatRelationAnchorRole(role);
      return roleLabel ? `${roleLabel}: ${display}` : display;
    })
    .filter(Boolean);
  if (!relationLabel)
    return anchorParts.join('; ');
  return anchorParts.length > 0 ? `${relationLabel}: ${anchorParts.join('; ')}` : relationLabel;
};

export const buildStageRecordReplayBlocks = (frame?: ReplayDerivationFrame | null, plannedStage?: DerivationReplayPlanStage | null): ReplayDetailBlock[] | undefined => {
  const stageRecord = getFrameStageRecordText(frame, plannedStage);
  if (!stageRecord)
    return undefined;
  return [{ title: 'Stage Record', lines: [stageRecord] }];
};

export const buildRelationReplayBlocks = (relations: DerivationReplayPlanStep[] = [], replayCanvasData?: SyntaxNode | null): ReplayDetailBlock[] | undefined => {
  const lines = relations
    .filter(isRenderableReplayRelation)
    .map((relation) => buildRelationReplayLine(relation, replayCanvasData))
    .filter(Boolean);
  if (lines.length === 0)
    return undefined;
  return [{ title: 'Relations', lines }];
};

export const buildFrameReplayBlocks = (
  frame?: ReplayDerivationFrame | null,
  replayCanvasData?: SyntaxNode | null,
  plannedStage?: DerivationReplayPlanStage | null
): ReplayDetailBlock[] | undefined => (mergeReplayDetailBlocks(buildStageRecordReplayBlocks(frame, plannedStage), buildRelationReplayBlocks(getFrameRelations(frame, plannedStage), replayCanvasData)));

const combineReplayNodeDisplayWithPosition = (nodeDisplay: string, positionDisplay: string): string => {
  if (!positionDisplay)
    return nodeDisplay;
  if (!nodeDisplay)
    return positionDisplay;
  const normalizedNodeDisplay = normalizeReplayTargetLabel(nodeDisplay);
  const normalizedPosition = normalizeReplayTargetLabel(positionDisplay);
  if (normalizedNodeDisplay === normalizedPosition)
    return nodeDisplay;
  if (/^spec,/i.test(positionDisplay))
    return positionDisplay;
  const inHostMatch = positionDisplay.match(/^[^ ]+\s+in\s+(.+)$/i);
  if (inHostMatch?.[1]) {
    return `${nodeDisplay} in ${formatReplaySupportValue(inHostMatch[1])}`;
  }
  return positionDisplay;
};

const getReplayMoveTargetLabel = (step: PlaybackStep | null): string => {
  if (!step)
    return '';
  if (!stepRepresentsMovement(step))
    return formatReplaySupportValue(step.targetLabel);
  return (getReplayNodeDisplayFromCanvas(step.replayCanvasData, step.targetNodeId)
    || formatReplaySupportValue(step.targetLabel));
};

const inferReplayLandingValue = (step: PlaybackStep | null): string => {
  if (!step)
    return '';
  const diagnostics = Array.isArray(step.movementDiagnostics)
    ? step.movementDiagnostics.filter(Boolean)
    : [];
  if (diagnostics.some((message) => /landing omitted/i.test(String(message || '')))) {
    return '';
  }
  const targetDisplay = getReplayMoveTargetLabel(step);
  const positionFromTree = describeReplayNodePosition(step.replayCanvasData, step.targetNodeId);
  if (isHeadLikePlaybackStep(step)) {
    return targetDisplay && !isGenericReplayStructuralLabel(targetDisplay)
      ? combineReplayNodeDisplayWithPosition(targetDisplay, positionFromTree)
      : (positionFromTree || '');
  }
  if (positionFromTree)
    return positionFromTree;
  const fallbackTarget = targetDisplay || formatReplaySupportValue(step.targetLabel);
  return fallbackTarget && !isGenericReplayStructuralLabel(fallbackTarget)
    ? fallbackTarget
    : '';
};

const inferReplaySourceValue = (
  step: PlaybackStep | null,
  landingValue: string,
  priorForest: readonly SyntaxNode[]
): string => {
  if (!step)
    return '';
  const priorIds = [...new Set(getReplayContentRelationLinks(step)
    .filter(isResolvedMovementLink)
    .map(link => (link as ReplayAuthoredRelationLink).priorSourceNodeId)
    .filter((id): id is string => Boolean(id)))];
  if (priorIds.length) {
    const priorNodes = priorForest.flatMap(collectReplayCanvasNodes);
    return priorIds.flatMap(nodeId => {
      if (priorNodes.filter(node => node.id === nodeId).length !== 1)
        return [];
      const root = priorForest.find(root => findReplayNodePathById(root, nodeId));
      const display = formatRelationParticipantValue({ role: '', nodeId }, root);
      const position = describeReplayNodePosition(root, nodeId);
      return [display && position && display !== position ? `${display} (${position})` : display || position];
    }).filter(Boolean).join(' + ');
  }
  const diagnostics = Array.isArray(step.movementDiagnostics)
    ? step.movementDiagnostics.filter(Boolean)
    : [];
  if (diagnostics.some((message) => /source omitted/i.test(String(message || '')))) {
    return '';
  }
  if (isHeadLikePlaybackStep(step)) {
    const sourceFromCanvas = (Array.isArray(step.sourceNodeIds) ? step.sourceNodeIds : [])
      .map((nodeId) => String(nodeId || ''))
      .filter((nodeId) => nodeId && nodeId !== String(step.targetNodeId || ''))
      .map((nodeId) => getReplayNodeDisplayFromCanvas(step.replayCanvasData, nodeId))
      .find(Boolean);
    if (sourceFromCanvas)
      return sourceFromCanvas;
    const labelSources = (Array.isArray(step.sourceLabels) ? step.sourceLabels : [])
      .map((label) => formatReplaySupportValue(label))
      .filter(Boolean);
    const labelSource = labelSources.find((label) => normalizeReplayTargetLabel(label) !== normalizeReplayTargetLabel(landingValue)) || labelSources[0];
    if (labelSource && !isGenericReplayStructuralLabel(labelSource))
      return labelSource;
    return '';
  }
  const structuralSources = (Array.isArray(step.sourceNodeIds) ? step.sourceNodeIds : [])
    .filter((nodeId) => String(nodeId || '') && String(nodeId || '') !== String(step.targetNodeId || ''))
    .map((nodeId) => describeReplayNodePosition(step.replayCanvasData, nodeId))
    .filter(Boolean);
  const normalizedLanding = normalizeReplayTargetLabel(landingValue);
  const structuralSource = structuralSources.find((label) => normalizeReplayTargetLabel(label) !== normalizedLanding);
  if (structuralSource)
    return structuralSource;
  const movedSurface = formatReplaySupportValue(step.targetLabel);
  if (movedSurface && !isGenericReplayStructuralLabel(movedSurface))
    return movedSurface;
  const labelSources = (Array.isArray(step.sourceLabels) ? step.sourceLabels : [])
    .map((label) => formatReplaySupportValue(label))
    .filter(Boolean);
  const labelSource = labelSources.find((label) => normalizeReplayTargetLabel(label) !== normalizedLanding) || labelSources[0];
  if (labelSource && !isGenericReplayStructuralLabel(labelSource))
    return labelSource;
  return '';
};

export const buildReplaySupportLines = (
  step: PlaybackStep | null,
  authoredRelation?: DerivationStageRelation | null,
  priorForest: readonly SyntaxNode[] = []
): ReplaySupportLine[] => {
  if (!step)
    return [];
  const operation = String(step.operation || '').trim();
  const inputValue = formatReplayInputsValue(step.sourceLabels);
  const resultValue = formatReplaySupportValue(step.targetLabel);
  const literalValues = authoredRelation === undefined
    ? getReplayContentRelationLinks(step).find(link => link.values)?.values
    : authoredRelation?.values;
  const valueLines = buildLiteralRelationValueLines(literalValues);
  if (step.replayKind !== 'relation' && operation === 'StageRecord') {
    return [];
  }
  if (step.replayKind !== 'relation' && operation === 'LexicalSelect') {
    return [];
  }
  if (step.replayKind !== 'relation' && (operation === 'Project' || operation === 'ExternalMerge')) {
    return inputValue && resultValue ? [{ label: '', value: `${inputValue} → ${resultValue}` }]
      : inputValue ? [{ label: 'Input', value: inputValue }]
        : resultValue ? [{ label: 'Result', value: resultValue }] : [];
  }
  const relationLines = (movementLines?: ReplaySupportLine[]): ReplaySupportLine[] => {
    const participants = authoredRelation === undefined ? movementLines ? [] : buildRelationParticipantSupportLines(step)
      : authoredRelation ? buildAuthoredRelationAnchorLines(step, authoredRelation, movementLines, priorForest) : [];
    const pairedKeys = new Set(participants.filter(line => line.literal !== undefined).map(line => line.label));
    return [...(movementLines ?? []), ...participants, ...valueLines.filter(line => !pairedKeys.has(line.label))];
  };
  if (stepRepresentsMovement(step) && relationMomentUsesMovementSupport(step)) {
    const landingValue = inferReplayLandingValue(step);
    const sourceValue = inferReplaySourceValue(step, landingValue, priorForest);
    const lines: ReplaySupportLine[] = [];
    const diagnostics = Array.isArray(step.movementDiagnostics)
      ? step.movementDiagnostics.filter(Boolean)
      : [];
    const mentionsMissingSource = diagnostics.some((message) => /source omitted/i.test(String(message || '')));
    const mentionsMissingLanding = diagnostics.some((message) => /landing omitted/i.test(String(message || '')));
    if (sourceValue)
      lines.push({ label: 'Source', value: sourceValue });
    else if (mentionsMissingSource)
      lines.push({ label: 'Source', value: '', referenceStatus: 'unavailable' });
    if (landingValue)
      lines.push({ label: 'Landing', value: landingValue });
    else if (mentionsMissingLanding)
      lines.push({ label: 'Landing', value: '', referenceStatus: 'unavailable' });
    return relationLines(lines);
  }
  if (step.replayKind === 'relation') {
    return relationLines();
  }
  const fallbackLines: ReplaySupportLine[] = [];
  if (inputValue)
    fallbackLines.push({ label: step.sourceLabels.length > 1 ? 'Inputs' : 'Input', value: inputValue });
  if (resultValue)
    fallbackLines.push({ label: 'Result', value: resultValue });
  return fallbackLines;
};

/** Panel content uses the original relation, including evidence with no drawing link. */
export const buildReplayPanelContent = (step: PlaybackStep | null | undefined, derivationStages: readonly DerivationStage[] | null | undefined = []): ReplayPanelContent => {
  const identity = step?.replayKind === 'relation' ? step.replayRelationIdentity : undefined;
  const authoredRelation = identity && Number.isInteger(identity.stageIndex) && identity.stageIndex >= 0
    && Number.isInteger(identity.relationIndex) && identity.relationIndex >= 0
    ? derivationStages?.[identity.stageIndex]?.relations?.[identity.relationIndex] ?? null : null;
  const prefix = identity ? `${identity.stageIndex}:${identity.relationIndex}` : 'structural';
  const priorForest = identity && identity.stageIndex > 0
    ? derivationStages?.[identity.stageIndex - 1]?.workspaceForest ?? [] : [];
  const supportLines = buildReplaySupportLines(step ?? null, authoredRelation, priorForest);
  // A true duplicate that shares this moment is listed with its own evidence.
  for (const shared of (identity ? step?.replaySharedRelationIdentities ?? [] : [])) {
    const relation = derivationStages?.[shared.stageIndex]?.relations?.[shared.relationIndex];
    if (!relation) continue;
    supportLines.push({ label: 'Same moment', value: spaceAuthoredName(relation.relation) },
      ...buildReplaySupportLines(step ?? null, relation, priorForest));
  }
  const stageIndex = step?.replayKind === 'macro' ? step.replayFrameIndex : undefined;
  const statement = typeof stageIndex === 'number' && Number.isInteger(stageIndex) && stageIndex >= 0
    ? derivationStages?.[stageIndex]?.statement : undefined;
  // Recipes also describe generated micro-steps; only the original stage owns this text.
  if (typeof statement === 'string' && statement.length > 0) {
    supportLines.unshift({ label: 'Statement', value: statement });
  }
  return {
    heading: authoredRelation ? spaceAuthoredName(authoredRelation.relation, { snakeCase: true }) : formatPlaybackOperationTitle(step),
    supportLines: supportLines.map((line, index) => ({
      ...line,
      label: `${spaceAuthoredName(line.label, { snakeCase: true })}${line.scope === 'previous' ? ' (previous stage)' : ''}`,
      value: line.referenceStatus ? `participant ${line.referenceStatus}`
        : line.emptyList ? 'empty list' : line.value === '' ? '""' : line.value,
      key: `${prefix}:${index}`
    })),
    authoredRelation
  };
};

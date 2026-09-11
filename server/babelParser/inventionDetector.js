import { dispatchRelationClaims } from '../../replay/relations/tier2RelationDispatch.ts';
import { recoverMovementEvidence } from '../../replay/relations/movementEvidence.ts';
import { PRODUCTION_RENDER_FAMILIES } from '../../replay/relations/renderFamilies.ts';

const DECLARED_REPLAY_OPERATIONS = new Set([
  'ExternalMerge',
  'LexicalSelect',
  'Preserve',
  'Project',
  'StageRecord',
  'Relation'
]);

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value || '').trim();

const visitSyntaxNodes = (value, visit) => {
  if (Array.isArray(value)) {
    value.forEach((item) => visitSyntaxNodes(item, visit));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (typeof value.id === 'string' && typeof value.label === 'string') {
    visit(value);
  }
  asArray(value.children).forEach((child) => visitSyntaxNodes(child, visit));
};

const collectAuthoredEvidence = (stages) => {
  const nodesById = new Map();
  const relationLabels = new Set();
  const relationAnchorIds = new Set();
  asArray(stages).forEach((stage) => {
    visitSyntaxNodes(stage?.workspaceForest, (node) => {
      const nodeId = asText(node.id);
      if (!nodeId) return;
      const evidence = nodesById.get(nodeId) || {
        labels: new Set(),
        words: new Set()
      };
      evidence.labels.add(String(node.label));
      if (typeof node.word === 'string') evidence.words.add(node.word);
      nodesById.set(nodeId, evidence);
    });
    asArray(stage?.relations).forEach((relation) => {
      const label = asText(relation?.relation);
      if (label) relationLabels.add(label);
      const anchors = relation?.anchors && typeof relation.anchors === 'object'
        ? relation.anchors
        : {};
      Object.values(anchors).forEach((value) => {
        (Array.isArray(value) ? value : [value]).forEach((nodeId) => {
          const normalizedNodeId = asText(nodeId);
          if (normalizedNodeId) relationAnchorIds.add(normalizedNodeId);
        });
      });
    });
  });
  return { nodesById, relationLabels, relationAnchorIds };
};

const sourceAuthoredNodeId = (nodeId) => {
  const normalized = asText(nodeId);
  const preterminalSeparator = normalized.indexOf('::__lex_');
  if (preterminalSeparator > 0) return normalized.slice(0, preterminalSeparator);
  return normalized.endsWith('::__leaf')
    ? normalized.slice(0, -'::__leaf'.length)
    : normalized;
};

export const detectDeterministicLinguisticInvention = ({
  authoredDerivationStages,
  analysis,
  replayPlan,
  replaySnapshot,
  renderedRelationLinks
}) => {
  const issues = [];
  const { nodesById, relationLabels, relationAnchorIds } = collectAuthoredEvidence(
    authoredDerivationStages
  );

  const inspectCompiledNodes = (surface, value) => {
    visitSyntaxNodes(value, (node) => {
      const nodeId = asText(node.id);
      const evidence = nodesById.get(nodeId);
      if (!evidence) {
        issues.push({
          kind: 'compiled-node-id-not-authored',
          nodeId,
          surface
        });
        return;
      }
      if (!evidence.labels.has(String(node.label))) {
        issues.push({
          authored: Array.from(evidence.labels),
          kind: 'compiled-node-label-not-authored',
          nodeId,
          observed: String(node.label),
          surface
        });
      }
      if (
        typeof node.word === 'string'
        && !evidence.words.has(node.word)
      ) {
        issues.push({
          authored: Array.from(evidence.words),
          kind: 'compiled-node-word-not-authored',
          nodeId,
          observed: node.word,
          surface
        });
      }
    });
  };

  inspectCompiledNodes('analysis.tree', analysis?.tree);
  asArray(analysis?.derivationStages).forEach((stage, stageIndex) => {
    inspectCompiledNodes(
      `analysis.derivationStages[${stageIndex}].workspaceForest`,
      stage?.workspaceForest
    );
  });

  asArray(replayPlan?.stages).forEach((stage, stageIndex) => {
    inspectCompiledNodes(
      `replayPlan.stages[${stageIndex}].workspaceForest`,
      stage?.workspaceForest
    );
  });

  const expectedRenderableRelations = new Map();
  asArray(replayPlan?.steps).forEach((step, stepIndex) => {
    const operation = asText(step?.operation);
    if (
      operation
      && !DECLARED_REPLAY_OPERATIONS.has(operation)
      && !relationLabels.has(operation)
    ) {
      issues.push({
        kind: 'replay-plan-operation-not-authored-or-declared',
        observed: operation,
        surface: `replayPlan.steps[${stepIndex}]`
      });
    }
    if (step?.kind === 'relation') {
      const label = asText(step?.relation || step?.label);
      if (label && !relationLabels.has(label)) {
        issues.push({
          kind: 'replay-relation-label-not-authored',
          observed: label,
          surface: `replayPlan.steps[${stepIndex}]`
        });
      }
      const resolvedAnchors = asArray(step?.resolvedAnchors)
        .map((anchor) => ({
          role: String(anchor?.role || ''),
          nodeId: asText(anchor?.nodeId)
        }))
        .filter((anchor) => anchor.role && anchor.nodeId);
      if (resolvedAnchors.length > 0) {
        const stageIndex = Number.isInteger(step?.stageIndex)
          ? Number(step.stageIndex)
          : 0;
        const authoredRelationIndex = Number.isInteger(step?.authoredRelationIndex)
          ? Number(step.authoredRelationIndex)
          : stepIndex;
        const current = analysis?.derivationStages?.[stageIndex];
        const previous = analysis?.derivationStages?.[stageIndex - 1];
        const relation = current?.relations?.[authoredRelationIndex];
        const dispatch = relation ? dispatchRelationClaims({ relation, stageIndex, relationIndex: authoredRelationIndex,
          currentForest: current.workspaceForest || [], priorForest: previous?.workspaceForest || [] }) : null;
        const boundAnchors = resolvedAnchors.map(anchor => {
          const binding = dispatch?.primaryClaim?.tier === 1 && dispatch.tier1Dispatch.roleBindings.find(binding =>
            binding.field === 'anchors' && binding.authoredRole === anchor.role);
          return binding && binding.role !== anchor.role
            ? { ...anchor, role: binding.role, authoredRole: anchor.role } : anchor;
        });
        const movement = relation ? recoverMovementEvidence(relation, current.workspaceForest || [], previous?.workspaceForest || []).movement : null;
        const movementLicensed = movement && (dispatch?.facets.some(facet => facet.recipe.id === 'movement.path')
          || (dispatch?.primaryClaim?.tier === 1 && PRODUCTION_RENDER_FAMILIES[dispatch.primaryClaim.registryEntryId]?.trajectoryKind === movement.trajectoryKind));
        expectedRenderableRelations.set(
          `${stageIndex}:${authoredRelationIndex}`,
          { anchors: boundAnchors, label, stepIndex, movement, movementLicensed }
        );
      }
    }
    [
      step?.targetNodeId,
      ...asArray(step?.sourceNodeIds)
    ].forEach((rawNodeId) => {
      const nodeId = asText(rawNodeId);
      if (
        !nodeId
        || nodesById.has(nodeId)
        || relationAnchorIds.has(nodeId)
      ) {
        return;
      }
      issues.push({
        kind: 'replay-plan-node-id-not-authored',
        nodeId,
        surface: `replayPlan.steps[${stepIndex}]`
      });
    });
  });

  const displayedRelationLinks = [
    ...asArray(renderedRelationLinks),
    ...asArray(replaySnapshot?.steps)
      .flatMap((step) => asArray(step?.replayRelationLinks))
  ];
  const displayedRelationKeys = new Set();
  displayedRelationLinks.forEach((link, linkIndex) => {
    const relationKey = asText(link?.authoredRelationKey);
    const expected = expectedRenderableRelations.get(relationKey);
    if (!expected) {
      issues.push({
        kind: 'displayed-relation-not-authored-renderable',
        observed: relationKey || null,
        surface: `renderedRelationLinks[${linkIndex}]`
      });
      return;
    }
    displayedRelationKeys.add(relationKey);
    const observedLabel = asText(link?.relation);
    if (observedLabel !== expected.label) {
      issues.push({
        authored: expected.label,
        kind: 'displayed-relation-label-not-authored',
        observed: observedLabel,
        surface: `renderedRelationLinks[${linkIndex}]`
      });
    }
    const observedAnchors = asArray(link?.anchors).map((anchor) => ({
      role: String(anchor?.role || ''),
      nodeId: asText(anchor?.nodeId),
      ...(anchor?.authoredRole ? { authoredRole: anchor.authoredRole } : {})
    }));
    if (JSON.stringify(observedAnchors) !== JSON.stringify(expected.anchors)) {
      issues.push({
        authored: expected.anchors,
        kind: 'displayed-relation-anchor-set-mismatch',
        observed: observedAnchors,
        surface: `renderedRelationLinks[${linkIndex}]`
      });
    }
    if (
      !asText(link?.relationIndex)
      || link?.relationIndexProvenance !== 'derived-presentation'
    ) {
      issues.push({
        kind: 'displayed-relation-index-provenance-missing',
        surface: `renderedRelationLinks[${linkIndex}]`
      });
    }
    const expectedAnchorNodeIds = new Set(
      expected.anchors.map((anchor) => anchor.nodeId)
    );
    const sourceNodeId = asText(link?.sourceNodeId);
    const targetNodeId = asText(link?.targetNodeId);
    const endpointOrderProvenance = asText(link?.endpointOrderProvenance);
    const endpointOrderMatches = endpointOrderProvenance === 'authored-anchor-order'
      ? (
          sourceNodeId === expected.anchors[0].nodeId
          && targetNodeId === expected.anchors[1].nodeId
        )
      : endpointOrderProvenance === 'registered-role-order'
        ? (
            sourceNodeId !== targetNodeId
            && expectedAnchorNodeIds.has(sourceNodeId)
            && expectedAnchorNodeIds.has(targetNodeId)
          )
        : endpointOrderProvenance === 'recovered-movement'
          ? Boolean(expected.movement && sourceNodeId === expected.movement.sourceNodeId
            && targetNodeId === expected.movement.targetNodeId
            && asText(link?.witnessNodeId) === expected.movement.witnessNodeId)
          : false;
    if (
      expected.anchors.length >= 2
      && !endpointOrderMatches
    ) {
      issues.push({
        kind: 'displayed-relation-endpoint-order-mismatch',
        surface: `renderedRelationLinks[${linkIndex}]`
      });
    }
    if (endpointOrderProvenance === 'recovered-movement' && link?.renderFamily === 'trajectory'
      && (!expected.movementLicensed || link.trajectoryKind !== expected.movement?.trajectoryKind)) {
      issues.push({
        kind: 'displayed-movement-trajectory-not-licensed',
        surface: `renderedRelationLinks[${linkIndex}]`
      });
    }
  });
  expectedRenderableRelations.forEach((expected, relationKey) => {
    if (displayedRelationKeys.has(relationKey)) return;
    issues.push({
      authored: {
        anchors: expected.anchors,
        relation: expected.label
      },
      kind: 'authored-renderable-relation-not-displayed',
      surface: `replayPlan.steps[${expected.stepIndex}]`
    });
  });

  asArray(replaySnapshot?.steps).forEach((step, stepIndex) => {
    const operation = asText(step?.operation);
    if (
      operation
      && !DECLARED_REPLAY_OPERATIONS.has(operation)
      && !relationLabels.has(operation)
    ) {
      issues.push({
        kind: 'replay-operation-not-authored-or-declared',
        observed: operation,
        surface: `replaySnapshot.steps[${stepIndex}]`
      });
    }
    [
      step?.targetNodeId,
      ...asArray(step?.sourceNodeIds),
      ...asArray(step?.replayVisibleNodeIds)
    ].forEach((rawNodeId) => {
      const nodeId = asText(rawNodeId);
      if (!nodeId) return;
      const authoredNodeId = sourceAuthoredNodeId(nodeId);
      if (nodesById.has(authoredNodeId)) return;
      issues.push({
        kind: 'replay-node-id-not-authored-or-declared-preterminal',
        nodeId,
        surface: `replaySnapshot.steps[${stepIndex}]`
      });
    });
  });

  return issues;
};

export const assertNoDeterministicLinguisticInvention = (input) => {
  const issues = detectDeterministicLinguisticInvention(input);
  if (issues.length > 0) {
    throw new Error(
      `Deterministic linguistic invention detected:\n${JSON.stringify(issues, null, 2)}`
    );
  }
};

export const DECLARED_PRESENTATION_TRANSFORMS = Object.freeze({
  replayOperations: Array.from(DECLARED_REPLAY_OPERATIONS).sort(),
  syntheticOvertPreterminalIdForms: [
    '<authored-node-id>::__leaf',
    '<authored-node-id>::__lex_<stable-surface-key>'
  ]
});

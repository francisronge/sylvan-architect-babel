import { findRelationRegistryEntry } from '../relationDispatch/relationRegistry.js';
import type { FacetPlanCompilers, FacetPlanContext } from './facetPlanContext.ts';
import { collectSubtreeIds, flattenAnchorIds } from './planSyntax.ts';
import {
  BLOCKED_OUTCOME_STATES,
  ILLICIT_OUTCOME_STATES,
  LICENSED_OR_BLOCKED_OUTCOME_STATES,
  recognizedOutcome,
  scalarValue
} from './planValues.ts';
import type { RegisteredPlanCompilers } from './registeredPlanContext.ts';
import { singleValue } from './tier2PlanValues.ts';

export const domainPlan = {
  'boundary-cuts': (context) => {
    const { anchors, values, family, base } = context.claim;
    const { pushCompositeTrajectory, resolvedIds, requireResolved, pushDiagnostic, items } = context.output;
    if (anchors.traceWitness && pushCompositeTrajectory('phrasal')) return;
    const domain = flattenAnchorIds(anchors.domain)[0];
    const boundary = resolvedIds('boundary', anchors.boundary);
    if (!requireResolved('domain', domain) || boundary.length === 0) return;
    const boundaryOutcomeRaw = scalarValue(values, 'outcome');
    const boundaryOutcome = recognizedOutcome(
      boundaryOutcomeRaw,
      family,
      BLOCKED_OUTCOME_STATES
    );
    if (boundaryOutcomeRaw && !boundaryOutcome) {
      pushDiagnostic(
        'value-unrecognized',
        `outcome -> "${boundaryOutcomeRaw}" is not a recognized BoundingNodeCrossing judgment`
      );
    }
    items.push({
      ...base,
      kind: 'node-badges',
      badgeStyle: 'boundary-cut',
      badges: boundary.map((nodeId) => ({ nodeId, text: '∥', shape: 'plain' as const }))
    });
    return;
  },
  'phase-arc': (context) => {
    const { anchors, base } = context.claim;
    const { requireResolved, items } = context.output;
    const { stageList, stageIndex, nodes } = context.workspace;
    const { registry, families, companionAnchors, nextPhaseIsPrimary } = context.lookup;
    const phase = flattenAnchorIds(anchors.phase)[0];
    if (!requireResolved('phase', phase)) return;
    const edge = flattenAnchorIds(anchors.edge)[0];
    if (edge && !requireResolved('edge', edge)) return;
    /*
     * A later authored TransferDomain elaborates this same Phase claim
     * with Fong's Phase/edge/SOD composition. The Phase relation still
     * owns the moment when its Phase arc and edge first appear; the
     * later Transfer relation adds only the SOD. This preserves one
     * genuine authored stage per operation without a duplicate plain
     * phase arc or an early transferred-domain mark.
     */
    const transferElaboratesPhase = Boolean(edge) && stageList.some((candidateStage, candidateStageIndex) => (
      candidateStageIndex >= stageIndex
      && (candidateStage.relations || []).some((candidate, candidateRelationIndex) => {
        const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
        return Boolean(candidateEntry)
          && families[candidateEntry!.id]?.family === 'transfer-domain'
          && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).phase)[0] === phase
          && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).edge)[0] === edge;
      })
    ));
    if (transferElaboratesPhase && edge) {
      items.push({
        ...base,
        kind: 'fong-component',
        headNodeId: phase,
        componentLabel: 'Phase'
      });
      items.push({
        ...base,
        kind: 'domain-mark',
        rootNodeId: edge,
        memberNodeIds: [edge],
        domainStyle: 'transfer-edge',
        label: 'Phase edge'
      });
      return;
    }
    const phasePrimary = nextPhaseIsPrimary();
    items.push({
      ...base,
      kind: 'domain-mark',
      rootNodeId: phase,
      ...(edge ? { phaseEdgeNodeId: edge } : {}),
      phasePrimary,
      memberNodeIds: collectSubtreeIds(nodes.get(phase)),
      subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: phase, mode: 'all' }],
      domainStyle: 'phase'
    });
    return;
  },
  'transfer-domain': (context) => {
    const { anchors, relationIndex, base } = context.claim;
    const { resolvedIds, requireResolved, items } = context.output;
    const { stageList, stageIndex } = context.workspace;
    const { registry, families, companionAnchors } = context.lookup;
    const phase = flattenAnchorIds(anchors.phase)[0];
    const edges = resolvedIds('edge', anchors.edge);
    const edge = edges[0];
    const spellOut = flattenAnchorIds(anchors.spellOutDomain || anchors.complement)[0];
    if (!requireResolved('phase', phase)) return;
    if (!requireResolved('edge', edge)) return;
    if (edges.length !== flattenAnchorIds(anchors.edge).length) return;
    if (spellOut && !requireResolved('spellOutDomain', spellOut)) return;
    /*
     * Fong Defs. 1–2, plate-exact: a tilted component arc labelled
     * Phase around the phase head, the rectangular Phase-edge outline
     * around the edge, and a second tilted component arc labelled SOD
     * around the spell-out domain head.
     */
    const phaseAlreadyAuthored = stageList.some((candidateStage, candidateStageIndex) => {
      if (candidateStageIndex > stageIndex) return false;
      return (candidateStage.relations || []).some((candidate, candidateRelationIndex) => {
        if (candidateStageIndex === stageIndex && candidateRelationIndex >= relationIndex) return false;
        const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
        return Boolean(candidateEntry)
          && ['phase-arc', 'transfer-domain'].includes(families[candidateEntry!.id]?.family)
          && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).phase)[0] === phase
          && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).edge)[0] === edge;
      });
    });
    if (!phaseAlreadyAuthored) {
      items.push({
        ...base,
        kind: 'fong-component',
        headNodeId: phase,
        componentLabel: 'Phase'
      });
    }
    edges.forEach((edgeNodeId) => {
      const edgeAlreadyAuthored = stageList.some((candidateStage, candidateStageIndex) =>
        candidateStageIndex <= stageIndex && (candidateStage.relations || []).some((candidate, candidateRelationIndex) => {
          if (candidateStageIndex === stageIndex && candidateRelationIndex >= relationIndex) return false;
          const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
          const bound = companionAnchors(candidateStageIndex, candidateRelationIndex);
          return Boolean(candidateEntry)
            && ['phase-arc', 'transfer-domain'].includes(families[candidateEntry!.id]?.family)
            && flattenAnchorIds(bound.phase)[0] === phase && flattenAnchorIds(bound.edge).includes(edgeNodeId);
        }));
      if (edgeAlreadyAuthored) return;
      items.push({
        ...base,
        kind: 'domain-mark',
        rootNodeId: edgeNodeId,
        memberNodeIds: [edgeNodeId],
        domainStyle: 'transfer-edge',
        label: 'Phase edge'
      });
    });
    if (spellOut) {
      items.push({
        ...base,
        kind: 'fong-component',
        headNodeId: spellOut,
        componentLabel: 'SOD'
      });
    }
    return;
  },
  'blocked-access': (context) => {
    const { values, family, anchors, relationIndex, base } = context.claim;
    const { pushDiagnostic, requireResolved, items } = context.output;
    const { stageList, stageIndex, nodes } = context.workspace;
    const { registry, families, companionAnchors } = context.lookup;
    const blockedAccessOutcomeRaw = scalarValue(values, 'outcome');
    if (
      blockedAccessOutcomeRaw
      && !recognizedOutcome(blockedAccessOutcomeRaw, family, BLOCKED_OUTCOME_STATES)
    ) {
      pushDiagnostic(
        'value-unrecognized',
        `outcome -> "${blockedAccessOutcomeRaw}" is not a recognized PostTransferAccess judgment`
      );
    }
    const phase = flattenAnchorIds(anchors.phase)[0];
    const edge = flattenAnchorIds(anchors.edge)[0];
    const source = flattenAnchorIds(anchors.source)[0];
    const target = flattenAnchorIds(anchors.target)[0];
    const domain = flattenAnchorIds(anchors.spellOutDomain || anchors.domain)[0];
    if (phase || edge) {
      if (!requireResolved('phase', phase)) return;
      if (!requireResolved('edge', edge)) return;
      const priorComposition = stageList.some((candidateStage, candidateStageIndex) => {
        if (candidateStageIndex > stageIndex) return false;
        return (candidateStage.relations || []).some((candidate, candidateRelationIndex) => {
          if (candidateStageIndex === stageIndex && candidateRelationIndex >= relationIndex) return false;
          const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
          return Boolean(candidateEntry)
            && families[candidateEntry!.id]?.family === 'blocked-access'
            && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).phase)[0] === phase
            && flattenAnchorIds(companionAnchors(candidateStageIndex, candidateRelationIndex).edge)[0] === edge;
        });
      });
      if (!priorComposition) {
        items.push({ ...base, kind: 'fong-component', headNodeId: phase, componentLabel: 'Phase' });
        items.push({
          ...base,
          kind: 'domain-mark',
          rootNodeId: edge,
          memberNodeIds: [edge],
          domainStyle: 'transfer-edge',
          label: 'Phase edge'
        });
      }
      if (domain) {
        if (!requireResolved('spellOutDomain', domain)) return;
        items.push({ ...base, kind: 'fong-component', headNodeId: domain, componentLabel: 'SOD' });
      }
      return;
    }
    if (!requireResolved('source', source)) return;
    if (!requireResolved('target', target)) return;
    if (domain && !requireResolved('spellOutDomain', domain)) return;
    items.push({
      ...base,
      kind: 'blocked-access-lane',
      sourceNodeId: source,
      targetNodeId: target,
      domainMemberNodeIds: domain ? collectSubtreeIds(nodes.get(domain)) : [],
      ...(domain
        ? { subtreeDerived: [{ field: 'domainMemberNodeIds', rootNodeId: domain, mode: 'all' as const }] }
        : {})
    });
    return;
  },
  'anti-locality': (context) => {
    const { anchors, values, family, base } = context.claim;
    const { requireResolved, pushDiagnostic, items } = context.output;
    const { nodes } = context.workspace;
    const source = flattenAnchorIds(anchors.source || anchors.lowerCopy)[0];
    const witness = flattenAnchorIds(anchors.traceWitness)[0];
    const landing = flattenAnchorIds(anchors.landing || anchors.pronouncedCopy)[0];
    if (!requireResolved('source', source)) return;
    if (!requireResolved('traceWitness', witness)) return;
    if (!requireResolved('landing', landing)) return;
    if (!collectSubtreeIds(nodes.get(source)).includes(witness)) {
      pushDiagnostic('witness-outside-source', `traceWitness -> ${witness} is not inside the source`);
      return;
    }
    const antiLocalityOutcomeRaw = scalarValue(values, 'outcome');
    const antiLocalityOutcome = recognizedOutcome(
      antiLocalityOutcomeRaw,
      family,
      LICENSED_OR_BLOCKED_OUTCOME_STATES
    );
    if (antiLocalityOutcomeRaw && !antiLocalityOutcome) {
      pushDiagnostic(
        'value-unrecognized',
        `outcome -> "${antiLocalityOutcomeRaw}" is not a recognized AntiLocality judgment; the path draws without a judgment mark`
      );
    }
    items.push({
      ...base,
      kind: 'directed-path',
      fromNodeId: source,
      toNodeId: landing,
      pathStyle: 'anti-locality',
      ...(antiLocalityOutcome ? { outcome: antiLocalityOutcome } : {})
    });
    const facilitator = flattenAnchorIds(anchors.facilitator)[0];
    if (facilitator && requireResolved('facilitator', facilitator)) {
      items.push({
        ...base,
        kind: 'node-badges',
        badgeStyle: 'facilitator',
        badges: [{ nodeId: facilitator, text: '', shape: 'plain' }]
      });
    }
    return;
  },
  'improper-movement': (context) => {
    const { anchors, primaryRelation, base } = context.claim;
    const { pushCompositeTrajectory, requireResolved, pushDiagnostic, resolvedIds, pushNeutralFallback, items } = context.output;
    const { nodes } = context.workspace;
    if (anchors.lowerCopy && anchors.traceWitness && pushCompositeTrajectory('phrasal')) return;
    const source = flattenAnchorIds(anchors.source)[0];
    const witness = flattenAnchorIds(anchors.traceWitness)[0];
    const landing = flattenAnchorIds(anchors.licensedLanding)[0];
    if (!requireResolved('source', source)) return;
    if (!requireResolved('traceWitness', witness)) return;
    if (!requireResolved('licensedLanding', landing)) return;
    if (!collectSubtreeIds(nodes.get(source)).includes(witness)) {
      pushDiagnostic('witness-outside-source', `traceWitness -> ${witness} is not inside the source`);
      return;
    }
    const forbidden = resolvedIds('forbiddenRegion', anchors.forbiddenRegion);
    const licensedHosts = resolvedIds('licensedLandingHosts', anchors.licensedLandingHosts);
    const rejectedHosts = resolvedIds('rejectedLandingHosts', anchors.rejectedLandingHosts);
    if (rejectedHosts.some((nodeId) => nodeId === landing || licensedHosts.includes(nodeId))) {
      pushDiagnostic('illegal-configuration', 'The same candidate host is both licensed and rejected');
      pushNeutralFallback(primaryRelation.anchors, false);
      return;
    }
    if (forbidden.length > 0) {
      items.push({
        ...base,
        kind: 'domain-mark',
        memberNodeIds: forbidden,
        domainStyle: 'forbidden-region'
      });
    }
    items.push({
      ...base,
      kind: 'directed-path',
      fromNodeId: witness,
      toNodeId: landing,
      pathStyle: 'anti-locality',
      sourceOccurrenceNodeId: source,
      outcome: 'licensed'
    });
    // The accepted drawing shows the rejected candidate paths too, each
    // from the same witness into the forbidden region's host.
    [...licensedHosts.map((nodeId) => ({ nodeId, outcome: 'licensed' as const })),
    ...rejectedHosts.map((nodeId) => ({ nodeId, outcome: 'blocked' as const }))].forEach(({ nodeId, outcome }) => {
      items.push({
        ...base,
        kind: 'directed-path',
        fromNodeId: witness,
        toNodeId: nodeId,
        pathStyle: 'improper-candidate',
        sourceOccurrenceNodeId: source,
        outcome
      });
    });
    if (licensedHosts.length > 0 || rejectedHosts.length > 0) {
      items.push({
        ...base,
        kind: 'node-badges',
        badgeStyle: 'improper-hosts',
        badges: [
          ...licensedHosts.map((nodeId) => ({ nodeId, text: '✓', shape: 'plain' as const })),
          ...rejectedHosts.map((nodeId) => ({ nodeId, text: '✗', shape: 'plain' as const }))
        ]
      });
    }
    return;
  },
  'blocked-extraction': (context) => {
    const { anchors, base, values, family } = context.claim;
    const { requireResolved, items, pushDiagnostic } = context.output;
    const { nodes } = context.workspace;
    const source = flattenAnchorIds(anchors.source || anchors.extractionSource)[0];
    const target = flattenAnchorIds(anchors.target || anchors.landingSite)[0];
    const domain = flattenAnchorIds(anchors.adjunctDomain || anchors.domain)[0];
    if (!requireResolved('source', source)) return;
    if (!requireResolved('target', target)) return;
    if (!requireResolved('domain', domain)) return;
    items.push({
      ...base,
      kind: 'domain-mark',
      rootNodeId: domain,
      memberNodeIds: collectSubtreeIds(nodes.get(domain)),
      subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
      domainStyle: 'adjunct-domain'
    });
    const blockedExtractionOutcomeRaw = scalarValue(values, 'outcome');
    const blockedExtractionOutcome = recognizedOutcome(
      blockedExtractionOutcomeRaw,
      family,
      BLOCKED_OUTCOME_STATES
    );
    if (blockedExtractionOutcomeRaw && !blockedExtractionOutcome) {
      pushDiagnostic(
        'value-unrecognized',
        `outcome -> "${blockedExtractionOutcomeRaw}" is not a recognized BlockedExtraction judgment; the path draws without a judgment mark`
      );
    }
    items.push({
      ...base,
      kind: 'directed-path',
      fromNodeId: source,
      toNodeId: target,
      pathStyle: 'blocked-extraction',
      ...(blockedExtractionOutcome ? { outcome: blockedExtractionOutcome } : {})
    });
    return;
  },
  'intervention': (context) => {
    const { anchors, values, family, base } = context.claim;
    const { pushCompositeTrajectory, requireResolved, pushDiagnostic, items } = context.output;
    if (anchors.lowerCopy && anchors.traceWitness && pushCompositeTrajectory('phrasal')) return;
    const probe = flattenAnchorIds(anchors.landing || anchors.probe)[0];
    const intervener = flattenAnchorIds(anchors.intervener)[0];
    const target = flattenAnchorIds(anchors.target)[0];
    if (!requireResolved('probe', probe)) return;
    if (!requireResolved('intervener', intervener)) return;
    if (!requireResolved('target', target)) return;
    const interventionOutcomeRaw = scalarValue(values, 'outcome');
    const interventionOutcome = recognizedOutcome(
      interventionOutcomeRaw,
      family,
      BLOCKED_OUTCOME_STATES
    );
    if (interventionOutcomeRaw && !interventionOutcome) {
      pushDiagnostic(
        'value-unrecognized',
        `outcome -> "${interventionOutcomeRaw}" is not a recognized Intervention judgment; the path draws without a judgment mark`
      );
    }
    items.push({
      ...base,
      kind: 'directed-path',
      fromNodeId: probe,
      toNodeId: target,
      pathStyle: 'intervention',
      ...(interventionOutcome ? { outcome: interventionOutcome } : {})
    });
    items.push({
      ...base,
      kind: 'node-badges',
      badgeStyle: 'intervener',
      badges: [{ nodeId: intervener, text: '', shape: 'plain' }]
    });
    return;
  },
  'analysis-judgment': (context) => {
    const { anchors, values, family, base } = context.claim;
    const { requireResolved, pushDiagnostic, items } = context.output;
    const analysis = flattenAnchorIds(anchors.analysis)[0];
    if (!requireResolved('analysis', analysis)) return;
    const outcomeRaw = scalarValue(values, 'outcome');
    if (outcomeRaw && !recognizedOutcome(outcomeRaw, family, ILLICIT_OUTCOME_STATES)) {
      pushDiagnostic(
        'value-unrecognized',
        `outcome -> "${outcomeRaw}" is not a recognized IllicitAnalysis judgment`
      );
    }
    const judgment = scalarValue(values, 'judgment');
    if (!judgment) {
      pushDiagnostic(
        'value-unrecognized',
        'judgment is required to draw an analysis-level judgment mark'
      );
      return;
    }
    const label = scalarValue(values, 'label');
    const canonicalClaimIdentity = JSON.stringify({
      kind: 'analysis-verdict',
      analysisNodeId: analysis,
      judgment,
      label: label || ''
    });
    items.push({
      ...base,
      kind: 'analysis-verdict',
      analysisNodeId: analysis,
      judgment,
      ...(label ? { label } : {}),
      claimTier: 1,
      canonicalClaimIdentity
    });
    return;
  }
} satisfies Partial<RegisteredPlanCompilers>;

const judgmentBlockedFacet = (context: FacetPlanContext) => {
  const { facet, push, base, one, state } = context;
  const piece = facet.evaluation.outputs[0];
  push({
    ...base(facet, [piece], 'tier2.local-judgment'),
    kind: 'node-badges',
    badgeStyle: 'local-judgment',
    badges: [{
      nodeId: one('judged.anchor'),
      text: facet.recipe.id === 'judgment.blocked' ? '\u2715' : '\u2713',
      shape: 'plain'
    }],
    ...(state === 'licensed' || state === 'blocked' ? { outcome: state } : {})
  });
  return;
};

export const domainFacetPlan = {
  'locality.boundary': (context: FacetPlanContext) => {
    const { push, base, facet, many } = context;
    push({
      ...base(facet, ['Barrier cut'], 'bounding-node.cuts'),
      kind: 'node-badges',
      badgeStyle: 'boundary-cut',
      badges: many('boundary').map((nodeId) => ({ nodeId, text: '\u2225', shape: 'plain' }))
    });
    return;
  },
  'phase.domain': (context: FacetPlanContext) => {
    const { one, push, base, facet, nodes, nextPhaseIsPrimary } = context;
    const phase = one('phase');
    push({
      ...base(facet, ['Phase arc'], 'phase.arc'),
      kind: 'domain-mark',
      rootNodeId: phase,
      memberNodeIds: collectSubtreeIds(nodes.get(phase)),
      subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: phase, mode: 'all' }],
      domainStyle: 'phase',
      phasePrimary: nextPhaseIsPrimary()
    });
    return;
  },
  'transfer.domain': (context: FacetPlanContext) => {
    const { one, push, base, facet, many } = context;
    if (one('phase')) push({
      ...base(facet, ['Transfer arcs'], 'transfer.domain', 'phase'),
      kind: 'fong-component',
      headNodeId: one('phase'),
      componentLabel: 'Phase'
    });
    many('phase.edge').forEach((edge, index) => push({
      ...base(facet, ['Transfer arcs'], 'transfer.domain', `edge:${index}`),
      kind: 'domain-mark',
      rootNodeId: edge,
      memberNodeIds: [edge],
      domainStyle: 'transfer-edge',
      label: 'Phase edge'
    }));
    push({
      ...base(facet, ['Transfer arcs'], 'transfer.domain', 'sod'),
      kind: 'fong-component',
      headNodeId: one('transfer.domain'),
      componentLabel: 'SOD'
    });
    return;
  },
  'domain.annotation': (context: FacetPlanContext) => {
    const { push, base, facet, one, evidence } = context;
    push({
      ...base(facet, ['Overlay annotation'], 'tier2.domain-annotation'),
      kind: 'node-badges',
      badgeStyle: 'phase-edge',
      badges: [{ nodeId: one('domain'), text: singleValue(evidence, 'label'), shape: 'plain' }]
    });
    return;
  },
  'phase.edge': (context: FacetPlanContext) => {
    const { many, push, base, facet } = context;
    many('phase.edge').forEach((edge, index) => push({
      ...base(facet, ['Edge outline'], 'transfer.domain', `edge:${index}`),
      kind: 'domain-mark',
      rootNodeId: edge,
      memberNodeIds: [edge],
      domainStyle: 'transfer-edge',
      label: 'Phase edge'
    }));
    return;
  },
  'transfer.access': (context: FacetPlanContext) => {
    const { one, push, base, facet, nodes } = context;
    const domain = one('transfer.domain');
    push({
      ...base(facet, ['Access path'], 'transfer.blocked-access'),
      kind: 'blocked-access-lane',
      sourceNodeId: one('access.source'),
      targetNodeId: one('access.target'),
      domainMemberNodeIds: collectSubtreeIds(nodes.get(domain)),
      subtreeDerived: [{ field: 'domainMemberNodeIds', rootNodeId: domain, mode: 'all' }]
    });
    return;
  },
  'judgment.verdict': (context: FacetPlanContext) => {
    const { evidence, one, diagnostics, relationRef, push, base, facet } = context;
    const judgment = singleValue(evidence, 'verdict');
    const label = singleValue(evidence, 'label');
    const analysisNodeId = one('analysis.anchor');
    const missing = [
      ...(!analysisNodeId ? ['analysis anchor'] : []),
      ...(!judgment ? ['judgment'] : [])
    ];
    if (missing.length > 0) {
      diagnostics.push({
        stageIndex: relationRef.stageIndex,
        relationIndex: relationRef.relationIndex,
        relation: relationRef.relation,
        kind: 'signature-incomplete',
        detail: `Tier-2 analysis verdict is missing ${missing.join(' and ')}`
      });
      return;
    }
    push({
      ...base(facet, facet.evaluation.outputs, 'analysis.illicit'),
      kind: 'analysis-verdict',
      analysisNodeId,
      judgment,
      ...(label ? { label } : {}),
      claimTier: 2,
      canonicalClaimIdentity: JSON.stringify({
        kind: 'analysis-verdict',
        analysisNodeId,
        judgment,
        label: label || ''
      })
    });
    return;
  },
  'judgment.blocked': judgmentBlockedFacet,
  'judgment.licensed': judgmentBlockedFacet,
  'landing-candidates': (context: FacetPlanContext) => {
    const { one, many, push, base, facet } = context;
    const witness = one('movement.witness');
    const licensed = many('licensed.hosts');
    const rejected = many('rejected.hosts');
    [...licensed, ...rejected].forEach((host, index) => {
      push({
        ...base(facet, ['Candidate rail'], 'improper-movement.landing', `path:${index}`),
        kind: 'directed-path',
        fromNodeId: witness,
        toNodeId: host,
        pathStyle: 'improper-candidate',
        outcome: licensed.includes(host) ? 'licensed' : 'blocked'
      });
    });
    push({
      ...base(facet, ['Candidate rail'], 'improper-movement.landing', 'badges'),
      kind: 'node-badges',
      badgeStyle: 'improper-hosts',
      badges: [
        ...licensed.map((nodeId) => ({ nodeId, text: '\u2713', shape: 'plain' as const })),
        ...rejected.map((nodeId) => ({ nodeId, text: '\u2715', shape: 'plain' as const }))
      ]
    });
    return;
  },
  'intervention': (context: FacetPlanContext) => {
    const { push, base, facet, one, state } = context;
    push({
      ...base(facet, ['Intervention path'], 'intervention.blocked-path', 'path'),
      kind: 'directed-path',
      fromNodeId: one('intervention.landing'),
      toNodeId: one('intervention.target'),
      pathStyle: 'intervention',
      ...(state === 'blocked' ? { outcome: 'blocked' } : {})
    });
    push({
      ...base(facet, ['Intervention path'], 'intervention.blocked-path', 'intervener'),
      kind: 'node-badges',
      badgeStyle: 'intervener',
      badges: [{ nodeId: one('intervener'), text: '', shape: 'plain' }]
    });
    return;
  },
  'blocked-extraction': (context: FacetPlanContext) => {
    const { one, push, base, facet, nodes, state } = context;
    const domain = one('adjunct.domain');
    const source = one('extraction.source');
    const target = one('extraction.target');
    push({
      ...base(facet, ['Branch overlay'], 'blocked-extraction.diagnostic', 'domain'),
      kind: 'domain-mark',
      rootNodeId: domain,
      memberNodeIds: collectSubtreeIds(nodes.get(domain)),
      subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
      domainStyle: 'adjunct-domain'
    });
    push({
      ...base(facet, ['Blocked extraction curve'], 'blocked-extraction.diagnostic', 'path'),
      kind: 'directed-path',
      fromNodeId: source,
      toNodeId: target,
      pathStyle: 'blocked-extraction',
      ...(state === 'blocked' ? { outcome: 'blocked' } : {})
    });
    return;
  }
} satisfies Partial<FacetPlanCompilers>;

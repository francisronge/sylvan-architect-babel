import { isWordlessCategoryLeaf } from '../replaySurfaceNotation.ts';
import { collectAuthoredSilentSubtreeIds } from './authoredSilence.ts';
import type { FacetPlanCompilers, FacetPlanContext } from './facetPlanContext.ts';
import {
  collectSubtreeIds,
  firstRole,
  flattenAnchorIds,
  loweringIsPhraseSized,
  stableChainKey,
  structuralLeafCount
} from './planSyntax.ts';
import { LICENSED_OR_BLOCKED_OUTCOME_STATES, asSubscript, recognizedOutcome, scalarValue } from './planValues.ts';
import type { RegisteredPlanCompilers } from './registeredPlanContext.ts';
import {
  TRAJECTORY_SOURCE_ROLES,
  TRAJECTORY_TARGET_ROLES,
  TRAJECTORY_WITNESS_ROLES,
  WITNESS_REQUIRED_TRAJECTORY_KINDS,
  type ProductionRenderFamily
} from './renderFamilies.ts';
import { pairedLiterals } from './tier2EvidenceQueries.ts';
import { gapBadgeText, singleValue } from './tier2PlanValues.ts';
import { headTrajectoryAttachment } from './trajectoryAttachment.ts';

export const movementPlan = {
  'operator-variable-binding': (context) => {
    const { anchors, base } = context.claim;
    const { requireResolved, pushDiagnostic, items, dependencyIndexFor } = context.output;
    const { nodes } = context.workspace;
    const operator = flattenAnchorIds(anchors.operator)[0];
    const variable = flattenAnchorIds(anchors.variable)[0];
    const traceWitness = flattenAnchorIds(anchors.traceWitness)[0];
    const scopeDomain = flattenAnchorIds(anchors.scopeDomain || anchors.domain)[0];
    if (!requireResolved('operator', operator)) return;
    if (!requireResolved('variable', variable)) return;
    if (traceWitness && !requireResolved('traceWitness', traceWitness)) return;
    if (scopeDomain && !requireResolved('scopeDomain', scopeDomain)) return;
    if (traceWitness && !collectSubtreeIds(nodes.get(variable)).includes(traceWitness)) {
      pushDiagnostic(
        'witness-outside-source',
        `traceWitness -> ${traceWitness} is not inside variable -> ${variable}`
      );
      return;
    }
    items.push({
      ...base,
      kind: 'operator-variable-binding',
      operatorNodeId: operator,
      variableNodeId: variable,
      ...(traceWitness ? { traceWitnessNodeId: traceWitness } : {}),
      ...(scopeDomain ? {
        scopeDomainNodeId: scopeDomain,
        scopeMemberNodeIds: collectSubtreeIds(nodes.get(scopeDomain)),
        subtreeDerived: [{ field: 'scopeMemberNodeIds', rootNodeId: scopeDomain, mode: 'all' }]
      } : {}),
      index: dependencyIndexFor(stableChainKey('operator-variable', nodes, [operator, variable]))
    });
    return;
  },
  'trajectory': (context) => {
    const { family, anchors, base, values, familyId, relation, claimDispatch } = context.claim;
    const { requireResolved, pushDiagnostic, items } = context.output;
    const { nodes, stage, stageList, stageIndex } = context.workspace;
    if (family.trajectoryKind === 'atb') {
      const target = firstRole(anchors, TRAJECTORY_TARGET_ROLES);
      const sources = flattenAnchorIds(anchors.sources);
      const witnesses = flattenAnchorIds(anchors.traceWitnesses);
      if (!target || !requireResolved(target.role, target.nodeId)) return;
      if (sources.length === 0 || sources.length !== witnesses.length) {
        pushDiagnostic('endpoint-missing', 'ATB requires positionally paired sources and traceWitnesses');
        return;
      }
      sources.forEach((sourceNodeId, pairIndex) => {
        const witnessNodeId = witnesses[pairIndex];
        if (!requireResolved('sources', sourceNodeId)) return;
        if (!requireResolved('traceWitnesses', witnessNodeId)) return;
        const sourceSubtree = collectSubtreeIds(nodes.get(sourceNodeId));
        if (!sourceSubtree.includes(witnessNodeId)) {
          pushDiagnostic(
            'witness-outside-source',
            `traceWitnesses[${pairIndex}] -> ${witnessNodeId} is not inside sources[${pairIndex}]`
          );
          return;
        }
        items.push({
          ...base,
          kind: 'trajectory',
          trajectoryKind: 'atb',
          sourceNodeId,
          targetNodeId: target.nodeId,
          witnessNodeId,
          sourceAttachment: 'terminal',
          targetAttachment: 'shell'
        });
        items.push({
          ...base,
          kind: 'node-badges',
          badgeStyle: 'gap-notation',
          badges: [{
            nodeId: sourceNodeId,
            text: `t${asSubscript(typeof values?.index === 'string' ? values.index : 'i')}`,
            shape: 'plain'
          }]
        });
      });
      return;
    }

    const source = firstRole(anchors, TRAJECTORY_SOURCE_ROLES);
    const target = firstRole(anchors, TRAJECTORY_TARGET_ROLES);
    if (!source || !target) {
      pushDiagnostic('endpoint-missing', 'trajectory requires one source-role and one target-role anchor');
      return;
    }
    if (!requireResolved(source.role, source.nodeId)) return;
    if (!requireResolved(target.role, target.nodeId)) return;

    let trajectoryKind = family.trajectoryKind as NonNullable<ProductionRenderFamily['trajectoryKind']>;
    if (
      familyId === 'trajectory.remnant'
      && scalarValue(values, 'phase') === 'evacuation'
    ) {
      trajectoryKind = 'phrasal';
    }
    if (
      familyId === 'trajectory.smuggling'
      && !anchors.passenger
      && !anchors.intervener
    ) {
      trajectoryKind = 'phrasal';
    }
    if (
      familyId === 'trajectory.sideward'
      && (stage.workspaceForest || []).length === 1
      && stageList.slice(0, stageIndex).some((priorStage) =>
        (priorStage.relations || []).some((priorRelation) =>
          priorRelation.relation === relation.relation
        )
      )
    ) {
      trajectoryKind = 'phrasal';
    }
    if (trajectoryKind === 'lowering'
      && loweringIsPhraseSized(claimDispatch.boundPrimaryRelation, nodes, source.nodeId, target.nodeId)) {
      trajectoryKind = 'phrasal';
    }

    const witness = firstRole(anchors, TRAJECTORY_WITNESS_ROLES);
    const witnessRequired = WITNESS_REQUIRED_TRAJECTORY_KINDS.has(trajectoryKind);
    if (witness) {
      if (!requireResolved(witness.role, witness.nodeId)) return;
      const sourceSubtree = collectSubtreeIds(nodes.get(source.nodeId));
      if (!sourceSubtree.includes(witness.nodeId)) {
        pushDiagnostic(
          'witness-outside-source',
          `${witness.role} -> ${witness.nodeId} is not the source occurrence or inside it`
        );
        return;
      }
    } else if (witnessRequired) {
      pushDiagnostic(
        'witness-missing',
        `${trajectoryKind} trajectories require an authored trace witness; none was authored`
      );
      return;
    }

    const headSized = trajectoryKind === 'head'
      || trajectoryKind === 'lowering';
    const sideward = trajectoryKind === 'sideward';
    const complexPhrase = !headSized && structuralLeafCount(nodes.get(source.nodeId)) > 1;
    items.push({
      ...base,
      kind: 'trajectory',
      trajectoryKind,
      sourceNodeId: source.nodeId,
      targetNodeId: target.nodeId,
      ...(witness ? { witnessNodeId: witness.nodeId } : {}),
      sourceAttachment: sideward
        ? 'shell-top'
        : headSized ? headTrajectoryAttachment(nodes.get(source.nodeId)!)
          : complexPhrase || isWordlessCategoryLeaf(nodes.get(source.nodeId)!) ? 'shell-bottom' : 'terminal',
      targetAttachment: sideward
        ? 'shell-top'
        : headSized ? headTrajectoryAttachment(nodes.get(target.nodeId)!) : 'shell-bottom'
    });

    if (sideward) {
      items.push({
        ...base,
        kind: 'node-badges',
        badgeStyle: 'gap-notation',
        badges: [{
          nodeId: source.nodeId,
          text: `t${asSubscript(typeof values?.index === 'string' ? values.index : '1')}`,
          shape: 'plain'
        }]
      });
    }

    /*
     * Accepted auxiliary marks travel with their trajectory: the
     * remnant's landing is boxed, the smuggling carrier's lower chunk
     * is shaded.
     */
    if (trajectoryKind === 'remnant') {
      items.push({
        ...base,
        kind: 'enclosure',
        nodeId: target.nodeId,
        licence: 'remnant-landing'
      });
    }
    if (trajectoryKind === 'smuggling') {
      items.push({
        ...base,
        kind: 'enclosure',
        nodeId: source.nodeId,
        licence: 'carrier-chunk'
      });
    }
    return;
  },
  'occurrence-identity': (context) => {
    const { anchors, claimDispatch, primaryRelation, base } = context.claim;
    const { pushCompositeTrajectory, requireResolved, pushDiagnostic, pushNeutralFallback, items, dependencyIndexFor } = context.output;
    const { nodes } = context.workspace;
    if (anchors.traceWitness && pushCompositeTrajectory('phrasal')) return;
    if (anchors.source && anchors.target && pushCompositeTrajectory('head')) return;
    const occurrenceIds = Object.values(anchors)
      .flatMap(flattenAnchorIds)
      .filter((nodeId, index, all) => all.indexOf(nodeId) === index)
      .filter((nodeId) => requireResolved('occurrences', nodeId));
    if (occurrenceIds.length < 2) return;
    const indexFields = (claimDispatch.evidence.authoredValues || [])
      .filter(field => field.concepts.includes('index'));
    const authoredIndices = new Set(indexFields.flatMap(field => field.items));
    if (indexFields.length && (indexFields.some(field => field.items.length !== 1)
      || authoredIndices.size !== 1 || ![...authoredIndices][0].trim())) {
      pushDiagnostic('signature-incomplete', 'Identity requires one nonempty index when an index is authored');
      pushNeutralFallback(primaryRelation.anchors || {}, true);
      return;
    }
    items.push({
      ...base,
      kind: 'coindex',
      nodeIds: occurrenceIds,
      index: indexFields.length ? [...authoredIndices][0]
        : dependencyIndexFor(stableChainKey('identity', nodes, occurrenceIds))
    });
    return;
  },
  'coindex': (context) => {
    const { anchors, base } = context.claim;
    const { requireResolved, items, dependencyIndexFor } = context.output;
    const { nodes } = context.workspace;
    const nodeIds = Object.values(anchors)
      .flatMap(flattenAnchorIds)
      .filter((nodeId, index, all) => all.indexOf(nodeId) === index)
      .filter((nodeId) => requireResolved('anchors', nodeId));
    if (nodeIds.length < 2) return;
    items.push({
      ...base,
      kind: 'coindex',
      nodeIds,
      index: dependencyIndexFor(stableChainKey('coindex', nodes, nodeIds))
    });
    return;
  },
  'control': (context) => {
    const { anchors, base } = context.claim;
    const { requireResolved, dependencyIndexFor, items } = context.output;
    const { nodes } = context.workspace;
    const controller = flattenAnchorIds(anchors.controller)[0];
    const controllee = flattenAnchorIds(anchors.controllee)[0];
    const domain = flattenAnchorIds(anchors.domain)[0];
    if (!requireResolved('controller', controller)) return;
    if (!requireResolved('controllee', controllee)) return;
    if (!requireResolved('domain', domain)) return;
    const index = dependencyIndexFor(stableChainKey('control', nodes, [controller, controllee]));
    items.push({
      ...base,
      kind: 'domain-mark',
      rootNodeId: domain,
      memberNodeIds: collectSubtreeIds(nodes.get(domain)),
      subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
      domainStyle: 'control-domain'
    });
    items.push({
      ...base,
      kind: 'directed-path',
      fromNodeId: controller,
      toNodeId: controllee,
      pathStyle: 'control'
    });
    items.push({ ...base, kind: 'coindex', nodeIds: [controller, controllee], index });
    return;
  },
  'split-antecedence': (context) => {
    const { resolvedIds, requireResolved, items } = context.output;
    const { anchors, base } = context.claim;
    const antecedents = resolvedIds('antecedents', anchors.antecedents);
    const dependent = flattenAnchorIds(anchors.dependent)[0];
    if (antecedents.length < 2 || !requireResolved('dependent', dependent)) return;
    items.push({
      ...base,
      kind: 'split-antecedence',
      antecedentNodeIds: antecedents,
      dependentNodeId: dependent
    });
    return;
  },
  'parasitic-gap': (context) => {
    const { anchors, base, values, family } = context.claim;
    const { resolvedIds, requireResolved, pushDiagnostic, items } = context.output;
    const { nodes } = context.workspace;
    const filler = flattenAnchorIds(anchors.filler || anchors.operator)[0];
    const realGap = flattenAnchorIds(anchors.realGap || anchors.gap)[0];
    const witness = flattenAnchorIds(anchors.traceWitness || anchors.lowerWitness)[0];
    const primaryPath = resolvedIds('primaryPath', anchors.primaryPath);
    const secondaryPath = resolvedIds('secondaryPath', anchors.secondaryPath);
    const parasitic = [
      ...flattenAnchorIds(anchors.parasiticGaps),
      ...flattenAnchorIds(anchors.parasiticGap)
    ].filter((nodeId, index, all) => all.indexOf(nodeId) === index);
    const fillerResolved = Boolean(filler && requireResolved('filler', filler));
    const realGapResolved = Boolean(realGap && requireResolved('realGap', realGap));
    const witnessResolved = Boolean(witness && requireResolved('traceWitness', witness));
    const resolvedParasitic = parasitic
      .filter((nodeId) => requireResolved('parasiticGap', nodeId));
    const parasiticFacetResolved = parasitic.length > 0
      && resolvedParasitic.length === parasitic.length;
    const movementFacetAuthored = Boolean(filler || realGap || witness);

    if (movementFacetAuthored) {
      if (!filler || !realGap) {
        pushDiagnostic(
          'endpoint-missing',
          'the ordinary parasitic-gap movement path requires one real gap and one filler'
        );
      } else if (fillerResolved && realGapResolved) {
        if (!witness) {
          pushDiagnostic(
            'witness-missing',
            'the ordinary parasitic-gap movement path requires an authored trace witness'
          );
        } else if (witnessResolved) {
          const realGapSubtree = collectSubtreeIds(nodes.get(realGap));
          if (!realGapSubtree.includes(witness)) {
            pushDiagnostic(
              'witness-outside-source',
              `traceWitness -> ${witness} is not inside realGap -> ${realGap}`
            );
          } else {
            items.push({
              ...base,
              kind: 'trajectory',
              trajectoryKind: 'parasitic-gap',
              sourceNodeId: realGap,
              targetNodeId: filler,
              witnessNodeId: witness,
              sourceAttachment: primaryPath.length > 0 || secondaryPath.length > 0
                ? 'terminal'
                : 'shell-bottom',
              targetAttachment: 'shell-bottom'
            });
          }
        }
      }
    }

    const usesPhillipsPathStatus = primaryPath.length > 0 || secondaryPath.length > 0;
    const drawsCopyFork = fillerResolved
      && realGapResolved
      && parasiticFacetResolved
      && !usesPhillipsPathStatus;
    if (drawsCopyFork) {
      items.push({
        ...base,
        kind: 'parasitic-gap-copy',
        contentNodeId: filler,
        ordinaryGapNodeId: realGap,
        parasiticGapNodeIds: resolvedParasitic
      });
    }

    const index = scalarValue(values, 'index') || 'i';
    const pushGapNotation = () => {
      const subscript = asSubscript(index);
      items.push({
        ...base,
        kind: 'node-badges',
        badgeStyle: 'gap-notation',
        badges: resolvedParasitic.map((nodeId) => ({
          nodeId,
          text: `pg${subscript}`,
          shape: 'plain' as const
        }))
      });
    };

    if (
      fillerResolved
      && realGapResolved
      && parasiticFacetResolved
      && usesPhillipsPathStatus
    ) {
      items.push({ ...base, kind: 'coindex', nodeIds: [filler], index });
    }
    if (parasiticFacetResolved && !drawsCopyFork) {
      pushGapNotation();
    }

    // The composition owns its path arrays outright, so every authored
    // path node renders even when only one of the two paths is present.
    // Phillips figure 4, plate-exact: circles enclose the primary path's
    // node labels, squares the secondary path's, and the blocked
    // finite-relative-clause edge takes the double slash.
    if (usesPhillipsPathStatus) {
      const blockedEdge = flattenAnchorIds(anchors.blockedEdge)[0];
      const resolvedBlockedEdge = blockedEdge && requireResolved('blockedEdge', blockedEdge)
        ? blockedEdge
        : '';
      const pathOutcomeRaw = scalarValue(values, 'outcome');
      const pathOutcome = recognizedOutcome(
        pathOutcomeRaw,
        family,
        LICENSED_OR_BLOCKED_OUTCOME_STATES
      );
      if (pathOutcomeRaw && !pathOutcome) {
        pushDiagnostic(
          'value-unrecognized',
          `outcome -> "${pathOutcomeRaw}" is not a recognized path-status judgment`
        );
      }
      items.push({
        ...base,
        kind: 'path-status',
        primaryNodeIds: primaryPath,
        secondaryNodeIds: secondaryPath,
        ...(resolvedBlockedEdge ? { blockedEdgeNodeId: resolvedBlockedEdge } : {}),
        ...(pathOutcome ? { outcome: pathOutcome } : {})
      });
    }
    return;
  },
  'qr': (context) => {
    const { anchors, base } = context.claim;
    const { requireResolved, items, pushDiagnostic, dependencyIndexFor } = context.output;
    const { nodes } = context.workspace;
    const ellipsisSite = flattenAnchorIds(anchors.site)[0];
    if (ellipsisSite) {
      const antecedent = flattenAnchorIds(anchors.antecedent)[0];
      if (!requireResolved('site', ellipsisSite)) return;
      if (antecedent && !requireResolved('antecedent', antecedent)) return;
      items.push({
        ...base,
        kind: 'ellipsis-site',
        siteNodeId: ellipsisSite,
        ...(antecedent ? {
          antecedentNodeId: antecedent,
          antecedentSubtreeNodeIds: collectSubtreeIds(nodes.get(antecedent))
        } : {}),
        ghostNodeIds: collectAuthoredSilentSubtreeIds(nodes.get(ellipsisSite)),
        siteSubtreeNodeIds: collectSubtreeIds(nodes.get(ellipsisSite)),
        subtreeDerived: [
          { field: 'ghostNodeIds', rootNodeId: ellipsisSite, mode: 'authored-silent' },
          { field: 'siteSubtreeNodeIds', rootNodeId: ellipsisSite, mode: 'all' },
          ...(antecedent
            ? [{ field: 'antecedentSubtreeNodeIds', rootNodeId: antecedent, mode: 'all' as const }]
            : [])
        ]
      });
      return;
    }
    const pronounced = firstRole(anchors, ['pronouncedQP', 'source']);
    const lf = firstRole(anchors, ['lfQP', 'target']);
    if (!pronounced || !lf) {
      pushDiagnostic('endpoint-missing', 'QuantifierRaising requires pronounced and LF occurrence anchors');
      return;
    }
    if (!requireResolved(pronounced.role, pronounced.nodeId)) return;
    if (!requireResolved(lf.role, lf.nodeId)) return;
    const scopeDomain = flattenAnchorIds(anchors.scopeDomain || anchors.domain)[0];
    if (scopeDomain && !requireResolved('scopeDomain', scopeDomain)) return;
    items.push({
      ...base,
      kind: 'quantifier-raising',
      pronouncedNodeId: pronounced.nodeId,
      lfNodeId: lf.nodeId,
      ...(scopeDomain ? { scopeDomainNodeId: scopeDomain } : {}),
      index: dependencyIndexFor(stableChainKey('qr', nodes, [pronounced.nodeId, lf.nodeId]))
    });
    return;
  },
  'lf-reconstruction': (context) => {
    const { anchors, base } = context.claim;
    const { requireResolved, items } = context.output;
    const { nodes } = context.workspace;
    const neglected = flattenAnchorIds(anchors.neglectedCopy)[0];
    const interpreted = flattenAnchorIds(anchors.interpretedCopy)[0];
    if (!requireResolved('neglectedCopy', neglected)) return;
    if (!requireResolved('interpretedCopy', interpreted)) return;
    // The sourced convention links the copies by shared subscript alone:
    // strike/ghost on the neglected copy, retained interpreted copy, and
    // no connector of any kind.
    items.push({
      ...base,
      kind: 'strike-ghost',
      strikeNodeIds: [neglected],
      ghostNodeIds: collectSubtreeIds(nodes.get(neglected)),
      subtreeDerived: [{ field: 'ghostNodeIds', rootNodeId: neglected, mode: 'all' }]
    });
    items.push({
      ...base,
      kind: 'coindex',
      nodeIds: [neglected, interpreted],
      index: 'i'
    });
    return;
  }
} satisfies Partial<RegisteredPlanCompilers>;

export const movementFacetPlan = {
  'movement.path': (context: FacetPlanContext) => {
    const { one, facet, push, base, evidence, state, nodes } = context;
    const source = one('movement.source');
    const witness = one('movement.witness');
    const landing = one('movement.landing');
    const pieces = facet.evaluation.outputs.filter((piece) => [
      'Movement curve', 'Orthogonal movement', 'Cross-workspace crest', 'Path states'
    ].includes(piece));
    const crossWorkspace = pieces.includes('Cross-workspace crest');
    const orthogonal = pieces.includes('Orthogonal movement');
    push({
      ...base(facet, pieces, 'tier2.movement-path'),
      kind: 'trajectory',
      trajectoryKind: crossWorkspace ? 'sideward' : orthogonal ? 'roll-up' : evidence.movement?.trajectoryKind || 'phrasal',
      sourceNodeId: source,
      targetNodeId: landing,
      witnessNodeId: witness,
      ...(state === 'licensed' || state === 'blocked' ? { outcome: state } : {}),
      sourceAttachment: crossWorkspace
        ? 'shell-top'
        : structuralLeafCount(nodes.get(source)) > 1 || isWordlessCategoryLeaf(nodes.get(source)!) ? 'shell-bottom' : 'terminal',
      targetAttachment: crossWorkspace ? 'shell-top'
        : evidence.movement?.trajectoryKind === 'head' ? headTrajectoryAttachment(nodes.get(landing)!) : 'shell-bottom'
    });
    return;
  },
  'movement.carrier': (context: FacetPlanContext) => {
    const { push, base, facet, one, state } = context;
    push({
      ...base(facet, ['Carrier arrow'], 'tier2.movement-carrier'),
      kind: 'trajectory',
      trajectoryKind: 'smuggling',
      sourceNodeId: one('movement.source'),
      targetNodeId: one('movement.landing'),
      witnessNodeId: one('movement.witness'),
      ...(state === 'licensed' || state === 'blocked' ? { outcome: state } : {}),
      sourceAttachment: 'shell-bottom',
      targetAttachment: 'shell-bottom'
    });
    return;
  },
  'gap.notation': (context: FacetPlanContext) => {
    const { evidence, push, base, facet, many, nodes } = context;
    const indices = pairedLiterals(evidence, 'gap', 'index') ?? [];
    const labels = pairedLiterals(evidence, 'gap', 'label') ?? [];
    push({
      ...base(facet, ['Gap label'], 'tier2.gap-notation'),
      kind: 'node-badges',
      badgeStyle: 'gap-notation',
      badges: many('gap').map((nodeId, index) => ({
        nodeId,
        text: labels[index]?.trim() ? labels[index]
          : gapBadgeText(String(nodes.get(nodeId)?.word || nodes.get(nodeId)?.label || ''), indices[index]), shape: 'plain'
      }))
    });
    return;
  },
  'identity.occurrences': (context: FacetPlanContext) => {
    const { push, base, facet, many, evidence, identityIndexFor, dependencyIndexFor, dependencyKey } = context;
    push({
      ...base(facet, ['Coindex', 'Forest light'], 'identity.occurrences'),
      kind: 'coindex',
      nodeIds: many('occurrences'),
      index: singleValue(evidence, 'index', identityIndexFor?.(many('occurrences'))
        ?? dependencyIndexFor(dependencyKey('identity', many('occurrences'))))
    });
    return;
  },
  'coreference.coindex': (context: FacetPlanContext) => {
    const { push, base, facet, many, evidence, dependencyIndexFor, dependencyKey } = context;
    push({
      ...base(facet, ['Coindex'], 'coreference.coindex'),
      kind: 'coindex',
      nodeIds: many('coreference.participants'),
      index: singleValue(evidence, 'index', dependencyIndexFor(dependencyKey('coreference', many('coreference.participants'))))
    });
    return;
  },
  'presentation.lens': (context: FacetPlanContext) => {
    const { push, base, facet, many } = context;
    push({
      ...base(facet, ['Lens emphasis'], 'identity.occurrences'),
      kind: 'coindex',
      nodeIds: many('facet.anchors'),
      index: ''
    });
    return;
  },
  'control.dependency': (context: FacetPlanContext) => {
    const { one, push, base, facet, nodes, evidence, occurrenceIndexFor } = context;
    const domain = one('domain');
    if (domain) push({
      ...base(facet, ['Rectangular domain'], 'control.dependency', 'domain'),
      kind: 'domain-mark',
      rootNodeId: domain,
      memberNodeIds: collectSubtreeIds(nodes.get(domain)),
      subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
      domainStyle: 'control-domain'
    });
    push({
      ...base(facet, ['Control connector'], 'control.dependency', 'connector'),
      kind: 'directed-path',
      fromNodeId: one('controller'),
      toNodeId: one('controllee'),
      pathStyle: 'control'
    });
    const participants = [one('controller'), one('controllee')];
    push({
      ...base(facet, ['Coindex'], 'control.dependency', 'indices'),
      kind: 'coindex',
      nodeIds: participants,
      index: singleValue(evidence, 'index') || occurrenceIndexFor('control', participants)
    });
    return;
  },
  'parasitic-gap.paths': (context: FacetPlanContext) => {
    const { push, base, facet, many, state } = context;
    push({
      ...base(facet, ['Path-node rings'], 'parasitic-gap.composition'),
      kind: 'path-status',
      primaryNodeIds: many('primary.path'),
      secondaryNodeIds: many('secondary.path'),
      ...(state === 'licensed' || state === 'blocked' ? { outcome: state } : {})
    });
    return;
  },
  'parasitic-gap.copy': (context: FacetPlanContext) => {
    const { push, base, facet, one, many } = context;
    push({
      ...base(facet, ['Copy fork'], 'parasitic-gap.composition'),
      kind: 'parasitic-gap-copy',
      contentNodeId: one('filler'),
      ordinaryGapNodeId: one('ordinary.gap'),
      parasiticGapNodeIds: many('parasitic.gap')
    });
    return;
  },
  'scope.movement': (context: FacetPlanContext) => {
    const { push, base, facet, one, evidence, occurrenceIndexFor } = context;
    push({
      ...base(facet, ['Covert path', 'Scope domain'], 'qr.covert'),
      kind: 'quantifier-raising',
      pronouncedNodeId: one('scope.source'),
      lfNodeId: one('scope.landing'),
      ...(one('scope.domain') ? { scopeDomainNodeId: one('scope.domain') } : {}),
      index: singleValue(evidence, 'index') || occurrenceIndexFor('qr', [one('scope.source'), one('scope.landing')])
    });
    return;
  },
  'operator-binding': (context: FacetPlanContext) => {
    const { one, push, base, facet, nodes, evidence, dependencyIndexFor, dependencyKey } = context;
    const domain = one('scope.domain');
    push({
      ...base(facet, ['Ranked scope hulls', 'Variable-binding path'], 'scope.operator-variable'),
      kind: 'operator-variable-binding',
      operatorNodeId: one('operator'),
      variableNodeId: one('variable'),
      ...(domain ? {
        scopeDomainNodeId: domain,
        scopeMemberNodeIds: collectSubtreeIds(nodes.get(domain)),
        subtreeDerived: [{ field: 'scopeMemberNodeIds' as const, rootNodeId: domain, mode: 'all' as const }]
      } : {}),
      index: singleValue(evidence, 'index', dependencyIndexFor(dependencyKey('operator-variable', [one('operator'), one('variable')])))
    });
    return;
  }
} satisfies Partial<FacetPlanCompilers>;

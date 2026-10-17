import { nativeThetaAssignments } from './compoundAssignments.ts';
import type { FacetPlanCompilers, FacetPlanContext } from './facetPlanContext.ts';
import { collectionAssignment } from './featureComposition.ts';
import { prepareNativeDependentCaseStep } from './nativeDrawingContent.ts';
import { authoredPathOutcome } from './outcomeResolver.ts';
import { collectSubtreeLeafIds, flattenAnchorIds } from './planSyntax.ts';
import { scalarValue, verbatimRows } from './planValues.ts';
import type { RegisteredPlanCompilers } from './registeredPlanContext.ts';
import { buildTier2FacetEvidence } from './relationEvidence.ts';
import {
  planItemsShareAuthoredStage,
  type DirectedPathPlanItem,
  type NodeBadgesPlanItem,
  type NodePlaquePlanItem
} from './renderPlan.ts';
import { literalThetaRoles, pairedLiterals } from './tier2EvidenceQueries.ts';
import { featureDependencyRows, singleValue, valueItems } from './tier2PlanValues.ts';

export const featurePlan = {
  'feature-plaque': (context) => {
    const { anchors, values, familyId, relationIndex, base, claimDispatch } = context.claim;
    const { pushDiagnostic, requireResolved, afterCaseCoalescence, items, pushNeutralFallback } = context.output;
    const { caseAgreementRow } = context.lookup;
    const { stageIndex, nodes } = context.workspace;
    const anchorEntries = Object.entries(anchors);
    if (anchorEntries.length === 0) {
      pushDiagnostic('endpoint-missing', 'a feature plaque needs at least one participant anchor');
      return;
    }
    const [role, value] = anchorEntries[0];
    const participant = flattenAnchorIds(value)[0];
    if (!requireResolved(role, participant)) return;
    const rows = verbatimRows(values);
    if (familyId === 'agree.plaque') {
      const probe = flattenAnchorIds(anchors.probe)[0];
      const goal = flattenAnchorIds(anchors.goal)[0];
      const collectionRow = caseAgreementRow(stageIndex, relationIndex);
      let standalone: NodePlaquePlanItem | NodeBadgesPlanItem | undefined;
      afterCaseCoalescence(caseItems => {
        if (!standalone || !nodes.has(goal)) return;
        const path: DirectedPathPlanItem = {
          ...base,
          kind: 'directed-path',
          fromNodeId: probe,
          toNodeId: goal,
          pathStyle: 'case-agree'
        };
        // All Case claims have lowered before this check. Their exact
        // endpoints and ownership, not relation names, prove composition.
        const uniqueAssignment = collectionAssignment(caseItems, path) !== undefined;
        const existingBearerCollection = collectionRow !== undefined && caseItems.some(item =>
          item.kind === 'directed-path' && item.pathStyle === 'case-assignment'
          && planItemsShareAuthoredStage(item, path) && item.toNodeId === probe);
        const collectionRows = collectionRow && (uniqueAssignment || existingBearerCollection)
          ? [collectionRow]
          : uniqueAssignment ? featureDependencyRows(claimDispatch.evidence) : [];
        if (!collectionRows.length) return;
        if (standalone.kind === 'node-plaque') {
          if (collectionRow) standalone.rows = [collectionRow];
          delete standalone.title;
        } else {
          items.splice(items.indexOf(standalone), 1);
        }
        collectionRows.forEach(row => items.push({
          ...path,
          featureRow: row,
          ...(collectionRow && (row.label || row.value)
            ? { label: [row.label, row.value].filter(Boolean).join(': ') } : {})
        }));
      });
      if (rows.length > 0) {
        const plaqueNodeId = probe || participant;
        if (!requireResolved(probe ? 'probe' : role, plaqueNodeId)) return;
        standalone = {
          ...base,
          kind: 'node-plaque',
          anchorNodeIds: [plaqueNodeId],
          positionNodeIds: collectSubtreeLeafIds(nodes.get(plaqueNodeId)),
          plaqueStyle: 'feature',
          title: [String(nodes.get(plaqueNodeId)?.label || plaqueNodeId), probe ? 'probe' : role]
            .filter(Boolean)
            .join(' '),
          anchorDerivedTitle: true,
          rows
        };
        items.push(standalone);
        return;
      }
      if (!requireResolved('goal', goal)) return;
      standalone = {
        ...base,
        kind: 'node-badges',
        badgeStyle: 'agreement-goal',
        badges: [{ nodeId: goal, text: '', shape: 'plain' }]
      };
      items.push(standalone);
      return;
    }
    /*
     * The plaque exists to show authored feature rows (the accepted
     * Agree/FeatureBundle convention authors the rows on FeatureBundle,
     * with Agree often carrying only probe/goal). An instance with no
     * authored values draws no plaque — an empty box would be an
     * invented claim — and its resolved participants instead keep the
     * neutral topology-only presentation so the authored relation stays
     * visible without invented connector semantics. Its generated heading
     * describes the bearer; its rows retain authored labels and values.
     */
    if (rows.length === 0) {
      pushNeutralFallback(anchors, false);
      return;
    }
    items.push({
      ...base,
      kind: 'node-plaque',
      anchorNodeIds: [participant],
      positionNodeIds: collectSubtreeLeafIds(nodes.get(participant)),
      plaqueStyle: 'feature',
      title: [String(nodes.get(participant)?.label || participant), role]
        .filter(Boolean)
        .join(' '),
      anchorDerivedTitle: true,
      rows
    });
    return;
  },
  'agreement-paths': (context) => {
    const { anchors, family, base, values } = context.claim;
    const { requireResolved, items } = context.output;
    const probe = flattenAnchorIds(anchors.probe)[0];
    if (!requireResolved('probe', probe)) return;
    if (family.agreementMode === 'multiple') {
      const goals = [
        ...flattenAnchorIds(anchors.goals),
        ...flattenAnchorIds(anchors.goal)
      ].filter((nodeId) => requireResolved('goals', nodeId));
      if (goals.length === 0) return;
      goals.forEach((goal) => {
        items.push({
          ...base,
          kind: 'directed-path',
          fromNodeId: probe,
          toNodeId: goal,
          pathStyle: 'agree-multiple',
          ...(scalarValue(values, 'outcome') ? { label: scalarValue(values, 'outcome') } : {})
        });
      });
      return;
    }
    const goal = flattenAnchorIds(anchors.goal || anchors.searchDomain)[0];
    if (!requireResolved('goal', goal)) return;
    // The cycle numeral is an authored claim; a relation's position in
    // the stage's relation list is not evidence of its cycle number, so
    // an unauthored cycle draws the path with no numeral at all.
    items.push({
      ...base,
      kind: 'directed-path',
      fromNodeId: probe,
      toNodeId: goal,
      pathStyle: 'agree-cyclic',
      ...(scalarValue(values, 'cycle') ? { label: scalarValue(values, 'cycle') } : {}),
      ...(scalarValue(values, 'outcome') ? { secondaryLabel: scalarValue(values, 'outcome') } : {})
    });
    return;
  },
  'feature-sharing': (context) => {
    const { resolvedIds, items } = context.output;
    const { anchors, base, values } = context.claim;
    const bearers = resolvedIds('bearers', anchors.bearers);
    if (bearers.length < 2) return;
    items.push({
      ...base,
      kind: 'undirected-link',
      pairs: bearers.slice(0, -1).map((bearer, index) => ({
        fromNodeId: bearer,
        toNodeId: bearers[index + 1]
      })),
      linkStyle: 'feature-sharing',
      ...(scalarValue(values, 'feature') || scalarValue(values, 'value')
        ? { label: [scalarValue(values, 'feature'), scalarValue(values, 'value')].filter(Boolean).join(': ') }
        : {})
    });
    return;
  },
  'case-assignment': (context) => {
    const { anchors, base, values, authoredValues } = context.claim;
    const { requireResolved, items } = context.output;
    const { nodes } = context.workspace;
    const outcome = authoredPathOutcome(authoredValues);
    const assigner = flattenAnchorIds(anchors.assigner)[0];
    const bearer = flattenAnchorIds(anchors.bearer)[0];
    const probe = flattenAnchorIds(anchors.probe)[0];
    const goal = flattenAnchorIds(anchors.goal)[0];
    if (!assigner && probe && goal) {
      if (!requireResolved('probe', probe)) return;
      if (!requireResolved('goal', goal)) return;
      items.push({
        ...base,
        kind: 'directed-path',
        fromNodeId: probe,
        toNodeId: goal,
        pathStyle: 'case-agree',
        ...(outcome ? { outcome } : {}),
        featureRow: { label: scalarValue(values, 'feature'), value: scalarValue(values, 'value') },
        ...(scalarValue(values, 'feature') || scalarValue(values, 'value')
          ? { label: [scalarValue(values, 'feature'), scalarValue(values, 'value')].filter(Boolean).join(': ') }
          : {})
      });
      return;
    }
    if (!assigner && bearer && verbatimRows(values).length > 0) {
      if (!requireResolved('bearer', bearer)) return;
      items.push({
        ...base,
        kind: 'node-plaque',
        anchorNodeIds: [bearer],
        positionNodeIds: collectSubtreeLeafIds(nodes.get(bearer)),
        plaqueStyle: 'feature',
        title: String(nodes.get(bearer)?.label || bearer),
        rows: verbatimRows(authoredValues)
      });
      return;
    }
    if (!requireResolved('assigner', assigner)) return;
    if (!requireResolved('bearer', bearer)) return;
    items.push({
      ...base,
      kind: 'directed-path',
      fromNodeId: assigner,
      toNodeId: bearer,
      pathStyle: 'case-assignment',
      ...(outcome ? { outcome } : {}),
      featureRow: { label: scalarValue(values, 'feature'), value: scalarValue(values, 'value') || scalarValue(values, 'case') },
      ...(scalarValue(values, 'feature') || scalarValue(values, 'value')
        ? { label: [scalarValue(values, 'feature'), scalarValue(values, 'value')].filter(Boolean).join(': ') }
        : {})
    });
    return;
  },
  'dependent-case': (context) => {
    const { anchors, values, base } = context.claim;
    const { requireResolved, pushDiagnostic, pushNeutralFallback, items } = context.output;
    const probe = flattenAnchorIds(anchors.probe)[0];
    const goal = flattenAnchorIds(anchors.goal)[0];
    if (!requireResolved('probe', probe)) return;
    if (!requireResolved('goal', goal)) return;
    const dependentCaseStep = prepareNativeDependentCaseStep(values?.step);
    if (values?.step !== undefined && dependentCaseStep === undefined) {
      pushDiagnostic('illegal-configuration', 'DependentCase requires one explicit step value of 1 or 2; unknown, multiple or empty steps are not a native mode');
      pushNeutralFallback(anchors, false);
      return;
    }
    items.push({
      ...base,
      kind: 'directed-path',
      fromNodeId: probe,
      toNodeId: goal,
      pathStyle: 'dependent-case',
      ...(dependentCaseStep ? { dependentCaseStep } : {}),
      ...(scalarValue(values, 'probeLabel') ? { label: scalarValue(values, 'probeLabel') } : {}),
      ...(scalarValue(values, 'goalLabel') ? { secondaryLabel: scalarValue(values, 'goalLabel') } : {})
    });
    return;
  },
  'accord': (context) => {
    const { anchors, base, values } = context.claim;
    const { requireResolved, items } = context.output;
    const source = flattenAnchorIds(anchors.source)[0];
    const goal = flattenAnchorIds(anchors.goal)[0];
    if (!requireResolved('source', source)) return;
    if (!requireResolved('goal', goal)) return;
    items.push({
      ...base,
      kind: 'directed-path',
      fromNodeId: source,
      toNodeId: goal,
      pathStyle: 'accord',
      featureRow: { label: scalarValue(values, 'feature'), value: scalarValue(values, 'value') },
      ...(scalarValue(values, 'index') ? { secondaryLabel: scalarValue(values, 'index') } : {}),
      ...(scalarValue(values, 'feature') || scalarValue(values, 'index') || scalarValue(values, 'value')
        ? { label: `${scalarValue(values, 'feature')}${scalarValue(values, 'index')}${scalarValue(values, 'value') ? `: ${scalarValue(values, 'value')}` : ''}` }
        : {})
    });
    return;
  },
  'theta-grid': (context) => {
    const { anchors, claimDispatch, primaryRelation, base } = context.claim;
    const { pushCompositeTrajectory, pushDiagnostic, pushNeutralFallback, requireResolved, items } = context.output;
    const { stage } = context.workspace;
    if (anchors.traceWitness && pushCompositeTrajectory('phrasal')) return;
    const evidence = buildTier2FacetEvidence({ relation: claimDispatch.boundPrimaryRelation, currentForest: stage.workspaceForest || [] });
    const { assignments, error } = nativeThetaAssignments(evidence);
    if (!assignments) {
      pushDiagnostic('illegal-configuration', error || 'Incomplete theta assignment');
      pushNeutralFallback(primaryRelation.anchors, false);
      return;
    }
    for (const { predicate, roles } of assignments) {
      if (!requireResolved('predicate', predicate) || roles.some(({ nodeId }) => !requireResolved('argument', nodeId))) continue;
      const owner = { ...base, ...(assignments.length > 1 ? { tier2ClaimIdentity: `theta:${predicate}` } : {}) };
      items.push({
        ...owner, kind: 'node-plaque', anchorNodeIds: [predicate],
        plaqueStyle: 'theta-grid', thetaRoles: roles, rows: roles.map(({ label }) => ({ label, value: '' }))
      });
      items.push({
        ...owner, kind: 'node-badges', badgeStyle: 'theta-role',
        badges: roles.map(({ nodeId }, index) => ({ nodeId, text: String(index + 1), shape: 'plain' as const }))
      });
    }
    return;
  }
} satisfies Partial<RegisteredPlanCompilers>;

export const featureFacetPlan = {
  'plaque.structured': (context: FacetPlanContext) => {
    const { push, base, facet, many, rows } = context;
    push({
      ...base(facet, ['Plaque shell'], 'feature-bundle.plaque'),
      kind: 'node-plaque',
      anchorNodeIds: many('plaque.anchor'),
      plaqueStyle: 'feature',
      rows
    });
    return;
  },
  'feature-sharing': (context: FacetPlanContext) => {
    const { many, evidence, push, base, facet } = context;
    const bearers = many('feature.bearers');
    const featureEntries = evidence.authoredValues?.filter(entry => entry.concepts.includes('feature.rows')) ?? [];
    const label = featureEntries.length
      ? featureEntries.map(entry => `${entry.key}: ${entry.items.join(', ')}`).join('; ')
      : valueItems(evidence, 'feature.rows').join(', ');
    push({
      ...base(facet, ['Feature vine'], 'feature-sharing.vines'),
      kind: 'undirected-link',
      pairs: bearers.slice(0, -1).map((fromNodeId, index) => ({
        fromNodeId,
        toNodeId: bearers[index + 1]
      })),
      linkStyle: 'feature-sharing',
      ...(label ? { label } : {})
    });
    return;
  },
  'agreement.cycle': (context: FacetPlanContext) => {
    const { many, push, base, facet, one, evidence } = context;
    many('goal').forEach((goal, index) => {
      push({
        ...base(facet, ['Cycle badge'], 'cyclic-agree.paths', `goal:${index}`),
        kind: 'directed-path',
        fromNodeId: one('probe'),
        toNodeId: goal,
        pathStyle: 'agree-cyclic',
        label: singleValue(evidence, 'cycle'),
        ...(singleValue(evidence, 'outcome') ? { secondaryLabel: singleValue(evidence, 'outcome') } : {})
      });
    });
    return;
  },
  'feature.dependency': (context: FacetPlanContext) => {
    const { evidence, rows, push, base, facet, one, many, state } = context;
    const caseLabels = pairedLiterals(evidence, 'feature.target', 'case.literal') ?? [];
    const featureRows = featureDependencyRows(evidence, rows);
    if (featureRows.length) {
      push({
        ...base(facet, ['Feature connectors'], 'feature-bundle.plaque', 'values'),
        kind: 'node-plaque',
        anchorNodeIds: [one('feature.source')],
        plaqueStyle: 'feature',
        rows: featureRows
      });
    }
    many('feature.target').forEach((target, index) => {
      const path = {
        kind: 'directed-path' as const,
        fromNodeId: one('feature.source'),
        toNodeId: target,
        ...(state === 'licensed' || state === 'blocked' ? { outcome: state } : {})
      };
      if (caseLabels.length) push({
        ...base(facet, ['Feature connectors'], 'tier2.feature-dependency', `target:${index}`),
        ...path, pathStyle: 'case-assignment', label: caseLabels[index]
      });
      featureRows.forEach((row, rowIndex) => push({
        ...base(facet, ['Feature connectors'], 'tier2.feature-dependency', `target:${index}:row:${rowIndex}`),
        ...path, pathStyle: 'case-agree', featureRow: row
      }));
      if (!caseLabels.length && !featureRows.length) push({
        ...base(facet, ['Feature connectors'], 'tier2.feature-dependency', `target:${index}`),
        ...path, pathStyle: 'case-agree'
      });
    });
    return;
  },
  'dependent-case': (context: FacetPlanContext) => {
    const { push, base, facet, one, rows, evidence } = context;
    push({
      ...base(facet, ['Dependent-case elbow'], 'dependent-case.elbow'),
      kind: 'directed-path',
      fromNodeId: one('probe'),
      toNodeId: one('goal'),
      pathStyle: 'dependent-case',
      label: rows.filter(row => evidence.authoredValues?.some(entry => entry.key === row.label
        && entry.concepts.includes('feature.rows'))).map(row => row.value).join(', '),
      ...(valueItems(evidence, 'step').length ? { dependentCaseStep: prepareNativeDependentCaseStep(valueItems(evidence, 'step')) } : {})
    });
    return;
  },
  'accord': (context: FacetPlanContext) => {
    const { push, base, facet, one, evidence, rows } = context;
    push({
      ...base(facet, ['Accord connector', 'Boxed index'], 'accord.link'),
      kind: 'directed-path',
      fromNodeId: one('feature.source'),
      toNodeId: one('goal'),
      pathStyle: 'accord',
      label: singleValue(evidence, 'index'),
      secondaryLabel: singleValue(evidence, 'index'),
      featureRow: rows.find(row => valueItems(evidence, 'feature.rows').includes(row.value))
    });
    return;
  },
  'theta-grid': (context: FacetPlanContext) => {
    const { many, evidence, push, base, facet, one } = context;
    const args = many('theta.arguments');
    const thetaRoles = literalThetaRoles(evidence);
    if (!thetaRoles) return;
    push({
      ...base(facet, ['Role grid'], 'theta.grid', 'grid'),
      kind: 'node-plaque',
      anchorNodeIds: [one('predicate')],
      plaqueStyle: 'theta-grid',
      rows: thetaRoles.map(({ label }) => ({ label, value: '' })),
      thetaRoles
    });
    push({
      ...base(facet, ['Role grid'], 'theta.grid', 'badges'),
      kind: 'node-badges',
      badgeStyle: 'theta-role',
      badges: args.map((nodeId, index) => ({
        nodeId,
        text: String(index + 1),
        shape: 'plain'
      }))
    });
    return;
  }
} satisfies Partial<FacetPlanCompilers>;

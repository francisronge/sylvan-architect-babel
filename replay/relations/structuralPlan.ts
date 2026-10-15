import type { FacetPlanCompilers, FacetPlanContext } from './facetPlanContext.ts';
import { isNativeProjectionPath, nativeAncestorEdges, prepareNativePlaqueContent } from './nativeDrawingContent.ts';
import { collectSubtreeIds, flattenAnchorIds, stableChainKey } from './planSyntax.ts';
import {
  LICENSED_OR_FAILED_OUTCOME_STATES,
  listValue,
  recognizedOutcome,
  scalarValue,
  verbatimRows
} from './planValues.ts';
import type { RegisteredPlanCompilers } from './registeredPlanContext.ts';
import { tier2NativePlaqueRows } from './tier2EvidenceQueries.ts';
import { singleValue } from './tier2PlanValues.ts';

export const structuralPlan = {
  'predication': (context) => {
    const { anchors, base } = context.claim;
    const { requireResolved, items } = context.output;
    const predicand = flattenAnchorIds(anchors.predicand)[0];
    if (!requireResolved('predicand', predicand)) return;
    const predicates = [
      ...flattenAnchorIds(anchors.predicate),
      ...flattenAnchorIds(anchors.predicates)
    ].filter((nodeId) => requireResolved('predicate', nodeId));
    if (predicates.length === 0) return;
    items.push({
      ...base,
      kind: 'undirected-link',
      pairs: predicates.map((predicate) => ({ fromNodeId: predicand, toNodeId: predicate })),
      linkStyle: 'predication'
    });
    return;
  },
  'binding-domain': (context) => {
    const { anchors, values, family, base } = context.claim;
    const { requireResolved, pushDiagnostic, items, dependencyIndexFor } = context.output;
    const { nodes } = context.workspace;
    const binder = flattenAnchorIds(anchors.binder)[0];
    const bound = flattenAnchorIds(anchors.bound)[0];
    const domain = flattenAnchorIds(anchors.domain)[0];
    if (!requireResolved('binder', binder)) return;
    if (!requireResolved('bound', bound)) return;
    if (!requireResolved('domain', domain)) return;
    const bindingOutcomeRaw = scalarValue(values, 'outcome');
    const bindingOutcome = recognizedOutcome(
      bindingOutcomeRaw,
      family,
      LICENSED_OR_FAILED_OUTCOME_STATES
    );
    if (bindingOutcomeRaw && !bindingOutcome) {
      pushDiagnostic('value-unrecognized', `outcome -> "${bindingOutcomeRaw}" is not a recognized Binding judgment`);
    }
    items.push({
      ...base,
      kind: 'binding-domain',
      binderNodeId: binder,
      boundNodeId: bound,
      domainNodeId: domain,
      domainMemberNodeIds: collectSubtreeIds(nodes.get(domain)),
      subtreeDerived: [{ field: 'domainMemberNodeIds', rootNodeId: domain, mode: 'all' }],
      ...(bindingOutcome ? { outcome: bindingOutcome } : {}),
      index: dependencyIndexFor(stableChainKey('binding', nodes, [binder, bound]))
    });
    return;
  },
  'pair-merge': (context) => {
    const { anchors, base } = context.claim;
    const { requireResolved, items } = context.output;
    const member = flattenAnchorIds(anchors.pairMember || anchors.adjunct)[0];
    const host = flattenAnchorIds(anchors.host)[0];
    if (!requireResolved('pairMember', member)) return;
    if (!requireResolved('host', host)) return;
    items.push({
      ...base,
      kind: 'undirected-link',
      pairs: [{ fromNodeId: member, toNodeId: host }],
      linkStyle: 'pair-merge'
    });
    return;
  },
  'shared-node': (context) => {
    const { resolvedIds, requireResolved, items } = context.output;
    const { anchors, base } = context.claim;
    const parents = resolvedIds('parents', anchors.parents);
    const shared = flattenAnchorIds(anchors.shared)[0];
    if (parents.length < 2 || !requireResolved('shared', shared)) return;
    // The authored parent role is the claim. A tree-shaped serialization
    // need not already contain one of the extra dominance edges.
    items.push({ ...base, kind: 'shared-node', parentNodeIds: parents, sharedNodeId: shared });
    return;
  },
  'argument-sharing': (context) => {
    const { resolvedIds, requireResolved, items } = context.output;
    const { anchors, values, base } = context.claim;
    const { nodes } = context.workspace;
    const domains = resolvedIds('domains', anchors.domains);
    const shared = flattenAnchorIds(anchors.shared)[0];
    if (domains.length < 2 || !requireResolved('shared', shared)) return;
    const role = scalarValue(values, 'role').trim().toUpperCase() || 'ARG';
    domains.forEach((domain) => {
      items.push({
        ...base,
        kind: 'domain-mark',
        rootNodeId: domain,
        sharedNodeId: shared,
        memberNodeIds: collectSubtreeIds(nodes.get(domain)),
        subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
        domainStyle: 'argument-domain'
      });
    });
    items.push({
      ...base,
      kind: 'node-badges',
      badgeStyle: 'shared-object',
      badges: [{ nodeId: shared, text: role, shape: 'plain' }]
    });
    return;
  },
  'idiom-chunks': (context) => {
    const { anchors, base } = context.claim;
    const { requireResolved, items } = context.output;
    const { nodes } = context.workspace;
    const domainRole = Object.keys(anchors)
      .find((role) => ['domain', 'interpretationDomain'].includes(role));
    const domain = domainRole ? flattenAnchorIds(anchors[domainRole])[0] : '';
    const chunks = Object.entries(anchors)
      .filter(([role]) => role !== domainRole)
      .flatMap(([, value]) => flattenAnchorIds(value))
      .filter((nodeId, index, all) => all.indexOf(nodeId) === index)
      .filter((nodeId) => requireResolved('chunk', nodeId));
    if (!requireResolved('domain', domain) || chunks.length < 2) return;
    items.push({
      ...base,
      kind: 'domain-mark',
      rootNodeId: domain,
      memberNodeIds: collectSubtreeIds(nodes.get(domain)),
      subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
      domainStyle: 'idiom'
    });
    items.push({
      ...base,
      kind: 'node-badges',
      badgeStyle: 'idiom-chunk',
      badges: chunks.map((nodeId) => ({ nodeId, text: '', shape: 'plain' as const }))
    });
    return;
  },
  'cooper-storage': (context) => {
    const { anchors, values, primaryRelation, base, authoredValues } = context.claim;
    const { requireResolved, pushDiagnostic, pushNeutralFallback, items } = context.output;
    const scope = flattenAnchorIds(anchors.scope)[0];
    if (!requireResolved('scope', scope)) return;
    const nativeContent = prepareNativePlaqueContent('cooper-storage', verbatimRows(values), [scope]);
    if (!nativeContent) {
      pushDiagnostic('illegal-configuration', 'Native storage requires explicit category, qstore, or retrieved rows');
      pushNeutralFallback(primaryRelation.anchors, false);
      return;
    }
    items.push({
      ...base,
      kind: 'node-plaque',
      anchorNodeIds: [scope],
      plaqueStyle: 'cooper-storage',
      nativeContent,
      rows: verbatimRows(authoredValues)
    });
    return;
  },
  'strong-npi': (context) => {
    const { anchors, base, values } = context.claim;
    const { requireResolved, pushDiagnostic, items } = context.output;
    const licensor = flattenAnchorIds(anchors.licensor)[0];
    const npi = flattenAnchorIds(anchors.npi)[0];
    const focusOperator = flattenAnchorIds(anchors.focusOperator)[0];
    const focusAssociate = flattenAnchorIds(anchors.focusAssociate)[0];
    if (!requireResolved('licensor', licensor)) return;
    if (!requireResolved('npi', npi)) return;
    if (Boolean(focusOperator) !== Boolean(focusAssociate)) {
      pushDiagnostic('endpoint-missing', 'focusOperator and focusAssociate must be authored together');
      return;
    }
    if (focusOperator && !requireResolved('focusOperator', focusOperator)) return;
    if (focusAssociate && !requireResolved('focusAssociate', focusAssociate)) return;
    items.push({
      ...base,
      kind: 'undirected-link',
      pairs: [
        { fromNodeId: licensor, toNodeId: npi },
        ...(focusOperator && focusAssociate
          ? [{ fromNodeId: focusOperator, toNodeId: focusAssociate }]
          : [])
      ],
      linkStyle: 'strong-npi',
      ...(scalarValue(values, 'feature') ? { label: scalarValue(values, 'feature') } : {})
    });
    return;
  },
  'focus-prominence': (context) => {
    const { anchors, primaryRelation, base } = context.claim;
    const { requireResolved, pushDiagnostic, pushNeutralFallback, items } = context.output;
    const { nodes } = context.workspace;
    const domain = flattenAnchorIds(anchors.domain)[0];
    const focus = flattenAnchorIds(anchors.focus)[0];
    const background = flattenAnchorIds(anchors.background)[0];
    if (!requireResolved('domain', domain)) return;
    if (!requireResolved('focus', focus)) return;
    if (!requireResolved('background', background)) return;
    const strongEdges = nativeAncestorEdges(nodes, domain, focus);
    const weakEdges = nativeAncestorEdges(nodes, domain, background);
    if (!strongEdges || !weakEdges || strongEdges.some((strong) => weakEdges.some((weak) =>
      strong.fromNodeId === weak.fromNodeId && strong.toNodeId === weak.toNodeId))) {
      pushDiagnostic('illegal-configuration', 'Focus and background require distinct native branches within the named domain');
      pushNeutralFallback(primaryRelation.anchors, false);
      return;
    }
    items.push({
      ...base,
      kind: 'branch-emphasis',
      focusNodeId: focus,
      strongEdges,
      weakEdges
    });
    return;
  },
  'f-projection': (context) => {
    const { anchors, primaryRelation, base, values } = context.claim;
    const { resolvedIds, requireResolved, pushDiagnostic, pushNeutralFallback, items } = context.output;
    const { nodes } = context.workspace;
    const accentBearer = flattenAnchorIds(anchors.accentBearer)[0];
    const projections = resolvedIds('projections', anchors.projections);
    if (!requireResolved('accentBearer', accentBearer) || projections.length === 0) return;
    const hops = [accentBearer, ...projections];
    if (!isNativeProjectionPath(nodes, accentBearer, projections)) {
      pushDiagnostic('illegal-configuration', 'FProjection requires ordered ancestor hops between the exact authored nodes');
      pushNeutralFallback(primaryRelation.anchors, false);
      return;
    }
    hops.slice(0, -1).forEach((fromNodeId, index) => {
      items.push({
        ...base,
        kind: 'directed-path',
        fromNodeId,
        toNodeId: hops[index + 1],
        pathStyle: 'f-projection',
        projectionTargetAttachment: nodes.get(hops[index + 1])?.word
          && !(nodes.get(hops[index + 1])?.children || []).length ? 'terminal' : 'shell',
        ...(scalarValue(values, 'feature') ? { projectionFeature: scalarValue(values, 'feature') } : {}),
        ...(index === 0 && scalarValue(values, 'accent') ? { label: scalarValue(values, 'accent') } : {})
      });
    });
    return;
  },
  'gapping-alignment': (context) => {
    const { resolvedIds, pushDiagnostic, items } = context.output;
    const { anchors, primaryRelation, values, base } = context.claim;
    const correlates = resolvedIds('correlates', anchors.correlates);
    const remnants = resolvedIds('remnants', anchors.remnants);
    if (correlates.length === 0 || correlates.length !== remnants.length) {
      pushDiagnostic('endpoint-missing', 'GappingAlignment requires positionally paired correlates and remnants');
      return;
    }
    // Labels pair with correlates only through a same-name values entry
    // of the same length, or one label for one correlate.
    const authoredCorrelateKey = Object.entries(primaryRelation.anchors || {})
      .find(([, value]) => JSON.stringify(flattenAnchorIds(value)) === JSON.stringify(correlates))?.[0];
    const sameNameLabels = authoredCorrelateKey ? listValue(values, authoredCorrelateKey) : [];
    const conceptLabels = listValue(values, 'labels');
    const labels = sameNameLabels.length === correlates.length
      ? sameNameLabels
      : (correlates.length === 1 && conceptLabels.length === 1 ? conceptLabels : []);
    items.push({
      ...base,
      kind: 'node-badges',
      badgeStyle: 'gapping-ordinal',
      badges: correlates.flatMap((nodeId, index) => {
        const label = labels[index] || String(index + 1);
        return [
          { nodeId, text: `-${label}`, shape: 'plain' as const },
          { nodeId: remnants[index], text: `=${label}`, shape: 'plain' as const }
        ];
      })
    });
    return;
  }
} satisfies Partial<RegisteredPlanCompilers>;

const constituentOccurrenceFacet = (context: FacetPlanContext) => {
  const { facet, push, base, one } = context;
  const gradient = facet.recipe.id === 'constituent.region';
  push({
    ...base(
      facet,
      [gradient ? 'Gradient enclosure' : 'Constituent enclosure'],
      gradient ? 'tier2.constituent-region' : 'copy.multiple-pronunciation'
    ),
    kind: 'enclosure',
    nodeId: one(gradient ? 'movement.carrier' : 'constituent'),
    licence: gradient ? 'carrier-chunk' : 'copy-occurrence'
  });
  return;
};

const polarityLicensingFacet = (context: FacetPlanContext) => {
  const { facet, push, base, one, evidence } = context;
  const polarityOnly = facet.recipe.id === 'polarity.licensing';
  push({
    ...base(facet, polarityOnly ? ['Nested association curves'] : ['Nested association curves', 'Feature notation'],
      polarityOnly ? 'polarity.licensing' : 'accord.strong-npi'),
    kind: 'undirected-link',
    pairs: [{ fromNodeId: one('licensor'), toNodeId: one(polarityOnly ? 'polarity.item' : 'licensee') }],
    linkStyle: 'strong-npi',
    ...(!polarityOnly && singleValue(evidence, 'feature.label')
      ? { label: singleValue(evidence, 'feature.label') }
      : {})
  });
  return;
};

export const structuralFacetPlan = {
  'binding.dependency': (context: FacetPlanContext) => {
    const { one, push, base, facet, evidence, dependencyIndexFor, dependencyKey, nodes, state } = context;
    const domain = one('domain');
    if (!domain) {
      push({
        ...base(facet, ['Variable-binding path'], 'binding.dependency'),
        kind: 'operator-variable-binding',
        operatorNodeId: one('binder'),
        variableNodeId: one('dependent'),
        index: singleValue(evidence, 'index', dependencyIndexFor(dependencyKey('binding', [one('binder'), one('dependent')])))
      });
      return;
    }
    push({
      ...base(facet, ['Elliptic domain'], 'binding.domain'),
      kind: 'binding-domain',
      binderNodeId: one('binder'),
      boundNodeId: one('dependent'),
      domainNodeId: domain,
      domainMemberNodeIds: collectSubtreeIds(nodes.get(domain)),
      subtreeDerived: [{ field: 'domainMemberNodeIds', rootNodeId: domain, mode: 'all' }],
      ...(state === 'licensed' || state === 'failed' ? { outcome: state } : {}),
      index: singleValue(evidence, 'index', dependencyIndexFor(dependencyKey('binding', [one('binder'), one('dependent')])))
    });
    return;
  },
  'predication.dependency': (context: FacetPlanContext) => {
    const { push, base, facet, many, one } = context;
    push({
      ...base(facet, ['Predication connector'], 'predication.paths'),
      kind: 'undirected-link',
      pairs: many('predicate').map((predicate) => ({
        fromNodeId: one('predicand'),
        toNodeId: predicate
      })),
      linkStyle: 'predication'
    });
    return;
  },
  'constituent.occurrence': constituentOccurrenceFacet,
  'constituent.region': constituentOccurrenceFacet,
  'pair-merge': (context: FacetPlanContext) => {
    const { push, base, facet, one } = context;
    push({
      ...base(facet, ['Branch overlay'], 'pair-merge.fork'),
      kind: 'undirected-link',
      pairs: [{ fromNodeId: one('pair.member'), toNodeId: one('host') }],
      linkStyle: 'pair-merge'
    });
    return;
  },
  'multidominance': (context: FacetPlanContext) => {
    const { push, base, facet, many, one } = context;
    push({
      ...base(facet, ['Shared branch'], 'multidominance.shared-node'),
      kind: 'shared-node',
      parentNodeIds: many('parents'),
      sharedNodeId: one('shared')
    });
    return;
  },
  'argument-sharing': (context: FacetPlanContext) => {
    const { many, push, base, facet, one, nodes, evidence } = context;
    many('predicate.domains').forEach((domain, index) => {
      push({
        ...base(facet, ['Crossed domain ovals'], 'argument-sharing.domains', `domain:${index}`),
        kind: 'domain-mark',
        rootNodeId: domain,
        sharedNodeId: one('shared.argument'),
        memberNodeIds: collectSubtreeIds(nodes.get(domain)),
        subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
        domainStyle: 'argument-domain'
      });
    });
    if (facet.evaluation.outputs.includes('Label box')) {
      push({
        ...base(facet, ['Label box'], 'argument-sharing.domains', 'label'),
        kind: 'node-badges',
        badgeStyle: 'shared-object',
        badges: [{
          nodeId: one('shared.argument'),
          text: singleValue(evidence, 'role.label'),
          shape: 'plain'
        }]
      });
    }
    return;
  },
  'idiom.chunks': (context: FacetPlanContext) => {
    const { one, push, base, facet, nodes, many } = context;
    const domain = one('interpretation.domain');
    if (domain) push({
      ...base(facet, ['Domain bracket'], 'idiom-chunks.domain', 'domain'),
      kind: 'domain-mark',
      rootNodeId: domain,
      memberNodeIds: collectSubtreeIds(nodes.get(domain)),
      subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: domain, mode: 'all' }],
      domainStyle: 'idiom'
    });
    push({
      ...base(facet, ['Underline'], 'idiom-chunks.domain', 'chunks'),
      kind: 'node-badges',
      badgeStyle: 'idiom-chunk',
      badges: many('chunks').map((nodeId) => ({ nodeId, text: '', shape: 'plain' }))
    });
    return;
  },
  'focus.prominence': (context: FacetPlanContext) => {
    const { facet, push, base, nodes, one } = context;
    const parent = facet.evaluation.structuralWitness?.branchParentNodeId;
    if (!parent) return;
    push({
      ...base(facet, ['Prominence branches'], 'focus.prominence'),
      kind: 'branch-emphasis',
      strongEdges: nativeAncestorEdges(nodes, parent, one('focus')) ?? [],
      weakEdges: nativeAncestorEdges(nodes, parent, one('background')) ?? [],
      focusNodeId: one('focus')
    });
    return;
  },
  'focus.projection': (context: FacetPlanContext) => {
    const { facet, push, base, nodes, evidence, many, one } = context;
    const nodesInProjection = facet.evaluation.structuralWitness?.projectionNodeIds ?? [];
    nodesInProjection.slice(0, -1).forEach((fromNodeId, index) => {
      push({
        ...base(facet, ['Projection hop'], 'focus.f-projection', `hop:${index}`),
        kind: 'directed-path',
        fromNodeId,
        toNodeId: nodesInProjection[index + 1],
        pathStyle: 'f-projection',
        projectionTargetAttachment: nodes.get(nodesInProjection[index + 1])?.word
          && !(nodes.get(nodesInProjection[index + 1])?.children?.length) ? 'terminal' : 'shell',
        ...(singleValue(evidence, 'feature.label') ? { projectionFeature: singleValue(evidence, 'feature.label') } : {}),
        ...(index === 0 && singleValue(evidence, 'accent.label') ? { label: singleValue(evidence, 'accent.label') } : {})
      });
    });
    if (facet.evaluation.outputs.includes('Feature annotation')) {
      push({
        ...base(facet, ['Feature annotation'], 'focus.f-projection', 'feature'),
        kind: 'node-badges',
        badgeStyle: 'path-status',
        badges: many('projection.nodes').map((nodeId) => ({
          nodeId,
          text: singleValue(evidence, 'feature.label'),
          shape: 'plain'
        }))
      });
    }
    if (facet.evaluation.outputs.includes('Accent annotation')) {
      push({
        ...base(facet, ['Accent annotation'], 'focus.f-projection', 'accent'),
        kind: 'node-badges',
        badgeStyle: 'path-status',
        badges: [{
          nodeId: one('accent.bearer'),
          text: singleValue(evidence, 'accent.label'),
          shape: 'plain'
        }]
      });
    }
    return;
  },
  'focus.association': (context: FacetPlanContext) => {
    const { push, base, facet, one } = context;
    push({
      ...base(facet, ['Nested association curves'], 'focus.association'),
      kind: 'undirected-link',
      pairs: [{ fromNodeId: one('association.particle'), toNodeId: one('association.associate') }],
      linkStyle: 'strong-npi'
    });
    return;
  },
  'polarity.licensing': polarityLicensingFacet,
  'strong-npi': polarityLicensingFacet,
  'storage.ledger': (context: FacetPlanContext) => {
    const { push, base, facet, one, rows, evidence } = context;
    push({
      ...base(facet, ['Ledger frame'], 'cooper-storage.ledger'),
      kind: 'node-plaque',
      anchorNodeIds: [one('scope')],
      plaqueStyle: 'cooper-storage',
      rows,
      nativeContent: prepareNativePlaqueContent('cooper-storage', tier2NativePlaqueRows(evidence), [one('scope')])
    });
    return;
  },
  'organization.large-anchor-set': (context: FacetPlanContext) => {
    const { evidence, push, base, facet, relationRef, nodes } = context;
    const roleEntries = evidence.authoredCurrentAnchors.filter((entry) => (
      entry.concepts.includes('large.anchor.array')
    ));
    push({
      ...base(facet, ['Anchor badge', 'Anchor rail'], 'tier2.large-anchor-set'),
      kind: 'anchor-set',
      set: {
        relation: relationRef.relation,
        stageIndex: relationRef.stageIndex,
        relationIndex: relationRef.relationIndex,
        instanceIndex: relationRef.relationIndex,
        roles: roleEntries.map((entry, roleIndex) => {
          const ids = [...entry.items];
          return {
            role: entry.key,
            roleIndex,
            large: true,
            anchors: ids.map((nodeId, arrayIndex) => ({
              nodeId,
              arrayIndex,
              resolved: nodes.has(nodeId)
            }))
          };
        })
      },
      showBadges: true,
      badgeSize: 'compact'
    });
    return;
  }
} satisfies Partial<FacetPlanCompilers>;

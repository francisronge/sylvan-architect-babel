/**
 * Task 8 bridge: lower complete Tier-2 facets into the semantic plan items
 * already painted by production. This module never dispatches by relation
 * name and never reconstructs facet/output identities.
 */
import type { SyntaxNode } from '../../types.ts';
import type {
  PlanDiagnostic,
  PlanRelationRef,
  RelationPlanItem
} from './renderPlanCompiler.ts';
import {
  type RelationClaimDispatch,
  type Tier2ResolvedFacet
} from './tier2RelationDispatch.ts';
import type {
  Tier2FacetEvidence,
  Tier2VisualPrimitiveName
} from './tier2FacetRecipes.ts';
import { literalThetaRoles, pairedLiterals, tier2NativePlaqueRows } from './tier2FacetRecipes.ts';
import { isWordlessCategoryLeaf } from '../replayCompiler.ts';
import { nativeAncestorEdges, prepareNativeDependentCaseStep, prepareNativeLinearizationContent, prepareNativePlaqueContent } from './nativeDrawingContent.ts';

type CompileTier2Input = {
  relationRef: PlanRelationRef;
  dispatch: RelationClaimDispatch;
  currentForest: readonly SyntaxNode[];
  priorForest?: readonly SyntaxNode[];
};

export type CompileTier2Result = {
  items: RelationPlanItem[];
  diagnostics: PlanDiagnostic[];
};

const flatten = (value: readonly string[] | string | undefined): string[] => (
  (value === undefined ? [] : Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? ''))
);

const collectForest = (forest: readonly SyntaxNode[]): Map<string, SyntaxNode> => {
  const nodes = new Map<string, SyntaxNode>();
  const walk = (node: SyntaxNode) => {
    const id = String(node.id || '').trim();
    if (id) nodes.set(id, node);
    (node.children || []).forEach(walk);
  };
  forest.forEach(walk);
  return nodes;
};

const collectSubtreeIds = (node?: SyntaxNode): string[] => {
  if (!node) return [];
  const ids: string[] = [];
  const walk = (current: SyntaxNode) => {
    const id = String(current.id || '').trim();
    if (id) ids.push(id);
    (current.children || []).forEach(walk);
  };
  walk(node);
  return ids;
};

const collectSilentSubtreeIds = (node?: SyntaxNode): string[] => {
  if (!node) return [];
  const ids: string[] = [];
  const walk = (current: SyntaxNode) => {
    const id = String(current.id || '').trim();
    if (id && current.silent === true) ids.push(id);
    (current.children || []).forEach(walk);
  };
  walk(node);
  return ids;
};

const leafCount = (node?: SyntaxNode): number => {
  if (!node) return 0;
  if ((node.children || []).length === 0) return 1;
  return (node.children || []).reduce((count, child) => count + leafCount(child), 0);
};

const unique = (items: readonly string[]): string[] => (
  items.filter((item, index) => items.indexOf(item) === index)
);

const currentIds = (evidence: Tier2FacetEvidence, role: string): string[] => (
  flatten(evidence.currentAnchors[role])
);

const valueItems = (evidence: Tier2FacetEvidence, name: string): string[] => (
  flatten(evidence.values[name])
);

const firstValue = (evidence: Tier2FacetEvidence, name: string, fallback = ''): string => (
  valueItems(evidence, name)[0] ?? fallback
);

const authoredRows = (evidence: Tier2FacetEvidence): Array<{ label: string; value: string }> => (
  (evidence.authoredValues || []).flatMap(({ key, items }) =>
    items.map((value) => ({ label: key, value })))
);

const outcomeState = (
  facet: Tier2ResolvedFacet
): 'licensed' | 'blocked' | 'failed' | undefined => {
  const concept = facet.evaluation.outcomeConcept;
  if (!concept) return undefined;
  if (['licensed', 'successful', 'allowed', 'accepted', 'valid'].includes(concept)) {
    return 'licensed';
  }
  return facet.recipe.id === 'binding.dependency' ? 'failed' : 'blocked';
};

const outputKeys = (
  facet: Tier2ResolvedFacet,
  pieces: readonly Tier2VisualPrimitiveName[]
): string[] => facet.outputIdentities
  .filter(({ piece }) => pieces.includes(piece))
  .map(({ key }) => key);

const currentWitnessNodeIdsFromFacetIdentity = (
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
          const nodeId = String((witness as { id?: unknown }).id ?? '').trim();
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

const identityAnchorBlock = (
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
            const nodeId = String((witness as { id?: unknown }).id ?? '').trim();
            return nodeId ? [nodeId] : [];
          })
        : []
    ])
  );
};

const ownReplacementGroup = (
  facet: Tier2ResolvedFacet,
  stageIndex: number
): string => JSON.stringify({
  facet: facet.recipe.id,
  stageIndex,
  anchors: canonicalReplacementAnchors(identityAnchorBlock(facet.facetIdentity, 'currentAnchors'))
});

const predecessorReplacementGroup = (
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

export const compileTier2RelationOutputs = ({
  relationRef,
  dispatch,
  currentForest,
  priorForest
}: CompileTier2Input): CompileTier2Result => {
  const evidence = dispatch.evidence;
  const nodes = collectForest(currentForest);
  const priorNodeIds = new Set(collectForest(priorForest || []).keys());
  const diagnostics: PlanDiagnostic[] = dispatch.diagnostics.map((diagnostic) => ({
    stageIndex: relationRef.stageIndex,
    relationIndex: relationRef.relationIndex,
    relation: relationRef.relation,
    kind: diagnostic.kind === 'unrecovered-evidence' ? 'unrecovered-evidence' : 'tier2-collision',
    detail: `${diagnostic.kind}:${diagnostic.collision}:${diagnostic.facets.join(',')}`
  }));
  const items: RelationPlanItem[] = [];

  const base = (
    facet: Tier2ResolvedFacet,
    pieces: readonly Tier2VisualPrimitiveName[],
    familyId: string,
    part = 'main'
  ) => {
    const tier2OutputIdentities = outputKeys(facet, pieces);
    const tier2OutputPieces = facet.outputIdentities
      .filter(({ key }) => tier2OutputIdentities.includes(key))
      .map(({ piece }) => piece);
    const authoredPriorWitnessNodeIds = unique(
      Object.values(identityAnchorBlock(facet.facetIdentity, 'priorAnchors')).flat()
    );
    const priorAnchorBlockComplete = authoredPriorWitnessNodeIds.length > 0
      && authoredPriorWitnessNodeIds.every((id) => priorNodeIds.has(id));
    const predecessorGroup = predecessorReplacementGroup(
      facet,
      relationRef.stageIndex,
      priorAnchorBlockComplete
    );
    const priorWitnessNodeIds = priorAnchorBlockComplete
      ? authoredPriorWitnessNodeIds
      : [];
    const tier2WitnessNodeIds = currentWitnessNodeIdsFromFacetIdentity(
      facet.facetIdentity
    ).filter((id) => nodes.has(id));
    return {
      relationRef,
      familyId,
      appearsAtStage: relationRef.stageIndex,
      persistence: facet.recipe.persistence.kind === 'while-active'
        ? 'stage-only' as const
        : 'replace-previous-instance' as const,
      replacementGroup: ownReplacementGroup(facet, relationRef.stageIndex),
      ...(predecessorGroup ? { replacementPredecessorGroup: predecessorGroup } : {}),
      backward: priorWitnessNodeIds.length > 0,
      priorWitnessNodeIds,
      tier2WitnessNodeIds,
      tier2FacetId: facet.recipe.id,
      tier2OutputIdentities,
      tier2OutputPieces,
      tier2RenderPart: part,
      claimTier: 2 as const
    };
  };

  const push = (item: RelationPlanItem) => items.push(item);
  const valid = (ids: readonly string[]) => ids.filter((id) => nodes.has(id));
  const one = (role: string) => valid(currentIds(evidence, role))[0] || '';
  const many = (role: string) => valid(currentIds(evidence, role));

  dispatch.facets.forEach((facet) => {
    const state = outcomeState(facet);
    const facetId = facet.recipe.id;
    const rows = authoredRows({ ...evidence, authoredValues: evidence.authoredValues?.flatMap(entry => {
      const refs = facet.evaluation.consumedEvidence.filter(ref => ref.field === 'values' && ref.key === entry.key);
      if (!refs.length) return [];
      const indices = new Set(refs.flatMap(ref => ref.itemIndices ?? entry.items.map((_, index) => index)));
      return [{ ...entry, items: entry.items.filter((_, index) => indices.has(index)) }];
    }) });
    switch (facetId) {
      case 'movement.path': {
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
            : leafCount(nodes.get(source)) > 1 || isWordlessCategoryLeaf(nodes.get(source)!) ? 'shell-bottom' : 'terminal',
          targetAttachment: crossWorkspace ? 'shell-top'
            : evidence.movement?.trajectoryKind === 'head' && !isWordlessCategoryLeaf(nodes.get(landing)!) ? 'terminal' : 'shell-bottom'
        });
        return;
      }
      case 'movement.carrier': {
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
      }
      case 'gap.notation': {
        const indices = pairedLiterals(evidence, 'gap', 'index') ?? [];
        const labels = pairedLiterals(evidence, 'gap', 'label') ?? [];
        push({
          ...base(facet, ['Gap label'], 'tier2.gap-notation'),
          kind: 'node-badges',
          badgeStyle: 'gap-notation',
          badges: many('gap').map((nodeId, index) => ({ nodeId,
            text: labels[index]?.trim() ? labels[index]
              : String(nodes.get(nodeId)?.word || nodes.get(nodeId)?.label || '') + (indices[index]?.trim() ? `_${indices[index]}` : ''), shape: 'plain' }))
        });
        return;
      }
      case 'identity.occurrences': {
        push({
          ...base(facet, ['Coindex', 'Forest light'], 'identity.occurrences'),
          kind: 'coindex',
          nodeIds: many('occurrences'),
          index: firstValue(evidence, 'index', String(relationRef.relationIndex + 1))
        });
        return;
      }
      case 'presentation.lens': {
        push({
          ...base(facet, ['Lens emphasis'], 'identity.occurrences'),
          kind: 'coindex',
          nodeIds: many('facet.anchors'),
          index: ''
        });
        return;
      }
      case 'control.dependency': {
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
        return;
      }
      case 'binding.dependency': {
        const domain = one('domain');
        push({
          ...base(facet, ['Elliptic domain'], 'binding.domain'),
          kind: 'binding-domain',
          binderNodeId: one('binder'),
          boundNodeId: one('dependent'),
          domainNodeId: domain,
          domainMemberNodeIds: collectSubtreeIds(nodes.get(domain)),
          subtreeDerived: [{ field: 'domainMemberNodeIds', rootNodeId: domain, mode: 'all' }],
          ...(state === 'licensed' || state === 'failed' ? { outcome: state } : {}),
          index: firstValue(evidence, 'index', String(relationRef.relationIndex + 1))
        });
        return;
      }
      case 'predication.dependency': {
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
      }
      case 'parasitic-gap.paths': {
        push({
          ...base(facet, ['Path-node rings'], 'parasitic-gap.composition'),
          kind: 'path-status',
          primaryNodeIds: many('primary.path'),
          secondaryNodeIds: many('secondary.path'),
          ...(state === 'licensed' || state === 'blocked' ? { outcome: state } : {})
        });
        return;
      }
      case 'parasitic-gap.copy': {
        push({
          ...base(facet, ['Copy fork'], 'parasitic-gap.composition'),
          kind: 'parasitic-gap-copy',
          contentNodeId: one('filler'),
          ordinaryGapNodeId: one('ordinary.gap'),
          parasiticGapNodeIds: many('parasitic.gap')
        });
        return;
      }
      case 'locality.boundary': {
        push({
          ...base(facet, ['Barrier cut'], 'bounding-node.cuts'),
          kind: 'node-badges',
          badgeStyle: 'boundary-cut',
          badges: many('boundary').map((nodeId) => ({ nodeId, text: '\u2225', shape: 'plain' }))
        });
        return;
      }
      case 'ellipsis.site': {
        const site = one('ellipsis.site');
        push({
          ...base(facet, ['Ghosting'], 'ellipsis.ghosting'),
          kind: 'ellipsis-site',
          siteNodeId: site,
          ghostNodeIds: collectSilentSubtreeIds(nodes.get(site)),
          siteSubtreeNodeIds: collectSubtreeIds(nodes.get(site)),
          subtreeDerived: [
            { field: 'ghostNodeIds', rootNodeId: site, mode: 'authored-silent' },
            { field: 'siteSubtreeNodeIds', rootNodeId: site, mode: 'all' }
          ]
        });
        return;
      }
      case 'correspondence.alignment': {
        const sources = many('correspondence.source');
        const targets = many('correspondence.target');
        push({
          ...base(facet, ['Correspondence curves'], 'tier2.correspondence-alignment', 'curves'),
          kind: 'undirected-link',
          pairs: sources.map((fromNodeId, index) => ({
            fromNodeId,
            toNodeId: targets[index]
          })),
          linkStyle: 'gapping-pair'
        });
        (pairedLiterals(evidence, 'correspondence.source', 'index') ?? []).forEach((index, pairIndex) => {
          if (!index.trim()) return;
          push({
            ...base(facet, ['Correspondence index'], 'tier2.correspondence-alignment', `index:${pairIndex}`),
            kind: 'coindex',
            nodeIds: [sources[pairIndex], targets[pairIndex]],
            index
          });
        });
        return;
      }
      case 'deletion.site': {
        push({
          ...base(facet, ['Strike'], 'copy.partial-deletion'),
          kind: 'strike-ghost',
          strikeNodeIds: [one('deleted.material')],
          ghostNodeIds: []
        });
        return;
      }
      case 'constituent.occurrence':
      case 'constituent.region': {
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
      }
      case 'pair-merge': {
        push({
          ...base(facet, ['Branch overlay'], 'pair-merge.fork'),
          kind: 'undirected-link',
          pairs: [{ fromNodeId: one('pair.member'), toNodeId: one('host') }],
          linkStyle: 'pair-merge'
        });
        return;
      }
      case 'multidominance': {
        push({
          ...base(facet, ['Shared branch'], 'multidominance.shared-node'),
          kind: 'shared-node',
          parentNodeIds: many('parents'),
          sharedNodeId: one('shared')
        });
        return;
      }
      case 'argument-sharing': {
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
              text: firstValue(evidence, 'role.label'),
              shape: 'plain'
            }]
          });
        }
        return;
      }
      case 'idiom.chunks': {
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
      }
      case 'plaque.structured': {
        push({
          ...base(facet, ['Plaque shell'], 'feature-bundle.plaque'),
          kind: 'node-plaque',
          anchorNodeIds: many('plaque.anchor'),
          plaqueStyle: 'feature',
          rows
        });
        return;
      }
      case 'feature-sharing': {
        const bearers = many('feature.bearers');
        push({
          ...base(facet, ['Feature vine'], 'feature-sharing.vines'),
          kind: 'undirected-link',
          pairs: bearers.slice(0, -1).map((fromNodeId, index) => ({
            fromNodeId,
            toNodeId: bearers[index + 1]
          })),
          linkStyle: 'feature-sharing',
          ...(valueItems(evidence, 'feature.rows').length > 0
            ? { label: valueItems(evidence, 'feature.rows').join(', ') }
            : {})
        });
        return;
      }
      case 'agreement.cycle': {
        many('goal').forEach((goal, index) => {
          push({
            ...base(facet, ['Cycle badge'], 'cyclic-agree.paths', `goal:${index}`),
            kind: 'directed-path',
            fromNodeId: one('probe'),
            toNodeId: goal,
            pathStyle: 'agree-cyclic',
            label: firstValue(evidence, 'cycle')
          });
        });
        return;
      }
      case 'feature.dependency': {
        const caseLabels = pairedLiterals(evidence, 'feature.target', 'case.literal') ?? [];
        many('feature.target').forEach((target, index) => {
          push({
            ...base(facet, ['Feature connectors'], 'tier2.feature-dependency', `target:${index}`),
            kind: 'directed-path',
            fromNodeId: one('feature.source'),
            toNodeId: target,
            pathStyle: caseLabels.length ? 'case-assignment' : 'case-agree',
            ...(caseLabels.length ? { label: caseLabels[index] } : valueItems(evidence, 'feature.rows').length > 0
              ? { label: valueItems(evidence, 'feature.rows').join(', ') }
              : {}),
            ...(state === 'licensed' || state === 'blocked' ? { outcome: state } : {})
          });
        });
        return;
      }
      case 'dependent-case': {
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
      }
      case 'accord': {
        push({
          ...base(facet, ['Accord connector', 'Boxed index'], 'accord.link'),
          kind: 'directed-path',
          fromNodeId: one('feature.source'),
          toNodeId: one('goal'),
          pathStyle: 'accord',
          label: firstValue(evidence, 'index'),
          secondaryLabel: firstValue(evidence, 'index'),
          featureRow: rows.find(row => valueItems(evidence, 'feature.rows').includes(row.value))
        });
        return;
      }
      case 'phase.domain': {
        const phase = one('phase');
        push({
          ...base(facet, ['Phase arc'], 'phase.arc'),
          kind: 'domain-mark',
          rootNodeId: phase,
          memberNodeIds: collectSubtreeIds(nodes.get(phase)),
          subtreeDerived: [{ field: 'memberNodeIds', rootNodeId: phase, mode: 'all' }],
          domainStyle: 'phase'
        });
        return;
      }
      case 'transfer.domain': {
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
      }
      case 'domain.annotation': {
        push({
          ...base(facet, ['Overlay annotation'], 'tier2.domain-annotation'),
          kind: 'node-badges',
          badgeStyle: 'phase-edge',
          badges: [{ nodeId: one('domain'), text: firstValue(evidence, 'label'), shape: 'plain' }]
        });
        return;
      }
      case 'phase.edge': {
        many('phase.edge').forEach((edge, index) => push({
          ...base(facet, ['Edge outline'], 'transfer.domain', `edge:${index}`),
          kind: 'domain-mark',
          rootNodeId: edge,
          memberNodeIds: [edge],
          domainStyle: 'transfer-edge',
          label: 'Phase edge'
        }));
        return;
      }
      case 'transfer.access': {
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
      }
      case 'judgment.verdict': {
        const judgment = firstValue(evidence, 'verdict');
        const label = firstValue(evidence, 'label');
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
      }
      case 'judgment.blocked':
      case 'judgment.licensed': {
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
      }
      case 'landing-candidates': {
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
      }
      case 'intervention': {
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
      }
      case 'blocked-extraction': {
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
      case 'focus.prominence': {
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
      }
      case 'focus.projection': {
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
            ...(firstValue(evidence, 'feature.label') ? { projectionFeature: firstValue(evidence, 'feature.label') } : {}),
            ...(index === 0 && firstValue(evidence, 'accent.label') ? { label: firstValue(evidence, 'accent.label') } : {})
          });
        });
        if (facet.evaluation.outputs.includes('Feature annotation')) {
          push({
            ...base(facet, ['Feature annotation'], 'focus.f-projection', 'feature'),
            kind: 'node-badges',
            badgeStyle: 'path-status',
            badges: many('projection.nodes').map((nodeId) => ({
              nodeId,
              text: firstValue(evidence, 'feature.label'),
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
              text: firstValue(evidence, 'accent.label'),
              shape: 'plain'
            }]
          });
        }
        return;
      }
      case 'strong-npi': {
        push({
          ...base(facet, ['Nested association curves', 'Feature notation'], 'accord.strong-npi'),
          kind: 'undirected-link',
          pairs: [{ fromNodeId: one('licensor'), toNodeId: one('licensee') }],
          linkStyle: 'strong-npi',
          ...(firstValue(evidence, 'feature.label')
            ? { label: firstValue(evidence, 'feature.label') }
            : {})
        });
        return;
      }
      case 'storage.ledger': {
        push({
          ...base(facet, ['Ledger frame'], 'cooper-storage.ledger'),
          kind: 'node-plaque',
          anchorNodeIds: [one('scope')],
          plaqueStyle: 'cooper-storage',
          rows,
          nativeContent: prepareNativePlaqueContent('cooper-storage', tier2NativePlaqueRows(evidence), [one('scope')])
        });
        return;
      }
      case 'scope.movement': {
        push({
          ...base(facet, ['Covert path', 'Scope domain'], 'qr.covert'),
          kind: 'quantifier-raising',
          pronouncedNodeId: one('scope.source'),
          lfNodeId: one('scope.landing'),
          ...(one('scope.domain') ? { scopeDomainNodeId: one('scope.domain') } : {}),
          index: firstValue(evidence, 'index', 'i')
        });
        return;
      }
      case 'operator-binding': {
        const domain = one('scope.domain');
        push({
          ...base(facet, ['Ranked scope hulls', 'Variable-binding path'], 'scope.operator-variable'),
          kind: 'operator-variable-binding',
          operatorNodeId: one('operator'),
          variableNodeId: one('variable'),
          ...(domain ? { scopeDomainNodeId: domain,
            scopeMemberNodeIds: collectSubtreeIds(nodes.get(domain)),
            subtreeDerived: [{ field: 'scopeMemberNodeIds' as const, rootNodeId: domain, mode: 'all' as const }] } : {}),
          index: firstValue(evidence, 'index', String(relationRef.relationIndex + 1))
        });
        return;
      }
      case 'theta-grid': {
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
      case 'pf.structured':
      case 'pf.rewrite':
      case 'pf.correspondence':
      case 'pf.fission':
      case 'pf.impoverishment':
      case 'pf.local-dislocation':
      case 'pf.linearization': {
        const config = {
          'pf.structured': { role: 'rewrite.output', style: 'realization', family: 'pf.realization', pieces: ['PF plate frame', 'PF plate rows'] },
          'pf.rewrite': { role: 'rewrite.output', style: 'realization', family: 'pf.vocabulary-insertion', pieces: ['Rewrite arrow'] },
          'pf.correspondence': { role: 'terminal', style: 'correspondence', family: 'pf.correspondence', pieces: ['Correspondence map'] },
          'pf.fission': { role: 'rewrite.outputs', style: 'fission', family: 'pf.fission', pieces: ['Bundle shell'] },
          'pf.impoverishment': { role: 'terminal', style: 'impoverishment', family: 'pf.impoverishment', pieces: ['Delinking mark'] },
          'pf.local-dislocation': { role: 'sequence', style: 'dislocation-lane', family: 'pf.local-dislocation', pieces: ['State lanes'] },
          'pf.linearization': { role: 'order', style: 'linearization', family: 'pf.cyclic-linearization', pieces: ['Comparison column layout'] }
        }[facet.recipe.id] as {
          role: string;
          style: 'realization' | 'correspondence' | 'fission' | 'impoverishment' | 'dislocation-lane' | 'linearization';
          family: string;
          pieces: Tier2VisualPrimitiveName[];
        };
        const nativeContent = config.style === 'linearization' ? prepareNativeLinearizationContent(evidence)
          : prepareNativePlaqueContent(config.style, tier2NativePlaqueRows(evidence), many(config.role));
        if (['fission', 'impoverishment', 'correspondence', 'linearization'].includes(config.style) && !nativeContent) {
          diagnostics.push({ stageIndex: relationRef.stageIndex, relationIndex: relationRef.relationIndex,
            relation: relationRef.relation, kind: 'illegal-configuration', detail: `Tier-2 ${facetId} has no complete prepared content` });
          return;
        }
        push({
          ...base(facet, config.pieces, config.family),
          kind: 'node-plaque',
          anchorNodeIds: many(config.role),
          plaqueStyle: config.style,
          rows,
          ...(config.style === 'realization' ? { realizationRowKinds: rows.map(() => 'literal' as const) } : {}),
          ...(nativeContent ? { nativeContent } : {})
        });
        return;
      }
      case 'organization.large-anchor-set': {
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
      default: {
        const unhandledFacet: never = facetId;
        diagnostics.push({
          stageIndex: relationRef.stageIndex,
          relationIndex: relationRef.relationIndex,
          relation: relationRef.relation,
          kind: 'tier2-lowering-missing',
          detail: `complete Tier-2 facet ${unhandledFacet} has no Task 8 lowering`
        });
      }
    }
  });

  return { items, diagnostics };
};

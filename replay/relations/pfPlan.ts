import { collectAuthoredSilentSubtreeIds } from './authoredSilence.ts';
import type { FacetPlanCompilers, FacetPlanContext } from './facetPlanContext.ts';
import { prepareLocalDislocationContent } from './localDislocationContent.ts';
import { prepareNativeLinearizationContent, prepareNativePlaqueContent } from './nativeDrawingContent.ts';
import { collectLexicalTerminalIds, collectSubtreeIds, flattenAnchorIds } from './planSyntax.ts';
import { nativeRealizationContent, scalarValue, verbatimRows } from './planValues.ts';
import type { RegisteredPlanCompilers } from './registeredPlanContext.ts';
import { buildTier2FacetEvidence } from './relationEvidence.ts';
import { prepareRewriteRows } from './rewriteLiterals.ts';
import { pairedLiterals, prepareNativeFissionContent, tier2NativePlaqueRows } from './tier2EvidenceQueries.ts';
import type { Tier2VisualPrimitiveName } from './tier2FacetTypes.ts';

export const pfPlan = {
  'ellipsis-site': (context) => {
    const { anchors, familyId, base } = context.claim;
    const { requireResolved, pushDiagnostic, items } = context.output;
    const { nodes } = context.workspace;
    const site = flattenAnchorIds(anchors.site || anchors.domain)[0];
    const antecedent = flattenAnchorIds(anchors.antecedent)[0];
    if (!requireResolved('site', site)) return;
    if (antecedent && !requireResolved('antecedent', antecedent)) return;
    if (familyId === 'ellipsis.deletion') {
      const terminalNodeIds = collectLexicalTerminalIds(nodes.get(site));
      if (terminalNodeIds.length === 0) {
        pushDiagnostic(
          'endpoint-missing',
          `deletion domain -> ${site} contains no lexical terminal material to strike`
        );
        return;
      }
      items.push({
        ...base,
        kind: 'strike-ghost',
        strikeNodeIds: [site],
        ghostNodeIds: []
      });
      return;
    }
    items.push({
      ...base,
      kind: 'ellipsis-site',
      siteNodeId: site,
      ...(antecedent ? {
        antecedentNodeId: antecedent,
        antecedentSubtreeNodeIds: collectSubtreeIds(nodes.get(antecedent))
      } : {}),
      ghostNodeIds: collectAuthoredSilentSubtreeIds(nodes.get(site)),
      siteSubtreeNodeIds: collectSubtreeIds(nodes.get(site)),
      subtreeDerived: [
        { field: 'ghostNodeIds', rootNodeId: site, mode: 'authored-silent' },
        { field: 'siteSubtreeNodeIds', rootNodeId: site, mode: 'all' },
        ...(antecedent
          ? [{ field: 'antecedentSubtreeNodeIds', rootNodeId: antecedent, mode: 'all' as const }]
          : [])
      ]
    });
    return;
  },
  'copy-pronunciation': (context) => {
    const { anchors, base } = context.claim;
    const { requireResolved, items } = context.output;
    const occurrences = [
      ...flattenAnchorIds(anchors.higherCopy),
      ...flattenAnchorIds(anchors.lowerCopy),
      ...flattenAnchorIds(anchors.occurrences)
    ].filter((nodeId, index, all) => all.indexOf(nodeId) === index)
      .filter((nodeId) => requireResolved('occurrences', nodeId));
    if (occurrences.length === 0) return;
    occurrences.forEach((nodeId) => {
      items.push({ ...base, kind: 'enclosure', nodeId, licence: 'copy-occurrence' });
    });
    return;
  },
  'partial-copy-deletion': (context) => {
    const { anchors, base } = context.claim;
    const { requireResolved, items } = context.output;
    const { nodes } = context.workspace;
    const deleted = flattenAnchorIds(anchors.deletedSubconstituent || anchors.deleted)[0];
    if (!requireResolved('deletedSubconstituent', deleted)) return;
    items.push({
      ...base,
      kind: 'strike-ghost',
      strikeNodeIds: [deleted],
      ghostNodeIds: collectSubtreeIds(nodes.get(deleted)),
      subtreeDerived: [{ field: 'ghostNodeIds', rootNodeId: deleted, mode: 'all' }]
    });
    return;
  },
  'realization-plate': (context) => {
    const { vocabularyAssignments } = context.lookup;
    const { relationIndex, anchors, values, base } = context.claim;
    const { requireResolved, items } = context.output;
    const { relations, stageIndex } = context.workspace;
    if (vocabularyAssignments.has(relationIndex)) return;
    const targets = Object.values(anchors)
      .flatMap(flattenAnchorIds)
      .filter((nodeId, index, all) => all.indexOf(nodeId) === index)
      .filter((nodeId) => requireResolved('target', nodeId));
    if (targets.length === 0) return;
    // Only this package's own validated insertions contribute rows, in
    // authored order.
    const packageCompanions = relations.flatMap((companion, companionIndex) =>
      vocabularyAssignments.get(companionIndex) === relationIndex
        ? [{ companion, companionIndex }]
        : []);
    const packageContents = packageCompanions.map(({ companion }) => nativeRealizationContent(companion.values));
    const packageRows = packageContents.flatMap((content) => content.rows);
    const packageRefs = packageCompanions.map(({ companion, companionIndex }) => ({
      stageIndex,
      relationIndex: companionIndex,
      relation: companion.relation,
      anchors: companion.anchors,
      ...(companion.priorAnchors ? { priorAnchors: companion.priorAnchors } : {}),
      ...(companion.values ? { values: companion.values } : {})
    }));
    const ownContent = nativeRealizationContent(values);
    const ownRows = ownContent.rows;
    items.push({
      ...base,
      kind: 'node-plaque',
      anchorNodeIds: targets,
      plaqueStyle: 'realization',
      rows: [...ownRows, ...packageRows],
      realizationRowKinds: [...ownContent.realizationRowKinds, ...packageContents.flatMap((content) => content.realizationRowKinds)],
      rowRefs: [...ownRows.map(() => null), ...packageContents.flatMap((content, index) => content.rows.map(() => packageRefs[index]))],
      composedRefs: packageRefs
    });
    return;
  },
  'vocabulary-insertion': (context) => {
    const { vocabularyAssignments } = context.lookup;
    const { relationIndex, anchors, base, values, relationRef } = context.claim;
    const { requireResolved, items } = context.output;
    // An insertion consumed by its explicitly-targeted package carries
    // no separate plate; any other insertion keeps its own.
    if (vocabularyAssignments.has(relationIndex)) return;
    const target = flattenAnchorIds(anchors.terminal || anchors.target)[0];
    if (!requireResolved('terminal', target)) return;
    items.push({
      ...base,
      kind: 'node-plaque',
      anchorNodeIds: [target],
      plaqueStyle: 'realization',
      ...nativeRealizationContent(values),
      rowRefs: nativeRealizationContent(values).rows.map(() => relationRef)
    });
    return;
  },
  'phrasal-spellout': (context) => {
    const { anchors, base, values, authoredValues } = context.claim;
    const { requireResolved, items } = context.output;
    const phrase = flattenAnchorIds(anchors.phrase || anchors.domain)[0];
    if (!requireResolved('phrase', phrase)) return;
    items.push({
      ...base,
      kind: 'node-plaque',
      anchorNodeIds: [phrase],
      plaqueStyle: 'spellout-label',
      title: scalarValue(values, 'exponent'),
      rows: verbatimRows(authoredValues)
    });
    return;
  },
  'pf-correspondence': (context) => {
    const { anchors, primaryRelation, base, authoredValues } = context.claim;
    const { requireResolved, pushDiagnostic, pushNeutralFallback, items } = context.output;
    const { stage } = context.workspace;
    const anchor = flattenAnchorIds(anchors.word || anchors.terminal)[0];
    if (!requireResolved('word', anchor)) return;
    const correspondenceEvidence = buildTier2FacetEvidence({ relation: primaryRelation, currentForest: stage.workspaceForest || [] });
    const nativeContent = prepareNativePlaqueContent('correspondence', tier2NativePlaqueRows(correspondenceEvidence), [anchor]);
    if (!nativeContent) {
      pushDiagnostic('illegal-configuration', 'PF correspondence needs sources and exponents paired item by item');
      pushNeutralFallback(primaryRelation.anchors, false);
      return;
    }
    items.push({
      ...base,
      kind: 'node-plaque',
      anchorNodeIds: [anchor],
      plaqueStyle: 'correspondence',
      nativeContent,
      rows: verbatimRows(authoredValues)
    });
    return;
  },
  'fission': (context) => {
    const { resolvedIds, pushDiagnostic, pushNeutralFallback, items } = context.output;
    const { anchors, primaryRelation, base, authoredValues } = context.claim;
    const { stage, stageIndex, stageList } = context.workspace;
    const outputs = resolvedIds('outputs', anchors.outputs);
    if (outputs.length === 0) return;
    const fissionEvidence = buildTier2FacetEvidence({
      relation: primaryRelation, currentForest: stage.workspaceForest || [],
      ...(stageIndex > 0 ? { priorForest: stageList[stageIndex - 1].workspaceForest } : {})
    });
    const nativeContent = prepareNativeFissionContent(fissionEvidence);
    if (!nativeContent) {
      pushDiagnostic('illegal-configuration', 'Native fission requires exactly two outputs, the input features, and one feature bundle per output paired by name');
      pushNeutralFallback(primaryRelation.anchors, false);
      return;
    }
    items.push({
      ...base,
      kind: 'node-plaque',
      anchorNodeIds: outputs,
      plaqueStyle: 'fission',
      nativeContent,
      rows: verbatimRows(authoredValues)
    });
    return;
  },
  'impoverishment': (context) => {
    const { anchors, values, primaryRelation, base, authoredValues } = context.claim;
    const { requireResolved, pushDiagnostic, pushNeutralFallback, items } = context.output;
    const terminal = flattenAnchorIds(anchors.terminal)[0];
    if (!requireResolved('terminal', terminal)) return;
    const nativeContent = prepareNativePlaqueContent('impoverishment', verbatimRows(values), [terminal]);
    if (!nativeContent) {
      pushDiagnostic('illegal-configuration', 'Native impoverishment requires an ordered hierarchy and one unambiguous delinking edge');
      pushNeutralFallback(primaryRelation.anchors, false);
      return;
    }
    items.push({
      ...base,
      kind: 'node-plaque',
      anchorNodeIds: [terminal],
      plaqueStyle: 'impoverishment',
      nativeContent,
      rows: verbatimRows(authoredValues)
    });
    return;
  },
  'local-dislocation': (context) => {
    const { resolvedIds, pushDiagnostic, items } = context.output;
    const { anchors, values, base, authoredValues } = context.claim;
    const { stage, stageIndex, stageList } = context.workspace;
    const sequence = resolvedIds('sequence', anchors.sequence);
    if (sequence.length === 0) return;
    const nativeContent = prepareLocalDislocationContent({
      sequenceNodeIds: sequence,
      currentForest: stage.workspaceForest || [],
      priorForest: stageIndex > 0 ? stageList[stageIndex - 1].workspaceForest : undefined,
      values
    });
    if (!nativeContent) {
      pushDiagnostic('signature-incomplete', 'LocalDislocation requires distinct, complete before and after sequence groupings');
      return;
    }
    items.push({
      ...base,
      kind: 'node-plaque',
      anchorNodeIds: sequence,
      plaqueStyle: 'dislocation-lane',
      nativeContent,
      rows: verbatimRows(authoredValues)
    });
    return;
  },
  'cyclic-linearization': (context) => {
    const { resolvedIds, pushDiagnostic, pushNeutralFallback, items } = context.output;
    const { anchors, primaryRelation, base, values, authoredValues } = context.claim;
    const { stage, stageIndex, stageList } = context.workspace;
    const order = resolvedIds('order', anchors.order);
    if (order.length === 0) {
      pushDiagnostic(
        'endpoint-missing',
        'CyclicLinearization requires an ordering ledger'
      );
      return;
    }
    const evidence = buildTier2FacetEvidence({
      relation: primaryRelation,
      currentForest: stage.workspaceForest,
      ...(stageIndex > 0 ? { priorForest: stageList[stageIndex - 1].workspaceForest } : {})
    });
    const nativeContent = prepareNativeLinearizationContent(evidence);
    if (!nativeContent) {
      pushDiagnostic('illegal-configuration', 'CyclicLinearization has no complete, unambiguous prior/current comparison content');
      pushNeutralFallback(anchors, false);
      return;
    }
    items.push({
      ...base,
      kind: 'node-plaque',
      anchorNodeIds: order,
      plaqueStyle: 'linearization',
      nativeContent,
      ...(scalarValue(values, 'outcome') ? { title: scalarValue(values, 'outcome') } : {}),
      rows: verbatimRows(authoredValues)
    });
    return;
  }
} satisfies Partial<RegisteredPlanCompilers>;

const pfStructuredFacet = (context: FacetPlanContext) => {
  const { facet, evidence, many, rows, diagnostics, relationRef, facetId, push, base } = context;
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
    : config.style === 'fission' ? prepareNativeFissionContent(evidence)
      : config.style === 'dislocation-lane' ? prepareLocalDislocationContent({
        sequenceNodeIds: many(config.role), currentForest: evidence.currentForest,
        priorForest: evidence.priorForest, rows,
        values: Object.fromEntries((evidence.authoredValues ?? []).map(entry => [entry.key, entry.items]))
      })
        : prepareNativePlaqueContent(config.style, tier2NativePlaqueRows(evidence), many(config.role));
  if (['fission', 'impoverishment', 'correspondence', 'linearization', 'dislocation-lane'].includes(config.style) && !nativeContent) {
    diagnostics.push({
      stageIndex: relationRef.stageIndex, relationIndex: relationRef.relationIndex,
      relation: relationRef.relation, kind: 'illegal-configuration', detail: `Tier-2 ${facetId} has no complete prepared content`
    });
    return;
  }
  push({
    ...base(facet, config.pieces, config.family),
    kind: 'node-plaque',
    anchorNodeIds: many(config.role),
    plaqueStyle: config.style,
    rows,
    ...(facetId === 'pf.rewrite' ? prepareRewriteRows(evidence, rows)
      : config.style === 'realization' ? { realizationRowKinds: rows.map(() => 'literal' as const) } : {}),
    ...(nativeContent ? { nativeContent } : {})
  });
  return;
};

export const pfFacetPlan = {
  'ellipsis.site': (context: FacetPlanContext) => {
    const { one, push, base, facet, nodes } = context;
    const site = one('ellipsis.site');
    push({
      ...base(facet, ['Ghosting'], 'ellipsis.ghosting'),
      kind: 'ellipsis-site',
      siteNodeId: site,
      ghostNodeIds: collectAuthoredSilentSubtreeIds(nodes.get(site)),
      siteSubtreeNodeIds: collectSubtreeIds(nodes.get(site)),
      subtreeDerived: [
        { field: 'ghostNodeIds', rootNodeId: site, mode: 'authored-silent' },
        { field: 'siteSubtreeNodeIds', rootNodeId: site, mode: 'all' }
      ]
    });
    return;
  },
  'correspondence.alignment': (context: FacetPlanContext) => {
    const { many, push, base, facet, evidence } = context;
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
  },
  'deletion.site': (context: FacetPlanContext) => {
    const { push, base, facet, one } = context;
    push({
      ...base(facet, ['Strike'], 'copy.partial-deletion'),
      kind: 'strike-ghost',
      strikeNodeIds: [one('deleted.material')],
      ghostNodeIds: []
    });
    return;
  },
  'pf.structured': pfStructuredFacet,
  'pf.rewrite': pfStructuredFacet,
  'pf.correspondence': pfStructuredFacet,
  'pf.fission': pfStructuredFacet,
  'pf.impoverishment': pfStructuredFacet,
  'pf.local-dislocation': pfStructuredFacet,
  'pf.linearization': pfStructuredFacet
} satisfies Partial<FacetPlanCompilers>;

import type { DerivationStage, SyntaxNode } from '../../types.ts';
import { dispatchRelationStages, projectRelationStages, type DispatchedRelationStages } from '../relationStages.ts';
import { productionRelationRegistry } from '../relationDispatch/productionRegistry.js';
import { findRelationRegistryEntry } from '../relationDispatch/relationRegistry.js';
import { isWordlessCategoryLeaf } from '../replaySurfaceNotation.ts';
import { domainPlan } from './domainPlan.ts';
import { fallbackDrawing } from './fallbackTopology.ts';
import { featurePlan } from './featurePlan.ts';
import { LARGE_ANCHOR_ARRAY_THRESHOLD, compileLargeAnchorSets } from './largeAnchorSets.ts';
import { movementPlan } from './movementPlan.ts';
import { pfPlan } from './pfPlan.ts';
import { createPlanCoalescer } from './planCoalescence.ts';
import { materializePlanFrames } from './planPersistence.ts';
import {
  collectForest,
  collectSubtreeIds,
  firstRole,
  flattenAnchorIds,
  stableChainKey,
  structuralLeafCount
} from './planSyntax.ts';
import type { RegisteredPlanCompilers } from './registeredPlanContext.ts';
import { singleValue } from './tier2PlanValues.ts';
import {
  FULL_ARRAY_OWNED_ROLES,
  PRODUCTION_RENDER_FAMILIES,
  TRAJECTORY_SOURCE_ROLES,
  TRAJECTORY_TARGET_ROLES,
  TRAJECTORY_WITNESS_ROLES,
  type ProductionRenderFamily
} from './renderFamilies.ts';
import {
  planItemDependencyNodeIds,
  planItemRelationRefs,
  type AnchorSetPlanItem,
  type DirectedPathPlanItem,
  type PlanDiagnostic,
  type PlanItemBase,
  type PlanRelationRef,
  type RelationPlanItem,
  type RelationRenderPlan
} from './renderPlan.ts';
import { structuralPlan } from './structuralPlan.ts';
import { recoveredClaimMovements } from './tier2RelationDispatch.ts';
import { compileTier2RelationOutputs } from './tier2RenderPlanCompiler.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';
import { headTrajectoryAttachment } from './trajectoryAttachment.ts';

/**
 * Compile authored stages into geometry-free relation plans. Exact Tier-1 claims
 * and structurally recovered Tier-2 claims share drawing families; unsupported
 * claims keep neutral drawings. Current and prior anchors resolve only in their
 * own authored stages. Missing evidence never earns a substitute endpoint.
 * Stages are read as Replay reads them (relationStages.ts), so the plan and the
 * Replay moments interpret every claim from the same dispatches.
 *
 * Composition can share pixels, but retains every contributing claim and its
 * relation moment. Ownership, attachment and lifetime rules live in renderPlan;
 * relationFrame projects the resulting marks for playback.
 */

export type CompilePlanOptions = {
  registry?: typeof productionRelationRegistry;
  families?: Record<string, ProductionRenderFamily>;
  activeLens?: boolean;
};

const conventionalIndex = (ordinal: number): string => 'ijklmnopqrstuvwxyz'[ordinal] ?? `i${ordinal + 1}`;

// Private-use delimiters for a dependency index that is settled after compilation.
const PLACEHOLDER_OPEN = '';
const PLACEHOLDER_CLOSE = '';
const PLACEHOLDER = /(\d+)/gu;

/** Replaces settled dependency placeholders throughout plan items, in place.
 * Only strings holding a placeholder are rewritten; shared values are left untouched. */
const replacePlaceholders = (value: unknown, letters: readonly string[], seen = new WeakSet<object>()): void => {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      const settled = item.replace(PLACEHOLDER, (_, ordinal) => letters[Number(ordinal)]);
      if (settled !== item) (value as Record<string, unknown>)[key] = settled;
    } else replacePlaceholders(item, letters, seen);
  }
};

export const compileRelationRenderPlan = (
  stages: DerivationStage[],
  options: CompilePlanOptions = {}
): RelationRenderPlan => {
  const registry = options.registry ?? productionRelationRegistry;
  return compileDispatchedRelationRenderPlan(
    dispatchRelationStagesForPlan(projectRelationStages(stages), { registry, activeLens: options.activeLens }), options);
};

/** Dispatches stages as the plan and Replay read them: a structure-only plaque
 * learns from a first compiled plan where later drawings put their plaques. */
export const dispatchRelationStagesForPlan = (
  stages: DispatchedRelationStages['stages'],
  options: Parameters<typeof dispatchRelationStages>[1] = {}
): DispatchedRelationStages => dispatchRelationStages(stages, {
  plaqueHosts: dispatches => nodePlaqueHosts(compileDispatchedRelationRenderPlan({ stages, dispatches },
    options.registry ? { registry: options.registry } : {})), ...options });

/** The nodes on which each relation's node plaques are drawn, keyed `stageIndex:relationIndex`. */
const nodePlaqueHosts = (plan: RelationRenderPlan) => {
  const hosts = new Map<string, Set<string>>();
  for (const frame of plan.frames)
    for (const item of frame.items) {
      if (item.kind !== 'node-plaque' || item.claimTier === 3) continue;
      for (const ref of [item.relationRef, ...(item.coalescedRefs ?? [])]) {
        const key = `${ref.stageIndex}:${ref.relationIndex}`;
        hosts.set(key, new Set([...(hosts.get(key) ?? []), ...item.anchorNodeIds.map(String)]));
      }
    }
  return hosts;
};

/** Compiles stages already dispatched with the same registry, as Replay
 * preparation does so that its frame relations reuse those dispatches. */
export const compileDispatchedRelationRenderPlan = (
  { stages: stageList, dispatches: stageDispatches }: DispatchedRelationStages,
  options: Omit<CompilePlanOptions, 'activeLens'> = {}
): RelationRenderPlan => {
  const registry = options.registry ?? productionRelationRegistry;
  const families = options.families ?? PRODUCTION_RENDER_FAMILIES;
  const companionAnchors = (stageIndex: number, relationIndex: number) => {
    const dispatch = stageDispatches[stageIndex][relationIndex];
    return dispatch.primaryClaim?.tier === 1 ? dispatch.boundPrimaryRelation.anchors : {};
  };
  // The curated feature/value notation names one row. Additional or competing
  // fields cannot be folded into that row; supported generic rows stay separate.
  const caseAgreementRow = (stageIndex: number, relationIndex: number) => {
    const fields = stageDispatches[stageIndex][relationIndex].evidence.authoredValues ?? [];
    const row = { label: '', value: '' };
    const assigned = new Set<keyof typeof row>();
    for (const field of fields) {
      const slot = field.concepts.includes('feature.label') ? 'label'
        : normalizeTier2Synonym(field.key) === 'value' ? 'value' : undefined;
      if (!slot || field.items.length !== 1 || (assigned.has(slot) && row[slot] !== field.items[0])) return undefined;
      row[slot] = field.items[0];
      assigned.add(slot);
    }
    return row;
  };
  const diagnostics: PlanDiagnostic[] = [];
  const unregisteredCounts = new Map<string, number>();
  const items: RelationPlanItem[] = [];

  /*
   * Dependency indices. A stage where the model authored the dependency's index
   * shows that index, and the dependency's other stages show the first index
   * authored for it. A dependency the model never indexed gets the next of
   * i, j, k... that no authored index uses, in order of first appearance and
   * never from a list position. Letters are settled after every stage is
   * compiled, so an index authored in a later stage governs earlier ones too.
   */
  const dependencyPlaceholders = new Map<string, string>();
  const authoredDependencyIndex = new Map<string, string>();
  const dependencyIndexFor = (key: string, authored?: string): string => {
    if (!dependencyPlaceholders.has(key)) {
      dependencyPlaceholders.set(key, `${PLACEHOLDER_OPEN}${dependencyPlaceholders.size}${PLACEHOLDER_CLOSE}`);
    }
    if (!authored?.trim()) return dependencyPlaceholders.get(key)!;
    if (!authoredDependencyIndex.has(key)) authoredDependencyIndex.set(key, authored);
    return authored;
  };
  let phaseArcOrdinal = 0;
  const nextPhaseIsPrimary = () => phaseArcOrdinal++ === 0;

  const stageNodeMaps = stageList.map(stage => collectForest(stage.workspaceForest));
  const { coalescedCaseItems, coalesceFrames } = createPlanCoalescer(stageDispatches, stageNodeMaps);

  stageList.forEach((stage, stageIndex) => {
    const nodes = stageNodeMaps[stageIndex];
    const priorNodes = stageIndex > 0
      ? stageNodeMaps[stageIndex - 1]
      : null;
    const relations = Array.isArray(stage?.relations) ? stage.relations : [];
    const pendingAgreementCollections: Array<(cases: DirectedPathPlanItem[]) => void> = [];
    /*
     * PF composition provenance: a VocabularyInsertion row joins a
     * PFRealization plate only when its own resolved target anchor is among
     * that package's explicitly authored targets. Multiple packages in one
     * stage stay separate; an insertion with no resolving target, or no
     * matching package, never contaminates another plate.
     */
    const pfPackages = relations.flatMap((candidate, candidateIndex) => {
      const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
      if (!candidateEntry || families[candidateEntry.id]?.family !== 'realization-plate') return [];
      const packageAnchors = companionAnchors(stageIndex, candidateIndex);
      if (!['root', 'verbalHead', 'tense', 'feature', 'exponent']
        .some((role) => packageAnchors[role] !== undefined)) return [];
      return [{
        relationIndex: candidateIndex,
        targets: new Set(Object.values(packageAnchors).flatMap(flattenAnchorIds))
      }];
    });
    const pfPackageIndices = new Set(pfPackages.map((pfPackage) => pfPackage.relationIndex));
    const vocabularyAssignments = new Map<number, number>();
    relations.forEach((candidate, candidateIndex) => {
      const candidateEntry = findRelationRegistryEntry(registry, candidate.relation);
      if (!candidateEntry) return;
      const candidateFamily = families[candidateEntry.id]?.family;
      const isVocabularyInsertion = candidateFamily === 'vocabulary-insertion'
        || (candidateFamily === 'realization-plate' && !pfPackageIndices.has(candidateIndex));
      if (!isVocabularyInsertion) return;
      const candidateAnchors = companionAnchors(stageIndex, candidateIndex);
      const viTarget = flattenAnchorIds(candidateAnchors.terminal || candidateAnchors.target)[0];
      if (!viTarget || !nodes.has(viTarget)) return;
      /*
       * Ownership must be provable, never first-win: an insertion joins a
       * package only when exactly one package's authored anchors contain its
       * target. A target shared by several packages is ambiguous authored
       * data — the insertion keeps its own standalone plate and the
       * ambiguity is diagnosed instead of silently resolved.
       */
      const owningPackages = pfPackages.filter((pfPackage) => pfPackage.targets.has(viTarget));
      if (owningPackages.length === 1) {
        vocabularyAssignments.set(candidateIndex, owningPackages[0].relationIndex);
      } else if (owningPackages.length > 1) {
        diagnostics.push({
          stageIndex,
          relationIndex: candidateIndex,
          relation: candidate.relation,
          kind: 'ambiguous-package-ownership',
          detail: `insertion target ${viTarget} is anchored by ${owningPackages.length} PF packages `
            + `(relation indices ${owningPackages.map((pfPackage) => pfPackage.relationIndex).join(', ')}); `
            + 'the row stays standalone instead of joining the first package'
        });
      }
    });

    const pendingNeutralFallbacks: Array<() => void> = [];
    relations.forEach((relation, relationIndex) => {
      const relationRef: PlanRelationRef = {
        stageIndex,
        relationIndex,
        relation: relation.relation,
        anchors: relation.anchors,
        ...(relation.priorAnchors ? { priorAnchors: relation.priorAnchors } : {}),
        ...(relation.values ? { values: relation.values } : {})
      };
      const pushDiagnostic = (kind: PlanDiagnostic['kind'], detail: string) => {
        diagnostics.push({ stageIndex, relationIndex, relation: relation.relation, kind, detail });
      };

      /*
       * priorAnchors resolve only against the immediately preceding stage,
       * and the authored block proves something only as a WHOLE: a block
       * with any unresolved witness is retained verbatim in the relationRef
       * and diagnosed, but it draws no backward continuity cue and proves
       * no replacement continuity — a subset of a prior block never
       * silently stands in for the whole authored claim.
       */
      if (relation.priorAnchors) {
        if (!priorNodes) {
          pushDiagnostic(
            'prior-anchor-without-prior-stage',
            'priorAnchors authored at stage 0 have no preceding stage to resolve against'
          );
        } else {
          Object.entries(relation.priorAnchors).forEach(([role, value]) => {
            flattenAnchorIds(value).forEach((nodeId) => {
              if (!priorNodes.has(nodeId)) {
                pushDiagnostic(
                  'prior-anchor-unresolved',
                  `${role} -> ${nodeId} does not resolve in the preceding stage; the incomplete `
                  + 'block draws no backward cue and proves no continuity'
                );
              }
            });
          });
        }
      }

      const claimDispatch = stageDispatches[stageIndex][relationIndex];
      const unrecovered = claimDispatch.evidenceCoverage.fields.filter(field =>
        field.unrecoveredItemIndices.length || field.unrecoveredEmptyField);
      if (claimDispatch.claims.some(claim => claim.tier === 3)) {
        diagnostics.push({
          stageIndex, relationIndex, relation: relation.relation,
          kind: 'claim-evidence',
          detail: unrecovered.map(field => `${field.field}.${field.key}: ${field.concepts.length
            ? 'candidate meanings exist, but no selected drawing accounts for this evidence'
            : 'no supported field meaning'}${field.unrecoveredEmptyField ? '; authored empty field' : `; original item indices ${field.unrecoveredItemIndices.join(',')}`}`).join('; ')
            || 'No complete supported claim. The original relation is retained.',
          evidenceCoverage: claimDispatch.evidenceCoverage,
          candidateFailures: claimDispatch.facetDiagnostics
        });
      }
      const primaryRelation = claimDispatch.primaryRelation;
      const primaryRelationRef: PlanRelationRef = {
        stageIndex,
        relationIndex,
        relation: primaryRelation.relation,
        anchors: primaryRelation.anchors,
        ...(primaryRelation.priorAnchors
          ? { priorAnchors: primaryRelation.priorAnchors }
          : {}),
        ...(primaryRelation.values ? { values: primaryRelation.values } : {})
      };
      const primaryPriorAnchorIds = Object.values(
        primaryRelation.priorAnchors ?? {}
      ).flatMap(flattenAnchorIds);
      const primaryPriorAnchorBlockComplete = primaryPriorAnchorIds.length > 0
        && Boolean(priorNodes)
        && primaryPriorAnchorIds.every((nodeId) => priorNodes!.has(nodeId));
      const primaryPriorWitnessNodeIds = primaryPriorAnchorBlockComplete
        ? primaryPriorAnchorIds
        : [];
      const primaryBackward = primaryPriorWitnessNodeIds.length > 0;

      if (claimDispatch.facets.length > 0) {
        const tier2 = compileTier2RelationOutputs({
          dependencyIndexFor,
          occurrenceIndexFor: (family, ids, authored) => dependencyIndexFor(stableChainKey(family, nodes, ids), authored),
          nextPhaseIsPrimary,
          identityIndexFor: (ids, authored) => dependencyIndexFor(stableChainKey('identity', nodes, ids), authored),
          relationRef,
          dispatch: claimDispatch,
          currentForest: stage?.workspaceForest || [],
          ...(stageIndex > 0
            ? { priorForest: stageList[stageIndex - 1]?.workspaceForest || [] }
            : {})
        });
        items.push(...tier2.items);
        diagnostics.push(...tier2.diagnostics);
      } else {
        claimDispatch.diagnostics.forEach((diagnostic) => {
          diagnostics.push({
            stageIndex,
            relationIndex,
            relation: relation.relation,
            kind: diagnostic.kind === 'unrecovered-evidence' ? 'unrecovered-evidence' : 'tier2-collision',
            detail: `${diagnostic.kind}:${diagnostic.collision}:${diagnostic.facets.join(',')}`
          });
        });
      }

      if (claimDispatch.tier1Dispatch.outcome === 'unregistered') {
        unregisteredCounts.set(
          relation.relation,
          (unregisteredCounts.get(relation.relation) ?? 0) + 1
        );
        if (claimDispatch.facets.length > 0 && !claimDispatch.primaryClaim) return;
      }

      const dispatch = claimDispatch.tier1Dispatch as {
        outcome: 'unregistered' | 'signature-incomplete' | 'resolved';
        registryEntryId?: string;
        signatureIssues: Array<Record<string, unknown>>;
      };

      /**
       * Neutral, name-free presentation of resolved witnesses through the
       * accepted fallback topology. Used for unregistered names and for
       * preserving evidence a specialized branch cannot or may not consume.
       */
      const pushNeutralFallback = (
        anchorSource: Record<string, string | string[]>,
        includePriorCue: boolean,
        fallbackRelation: PlanRelationRef = primaryRelationRef,
        claimIdentity = claimDispatch.primaryClaim?.canonicalClaimIdentity
      ) => {
        const resolvedAnchors: Record<string, string | string[]> = {};
        const fallbackClaim = claimDispatch.claims.find(claim => claim.canonicalClaimIdentity === claimIdentity);
        const anchorContext = fallbackClaim?.tier === 3 ? fallbackClaim.contextAnchors : undefined;
        Object.entries(anchorContext || anchorSource || {}).forEach(([role, value]) => {
          const ids = flattenAnchorIds(value);
          const resolved = ids.filter((nodeId) => {
            if (nodes.has(nodeId)) return true;
            pushDiagnostic(
              'anchor-unresolved',
              `${role} -> ${nodeId} does not resolve in its stage; its fallback mark fails closed`
            );
            return false;
          });
          if (resolved.length === 0) return;
          resolvedAnchors[role] = Array.isArray(value) ? resolved : resolved[0];
        });
        // The badge number is the relation's authored position in its stage,
        // so it matches the panel's relation list. Names play no part.
        const instanceNumber = relationIndex + 1;
        const drawing = fallbackDrawing(
          {
            relation: relation.relation,
            anchors: resolvedAnchors,
            ...(includePriorCue && primaryPriorWitnessNodeIds.length > 0
              ? { priorAnchors: { resolved: primaryPriorWitnessNodeIds } }
              : {})
          },
          instanceNumber
        );
        items.push({
          kind: 'fallback',
          relationRef: fallbackRelation,
          appearsAtStage: stageIndex,
          persistence: 'relation-only',
          backward: includePriorCue && primaryBackward,
          priorWitnessNodeIds: includePriorCue ? primaryPriorWitnessNodeIds : [],
          drawing,
          claimTier: 3,
          ...(claimIdentity
            ? { canonicalClaimIdentity: claimIdentity }
            : {})
        });
      };

      if (relation.relationContractFailure) {
        pushNeutralFallback(relation.anchors || {}, false, relationRef);
        return;
      }

      if (claimDispatch.residualRelation) {
        const residualClaim = claimDispatch.claims.find(claim => claim.kind === 'fallback-residual');
        pushNeutralFallback(claimDispatch.residualRelation.anchors, false,
          { ...claimDispatch.residualRelation, stageIndex, relationIndex }, residualClaim?.canonicalClaimIdentity);
      }

      if (dispatch.outcome === 'unregistered') {
        pushNeutralFallback(claimDispatch.primaryRelation.anchors || {}, true);
        return;
      }

      if (dispatch.outcome === 'signature-incomplete') {
        pushDiagnostic(
          'signature-incomplete',
          dispatch.signatureIssues
            .map((issue) => {
              const roleDetail = issue.role
                ?? (Array.isArray(issue.roles) ? issue.roles.join('|') : '')
                ?? '';
              const countDetail = issue.minPresentItems === undefined
                ? ''
                : `>=${issue.minPresentItems}`;
              return `${issue.kind}:${issue.field ?? ''}:${roleDetail || countDetail}${issue.reason ? `:${issue.reason}` : ''}`;
            })
            .join(', ') || 'signature incomplete'
        );
        /*
         * Claim extraction has already removed independently complete Tier-2
         * evidence. Whatever remains is the named primary claim itself. A
         * malformed registered primary therefore stays Tier 3; the compiler
         * never repairs it by silently ignoring roles.
         */
        pushNeutralFallback(claimDispatch.primaryRelation.anchors || {}, true);
        return;
      }

      const familyId = String(dispatch.registryEntryId);
      const family = families[familyId];
      if (!family) {
        pushDiagnostic(
          'signature-incomplete',
          `registry entry ${familyId} has no production render family`
        );
        pushNeutralFallback(primaryRelation.anchors || {}, true);
        return;
      }
      /*
       * Replacement grouping. Replacement is licensed only when two states
       * provably belong to the same authored relation thread:
       * - a replace-previous-instance family threads by its complete
       *   authored participant set — a later instance over the same nodes is
       *   a restatement of the same claim and replaces it;
       * - a later instance whose authored `priorAnchors` name exactly an
       *   earlier instance's participants has authored its own continuity
       *   with that state, and replaces it even though its current
       *   participant set differs (a grown linearization domain). A
       *   persistent family with prior-state replacement honours only this
       *   second thread, so its identical restatements keep sharing ink.
       * An instance over a different participant set with no authored
       * continuity is an independent claim and both persist. Nothing global
       * to the family ever replaces across unrelated participants.
       */
      const participantSetKey = (source: Record<string, string | string[]> | undefined): string =>
        Array.from(new Set(
          Object.values(source || {}).flatMap(flattenAnchorIds)
        )).sort().join(',');
      const replacementThread = `${familyId}:participants:${participantSetKey(primaryRelation.anchors)}`;
      /*
       * Replacement continuity across changed participants requires PROOF:
       * only a complete prior-anchor block whose every authored witness
       * resolved in the immediately preceding stage may name a predecessor
       * thread. An incomplete block is authored data that failed to verify —
       * it is diagnosed and retained verbatim, but it never erases an
       * earlier claim.
       */
      const replacesInstances = family.persistence === 'replace-previous-instance';
      const replacementPredecessor = (replacesInstances || family.priorStateReplacement)
        && primaryPriorAnchorBlockComplete
        ? `${familyId}:participants:${participantSetKey(primaryRelation.priorAnchors)}`
        : '';
      const base: PlanItemBase = {
        relationRef: primaryRelationRef,
        familyId,
        appearsAtStage: stageIndex,
        persistence: family.persistence,
        ...(replacesInstances || family.priorStateReplacement
          ? {
            replacementGroup: replacementThread,
            ...(replacementPredecessor
              ? { replacementPredecessorGroup: replacementPredecessor }
              : {})
          }
          : {}),
        backward: primaryBackward,
        priorWitnessNodeIds: primaryPriorWitnessNodeIds,
        claimTier: 1
      };

      const requireResolved = (role: string, nodeId: string): boolean => {
        if (nodeId && nodes.has(nodeId)) return true;
        pushDiagnostic(
          'anchor-unresolved',
          `${role} -> ${nodeId || '(missing)'} does not resolve in its stage; the mark fails closed`
        );
        return false;
      };
      const resolvedIds = (role: string, value: string | string[] | undefined): string[] =>
        flattenAnchorIds(value).filter((nodeId) => requireResolved(role, nodeId));
      const anchors = claimDispatch.boundPrimaryRelation.anchors || {};
      const values = claimDispatch.boundPrimaryRelation.values;
      const authoredValues = primaryRelation.values;

      const pushCompositeTrajectory = (trajectoryKind: 'phrasal' | 'head'): boolean => {
        const source = firstRole(anchors, TRAJECTORY_SOURCE_ROLES);
        const target = firstRole(anchors, TRAJECTORY_TARGET_ROLES);
        if (!source && !target) return false;
        if (!source || !target) {
          pushDiagnostic('endpoint-missing', `${relation.relation} movement requires one source and one landing anchor`);
          return true;
        }
        if (!requireResolved(source.role, source.nodeId)) return true;
        if (!requireResolved(target.role, target.nodeId)) return true;
        const witness = firstRole(anchors, TRAJECTORY_WITNESS_ROLES);
        if (trajectoryKind === 'phrasal' && !witness) {
          pushDiagnostic('witness-missing', `${relation.relation} movement requires an authored trace witness`);
          return true;
        }
        if (witness) {
          if (!requireResolved(witness.role, witness.nodeId)) return true;
          if (!collectSubtreeIds(nodes.get(source.nodeId)).includes(witness.nodeId)) {
            pushDiagnostic(
              'witness-outside-source',
              `${witness.role} -> ${witness.nodeId} is not inside ${source.role} -> ${source.nodeId}`
            );
            return true;
          }
        }
        const complexPhrase = trajectoryKind === 'phrasal'
          && structuralLeafCount(nodes.get(source.nodeId)) > 1;
        items.push({
          ...base,
          kind: 'trajectory',
          trajectoryKind,
          sourceNodeId: source.nodeId,
          targetNodeId: target.nodeId,
          ...(witness ? { witnessNodeId: witness.nodeId } : {}),
          sourceAttachment: trajectoryKind === 'head' ? headTrajectoryAttachment(nodes.get(source.nodeId)!)
            : complexPhrase || isWordlessCategoryLeaf(nodes.get(source.nodeId)!) ? 'shell-bottom' : 'terminal',
          targetAttachment: trajectoryKind === 'head' ? headTrajectoryAttachment(nodes.get(target.nodeId)!) : 'shell-bottom'
        });
        return true;
      };

      const specializedItemCountBefore = items.length;
      try {
        const compile = registeredPlanCompilers[family.family];
        if (compile) compile({
          claim: {
            anchors, base, family, values, familyId, relation, claimDispatch,
            primaryRelation, relationIndex, authoredValues, relationRef
          },
          workspace: { nodes, stage, stageList, stageIndex, relations },
          lookup: { caseAgreementRow, registry, families, companionAnchors, nextPhaseIsPrimary, vocabularyAssignments },
          output: {
            requireResolved, pushDiagnostic, items, dependencyIndexFor,
            pushCompositeTrajectory, pushNeutralFallback, resolvedIds,
            afterCaseCoalescence: complete => { pendingAgreementCollections.push(complete); }
          }
        });
        else pushDiagnostic('signature-incomplete', `family ${family.family} has no compiler branch`);
      } finally {
        const relationPresented = () => items.some(item => {
          const refs = [...planItemRelationRefs(item),
          ...(item.kind === 'node-plaque' ? item.rowRefs ?? [] : [])];
          return refs.some(ref => ref?.stageIndex === stageIndex && ref.relationIndex === relationIndex);
        });
        if (items.length === specializedItemCountBefore && !relationPresented()) {
          pendingNeutralFallbacks.push(() => {
            if (!relationPresented()) pushNeutralFallback(relation.anchors || {}, true);
          });
        }
      }
    });
    const caseItems = coalescedCaseItems(items);
    pendingAgreementCollections.forEach(complete => complete(caseItems));
    pendingNeutralFallbacks.forEach((presentFallbackIfStillNeeded) => {
      presentFallbackIfStillNeeded();
    });
  });

  // Organization follows each entry's proved owner, including its complete
  // witness set and replacement timing. It is materialized alongside that
  // owner's output rather than choosing one parent for a mixed relation.
  const organizationCompanions = new Map<RelationPlanItem, AnchorSetPlanItem[]>();
  const isFullArrayOwned = (relationName: string, role: string): boolean => {
    const ownedEntry = findRelationRegistryEntry(registry, relationName);
    if (!ownedEntry || !families[ownedEntry.id]) return false;
    return (FULL_ARRAY_OWNED_ROLES[ownedEntry.id] || []).includes(role);
  };
  const largeSets = compileLargeAnchorSets(stageList, isFullArrayOwned);
  largeSets.diagnostics.forEach((detail) => {
    diagnostics.push({
      stageIndex: -1, relationIndex: -1, relation: '',
      kind: 'large-array-anchor-unresolved', detail
    });
  });
  largeSets.sets.forEach((set) => {
    const parentRelation = stageList[set.stageIndex].relations[set.relationIndex];
    const relationItems = items.filter((item) =>
      item.relationRef.stageIndex === set.stageIndex
      && item.relationRef.relationIndex === set.relationIndex);
    const existingOrganization = relationItems.filter((item): item is AnchorSetPlanItem =>
      item.kind === 'anchor-set' && item.tier2FacetId === 'organization.large-anchor-set');
    existingOrganization.forEach(item => {
      item.organizationOwners = [item.tier2ClaimIdentity!];
      // A scoped organization recipe may omit other authored roles. Keep its
      // role ordinals from the complete instance when composing their rails.
      item.set = {
        ...item.set, roles: item.set.roles.map(role => ({
          ...role,
          roleIndex: set.roles.find(authoredRole => authoredRole.role === role.role)!.roleIndex
        }))
      };
    });
    const dispatch = stageDispatches[set.stageIndex][set.relationIndex];
    dispatch.claims.forEach(claim => {
      const roles = set.roles.flatMap(role => {
        if (!role.large) return [];
        const consumed = claim.consumedEvidence.filter(ref => ref.field === 'anchors' && ref.key === role.role);
        const anchors = role.anchors.filter(anchor => consumed.some(ref =>
          !ref.itemIndices || ref.itemIndices.includes(anchor.arrayIndex))
          && !existingOrganization.some(item => item.set.roles.some(existingRole =>
            existingRole.large && existingRole.role === role.role && existingRole.anchors.some(existingAnchor =>
              existingAnchor.arrayIndex === anchor.arrayIndex && existingAnchor.nodeId === anchor.nodeId))));
        return anchors.length ? [{ ...role, anchors }] : [];
      });
      if (!roles.length) return;
      const owners = relationItems.filter(item => item.kind !== 'anchor-set' && (claim.tier === 1
        ? item.claimTier === 1 || item.kind === 'fallback' && item.canonicalClaimIdentity === claim.canonicalClaimIdentity
        : claim.tier === 2 ? item.tier2ClaimIdentity === claim.facet.facetIdentity
          : item.kind === 'fallback' && item.canonicalClaimIdentity === claim.canonicalClaimIdentity));
      owners.forEach(owner => {
        const companion: AnchorSetPlanItem = {
          kind: 'anchor-set',
          relationRef: { ...parentRelation, stageIndex: set.stageIndex, relationIndex: set.relationIndex },
          appearsAtStage: owner.appearsAtStage,
          persistence: owner.persistence,
          backward: owner.backward,
          priorWitnessNodeIds: owner.priorWitnessNodeIds,
          tier2WitnessNodeIds: planItemDependencyNodeIds(owner),
          claimTier: owner.claimTier ?? claim.tier,
          organizationOwners: [claim.canonicalClaimIdentity],
          showBadges: owner.kind !== 'fallback',
          badgeSize: owner.familyId === 'pf.cyclic-linearization' ? 'compact' : 'standard',
          set: { ...set, roles }
        };
        const companions = organizationCompanions.get(owner) ?? [];
        companions.push(companion);
        organizationCompanions.set(owner, companions);
      });
    });
  });

  // Allocate notation across the derivation, never separately in each painter.
  // Reserve authored symbols before allocating, including later movement indices.
  const usedIndices = new Set<string>();
  const authoredIndicesByIdentity = new Map<string, Set<string>>();
  stageDispatches.forEach((dispatches, stageIndex) => {
    const nodes = stageNodeMaps[stageIndex];
    dispatches.forEach(dispatch => {
      const { evidence } = dispatch;
      const indices = evidence.values.index || [];
      indices.forEach(index => usedIndices.add(index));
      if (indices.length !== 1) return;
      recoveredClaimMovements(dispatch).forEach(movement => {
        const lineage = nodes.get(movement.targetNodeId)?.lineageId;
        if (!lineage) return;
        const key = `lineage:${lineage}`;
        const authored = authoredIndicesByIdentity.get(key) || new Set<string>();
        authored.add(indices[0]);
        authoredIndicesByIdentity.set(key, authored);
      });
    });
  });
  const unavailableLetters = new Set([...usedIndices, ...authoredDependencyIndex.values()]
    .map(index => index.trim().toLowerCase()));
  let nextDependencyOrdinal = 0;
  // A dependency also takes an index authored by a different relation about the
  // same nodes, such as trace binding between the two occurrences of one chain.
  const nodesOf = (key: string) => (key.startsWith('lineage:') ? key
    : key.slice(key.indexOf(':') + 1).split(/[|,]/u).sort().join(','));
  const authoredIndexByNodes = new Map<string, string>();
  stageDispatches.forEach((dispatches, stageIndex) => dispatches.forEach(({ evidence }) => {
    const authored = singleValue(evidence, 'index');
    const ids = [...new Set(Object.values(evidence.currentAnchors).flat())];
    if (!authored.trim() || ids.length < 2) return;
    const nodes = nodesOf(stableChainKey('relation', stageNodeMaps[stageIndex], ids));
    if (!authoredIndexByNodes.has(nodes)) authoredIndexByNodes.set(nodes, authored);
  }));
  const dependencyLetters = [...dependencyPlaceholders.keys()].map(key => {
    let index = authoredDependencyIndex.get(key) ?? authoredIndexByNodes.get(nodesOf(key)) ?? '';
    while (!index) {
      const candidate = conventionalIndex(nextDependencyOrdinal++);
      if (!unavailableLetters.has(candidate)) index = candidate;
    }
    return index;
  });
  replacePlaceholders(items, dependencyLetters);
  organizationCompanions.forEach(companions => replacePlaceholders(companions, dependencyLetters));
  items.forEach(item => { if ('index' in item) usedIndices.add(item.index); });
  const argumentIndexByKey = new Map<string, string>();
  const chainIndexByLineage = new Map([...dependencyPlaceholders.keys()]
    .map((key, ordinal) => [key, dependencyLetters[ordinal]] as const)
    .filter(([key]) => key.startsWith('lineage:')));
  // A phrasal chain's key lists every lineage its occurrences share, the
  // copied descendants' too (stableChainKey). An argument belongs to such a
  // chain when its own lineage is listed and its subtree carries all of them.
  const chainIndexOf = (stageIndex: number, nodeId: string, key: string): string | undefined => {
    if (chainIndexByLineage.has(key)) return chainIndexByLineage.get(key);
    const subtree = new Set<string>();
    const walk = (node: SyntaxNode) => {
      if (node.lineageId) subtree.add(String(node.lineageId));
      node.children?.forEach(walk);
    };
    const argument = stageNodeMaps[stageIndex].get(nodeId);
    if (argument) walk(argument);
    const own = key.slice('lineage:'.length);
    const letters = new Set([...chainIndexByLineage].flatMap(([chain, letter]) => {
      const shared = chain.slice('lineage:'.length).split('|');
      return shared.includes(own) && shared.every(lineage => subtree.has(lineage)) ? [letter] : [];
    }));
    return letters.size === 1 ? [...letters][0] : undefined;
  };
  let nextArgumentIndex = 0;
  // Theta notation identifies the exact argument, or its explicit root lineage.
  // Shared descendants and similarly spelled labels cannot merge arguments.
  // An argument whose chain already carries an index shows that same index.
  const argumentIndex = (stageIndex: number, nodeId: string): string => {
    const lineage = stageNodeMaps[stageIndex].get(nodeId)?.lineageId;
    const key = lineage ? `lineage:${lineage}` : `theta:${nodeId}`;
    if (!argumentIndexByKey.has(key)) {
      const authored = authoredIndicesByIdentity.get(key);
      let index = authored?.size === 1 ? [...authored][0] : (lineage && chainIndexOf(stageIndex, nodeId, key)) || '';
      while (!index) {
        const candidate = conventionalIndex(nextArgumentIndex++);
        if (!usedIndices.has(candidate)) index = candidate;
      }
      usedIndices.add(index);
      argumentIndexByKey.set(key, index);
    }
    return argumentIndexByKey.get(key)!;
  };
  items.forEach(item => {
    if (item.kind === 'node-plaque' && item.plaqueStyle === 'theta-grid') {
      item.thetaRoles = item.thetaRoles?.map(role => ({ ...role, index: argumentIndex(item.appearsAtStage, role.nodeId) }));
    } else if (item.kind === 'node-badges' && item.badgeStyle === 'theta-role') {
      item.badges = item.badges.map(badge => ({ ...badge, text: argumentIndex(item.appearsAtStage, badge.nodeId) }));
    }
  });

  // A persistent exact state keeps its replacement thread only where a later
  // claim of its family names it as the preceding state; otherwise the item is
  // unchanged. Tier-2 items keep their own threads.
  const stateThread = (item: RelationPlanItem) => item.claimTier === 1
    && Boolean(item.familyId && families[item.familyId]?.priorStateReplacement);
  const states = items.filter(stateThread);
  states.map(item => ({ item,
    named: states.some(later => later.appearsAtStage > item.appearsAtStage && later.replacementPredecessorGroup === item.replacementGroup),
    names: states.some(earlier => earlier.appearsAtStage < item.appearsAtStage && earlier.replacementGroup === item.replacementPredecessorGroup)
  })).forEach(({ item, named, names }) => {
    if (!named) delete item.replacementGroup;
    if (!names) delete item.replacementPredecessorGroup;
  });
  const frames = materializePlanFrames(items, stageList, stageDispatches, stageNodeMaps, organizationCompanions, diagnostics);
  coalesceFrames(frames);

  return {
    planVersion: 1,
    registryId: registry.registryId,
    registryVersion: registry.version,
    stageCount: stageList.length,
    frames,
    diagnostics,
    unregistered: Array.from(unregisteredCounts, ([relation, count]) => ({ relation, count }))
  };
};

export { LARGE_ANCHOR_ARRAY_THRESHOLD };

const registeredPlanCompilers = { ...movementPlan, ...structuralPlan, ...featurePlan, ...domainPlan, ...pfPlan } satisfies RegisteredPlanCompilers;

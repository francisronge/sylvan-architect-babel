import type { SyntaxNode } from '../../types.ts';
import { collectionAssignment, composeFeatureBundles } from './featureComposition.ts';
import { authoredOutcomeLiterals } from './outcomeResolver.ts';
import { flattenAnchorIds } from './planSyntax.ts';
import type { RelationClaimDispatch } from './relationClaims.ts';
import { mergeAnchorSetOrganization } from './relationFrame.ts';
import {
  planItemDependencyNodeIds,
  planItemRelationRefs,
  resolveDisplayedTrajectoryAttachments,
  type DirectedPathPlanItem,
  type OperatorVariableBindingPlanItem,
  type RelationPlanItem,
  type RelationRenderPlan,
  type TrajectoryPlanItem
} from './renderPlan.ts';
import { composeThetaGrids, thetaLetterRoles } from './thetaGridComposition.ts';

/** Deterministic layer order: lower draws first (further back). */
const LAYER_ORDER: Record<RelationPlanItem['kind'], number> = {
  'domain-mark': 0,
  'binding-domain': 1,
  'ellipsis-site': 2,
  enclosure: 3,
  'strike-ghost': 4,
  'branch-emphasis': 5,
  'shared-node': 6,
  'path-status': 7,
  trajectory: 8,
  'fong-component': 9,
  'blocked-access-lane': 10,
  'directed-path': 11,
  'undirected-link': 12,
  'gapping-alignment': 12,
  'quantifier-raising': 12,
  'operator-variable-binding': 12,
  'parasitic-gap-copy': 12,
  'split-antecedence': 12,
  coindex: 13,
  'node-badges': 14,
  'analysis-verdict': 14,
  'node-plaque': 15,
  fallback: 16,
  'anchor-set': 17
};

/** Complete-claim identity and composition share one policy. Restatement can
 * share ink, but never loses an authored relation moment. */
export function createPlanCoalescer(stageDispatches: RelationClaimDispatch[][], stageNodeMaps: Map<string, SyntaxNode>[],
  { shareRestatedPlaques = true }: { shareRestatedPlaques?: boolean } = {}) {
  const COALESCE_EXCLUDED_FIELDS = new Set([
    'relationRef',
    'composedRefs',
    'coalescedRefs',
    'appearsAtStage',
    'subtreeDerived',
    'positionNodeIds',
    'orthogonalDepartureNodeIds'
  ]);
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((out, key) => {
          out[key] = canonicalize((value as Record<string, unknown>)[key]);
          return out;
        }, {});
    }
    return value;
  };
  const coalesceKeyOf = (item: RelationPlanItem): string => {
    if (item.canonicalClaimIdentity) {
      return JSON.stringify(canonicalize({
        canonicalClaimIdentity: item.canonicalClaimIdentity,
        supersededAt: item.supersededAt,
        renderPart: item.tier2RenderPart || 'main'
      }));
    }
    if ((item.tier2OutputIdentities || []).length > 0) {
      return JSON.stringify(canonicalize({
        tier2OutputIdentities: [...item.tier2OutputIdentities!].sort(),
        supersededAt: item.supersededAt,
        renderPart: item.tier2RenderPart || 'main'
      }));
    }
    const content: Record<string, unknown> = {};
    Object.entries(item).forEach(([field, value]) => {
      if (COALESCE_EXCLUDED_FIELDS.has(field)) return;
      // A later label on the same occurrence does not create another feature
      // claim. Keep the original heading with the one persistent plaque; every
      // authored value and bound participant still contributes to its identity.
      if (item.kind === 'node-plaque' && item.anchorDerivedTitle && field === 'title') return;
      content[field] = value;
    });
    /*
     * The authored claim itself is meaning-bearing even where a specialized
     * primitive copies none of it onto its own fields: the complete anchor
     * role/value structure, `priorAnchors`, and every authored value belong
     * to the key. Relation IDENTITY is the registered render family (already
     * part of the item content via `familyId`): two registered aliases of
     * one family making the otherwise-identical complete claim are one
     * claim, and either authored Replay moment can activate the one mark.
     * An UNREGISTERED relation has no registered family, so its normalized
     * authored name is its identity — open relations never collapse across
     * different authored names. Only the authored stage/relation coordinates
     * are provenance and stay excluded — a persisted claim and its identical
     * later restatement still paint once.
     */
    // Registered role binding already proves equivalent wording. Reuse that
    // evidence for identity while keeping the original Replay references.
    const registered = item.claimTier === 1
      ? stageDispatches[item.relationRef.stageIndex]?.[item.relationRef.relationIndex]
      : undefined;
    const bound = registered?.tier1Dispatch.outcome === 'resolved'
      ? registered.boundPrimaryRelation : item.relationRef;
    content.authoredClaim = {
      ...(item.familyId
        ? {}
        : { relation: String(item.relationRef.relation || '').trim() }),
      anchors: bound.anchors ?? {},
      priorAnchors: bound.priorAnchors ?? null,
      values: item.relationRef.values ?? null
    };
    if (registered) {
      content.occurrenceLineages = Object.fromEntries(Object.values(bound.anchors ?? {})
        .flatMap(flattenAnchorIds).sort().map(id => [id,
          stageNodeMaps[item.appearsAtStage].get(id)?.lineageId ?? null]));
      if (item.backward) content.priorStageIndex = item.appearsAtStage - 1;
    }
    return JSON.stringify(canonicalize(content));
  };
  const mergeRelationRefs = (holder: RelationPlanItem, contributor: RelationPlanItem) => {
    const holderRefs = planItemRelationRefs(holder);
    const additionalRefs = planItemRelationRefs(contributor).filter(ref =>
      !holderRefs.some(existing => existing.stageIndex === ref.stageIndex && existing.relationIndex === ref.relationIndex));
    if (additionalRefs.length) holder.coalescedRefs = [...(holder.coalescedRefs || []), ...additionalRefs];
  };
  // Association sees the same complete Case claims as final visual coalescing.
  // Clones retain every restatement's moment without mutating uncompiled frames.
  const coalescedCaseItems = (candidates: RelationPlanItem[]): DirectedPathPlanItem[] => {
    const unique = new Map<string, DirectedPathPlanItem>();
    candidates.forEach(item => {
      if (item.kind !== 'directed-path' || item.pathStyle !== 'case-assignment') return;
      const key = coalesceKeyOf(item), holder = unique.get(key);
      if (holder) mergeRelationRefs(holder, item);
      else unique.set(key, { ...item });
    });
    return [...unique.values()];
  };

  /*
   * Different claims can paint the same plaque on one anchor: a later stage
   * restating a theta role for the trace of the same chain (the allocator gives
   * both arguments the chain's letter), or each stage restating one PF form.
   * Where their plaques stand together in a frame and yield at the same moment,
   * the earliest paints once and carries every later claim's moment and hover.
   * Other plaques' claims must also name the same occurrences, with the same
   * lineage: a plaque whose claim names another recipient is another claim. A grid's
   * letters already name its arguments' identity; its later restatement yields
   * its argument badges but keeps writing its own letters (restatedRoles). A claim about a preceding state (backward)
   * stays its own, as does a feature plaque on the source of a Case or
   * agreement path, which joins its plaque by the claims' authored stage
   * (featureComposition.ts, collectionPlaque).
   */
  const paintedPlaqueKey = (item: RelationPlanItem): string | undefined => item.kind !== 'node-plaque'
    || item.realization || item.rowRefs ? undefined : JSON.stringify(canonicalize({
      style: item.plaqueStyle, family: item.familyId ?? null, anchors: item.anchorNodeIds, title: item.title ?? null,
      rows: item.rows, native: item.nativeContent ?? null, kinds: item.realizationRowKinds ?? null,
      columns: item.thetaRoles?.map(role => [role.label, role.index ?? null]) ?? null,
      relationOnly: item.persistence === 'relation-only', supersededAt: item.supersededAt ?? null, backward: item.backward
    }));
  // The occurrences a plaque's claim names or depends on, each with its lineage where it stands.
  const participants = (item: RelationPlanItem) => JSON.stringify([...new Set([...planItemDependencyNodeIds(item),
    ...Object.values(item.relationRef.anchors ?? {}).flatMap(flattenAnchorIds)])]
    .map(id => [id, stageNodeMaps[item.appearsAtStage]?.get(id)?.lineageId ?? null]).sort());
  const coalesceRestatedPlaques = (items: RelationPlanItem[]): RelationPlanItem[] => {
    if (!shareRestatedPlaques) return items;
    const holders = new Map<string, RelationPlanItem>(), removed = new Set<RelationPlanItem>(), yielded = new Set<string>();
    const pathSources = new Set(items.flatMap(item => item.kind === 'directed-path' ? [item.fromNodeId] : []));
    const drawing = (item: RelationPlanItem) => JSON.stringify([item.relationRef.stageIndex, item.relationRef.relationIndex,
      item.tier2ClaimIdentity ?? null]);
    for (const item of items) {
      const face = paintedPlaqueKey(item);
      if (face === undefined || item.backward || item.kind === 'node-plaque' && item.plaqueStyle === 'feature'
        && item.anchorNodeIds.some(id => pathSources.has(id))) continue;
      const key = item.kind === 'node-plaque' && item.plaqueStyle === 'theta-grid' ? face : `${face}\u0000${participants(item)}`;
      const holder = holders.get(key);
      if (!holder) { holders.set(key, item); continue; }
      mergeRelationRefs(holder, item);
      removed.add(item);
      if (holder.kind === 'node-plaque' && item.kind === 'node-plaque' && item.plaqueStyle === 'theta-grid') {
        yielded.add(drawing(item));
        // The restatement still letters its own arguments, from its own moment.
        const written = new Set(thetaLetterRoles(holder).map(role => JSON.stringify([role.nodeId, role.index])));
        const restated = [...(item.thetaRoles ?? []).map(role => ({ ...role, relationRefs: role.relationRefs ?? planItemRelationRefs(item) })),
          ...item.restatedRoles ?? []].filter(role => !written.has(JSON.stringify([role.nodeId, role.index])));
        if (restated.length) holder.restatedRoles = [...holder.restatedRoles ?? [], ...restated];
      }
    }
    return items.filter(item => !removed.has(item) && !(item.kind === 'node-badges' && item.badgeStyle === 'theta-role'
      && yielded.has(drawing(item))));
  };

  const coalesceFrames = (frames: RelationRenderPlan['frames']) => {
    /*
     * Composition without semantic suppression. Babel never decides that two
     * authored linguistic claims are incompatible merely because they share a
     * visual channel: exactly identical marks are visually coalesced with every
     * contributing relation instance retained in `coalescedRefs`; distinct
     * marks remain distinct except for theta-grid rows, shared binding paths and
     * repeated descriptions of one unchanged movement. These pieces retain their
     * separate histories. The geometry binder routes
     * other marks apart. Replacement happens only through explicitly declared
     * replace-previous-instance family metadata, upstream of this pass.
     */
    /*
     * The general key requires the same complete semantic claim: the same
     * registered render family and every meaning-bearing field —
     * anchors, antecedents, labels, values, outcomes, ghost/member sets, the
     * backward cue, all of it. Sharing a route or a site is not identity; an
     * ellipsis claim naming a different antecedent, or a coincident path from
     * a different family, remains a distinct authored claim. The explicit grid,
     * binding and movement sharing rules below retain each claim's ownership.
     * The general key is the canonical serialization of
     * the whole item minus provenance bookkeeping (`relationRef`,
     * `coalescedRefs`) and the appearance stage — a persisted claim and an
     * identical later restatement still paint once in their co-visible frames.
     */
    const unchangedAssignmentInk = (part: RelationPlanItem) => {
      if (part.kind === 'node-plaque' && part.plaqueStyle === 'theta-grid') return {
        kind: part.kind, anchors: part.anchorNodeIds, roles: part.thetaRoles, rows: part.rows, supersededAt: part.supersededAt
      };
      if (part.kind === 'node-badges' && part.badgeStyle === 'theta-role') return {
        kind: part.kind, badges: part.badges, supersededAt: part.supersededAt
      };
      if (part.kind === 'directed-path' && part.pathStyle === 'case-assignment') return {
        kind: part.kind, from: part.fromNodeId, to: part.toNodeId, label: part.label,
        secondaryLabel: part.secondaryLabel, featureRow: part.featureRow, outcome: part.outcome, supersededAt: part.supersededAt
      };
      return null;
    };
    const unchangedMovementInk = (part: RelationPlanItem) => {
      if (part.kind !== 'trajectory' || !['phrasal', 'head'].includes(part.trajectoryKind)) return null;
      // A later chain description can share the movement's exact curve, including
      // across tiers. Prior-anchor bookkeeping is retained on each relation ref;
      // it does not make a second movement between the same exact occurrences.
      return {
        kind: part.trajectoryKind, source: part.sourceNodeId, target: part.targetNodeId,
        witness: part.witnessNodeId, sourceAttachment: part.sourceAttachment, targetAttachment: part.targetAttachment,
        sourceAttachmentNodeId: part.sourceAttachmentNodeId,
        headLandingSite: part.headLandingSite, departures: part.orthogonalDepartureNodeIds,
        occurrenceTransfers: part.occurrenceTransfers, outcome: part.outcome, supersededAt: part.supersededAt
      };
    };
    const retainsMovementOccurrences = (earlier: RelationPlanItem, later: RelationPlanItem) => {
      if (earlier.kind !== 'trajectory' || later.kind !== 'trajectory') return false;
      // Establish identity at the later claim's authored stage, before subsequent
      // hops replace either endpoint with a lower witness that did not exist yet.
      const authored = resolveDisplayedTrajectoryAttachments(later, id => stageNodeMaps[later.appearsAtStage].get(id),
        { stageIndex: later.appearsAtStage, playedRelationIndices: null }) as TrajectoryPlanItem;
      return [authored.sourceNodeId, authored.targetNodeId, authored.witnessNodeId].filter(Boolean).every(id => {
        const lineage = stageNodeMaps[earlier.appearsAtStage].get(id!)?.lineageId;
        return Boolean(lineage) && stageNodeMaps.slice(earlier.appearsAtStage, later.appearsAtStage + 1)
          .every(nodes => nodes.get(id!)?.lineageId === lineage);
      });
    };
    const unchangedCollectionInk = (item: RelationPlanItem) => item.kind === 'directed-path'
      && item.pathStyle === 'case-agree' && item.featureRow ? {
      from: item.fromNodeId, to: item.toNodeId, row: item.featureRow, outcome: item.outcome,
      authoredOutcomes: authoredOutcomeLiterals(item.relationRef.values),
      relationOnly: item.persistence === 'relation-only', supersededAt: item.supersededAt,
      backward: item.backward, priorWitnesses: item.priorWitnessNodeIds
    } : null;
    const retainsCollectionOccurrences = (earlier: RelationPlanItem, later: RelationPlanItem) => {
      if (earlier.kind !== 'directed-path' || later.kind !== 'directed-path') return false;
      return [later.fromNodeId, later.toNodeId].every(id => {
        const occurrence = stageNodeMaps[earlier.appearsAtStage].get(id);
        return occurrence && stageNodeMaps.slice(earlier.appearsAtStage, later.appearsAtStage + 1)
          .every(nodes => nodes.has(id) && nodes.get(id)?.lineageId === occurrence.lineageId);
      });
    };
    frames.forEach((frame) => {
      const movementRoutes = new Set(frame.items.flatMap((item) => (
        item.kind === 'trajectory'
          ? [`${item.sourceNodeId}\u0000${item.targetNodeId}`]
          : []
      )));
      frame.items = frame.items.filter((item) => !(
        item.kind === 'directed-path'
        && item.pathStyle === 'blocked-extraction'
        && movementRoutes.has(`${item.fromNodeId}\u0000${item.toNodeId}`)
      ));
      frame.items.sort((left, right) => {
        const layer = LAYER_ORDER[left.kind] - LAYER_ORDER[right.kind];
        if (layer !== 0) return layer;
        if (
          left.canonicalClaimIdentity
          && left.canonicalClaimIdentity === right.canonicalClaimIdentity
        ) {
          const tier = (left.claimTier ?? 4) - (right.claimTier ?? 4);
          if (tier !== 0) return tier;
        }
        if (left.appearsAtStage !== right.appearsAtStage) {
          return left.appearsAtStage - right.appearsAtStage;
        }
        return left.relationRef.relationIndex - right.relationRef.relationIndex;
      });
      const coalescedItems: RelationPlanItem[] = [];
      const coalesceHolderIndices = new Map<string, number>();
      const assignmentCandidates = coalescedCaseItems(frame.items);
      frame.items.forEach((item) => {
        // A shared row has one collector even when native and recovered claims
        // both own it. The accepted assignment and exact occurrences prove this
        // association; coincident coordinates or lineage alone do not.
        const collectionInk = unchangedCollectionInk(item);
        if (collectionInk && item.kind === 'directed-path') {
          const assignment = collectionAssignment(assignmentCandidates, item);
          const holder = assignment === undefined ? undefined : coalescedItems.find(candidate =>
            candidate.kind === 'directed-path' && collectionAssignment(assignmentCandidates, candidate) === assignment
            && retainsCollectionOccurrences(candidate, item)
            && JSON.stringify(canonicalize(unchangedCollectionInk(candidate))) === JSON.stringify(canonicalize(collectionInk)));
          if (holder) { mergeRelationRefs(holder, item); return; }
        }
        // Embedding an unchanged chain in a larger workspace does not create a
        // second trajectory. Keep both authored moments on the one proven path.
        const movementInk = unchangedMovementInk(item);
        if (movementInk) {
          const holder = coalescedItems.find(candidate => retainsMovementOccurrences(candidate, item)
            && JSON.stringify(canonicalize(unchangedMovementInk(candidate))) === JSON.stringify(canonicalize(movementInk)));
          if (holder) { mergeRelationRefs(holder, item); return; }
        }
        // Continuity can prove an existing assignment independently of its tier.
        // Reuse its ink only when the complete drawing and lifetime also agree.
        if (item.restatesAssignment) {
          const content = unchangedAssignmentInk(item);
          const holder = content && coalescedItems.find(candidate => planItemRelationRefs(candidate).some(ref =>
            ref.stageIndex === item.restatesAssignment!.stageIndex && ref.relationIndex === item.restatesAssignment!.relationIndex)
            && JSON.stringify(canonicalize(unchangedAssignmentInk(candidate))) === JSON.stringify(canonicalize(content)));
          if (holder) { mergeRelationRefs(holder, item); return; }
        }
        const key = coalesceKeyOf(item);
        const holderIndex = coalesceHolderIndices.get(key);
        if (holderIndex === undefined) {
          coalesceHolderIndices.set(key, coalescedItems.length);
          coalescedItems.push(item);
          return;
        }
        const holder = coalescedItems[holderIndex];
        if ((item.claimTier ?? 4) < (holder.claimTier ?? 4)) {
          mergeRelationRefs(item, holder);
          coalescedItems[holderIndex] = item;
          return;
        }
        mergeRelationRefs(holder, item);
      });
      // Compose only the binding piece, leaving each domain's timing and hover
      // ownership intact. Identity comes from dispatch, not matching geometry.
      const bindingGroups = new Map<string, OperatorVariableBindingPlanItem[]>();
      coalescedItems.forEach(item => {
        if (item.kind !== 'operator-variable-binding' || item.backward) return;
        const pathIdentity = item.tier2OutputIdentities?.find(identity =>
          JSON.parse(identity).piece === 'Variable-binding path');
        if (!pathIdentity) return;
        const key = JSON.stringify([pathIdentity, item.index, item.traceWitnessNodeId, item.supersededAt]);
        const group = bindingGroups.get(key) ?? [];
        group.push(item);
        bindingGroups.set(key, group);
      });
      bindingGroups.forEach(group => {
        if (group.length < 2) return;
        // Distinct explicitly scoped claims stay separate. Absence of a domain
        // can restate a scoped path, but cannot choose between different scopes.
        const domains = new Set(group.map(item => item.scopeDomainNodeId).filter(Boolean));
        if (domains.size > 1) return;
        const [holder, ...rest] = group;
        holder.bindingPathRefs = group.flatMap(planItemRelationRefs).filter((ref, index, refs) =>
          refs.findIndex(candidate => candidate.stageIndex === ref.stageIndex
            && candidate.relationIndex === ref.relationIndex) === index);
        rest.forEach(item => { item.bindingPathSuppressed = true; });
      });
      frame.items = mergeAnchorSetOrganization(coalesceRestatedPlaques(composeFeatureBundles(composeThetaGrids(coalescedItems, grid =>
        stageNodeMaps[grid.appearsAtStage].get(grid.anchorNodeIds[0])?.lineageId, frame.stageIndex))), false);
    });

  };
  return { coalescedCaseItems, coalesceFrames };
}

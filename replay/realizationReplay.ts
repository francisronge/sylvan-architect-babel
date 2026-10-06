import type { DerivationStageRelation, SurfaceRealization, SyntaxNode } from '../types.ts';
import type { PlaybackStep, ReplayDerivationFrame } from './replayCompiler.ts';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from './displayIdentity.ts';
import { recoverMovementEvidence } from './relations/movementEvidence.ts';
import { dispatchRelationClaims, type RelationClaimDispatch } from './relations/tier2RelationDispatch.ts';
import { isRealizationDescription, normalizeTier2Synonym, relationLabelClauses } from './relations/tier2Synonyms.ts';
import { establishesAssignment } from './relations/assignmentContinuity.ts';
import { readCategoryLabel } from './categoryLabel.ts';

export const cloneRealizations = (groups: readonly SurfaceRealization[]): SurfaceRealization[] =>
  groups.map(group => ({ nodeIds: [...group.nodeIds], tokenIndices: [...group.tokenIndices] }));

const groupKey = (group: SurfaceRealization): string => JSON.stringify([
  [...group.nodeIds].sort(), [...group.tokenIndices].sort((a, b) => a - b)
]);

const anchorIds = (anchors?: DerivationStageRelation['anchors']): Set<string> =>
  new Set(Object.values(anchors || {}).flat());

const sameMembers = <T,>(left: readonly T[], right: readonly T[]) => left.length === right.length
  && new Set(left).size === left.length && new Set(right).size === right.length
  && left.every(item => right.includes(item));

const inputSequenceRole = (key: string) => /^(?:input (?:parts|pieces(?: in order)?|tokens)|surface pieces)$/u
  .test(normalizeTier2Synonym(key));

const pronunciationRole = (key: string, pronounced: boolean) =>
  new RegExp(`^${pronounced ? 'pronounced' : 'unpronounced'}(?: (?:occurrence|copy|contributors?))?$`, 'u')
    .test(normalizeTier2Synonym(key));

const exactRoleMembers = (anchors: DerivationStageRelation['anchors'] | undefined, role: (key: string) => boolean) => {
  const entries = Object.entries(anchors ?? {}).filter(([key]) => role(key)).map(([, value]) => [value].flat());
  return entries.length && entries.every(entry => sameMembers(entry, entries[0])) ? entries[0] : [];
};

const orderedContent = (node: SyntaxNode): string => {
  const content = Object.fromEntries(Object.entries(node).filter(([key]) => !['id', 'lineageId', 'children'].includes(key))
    .sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify([content, (node.children ?? []).map(orderedContent)]);
};

/** A proved phrase movement can carry renamed descendants. Correspondence is
 * confined to its unchanged ordered subtree; similar words elsewhere prove nothing. */
const copiedDescendants = (before: SyntaxNode, landing: SyntaxNode): Map<string, string> | undefined => {
  if (orderedContent(before) !== orderedContent(landing)) return undefined;
  const pairs = new Map<string, string>();
  const visit = (old: SyntaxNode, next: SyntaxNode): boolean => {
    if (pairs.has(old.id) || [...pairs.values()].includes(next.id)) return false;
    if (old.lineageId && next.lineageId && old.lineageId !== next.lineageId) return false;
    pairs.set(old.id, next.id);
    const oldChildren = old.children ?? [], nextChildren = next.children ?? [];
    return oldChildren.every((child, index) => {
      const target = nextChildren[index];
      const identified = child.id === target.id || Boolean(child.lineageId && child.lineageId === target.lineageId);
      if (!identified && oldChildren.filter(sibling => orderedContent(sibling) === orderedContent(child)).length !== 1) return false;
      return visit(child, target);
    });
  };
  return visit(before, landing) ? pairs : undefined;
};

const syntaxIds = (forest: readonly SyntaxNode[]): Set<string> => {
  const ids = new Set<string>();
  const visit = (node: SyntaxNode) => {
    if (node.id) ids.add(node.id);
    node.children?.forEach(visit);
  };
  forest.forEach(visit);
  return ids;
};

interface RealizationChange {
  before: SurfaceRealization[];
  after: SurfaceRealization[];
  relationIndex: number | null;
  candidateRelationIndices?: number[];
  diagnostic?: string;
}

/** A shared output is replaced atomically; shared source features may serve separate outputs. */
const changedGroups = (
  before: readonly SurfaceRealization[],
  after: readonly SurfaceRealization[]
): Array<Pick<RealizationChange, 'before' | 'after'>> => {
  const beforeKeys = new Set(before.map(groupKey));
  const afterKeys = new Set(after.map(groupKey));
  const entries = [
    ...before.filter(group => !afterKeys.has(groupKey(group))).map(group => ({ side: 'before' as const, group })),
    ...after.filter(group => !beforeKeys.has(groupKey(group))).map(group => ({ side: 'after' as const, group }))
  ];
  const parents = entries.map((_, index) => index);
  const find = (index: number): number => {
    if (parents[index] !== index) parents[index] = find(parents[index]);
    return parents[index];
  };
  const tokenOwners = new Map<number, number>();
  entries.forEach(({ group }, index) => group.tokenIndices.forEach(token => {
    const previous = tokenOwners.get(token);
    if (previous !== undefined) parents[find(index)] = find(previous);
    tokenOwners.set(token, index);
  }));
  const components = new Map<number, Pick<RealizationChange, 'before' | 'after'>>();
  entries.forEach(({ side, group }, index) => {
    const key = find(index);
    if (!components.has(key)) components.set(key, { before: [], after: [] });
    components.get(key)![side].push(group);
  });
  return [...components.values()];
};

export const resolveRealizationChanges = (
  previous: ReplayDerivationFrame | undefined,
  current: ReplayDerivationFrame,
  stageIndex: number,
  inputTokens?: readonly string[]
): RealizationChange[] => {
  const changes = changedGroups(previous?.after?.realizations || [], current.after?.realizations || []);
  if (!changes.length) return [];
  const nodes = (forest: readonly SyntaxNode[]) => {
    const result = new Map<string, SyntaxNode[]>();
    const visit = (node: SyntaxNode) => { result.set(node.id, [...(result.get(node.id) ?? []), node]); node.children?.forEach(visit); };
    forest.forEach(visit); return result;
  };
  const oldNodes = nodes(previous?.workspaceForest || []), newNodes = nodes(current.workspaceForest);
  const exactNode = (index: Map<string, SyntaxNode[]>, id: string) => index.get(id)?.length === 1 ? index.get(id)![0] : undefined;
  const relations = (current.relations || []).map(relation => ({
    current: anchorIds(relation.anchors), prior: anchorIds(relation.priorAnchors),
    movement: recoverMovementEvidence(relation, current.workspaceForest, previous?.workspaceForest || []).movement
  }));
  const claimDispatches = new Map<number, RelationClaimDispatch>();
  const claimsFor = (relationIndex: number) => {
    if (!claimDispatches.has(relationIndex)) claimDispatches.set(relationIndex, dispatchRelationClaims({
      relation: current.relations![relationIndex], stageIndex, relationIndex,
      currentForest: current.workspaceForest, priorForest: previous?.workspaceForest,
      currentRealizations: current.after?.realizations, priorRealizations: previous?.after?.realizations
    }));
    return claimDispatches.get(relationIndex)!;
  };
  const pfOutputs = (dispatch: RelationClaimDispatch) => dispatch.facets.flatMap(facet => {
      const evidence = facet.evidence ?? dispatch.evidence;
      const outputs = evidence.currentAnchors['rewrite.output'] ?? [];
      return facet.recipe.id.startsWith('pf.') && outputs.length
        ? [{ kind: facet.recipe.id, ids: outputs, collective: Boolean(evidence.realizationGroupAnchorKeys?.length) }] : [];
    });
  const outputCovers = (outputs: readonly string[], group: SurfaceRealization) => {
    if (sameMembers(outputs, group.nodeIds)) return true;
    if (outputs.length !== 1) return false;
    const owner = exactNode(newNodes, outputs[0]);
    if (!owner) return false;
    const leaves: string[] = [];
    const visit = (node: SyntaxNode) => node.children?.length ? node.children.forEach(visit) : leaves.push(node.id);
    visit(owner);
    return sameMembers(leaves, group.nodeIds);
  };
  const conditionerRole = (key: string) => /^(?:(?:morphological|allomorphic) )?conditioner$/u.test(normalizeTier2Synonym(key));
  const inputSequence = (index: number) => Object.entries(current.relations![index].values ?? {})
    .filter(([key]) => inputSequenceRole(key));
  const exactInputSequence = (index: number, groups: SurfaceRealization[]) => {
    const entries = inputSequence(index);
    if (!inputTokens || groups.length !== 1 || entries.length !== 1 || !Array.isArray(entries[0][1])) return false;
    const positions = [...groups[0].tokenIndices].sort((a, b) => a - b);
    return entries[0][1].length === positions.length
      && entries[0][1].every((item, i) => typeof item === 'string' && item.trim() && item === inputTokens[positions[i]]);
  };
  const pfOwns = (index: number, groups: SurfaceRealization[]) => !malformedClaim(claimsFor(index))
    && groups.length > 0 && groups.every(group =>
    pfOutputs(claimsFor(index)).some(output => outputCovers(output.ids, group)
      && (!inputSequence(index).length || exactInputSequence(index, groups))
      && (output.collective || Object.entries(current.relations![index].anchors ?? {}).every(([key, ids]) =>
        conditionerRole(key) || [ids].flat().every(id => {
          const node = exactNode(newNodes, id);
          return group.nodeIds.includes(id) || Boolean(node && node.children?.length
            && group.nodeIds.some(member => syntaxIds([node]).has(member)));
        })))));
  const inputAssociationOwns = (index: number, groups: SurfaceRealization[]) => {
    return pfOwns(index, groups) && exactInputSequence(index, groups);
  };
  const pronunciationOwns = (index: number, change: Pick<RealizationChange, 'before' | 'after'>) => {
    if (malformedClaim(claimsFor(index)) || change.before.length !== 1 || change.after.length !== 1
      || !sameMembers(change.before[0].tokenIndices, change.after[0].tokenIndices)) return false;
    const relation = current.relations![index];
    if (inputSequence(index).length && !exactInputSequence(index, change.after)) return false;
    if (!establishesAssignment(claimsFor(index).evidence)
      || relationLabelClauses(relation.relation).some(clause => /^(?:no|failed|blocked|pending|possible|hypothetical) (?:copy chain |copy )?pronunciation(?: selection)?$/u.test(clause))) return false;
    const pronounced = exactRoleMembers(relation.anchors, key => pronunciationRole(key, true));
    const unpronounced = exactRoleMembers(relation.anchors, key => pronunciationRole(key, false));
    if (!sameMembers(pronounced, change.after[0].nodeIds)
      || unpronounced.length !== change.before[0].nodeIds.length) return false;
    const paired = change.before[0].nodeIds.map(id => {
      const old = exactNode(oldNodes, id);
      const lowers = unpronounced.map(lowerId => exactNode(newNodes, lowerId))
        .filter(lower => old?.lineageId && lower?.lineageId === old.lineageId);
      return pronounced.filter(target => {
        const next = exactNode(newNodes, target);
        return old && lowers.length === 1 && next && old.lineageId === next.lineageId
          && lowers[0]!.id !== target && Boolean(lowers[0]!.silent) && !next.silent;
      });
    });
    return paired.every(pair => pair.length === 1) && new Set(paired.flat()).size === pronounced.length;
  };
  const malformedClaim = (dispatch: RelationClaimDispatch) => dispatch.claims.some(claim => claim.tier === 3
    && ['registered-signature-incomplete', 'malformed-authored-relation'].includes(claim.reason));
  const pfConcept = (concept: string) => /^(?:pf\.|rewrite\.)/u.test(concept);
  const receivingHeadRole = (key: string) => /^(?:host head|receiving head|target head|inflectional host|receiving host|target host)$/u
    .test(normalizeTier2Synonym(key));
  const receivingHosts = new Map<number, string | undefined>();
  const retainedReceivingHost = (index: number): string | undefined => {
    if (receivingHosts.has(index)) return receivingHosts.get(index);
    receivingHosts.set(index, undefined);
    const movement = relations[index].movement;
    if (!movement?.transition || movement.trajectoryKind !== 'head') return;
    const parentSlot = (nodes: Map<string, SyntaxNode[]>, id: string) => {
      const slots = [...nodes.values()].flat().flatMap(parent => (parent.children ?? [])
        .flatMap((child, position) => child.id === id ? [{ parent, position }] : []));
      return slots.length === 1 && exactNode(nodes, slots[0].parent.id) ? slots[0] : undefined;
    };
    const landing = exactNode(newNodes, movement.targetNodeId), shellSlot = parentSlot(newNodes, movement.targetNodeId);
    const shell = shellSlot?.parent;
    if (!landing || !shell || shell.children?.length !== 2 || oldNodes.has(shell.id)
      || readCategoryLabel(shell.label)?.kind !== 'head' || readCategoryLabel(landing.label)?.kind !== 'head') return;
    const host = shell.children.find(node => node.id !== landing.id);
    const oldHost = host && exactNode(oldNodes, host.id);
    if (!host || !oldHost || exactNode(newNodes, host.id) !== host
      || readCategoryLabel(host.label)?.kind !== 'head'
      || readCategoryLabel(host.label)?.head !== readCategoryLabel(shell.label)?.head
      || !movement.context?.some(context => [shell.id, host.id].includes(context.nodeId)
        && ['head-host', 'head-complex', 'head-landing'].includes(context.kind))) return;
    const { word: _beforeWord, ...beforeContent } = oldHost;
    const { word: _afterWord, ...afterContent } = host;
    if (JSON.stringify(beforeContent) !== JSON.stringify(afterContent)) return;
    const beforeSlot = parentSlot(oldNodes, host.id), afterSlot = parentSlot(newNodes, shell.id);
    if (!beforeSlot || !afterSlot || beforeSlot.parent.id !== afterSlot.parent.id
      || beforeSlot.parent.label !== afterSlot.parent.label || beforeSlot.position !== afterSlot.position
      || JSON.stringify(beforeSlot.parent.children!.map(node => node.id))
        !== JSON.stringify(afterSlot.parent.children!.map(node => node.id === shell.id ? host.id : node.id))) return;
    const { children: _beforeChildren, ...beforeParent } = beforeSlot.parent;
    const { children: _afterChildren, ...afterParent } = afterSlot.parent;
    if (JSON.stringify(beforeParent) !== JSON.stringify(afterParent)) return;
    receivingHosts.set(index, host.id);
    return host.id;
  };
  const rewriteDomainContext = (index: number, id: string): boolean => {
    const dispatch = claimsFor(index), outputs = pfOutputs(dispatch);
    if (!outputs.length || outputs.some(output => output.kind !== 'pf.rewrite')) return false;
    const outputIds = new Set(outputs.flatMap(output => output.ids));
    const before = exactNode(oldNodes, id), after = exactNode(newNodes, id);
    if (!before?.children?.length || !after?.children?.length || outputIds.has(id)) return false;
    const domain = syntaxIds([after]);
    if ([...domain].some(nodeId => !exactNode(newNodes, nodeId) || !exactNode(oldNodes, nodeId))
      || [...outputIds].some(nodeId => !domain.has(nodeId) || exactNode(newNodes, nodeId)?.children?.length)) return false;
    const conditioners = new Set(Object.entries(current.relations![index].anchors ?? {})
      .filter(([key]) => conditionerRole(key)).flatMap(([, ids]) => [ids].flat()));
    const terminals: string[] = [];
    const visit = (node: SyntaxNode) => node.children?.length ? node.children.forEach(visit) : terminals.push(node.id);
    visit(after);
    if (terminals.some(nodeId => !outputIds.has(nodeId) && !conditioners.has(nodeId))) return false;
    const content = (node: SyntaxNode): unknown => Object.fromEntries(Object.entries(node)
      .filter(([key]) => key !== 'word' || !outputIds.has(node.id))
      .map(([key, value]) => [key, key === 'children' ? node.children?.map(content) : value]));
    return JSON.stringify(content(before)) === JSON.stringify(content(after));
  };
  const literalAssociationScopes = new Map<number, SurfaceRealization | null>();
  const disjointLiteralAssociation = (index: number, change: Pick<RealizationChange, 'before' | 'after'>): boolean => {
    if (!literalAssociationScopes.has(index)) {
      const relation = current.relations![index];
      const assertions = Object.entries(relation.values ?? {})
        .filter(([key]) => normalizeTier2Synonym(key) === 'input association');
      const groups = current.after?.realizations ?? [];
      const outputs = new Set(pfOutputs(claimsFor(index)).flatMap(output => output.ids));
      // Corroborate the entire literal against one already authored output and
      // token mapping. This only bounds a competing assertion's scope; it does
      // not invent a claim, consume the prose, or grant ownership priority.
      const matches = inputTokens && assertions.length === 1 && typeof assertions[0][1] === 'string'
        ? groups.filter(group => {
          if (group.nodeIds.length !== 1 || !outputs.has(group.nodeIds[0]) || group.tokenIndices.length < 2) return false;
          const output = exactNode(newNodes, group.nodeIds[0]);
          if (!output?.word || output.children?.length || !pfOwns(index, [group])) return false;
          const positions = [...group.tokenIndices].sort((a, b) => a - b);
          if (positions.some((position, i) => !Number.isInteger(position) || position < 0
            || position >= inputTokens.length || i > 0 && position !== positions[i - 1] + 1)) return false;
          const pieces = positions.map(position => inputTokens[position]);
          if (pieces.some(piece => !piece || /\s/u.test(piece)) || pieces.join('') !== output.word) return false;
          if (assertions[0][1] !== `${output.word} corresponds collectively to ${pieces.join(' and ')}`) return false;
          if (groups.some(other => other !== group && (other.nodeIds.includes(output.id)
            || other.tokenIndices.some(position => positions.includes(position))))) return false;
          return [...newNodes.values()].flat().filter(node => node.word === output.word).length === 1;
        }) : [];
      literalAssociationScopes.set(index, matches.length === 1 ? matches[0] : null);
    }
    const scope = literalAssociationScopes.get(index);
    return Boolean(scope && [...change.before, ...change.after].every(group =>
      !group.nodeIds.some(id => scope.nodeIds.includes(id))
      && !group.tokenIndices.some(position => scope.tokenIndices.includes(position))));
  };
  const unsupportedPFAssertion = (index: number, change: Pick<RealizationChange, 'before' | 'after'>) => {
    const dispatch = claimsFor(index), relation = current.relations![index];
    if (malformedClaim(dispatch) || inputSequence(index).length && !exactInputSequence(index, change.after)) return true;
    if (Object.keys(relation.anchors ?? {}).some(key => pronunciationRole(key, true) || pronunciationRole(key, false))) return true;
    if (!pfOutputs(dispatch).length && (isRealizationDescription(relation.relation)
      || relationLabelClauses(relation.relation).some(clause => /\bpronunciation\b/u.test(clause)))) return true;
    return dispatch.evidenceCoverage.fields.some(field => {
      if (field.field === 'values' && normalizeTier2Synonym(field.key) === 'input association'
        && disjointLiteralAssociation(index, change)) return false;
      const explicit = field.concepts.some(pfConcept) || field.field === 'values'
        && /^(?:pronunciation(?: selection)?|input association)$/u.test(normalizeTier2Synonym(field.key));
      const ids = field.field === 'anchors' ? [relation.anchors?.[field.key] ?? []].flat() : [];
      if (field.field === 'anchors' && field.concepts.filter(pfConcept).every(concept => concept === 'rewrite.output')
        && ids.length === 1 && rewriteDomainContext(index, ids[0])) return false;
      return explicit && (field.unrecoveredItemIndices.length || field.unrecoveredEmptyField);
    });
  };
  const participantsRecovered = (index: number, change: Pick<RealizationChange, 'before' | 'after'>,
    allows: (claim: string) => boolean) => {
    const relation = current.relations![index];
    const movement = relations[index].movement;
    const affected = new Set([...change.before, ...change.after].flatMap(group => group.nodeIds));
    return claimsFor(index).evidenceCoverage.fields.every(field => {
      if (field.field === 'values') return true;
      const ids = [relation[field.field]?.[field.key] ?? []].flat();
      return ids.every((id, itemIndex) => !affected.has(id)
        || field.recognizedBy.some(owner => allows(owner.claim) && owner.itemIndices.includes(itemIndex))
        || allows('movement.path') && movement && (field.field === 'anchors'
          ? movement.context?.some(context => context.key === field.key && context.nodeId === id)
          : movement.priorContextKeys?.includes(field.key))
        || allows('movement.path') && receivingHeadRole(field.key) && id === retainedReceivingHost(index));
    });
  };
  const spellingRewriteOnly = (index: number, change: Pick<RealizationChange, 'before' | 'after'>) => {
    const dispatch = claimsFor(index), outputs = pfOutputs(dispatch);
    return !unsupportedPFAssertion(index, change) && participantsRecovered(index, change, claim => claim === 'pf.rewrite')
      && outputs.some(output => output.kind === 'pf.rewrite' && change.after.every(group => outputCovers(output.ids, group)))
      && !outputs.some(output => output.kind !== 'pf.rewrite' && change.after.some(group => outputCovers(output.ids, group)));
  };
  const incidentalContext = (index: number, change: Pick<RealizationChange, 'before' | 'after'>) => {
    const dispatch = claimsFor(index), relation = current.relations![index];
    const affected = new Set(change.after.flatMap(group => group.nodeIds));
    const outputs = pfOutputs(dispatch);
    if (unsupportedPFAssertion(index, change)) return false;
    if (outputs.length) {
      // A conditioner of one PF output is not an output of that claim.
      return !pfOwns(index, change.after)
        && Object.entries(relation.anchors ?? {}).every(([key, ids]) =>
        ![ids].flat().some(id => affected.has(id))
        || conditionerRole(key));
    }
    // Ownership follows recovered participant roles. Neutral prose remains in
    // its residual claim; it does not turn a Case or movement claim into PF.
    return dispatch.claims.some(claim => claim.tier !== 3)
      && participantsRecovered(index, change, claim => !claim.startsWith('pf.'));
  };
  const movementCovers = (change: Pick<RealizationChange, 'before' | 'after'>, movement: typeof relations[number]['movement']) => {
    if (!movement?.transition || !change.before.length || change.before.length !== change.after.length) return false;
    const before = exactNode(oldNodes, movement.priorSourceNodeId);
    const lower = exactNode(newNodes, movement.sourceNodeId), landing = exactNode(newNodes, movement.targetNodeId);
    if (!before || !lower || !landing) return false;
    const oldDomain = syntaxIds([before]), newDomain = syntaxIds([lower, landing]);
    let copied: Map<string, string> | undefined, copyChecked = false;
    const isCopied = (id: string, nextId: string) => {
      if (!copyChecked) {
        copied = copiedDescendants(before, landing);
        if (copied && [...copied].some(([oldId, newId]) => !exactNode(oldNodes, oldId) || !exactNode(newNodes, newId))) copied = undefined;
        copyChecked = true;
      }
      return copied?.get(id) === nextId;
    };
    const tokens = (group: SurfaceRealization) => JSON.stringify([...group.tokenIndices].sort((a, b) => a - b));
    return change.before.every(group => {
      const matched = change.after.filter(after => tokens(after) === tokens(group));
      if (matched.length !== 1 || group.nodeIds.length !== matched[0].nodeIds.length
        || !group.nodeIds.every(id => oldDomain.has(id)) || !matched[0].nodeIds.every(id => newDomain.has(id))) return false;
      const pairs = group.nodeIds.map(id => matched[0].nodeIds.filter(nextId => {
        const old = exactNode(oldNodes, id), next = exactNode(newNodes, nextId);
        return old && next && (id === nextId || Boolean(old.lineageId && old.lineageId === next.lineageId)
          || isCopied(id, nextId));
      }));
      return pairs.every(pair => pair.length === 1) && new Set(pairs.flat()).size === group.nodeIds.length;
    });
  };
  return changes.map(change => {
    let directCandidates = relations.flatMap((relation, index) => {
      const currentCovered = change.after.every(group => group.nodeIds.every(id =>
        exactNode(newNodes, id) && relation.current.has(id)));
      const previousCovered = change.before.every(group => group.nodeIds.every(id =>
        exactNode(oldNodes, id) && (relation.prior.has(id) || (exactNode(newNodes, id) && relation.current.has(id)))));
      return currentCovered && previousCovered ? [index] : [];
    });
    if (directCandidates.length > 1 && change.after.length) {
      const explicitAssociation = directCandidates.filter(index => inputAssociationOwns(index, change.after)
        || pronunciationOwns(index, change));
      const pf = directCandidates.filter(index => pfOwns(index, change.after));
      const owners = explicitAssociation.length ? explicitAssociation : pf;
      if (owners.length) directCandidates = directCandidates.filter(index => owners.includes(index)
        || !incidentalContext(index, change) && !(explicitAssociation.some(owner => inputAssociationOwns(owner, change.after))
          && spellingRewriteOnly(index, change)));
    }
    // Explicit coverage owns the association even when movement also proves
    // continuity of its containing phrase. Infer through those domains only
    // when no relation names the complete change directly.
    const candidates = directCandidates.length ? directCandidates
      : relations.flatMap((relation, index) => movementCovers(change, relation.movement) ? [index] : []);
    if (candidates.length === 1) return { ...change, relationIndex: candidates[0] };
    const reason = candidates.length === 0 ? 'MISSING_OWNER' : 'AMBIGUOUS_OWNER';
    return { ...change, relationIndex: null, candidateRelationIndices: candidates,
      diagnostic: `REALIZATION_${reason}: Stage ${stageIndex + 1}, input positions ${[...new Set([...change.before, ...change.after].flatMap(group => group.tokenIndices))].sort((a, b) => a - b).join(', ')}. ${candidates.length
        ? `Relations ${candidates.map(index => index + 1).join(', ')} cover the same change.`
        : 'No relation covers the complete change.'} The association becomes visible at the Stage Record.` };
  });
};

const authoredIds = (node: SyntaxNode): string[] => node.replayOrigin?.kind === 'lexical' && node.replayOrigin.authoredId
  ? [node.replayOrigin.authoredId]
  : [...(node.id ? [node.id] : []), ...(node.aliasIds || [])];

const missingSourceDomainIds = (
  groups: SurfaceRealization[],
  forest: SyntaxNode[],
  step: PlaybackStep
): string[] => {
  const expected = new Map<string, SyntaxNode>();
  const indexExpected = (node: SyntaxNode) => {
    if (node.id) expected.set(node.id, node);
    node.children?.forEach(indexExpected);
  };
  forest.forEach(indexExpected);
  const visible = new Set(step.replayVisibleNodeIds || []);
  const actual = new Map<string, d3.HierarchyNode<SyntaxNode> | null>();
  if (step.replayCanvasData) {
    const root = d3.hierarchy(step.replayCanvasData);
    applyVizIds(root);
    root.eachBefore(node => {
      if (!visible.has(getNodeId(node))) return;
      authoredIds(node.data).forEach(id => {
        if (!actual.has(id)) actual.set(id, node);
        else if (actual.get(id) !== node) actual.set(id, null);
      });
    });
  }
  const missing = new Set<string>();
  groups.forEach(group => group.nodeIds.forEach(id => {
    const source = expected.get(id);
    const renderedSource = actual.get(id);
    if (!source || !renderedSource) {
      missing.add(id);
      return;
    }
    // A visible parent cannot stand in for its unfinished current domain, nor
    // can a descendant that remains visible elsewhere satisfy that domain.
    const present = new Set(renderedSource.descendants()
      .filter(node => visible.has(getNodeId(node))).flatMap(node => authoredIds(node.data)));
    syntaxIds([source]).forEach(sourceId => {
      if (!present.has(sourceId)) missing.add(sourceId);
    });
  }));
  return [...missing];
};

/** Attach authored association state after scheduling; it cannot alter tree geometry or add moments. */
export const attachReplayRealizations = (
  steps: PlaybackStep[],
  frames: ReplayDerivationFrame[],
  inputTokens?: readonly string[]
): PlaybackStep[] => {
  if (!frames.some(frame => frame.after?.realizations !== undefined)) return steps;
  const moments = new Set(steps.filter(step => step.replayKind === 'relation' && step.replayRelationIdentity)
    .map(step => `${step.replayRelationIdentity!.stageIndex}:${step.replayRelationIdentity!.relationIndex}`));
  const changesByStage = new Map<number, RealizationChange[]>();
  const states = new Map<number, SurfaceRealization[]>();
  const diagnostics = new Map<number, string[]>();
  return steps.map(step => {
    const stageIndex = step.replayFrameIndex ?? step.sourceFrameIndex;
    if (stageIndex === undefined || !frames[stageIndex]) return step;
    const frame = frames[stageIndex];
    if (!changesByStage.has(stageIndex)) {
      const changes = resolveRealizationChanges(frames[stageIndex - 1], frame, stageIndex, inputTokens);
      changesByStage.set(stageIndex, changes);
      states.set(stageIndex, cloneRealizations(frames[stageIndex - 1]?.after?.realizations || []));
      diagnostics.set(stageIndex, changes.flatMap(change => {
        if (change.diagnostic) return [change.diagnostic];
        return !moments.has(`${stageIndex}:${change.relationIndex}`)
          ? [`REALIZATION_OWNER_MOMENT_UNAVAILABLE: Stage ${stageIndex + 1}, relation ${change.relationIndex! + 1} has no available Replay moment. No realization moment was invented.`]
          : [];
      }));
    }
    let active = states.get(stageIndex)!;
    const stageDiagnostics = diagnostics.get(stageIndex)!;
    if (step.replayKind === 'macro') {
      active = cloneRealizations(frame.after?.realizations || []);
    } else if (step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === stageIndex) {
      changesByStage.get(stageIndex)!.filter(change => change.relationIndex === step.replayRelationIdentity!.relationIndex)
        .forEach(change => {
          const missing = missingSourceDomainIds(change.after, frame.workspaceForest, step);
          if (missing.length) {
            stageDiagnostics.push(`REALIZATION_PARTICIPANT_UNAVAILABLE: Stage ${stageIndex + 1}, relation ${change.relationIndex! + 1} requires unavailable syntax ${missing.join(', ')}. No realization moment was invented.`);
            return;
          }
          const removed = new Set(change.before.map(groupKey));
          active = [...active.filter(group => !removed.has(groupKey(group))), ...cloneRealizations(change.after)];
        });
    }
    states.set(stageIndex, active);
    return { ...step,
      replayRealizations: cloneRealizations(active),
      ...(stageDiagnostics.length ? { replayRealizationDiagnostics: [...stageDiagnostics] } : {})
    };
  });
};

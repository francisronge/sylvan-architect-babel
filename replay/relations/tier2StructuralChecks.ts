import { readCategoryLabel } from '../categoryLabel.ts';
import { explicitCoreferenceParticipants } from './explicitCoreference.ts';
import { hasIndependentCaseEndpoints, isUnestablishedCaseValue } from './featureEvidence.ts';
import { prepareLocalDislocationContent } from './localDislocationContent.ts';
import {
  isNativeProjectionPath,
  prepareNativeDependentCaseStep,
  prepareNativeLinearizationContent,
  prepareNativePlaqueContent
} from './nativeDrawingContent.ts';
import {
  establishesAssignment,
  negativeClaimFailure,
  POSITIVE_OUTCOMES,
  relationAssertionFailure,
  relationLabelOutcome,
  resolveOutcomeLiteral,
  type OutcomeConcept
} from './outcomeResolver.ts';
import { ownedPFRewriteOutcomes, pfRewriteLabelDenial, prepareRewriteRows } from './rewriteLiterals.ts';
import { explicitPhaseEdgeFields } from './phaseEdgeEvidence.ts';
import type { TreeIndex } from './tier2EvidenceQueries.ts';
import {
  anchorIds,
  buildTreeIndex,
  featureNotationStatus,
  focusParent,
  hasAuthoredSilent,
  isAuthoredTraceOrGap,
  negativeClaimEvidence,
  nodeContainsAny,
  notationFeatureLabelPair,
  pairedLiteralsDetail,
  prepareNativeFissionContent,
  projectionChain,
  sharedRootLineage,
  sharesLineage,
  tier2NativePlaqueRows,
  unpairedReason,
  valueLiterals
} from './tier2EvidenceQueries.ts';
import type { Tier2FacetEvidence, Tier2FacetRecipe, Tier2StructuralCheck } from './tier2FacetTypes.ts';
import {
  focusRestrictionRoles,
  isCovertMovementDescription,
  isExplicitTier2Role,
  normalizeTier2Synonym
} from './tier2Synonyms.ts';

export const evaluateStructuralCheck = (
  check: Tier2StructuralCheck,
  recipeEntry: Tier2FacetRecipe,
  evidence: Tier2FacetEvidence,
  currentIndex: TreeIndex,
  outcomeConcept: OutcomeConcept | null,
  priorIndex: TreeIndex = buildTreeIndex(evidence.priorForest)
): boolean | string => {
  const ids = (role: string) => anchorIds(evidence, role, 'current');
  switch (check.kind) {
    case 'explicit-coreference':
      if (!establishesAssignment(evidence)) return 'coreference-outcome-not-established';
      return explicitCoreferenceParticipants(evidence) ? true : 'coreference-not-explicit-or-participants-unresolved';
    case 'negative-claim':
      return negativeClaimEvidence(evidence, check.roles).failure ?? true;
    case 'explicit-role':
      // Accessibility becomes an edge only inside a proven Transfer claim.
      // A standalone outline needs an explicit or independently recovered edge.
      if (recipeEntry.id === 'phase.edge') {
        const explicit = explicitPhaseEdgeFields(evidence);
        return (evidence.authoredCurrentAnchors ?? []).filter(entry => entry.concepts.includes('phase.edge'))
          .every(entry => explicit.includes(entry) || evidence.associatedAnchorKeys?.['phase.edge']?.includes(entry.key));
      }
      if (recipeEntry.id === 'operator-binding' && evidence.associatedAnchorKeys?.operator?.length === 1
        && evidence.associatedAnchorKeys?.variable?.length === 1) return true;
      if (recipeEntry.id === 'focus.association' && evidence.associatedAnchorKeys?.['association.particle']?.length === 1
        && evidence.associatedAnchorKeys?.['association.associate']?.length === 1) return true;
      if (recipeEntry.id === 'control.dependency' && evidence.associatedAnchorKeys?.controller?.length === 1
        && evidence.associatedAnchorKeys?.controllee?.length === 1) return true;
      if (recipeEntry.id === 'ellipsis.site' && evidence.associatedAnchorKeys?.['ellipsis.site']?.length === 1) return true;
      if (recipeEntry.id === 'idiom.chunks' && evidence.associatedAnchorKeys?.['interpretation.domain']?.length === 1
        && (evidence.associatedAnchorKeys?.chunks?.length ?? 0) >= 2) return true;
      if (recipeEntry.id === 'binding.dependency' && evidence.associatedAnchorKeys?.binder?.length === 1
        && evidence.associatedAnchorKeys?.dependent?.length === 1) return true;
      if (recipeEntry.id === 'predication.dependency' && evidence.associatedAnchorKeys?.predicand?.length === 1)
        return true;
      if (recipeEntry.id === 'scope.movement' && evidence.movement?.trajectoryKind === 'phrasal'
        && isCovertMovementDescription(evidence.relationName ?? '')) return true;
      if (recipeEntry.id === 'ellipsis.site' && /\bellipsis antecedence$/u.test(normalizeTier2Synonym(evidence.relationName ?? ''))
        && (evidence.authoredCurrentAnchors ?? []).some(entry => entry.concepts.includes('ellipsis.site') && normalizeTier2Synonym(entry.key) === 'target')) return true;
      if (recipeEntry.id === 'focus.association' && focusRestrictionRoles({
        relation: evidence.relationName,
        anchors: Object.fromEntries((evidence.authoredCurrentAnchors ?? []).map(entry => [entry.key, [...entry.items]])),
        values: Object.fromEntries((evidence.authoredValues ?? []).map(entry => [entry.key, entry.items.length === 1 ? entry.items[0] : [...entry.items]]))
      }).length === 2) return true;
      return check.roles.some(role => ids(role).length > 0 && (evidence.authoredCurrentAnchors
        ? evidence.authoredCurrentAnchors.some(entry => entry.concepts.includes(role) && isExplicitTier2Role(role, entry.key))
        : true));
    case 'distinct': {
      const all = check.roles.flatMap(role => check.allowRepeatedWithinRole ? [...new Set(ids(role))] : ids(role));
      return all.length === new Set(all).size;
    }
    case 'contains':
      if (ids(check.containerRole).length === 0 && recipeEntry.anchors.some(r => r.role === check.containerRole && r.optional)) return true;
      return nodeContainsAny(currentIndex, ids(check.containerRole), ids(check.memberRole));
    case 'contains-authored-silent':
      return hasAuthoredSilent(currentIndex, ids(check.role));
    case 'authored-trace-or-gap':
      return isAuthoredTraceOrGap(currentIndex, ids(check.role));
    case 'gap-or-silent-copy':
      return ids(check.role).every(id => isAuthoredTraceOrGap(currentIndex, [id])
        || currentIndex.nodes.get(id)?.length === 1 && currentIndex.nodes.get(id)![0].silent === true
        && Boolean(sharedRootLineage(currentIndex, [id, ...ids(check.fillerRole)])));
    case 'shared-lineage':
      return sharesLineage(currentIndex, check.roles.map(ids));
    case 'shared-root-lineage': {
      // A kept-ID landing proved without its lineage shares its lower
      // occurrence's lineage (RecoveredMovement.recoveredLandingLineageId).
      const roleIds = check.roles.flatMap(ids), movement = evidence.movement;
      const recovered = movement?.recoveredLandingLineageId;
      return Boolean(sharedRootLineage(currentIndex, roleIds)) || Boolean(recovered && roleIds.length === 2
        && roleIds[0] === movement.sourceNodeId && roleIds[1] === movement.targetNodeId
        && sharedRootLineage(currentIndex, [roleIds[0], roleIds[0]]) === recovered);
    }
    case 'movement-evidence':
      // A static drawing can be complete without a preceding stage. A rejected
      // occurrence, context or contradictory source cannot earn that drawing.
      return !evidence.movementFailure || evidence.movementFailure === 'MOVEMENT_PRIOR_SOURCE_UNPROVEN';
    case 'separate-occurrences': {
      const [source, target] = check.roles.map(ids);
      return [...source, ...target].every(id => currentIndex.nodes.get(id)?.length === 1)
        && !nodeContainsAny(currentIndex, source, target) && !nodeContainsAny(currentIndex, target, source);
    }
    case 'prior-source-consistency':
      return anchorIds(evidence, check.role, 'prior').every(id => ids(check.role).includes(id));
    case 'paired-cardinality':
      return ids(check.roles[0]).length === ids(check.roles[1]).length;
    case 'paired-values': {
      const detail = pairedLiteralsDetail(evidence, check.role, check.value);
      if (detail.status === 'unequal' || detail.status === 'ambiguous') return unpairedReason(check.role, check.value, detail.status);
      // An optional list under another name is context, left in the residue.
      if (detail.status === 'unpaired') return check.optional || unpairedReason(check.role, check.value, detail.status);
      if (detail.literals.length === 0) return Boolean(check.optional);
      return ids(check.role).length === detail.literals.length
        && (check.optional || detail.literals.every(literal => literal.trim().length > 0));
    }
    case 'multiple-parents':
      // The relation supplies the additional dominance edges. Requiring those
      // edges in the forest would force one occurrence ID into several positions.
      return new Set(ids('parents')).size === ids('parents').length
        && ids('parents').length >= check.minParents
        && ids(check.role).every(id => !ids('parents').includes(id));
    case 'shared-native-parent': {
      const leftParents = new Set(ids(check.roles[0]).flatMap((id) => [...(currentIndex.parentIds.get(id) ?? [])]));
      return ids(check.roles[1]).some((id) =>
        [...(currentIndex.parentIds.get(id) ?? [])].some((parentId) => leftParents.has(parentId)));
    }
    case 'siblings-within-domain': {
      return Boolean(focusParent(evidence, currentIndex));
    }
    case 'native-parent-branch':
      return ids(check.role).every((id) => (currentIndex.parentIds.get(id)?.size ?? 0) > 0);
    case 'value-token': {
      const statuses = valueLiterals(evidence, check.value).map(literal => featureNotationStatus(literal, check.tokens));
      return statuses.includes('affirmative') && !statuses.includes('contradiction');
    }
    case 'displayable-verdict': {
      const verdicts = valueLiterals(evidence, 'verdict');
      return verdicts.length === 1 && Array.from(verdicts[0].trim()).length <= check.maxCharacters;
    }
    case 'projection-chain': {
      const chain = projectionChain(evidence);
      const nodes = new Map([...currentIndex.nodes].flatMap(([id, matches]) => matches.length === 1 ? [[id, matches[0]] as const] : []));
      return isNativeProjectionPath(nodes, chain[0], chain.slice(1));
    }
    case 'transfer-configuration': {
      const domains = ids('transfer.domain');
      const edges = ids('phase.edge');
      const inside = edges.filter(edge => nodeContainsAny(currentIndex, domains, [edge]));
      if (inside.length) return `accessible edges ${inside.join(',')} are inside transferred domain ${domains.join(',')}`;
      if (ids('phase').length) return nodeContainsAny(currentIndex, ids('phase'), [...domains, ...edges, ...ids('phase.head')])
        || `phase ${ids('phase').join(',')} does not contain all authored domain, edge and head anchors`;
      const head = ids('phase.head')[0];
      if (!head) return true;
      // Categories come from the shared notation reader, so v*, v[uφ], v{uφ}
      // and v⁰ share one spine with v, v′ and v*P. As in phase-edge recovery,
      // the spine never runs through a compound label (V+v) or one the reader
      // declines.
      const shapeOf = (text?: string | null) => {
        const shape = readCategoryLabel(text);
        return shape && !shape.compound ? shape : undefined;
      };
      const label = (id: string) => currentIndex.nodes.get(id)?.[0]?.label;
      const headCategory = shapeOf(label(head))?.head ?? '';
      // The authored phase head can be inside a complex head. Follow only
      // its unambiguous same-category spine, never an arbitrary ancestor.
      const projections = new Set<string>();
      const visited = new Set<string>([head]);
      let child = head;
      let foundComplement = false;
      while (true) {
        const parents = [...(currentIndex.parentIds.get(child) ?? [])];
        if (parents.length !== 1) break;
        const parent = parents[0];
        if (visited.has(parent) || currentIndex.nodes.get(parent)?.length !== 1
          || !headCategory || shapeOf(label(parent))?.head !== headCategory) break;
        const siblings = currentIndex.nodes.get(parent)![0].children ?? [];
        // A sister head of the same category, alone or as any member of a
        // compound head (v+T, T+v), competes for the spine: inside the
        // complex head it makes the head ambiguous, above the complement it
        // heads a higher shell. Stop there.
        if (siblings.some(sibling => {
          const shape = readCategoryLabel(sibling.label);
          return sibling.id !== child && shape?.kind === 'head' && shape.members.includes(headCategory);
        })) break;
        visited.add(parent);
        if (domains.every(domain => domain !== child && currentIndex.parentIds.get(domain)?.has(parent))) foundComplement = true;
        if (foundComplement) projections.add(parent);
        child = parent;
      }
      if (!foundComplement) return `head ${head} has no unique same-category projection with domain ${domains.join(',')} as a separate child`;
      const outside = edges.filter(edge => ![...(currentIndex.parentIds.get(edge) ?? [])].some(parent => projections.has(parent)));
      return outside.length === 0 || `edges ${outside.join(',')} are not attached to the identified projections ${[...projections].join(',')}`;
    }
    case 'feature-dependency': {
      const caseDetail = pairedLiteralsDetail(evidence, 'feature.target', 'case.literal');
      const assertionFailure = relationAssertionFailure(evidence.relationName,
        caseDetail.literals.length ? 'case' : 'agreement');
      const outcomes = valueLiterals(evidence, 'outcome');
      const labelOutcome = relationLabelOutcome(evidence.relationName, caseDetail.literals.length ? 'case' : 'agreement');
      if (assertionFailure && !labelOutcome && !(outcomes.length && !negativeClaimFailure(outcomes, []))) return assertionFailure;
      if (!outcomes.length && caseDetail.literals.length && valueLiterals(evidence, 'feature.rows').length
        && relationLabelOutcome(evidence.relationName, 'case') !== relationLabelOutcome(evidence.relationName, 'agreement'))
        return 'independent-feature-outcomes-require-scoped-claims';
      if (caseDetail.status === 'unequal' || caseDetail.status === 'unpaired' || caseDetail.status === 'ambiguous') return unpairedReason('feature.target', 'case.literal', caseDetail.status);
      const caseValues = caseDetail.literals;
      if (caseValues.some(isUnestablishedCaseValue)) return 'case-value-not-established';
      if (caseValues.length && !hasIndependentCaseEndpoints(evidence))
        return 'case-direction-requires-independent-participant-evidence';
      if (caseValues.length) return caseValues.length === ids('feature.target').length && caseValues.every(literal => literal.trim().length > 0);
      if (valueLiterals(evidence, 'feature.rows').length) return true;
      if (notationFeatureLabelPair(evidence)) return true;
      const hasRole = (concept: string, specific: string, names: string[]) => (evidence.authoredCurrentAnchors ?? []).some(entry =>
        entry.concepts.includes(concept) && (entry.concepts.includes(specific) && (isExplicitTier2Role(specific, entry.key)
          || evidence.associatedAnchorKeys?.[specific]?.includes(entry.key))
          || names.includes(normalizeTier2Synonym(entry.key))));
      return hasRole('feature.source', 'probe', ['feature source', 'collector'])
        && hasRole('feature.target', 'goal', ['feature target']);
    }
    case 'native-linearization':
      return Boolean(prepareNativeLinearizationContent(evidence));
    case 'native-rewrite': {
      if (pfRewriteLabelDenial(evidence.relationName)) return 'the authored mapping is denied or provisional';
      if (ownedPFRewriteOutcomes(evidence).some(entry => entry.items.length === 0 || entry.items.some(literal =>
        !POSITIVE_OUTCOMES.some(concept => concept === resolveOutcomeLiteral(literal)?.concept)))) return 'the mapping outcome does not establish realization';
      if (anchorIds(evidence, 'rewrite.output').some(id => currentIndex.nodes.get(id)?.length !== 1)
        || anchorIds(evidence, 'rewrite.input', 'either').some(id =>
          (currentIndex.nodes.get(id)?.length ?? 0) > 1 || (priorIndex.nodes.get(id)?.length ?? 0) > 1)) return 'rewrite endpoints are not unique occurrences';
      const rows = evidence.authoredValues === undefined
        ? valueLiterals(evidence, 'rewrite.rows').map(value => ({ label: 'rewrite.rows', value }))
        : evidence.authoredValues.filter(entry => entry.concepts.includes('rewrite.rows'))
          .flatMap(entry => entry.items.map(value => ({ label: entry.key, value })));
      const prepared = prepareRewriteRows(evidence, rows);
      return prepared.realizationRowKinds.length > 0 && prepared.realizationRowKinds.every(kind => kind === 'rewrite');
    }
    case 'rebracketing-configuration':
      return Boolean(prepareLocalDislocationContent({
        sequenceNodeIds: ids('sequence'), currentForest: evidence.currentForest, priorForest: evidence.priorForest,
        values: Object.fromEntries((evidence.authoredValues ?? []).map(entry => [entry.key, entry.items]))
      })) || 'the authored evidence does not establish a drawable regrouping of the unchanged sequence';
    case 'dependent-case-step': {
      const entries = evidence.authoredValues?.filter(entry => normalizeTier2Synonym(entry.key) === 'step');
      const literals = entries?.length ? entries.flatMap(entry => entry.items) : evidence.values.step;
      return literals === undefined || prepareNativeDependentCaseStep([...literals]) !== undefined;
    }
    case 'explicit-npi':
      return valueLiterals(evidence, 'feature.label').some(literal => normalizeTier2Synonym(literal) === 'strong npi');
    case 'binding-domain-or-positive': {
      const assertionFailure = relationAssertionFailure(evidence.relationName, 'binding');
      const outcomes = valueLiterals(evidence, 'outcome');
      if (assertionFailure && !relationLabelOutcome(evidence.relationName, 'binding')
        && !(outcomes.length && !negativeClaimFailure(outcomes, []))) return assertionFailure;
      return ids('domain').length > 0 || ((!evidence.authoredCurrentAnchors || evidence.associatedAnchorKeys?.dependent?.length === 1 || evidence.authoredCurrentAnchors.some(entry =>
        entry.concepts.includes('dependent') && isExplicitTier2Role('dependent', entry.key)))
        && !relationLabelOutcome(evidence.relationName, 'binding')
        && outcomes.every(literal => POSITIVE_OUTCOMES.some(concept => concept === resolveOutcomeLiteral(literal)?.concept)));
    }
    case 'movement-carrier':
      return ['movement.source', 'movement.landing'].some(role =>
        nodeContainsAny(currentIndex, ids('movement.carrier'), ids(role)));
    case 'native-plaque':
      return check.style === 'fission'
        ? Boolean(prepareNativeFissionContent(evidence))
        : Boolean(prepareNativePlaqueContent(check.style, tier2NativePlaqueRows(evidence), ids(check.anchorRole)));
    case 'accepted-outcome':
      return outcomeConcept !== null && recipeEntry.acceptedOutcomeConcepts.includes(outcomeConcept);
    case 'active-lens':
      return evidence.activeLens === true;
    case 'parent-facet-complete':
      return evidence.parentFacetComplete === true;
    case 'large-array':
      return ids(check.role).length >= check.min;
  }
};

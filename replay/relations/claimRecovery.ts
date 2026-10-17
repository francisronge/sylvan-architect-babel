import type { DerivationStageRelation } from '../../types.ts';
import { recoverAssignmentContinuity, type AssignmentContext } from './assignmentContinuity.ts';
import { recoverCompoundAssignments } from './compoundAssignments.ts';
import {
  recoverEllipsisCorrespondence,
  recoverNamedEllipsisSite
} from './correspondenceEvidence.ts';
import {
  recoverDeclarativeLicensing,
  recoverNamedFormLicensing,
  recoverSpecifiedMoodLicensing
} from './declarativeLicensing.ts';
import type { EvidenceScope } from './evidenceScopes.ts';
import { recoverExplicitCoreference, recoverNamedBinding } from './explicitCoreference.ts';
import { recoverNamedFeatureLicensing } from './featureLicensingEvidence.ts';
import { recoverFocusAssociation } from './focusAssociationEvidence.ts';
import { recoverIdiomDomain } from './idiomEvidence.ts';
import { recoverInterpretedOperatorBinding } from './interpretedBindingEvidence.ts';
import { recoverInterpretiveCorrespondence } from './interpretiveCorrespondence.ts';
import { recoverModifierAttachment } from './modifierEvidence.ts';
import { recoverOccurrenceGroups } from './occurrenceGroups.ts';
import { recoverPFRewrite } from './pfRewrite.ts';
import { recoverPhaseEdge } from './phaseEdgeEvidence.ts';
import { recoverPredication } from './predicationRecovery.ts';
import {
  recoverCheckedFeatureRows,
  recoverDirectedAgreementTargets,
  recoverExplicitFeatureSharing,
  recoverFailedFeatureComparison,
  recoverIndependentFeatureOutcomes,
  recoverInterrogativeAgreement,
  recoverNominalCaseConcord,
  recoverQualifiedAgreement,
  recoverQualifiedNominalConcord,
  recoverRelativeConcord
} from './qualifiedAgreement.ts';
import {
  recoverCaseQualifiedPair,
  recoverContextualCaseAssignment,
  recoverLabelledCaseAssignment,
  recoverLicensedArgumentCase,
  recoverQualifiedCaseAssignments
} from './qualifiedCaseAssignments.ts';
import { recoverResultAssignments } from './resultAssignments.ts';
import { recoverMovementGroups } from './movementGroups.ts';
import {
  recoverClauseComplementTheta,
  recoverQualifiedRoleInterpretation,
  typedThematicAssignment
} from './thematicAssignment.ts';
import type { Tier2FacetEvidence } from './tier2FacetTypes.ts';

/** Association recovery produces evidence scopes, never geometry or a tier
 * decision. Every scope must pass the same recipe checks as an ordinary claim. */
export function recoverRelationScopes(
  relation: DerivationStageRelation,
  evidence: Tier2FacetEvidence,
  history?: AssignmentContext
): EvidenceScope[] {
  const movements = recoverMovementGroups(evidence);
  const thematic = typedThematicAssignment(evidence).scope;
  const occurrences = recoverOccurrenceGroups(evidence).filter(scope => !movements.some(movement =>
    Object.keys(scope.origins.anchors).every(key => key in movement.origins.anchors)));
  return [
    ...movements,
    ...occurrences,
    ...recoverInterpretiveCorrespondence(evidence),
    ...recoverIdiomDomain(evidence),
    ...recoverEllipsisCorrespondence(evidence),
    ...recoverNamedEllipsisSite(evidence),
    ...recoverPredication(evidence),
    ...recoverPhaseEdge(evidence),
    ...recoverModifierAttachment(evidence),
    ...recoverExplicitCoreference(evidence),
    ...recoverNamedBinding(evidence),
    ...recoverInterpretedOperatorBinding(evidence),
    ...recoverFocusAssociation(evidence),
    ...recoverNamedFeatureLicensing(evidence),
    ...(thematic ? [thematic] : []),
    ...recoverClauseComplementTheta(evidence),
    ...recoverQualifiedRoleInterpretation(evidence),
    ...recoverCompoundAssignments(evidence),
    ...recoverQualifiedCaseAssignments(evidence),
    ...recoverCaseQualifiedPair(evidence),
    ...recoverLicensedArgumentCase(evidence),
    ...recoverContextualCaseAssignment(evidence, thematic),
    ...recoverLabelledCaseAssignment(relation, evidence, thematic),
    ...recoverExplicitFeatureSharing(evidence),
    ...recoverRelativeConcord(evidence),
    ...recoverQualifiedNominalConcord(evidence),
    ...recoverDirectedAgreementTargets(evidence),
    ...recoverCheckedFeatureRows(evidence),
    ...recoverInterrogativeAgreement(evidence),
    ...recoverNominalCaseConcord(evidence),
    ...recoverQualifiedAgreement(evidence),
    ...recoverIndependentFeatureOutcomes(evidence),
    ...recoverFailedFeatureComparison(evidence),
    ...recoverResultAssignments(relation, evidence),
    ...recoverDeclarativeLicensing(evidence),
    ...recoverNamedFormLicensing(evidence),
    ...recoverSpecifiedMoodLicensing(evidence),
    ...recoverPFRewrite(evidence),
    ...(history ? recoverAssignmentContinuity(evidence, history) : [])
  ];
}

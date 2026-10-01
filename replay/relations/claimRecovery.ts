import type { DerivationStageRelation } from '../../types.ts';
import { recoverAssignmentContinuity, type AssignmentContext } from './assignmentContinuity.ts';
import { recoverCompoundAssignments } from './compoundAssignments.ts';
import { recoverOccurrenceGroups } from './occurrenceGroups.ts';
import { recoverInterpretiveCorrespondence } from './interpretiveCorrespondence.ts';
import { recoverEllipsisCorrespondence, recoverRemnantCorrespondence, recoverNamedEllipsisSite, recoverCoordinateGapping, recoverQualifiedParallelism } from './correspondenceEvidence.ts';
import { recoverSharedMovement } from './sharedMovement.ts';
import { recoverContextualCaseAssignment, recoverLabelledCaseAssignment, recoverQualifiedCaseAssignments, recoverCaseQualifiedPair, recoverLicensedArgumentCase } from './qualifiedCaseAssignments.ts';
import { recoverExplicitFeatureSharing, recoverRelativeConcord, recoverQualifiedNominalConcord, recoverDirectedAgreementTargets, recoverCheckedFeatureRows, recoverInterrogativeAgreement, recoverNominalCaseConcord, recoverQualifiedAgreement, recoverFailedFeatureComparison, recoverIndependentFeatureOutcomes } from './qualifiedAgreement.ts';
import { recoverResultAssignments } from './resultAssignments.ts';
import { recoverDeclarativeLicensing, recoverNamedFormLicensing, recoverSpecifiedMoodLicensing } from './declarativeLicensing.ts';
import { recoverPFRewrite } from './pfRewrite.ts';
import { recoverPredication } from './predicationRecovery.ts';
import { recoverPhaseEdge } from './phaseEdgeEvidence.ts';
import { recoverModifierAttachment } from './modifierEvidence.ts';
import { recoverExplicitCoreference, recoverNamedBinding } from './explicitCoreference.ts';
import { typedThematicAssignment, recoverClauseComplementTheta, recoverQualifiedThetaLicensing, recoverQualifiedRoleInterpretation } from './thematicAssignment.ts';
import { recoverFocusAssociation } from './focusAssociationEvidence.ts';
import { recoverSubjectChainControl } from './controlEvidence.ts';
import { recoverInterpretedOperatorBinding } from './interpretedBindingEvidence.ts';
import type { EvidenceScope } from './evidenceScopes.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';

/** Association recovery produces evidence scopes, never geometry or a tier
 * decision. Every scope must pass the same recipe checks as an ordinary claim. */
export function recoverRelationScopes(
  relation: DerivationStageRelation,
  evidence: Tier2FacetEvidence,
  history?: AssignmentContext
): EvidenceScope[] {
  const movements = recoverSharedMovement(evidence);
  const thematic = typedThematicAssignment(evidence).scope;
  const occurrences = recoverOccurrenceGroups(evidence).filter(scope => !movements.some(movement =>
    Object.keys(scope.origins.anchors).every(key => key in movement.origins.anchors)));
  return [
    ...movements,
    ...occurrences,
    ...recoverInterpretiveCorrespondence(evidence),
    ...recoverEllipsisCorrespondence(evidence),
    ...recoverRemnantCorrespondence(evidence),
    ...recoverNamedEllipsisSite(evidence),
    ...recoverCoordinateGapping(evidence),
    ...recoverQualifiedParallelism(evidence),
    ...recoverPredication(evidence),
    ...recoverPhaseEdge(evidence),
    ...recoverModifierAttachment(evidence),
    ...recoverExplicitCoreference(evidence),
    ...recoverNamedBinding(evidence),
    ...recoverSubjectChainControl(evidence),
    ...recoverInterpretedOperatorBinding(evidence),
    ...recoverFocusAssociation(evidence),
    ...(thematic ? [thematic] : []),
    ...recoverClauseComplementTheta(evidence),
    ...recoverQualifiedThetaLicensing(evidence),
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

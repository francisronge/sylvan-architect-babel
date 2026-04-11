import { buildSystemInstruction } from './geminiParser/systemInstruction.js';
import { MOVEMENT_INDEX_SUBSCRIPT_MAP } from './geminiParser/constants.js';
import { ParseApiError } from './geminiParser/error.js';
import {
  normalizeSurfaceToken,
  tokenizeSentenceSurfaceOrder
} from './geminiParser/surfaceTokens.js';
import {
  STRUCTURAL_LEAF_LABELS,
  PRIME_CATEGORY_LABEL_RE,
  PRIME_MARK_RE,
  nextGeneratedNodeId,
  canonicalizeCovertSurface,
  collectNodeReferencesById,
  getLabelProfile
} from './geminiParser/treeBasics.js';
import {
  buildParseContentsPrompt
} from './geminiParser/prompts.js';
import {
  estimateProOutputBudget,
  resolveRouteMaxOutputTokens
} from './geminiParser/routeConfig.js';
import {
  extractLocalModelResponseText,
  summarizeGeneration,
  summarizeProviderReasoningForDisplay
} from './geminiParser/modelRuntime.js';
import { createDerivationHelpers } from './geminiParser/derivationHelpers.js';
import { createNoteBindingHelpers } from './geminiParser/noteBindings.js';
import { createSemanticValidationHelpers } from './geminiParser/semanticValidation.js';
import { createNotesSecondPassHelpers } from './geminiParser/notesSecondPass.js';
import { createParseRoutes } from './geminiParser/parseRoutes.js';
import { createAnalysisNormalizationHelpers } from './geminiParser/analysisNormalization.js';
import { createParseNormalizationHelpers } from './geminiParser/parseNormalization.js';
import { createGrowthDerivationHelpers } from './geminiParser/growthDerivation.js';
import { createNormalizationUtils } from './geminiParser/normalizationUtils.js';
import { createStepNormalizationHelpers } from './geminiParser/stepNormalization.js';
import { createSyntaxTreeHelpers } from './geminiParser/syntaxTree.js';

export { ParseApiError } from './geminiParser/error.js';

const {
  normalizeKey,
  normalizeDerivationOperation,
  normalizeSpelloutOrder,
  normalizeOptionalStepText,
  normalizeOptionalStringArray,
  normalizeNodeIdArray,
  normalizeMovementOperation,
  normalizeIndexedText,
  extractMovementIndex,
  stripMovementIndex,
  normalizeChainType,
  mergeChainTypes,
  deriveChainTypeFromOperation
} = createNormalizationUtils({
  MOVEMENT_INDEX_SUBSCRIPT_MAP
});

let syntaxTreeHelpersRef = null;

const subtreeHasOvertYield = (...args) => {
  if (!syntaxTreeHelpersRef) {
    throw new Error('syntaxTreeHelpers not initialized');
  }
  return syntaxTreeHelpersRef.subtreeHasOvertYield(...args);
};

const {
  isMoveLikeOperation,
  buildNodeLabelIndexFromTree,
  normalizeMovementEvents,
  isAbstractFeatureSurface,
  cleanExplanationWhitespace,
  ensureExplanationTerminator,
  getNodeOvertYield,
  normalizeTraceLikeSurface,
  isNullLikeSurface,
  buildNodeIndexFromTree,
  buildParentIndexFromTree,
  collectLeafNodes,
  resolveNodeSurface,
  resolveOvertLeafSurface,
  isTraceLikeSurface,
  isTraceLikeNode,
  isNullLikeNode,
  subtreeContainsOnlyCovertCategoryLeaves,
  subtreeContainsNamedCovertCategoryLeaf,
  stripMovementIndicesFromTree,
  materializeEmptyStructuralLeaves,
  promoteSentenceMatchingLeaves,
  buildCanonicalMovementEvents,
  reconcileDerivationStepOperations,
  buildGroundedExplanation,
  buildCanonicalDerivationFromTree,
  harmonizeExplanationWithDerivation,
  getMovementDisplayLabel,
  normalizeMovementLabelKey,
  resolveHeadMovementLandingNode
} = createDerivationHelpers({
  MOVEMENT_INDEX_SUBSCRIPT_MAP,
  STRUCTURAL_LEAF_LABELS,
  PRIME_CATEGORY_LABEL_RE,
  canonicalizeCovertSurface,
  normalizeSurfaceToken,
  subtreeHasOvertYield,
  getLabelProfile,
  normalizeOptionalStepText,
  normalizeOptionalStringArray,
  normalizeMovementOperation,
  extractMovementIndex,
  stripMovementIndex
});

syntaxTreeHelpersRef = createSyntaxTreeHelpers({
  ParseApiError,
  normalizeOptionalStepText,
  normalizeNodeIdArray,
  normalizeMovementOperation,
  resolveNodeSurface,
  resolveOvertLeafSurface,
  isAbstractFeatureSurface,
  isTraceLikeSurface,
  isNullLikeSurface,
  isTraceLikeNode,
  isNullLikeNode,
  collectLeafNodes,
  buildNodeIndexFromTree,
  buildParentIndexFromTree,
  normalizeMovementLabelKey
});

const {
  materializeLexicalPhrasalLeaves,
  normalizeSyntaxNode,
  normalizeSyntaxTreeWithIds,
  compileFlatNodeTableToTree,
  collectOvertTerminalNodes,
  sameTokenSequence,
  isTraceOrNullOnlySubtree,
  anchorOvertLeavesToSentenceTokens,
  deriveCanonicalSurfaceSpans,
  collapseOvertHeadLandingChains,
  collectExistingNodeIds,
  canonicalizeHeadMoveSourceShells,
  canonicalizeSplitClauseEdgeMovedPhrases,
  remapDerivationStepsNodeIds,
  remapMovementEventsNodeIds,
  validateAndCommitSurfaceOrder,
  validateSpelloutConsistency
} = syntaxTreeHelpersRef;

const {
  normalizeNoteBindings,
  buildNoteBindingChainIdAliases,
  buildExplanationFromNoteBindings
} = createNoteBindingHelpers({
  normalizeOptionalStepText,
  cleanExplanationWhitespace,
  ensureExplanationTerminator
});

const {
  normalizeTransportJsonArray,
  normalizeGrowthFrames,
  normalizeMovementStemFromId,
  materializeImplicitPhrasalTraceShellsInGrowthFrames,
  materializeCommittedTraceShells,
  inferSupplementalHeadMoveEventsFromGrowthFrames,
  collectGrowthFrameNodeIds,
  canonicalizeGrowthRootCandidateForSentence,
  selectCommittedGrowthRoot,
  findLatestCommittedGrowthFrame,
  buildCanonicalMovementEventsFromGrowthFrames,
  buildCanonicalDerivationFromGrowthFrames,
  assignDerivationStepIds,
  suppressExcessUntokenedHeadCopiesForSurfaceMatch
} = createGrowthDerivationHelpers({
  ParseApiError,
  nextGeneratedNodeId,
  normalizeSurfaceToken,
  normalizeDerivationOperation,
  normalizeOptionalStepText,
  normalizeNodeIdArray,
  normalizeOptionalStringArray,
  normalizeSpelloutOrder,
  normalizeMovementOperation,
  normalizeIndexedText,
  normalizeSyntaxNode,
  normalizeSyntaxTreeWithIds,
  collectNodeReferencesById,
  collectOvertTerminalNodes,
  promoteSentenceMatchingLeaves,
  stripMovementIndicesFromTree,
  materializeEmptyStructuralLeaves,
  resolveNodeSurface,
  subtreeHasOvertYield,
  isTraceOrNullOnlySubtree,
  getLabelProfile,
  isTraceLikeNode,
  isNullLikeNode,
  sameTokenSequence,
  isMoveLikeOperation,
  PRIME_CATEGORY_LABEL_RE,
  PRIME_MARK_RE,
  buildNodeIndexFromTree,
  buildParentIndexFromTree,
  collectLeafNodes,
  collectExistingNodeIds,
  getNodeOvertYield,
  isTraceLikeSurface,
  isNullLikeSurface,
  resolveHeadMovementLandingNode,
  anchorOvertLeavesToSentenceTokens,
  deriveCanonicalSurfaceSpans,
  subtreeContainsOnlyCovertCategoryLeaves,
  subtreeContainsNamedCovertCategoryLeaf,
  collapseOvertHeadLandingChains
});

const {
  normalizeFeatureChecking,
  normalizeDerivationSteps,
  deriveImplicitGrowthChainId
} = createStepNormalizationHelpers({
  normalizeTransportJsonArray,
  normalizeDerivationOperation,
  normalizeOptionalStepText,
  normalizeNodeIdArray,
  normalizeOptionalStringArray,
  normalizeSpelloutOrder,
  normalizeMovementStemFromId
});

const {
  validatePronouncedCopiesAgainstCommittedTree,
  validateNoteBindingsAgainstStructuredAnalysis,
  runSemanticValidation,
  auditNoteConsistency,
  computeCompletenessStatus
} = createSemanticValidationHelpers({
  ParseApiError,
  cleanExplanationWhitespace,
  normalizeMovementOperation,
  normalizeChainType,
  normalizeOptionalStepText,
  normalizeKey,
  buildNodeIndexFromTree,
  collectOvertTerminalNodes,
  subtreeContainsNamedCovertCategoryLeaf
});

const {
  normalizeChains,
  normalizeResearchTrace,
  normalizeCaseAssignments,
  normalizeArgumentStructure,
  normalizePhaseLog,
  normalizeMorphologyRealization,
  normalizeFeatureLedger,
  normalizeSelectionLedger,
  normalizeBindingLedger,
  normalizeClausalDependencies,
  normalizeAgreementLedger,
  normalizePredicateClassLedger,
  normalizeProbeLedger,
  normalizeNullElementLedger,
  normalizeDiagnosticLedger,
  normalizeParameterLedger,
  normalizeInformationStructureLedger,
  normalizeOperatorScopeLedger,
  normalizeVoiceValencyLedger,
  normalizeLinearizationLedger,
  normalizeLocalityLedger,
  normalizePredicationLedger,
  ensureStructuredEntryIds
} = createAnalysisNormalizationHelpers({
  normalizeChainType,
  normalizeKey,
  normalizeNodeIdArray,
  normalizeOptionalStepText,
  normalizeOptionalStringArray,
  normalizeTransportJsonArray
});

const {
  deriveChainsFromCommittedAnalysis,
  normalizeParseResult,
  normalizeParseBundle,
  validateFinalProNoteBindings
} = createParseNormalizationHelpers({
  ParseApiError,
  normalizeKey,
  normalizeChainType,
  normalizeMovementOperation,
  normalizeOptionalStepText,
  normalizeOptionalStringArray,
  tokenizeSentenceSurfaceOrder,
  normalizeSurfaceToken,
  normalizeNoteBindings,
  buildExplanationFromNoteBindings,
  normalizeGrowthFrames,
  materializeImplicitPhrasalTraceShellsInGrowthFrames,
  buildCanonicalDerivationFromGrowthFrames,
  compileFlatNodeTableToTree,
  collectNodeReferencesById,
  normalizeSyntaxTreeWithIds,
  materializeLexicalPhrasalLeaves,
  buildNodeIndexFromTree,
  buildNodeLabelIndexFromTree,
  assignDerivationStepIds,
  normalizeDerivationSteps,
  normalizeMovementEvents,
  canonicalizeSplitClauseEdgeMovedPhrases,
  collapseOvertHeadLandingChains,
  remapDerivationStepsNodeIds,
  remapMovementEventsNodeIds,
  canonicalizeHeadMoveSourceShells,
  validateAndCommitSurfaceOrder,
  validateSpelloutConsistency,
  buildCanonicalMovementEvents,
  stripMovementIndicesFromTree,
  materializeEmptyStructuralLeaves,
  promoteSentenceMatchingLeaves,
  collectOvertTerminalNodes,
  resolveNodeSurface,
  materializeCommittedTraceShells,
  buildGroundedExplanation,
  harmonizeExplanationWithDerivation,
  buildCanonicalDerivationFromTree,
  reconcileDerivationStepOperations,
  collectGrowthFrameNodeIds,
  normalizeChains,
  normalizeResearchTrace,
  normalizeCaseAssignments,
  normalizeArgumentStructure,
  normalizePhaseLog,
  normalizeMorphologyRealization,
  normalizeFeatureLedger,
  normalizeSelectionLedger,
  normalizeBindingLedger,
  normalizeClausalDependencies,
  normalizeAgreementLedger,
  normalizePredicateClassLedger,
  normalizeProbeLedger,
  normalizeNullElementLedger,
  normalizeDiagnosticLedger,
  normalizeParameterLedger,
  normalizeInformationStructureLedger,
  normalizeOperatorScopeLedger,
  normalizeVoiceValencyLedger,
  normalizeLinearizationLedger,
  normalizeLocalityLedger,
  normalizePredicationLedger,
  ensureStructuredEntryIds,
  runSemanticValidation,
  validatePronouncedCopiesAgainstCommittedTree,
  buildNoteBindingChainIdAliases,
  validateNoteBindingsAgainstStructuredAnalysis,
  auditNoteConsistency,
  computeCompletenessStatus,
  deriveImplicitGrowthChainId,
  deriveChainTypeFromOperation,
  mergeChainTypes,
  normalizeMovementStemFromId,
  subtreeContainsNamedCovertCategoryLeaf
});

const {
  parseModelJson,
  buildNotesSecondPassPrompt,
  regenerateCommittedNoteBindings,
  regenerateCommittedNoteBindingsWithLocalModel
} = createNotesSecondPassHelpers({
  ParseApiError,
  normalizeChainType,
  normalizeParseBundle
});

export const {
  parseSentenceWithLocalModel,
  parseSentenceWithGemini
} = createParseRoutes({
  ParseApiError,
  normalizeParseBundle,
  validateFinalProNoteBindings,
  parseModelJson,
  regenerateCommittedNoteBindings,
  regenerateCommittedNoteBindingsWithLocalModel
});

export const __test__ = {
  normalizeParseBundle,
  normalizeParseResult,
  validateFinalProNoteBindings,
  normalizeGrowthFrames,
  validateAndCommitSurfaceOrder,
  canonicalizeGrowthRootCandidateForSentence,
  selectCommittedGrowthRoot,
  findLatestCommittedGrowthFrame,
  buildCanonicalMovementEvents,
  buildCanonicalMovementEventsFromGrowthFrames,
  inferSupplementalHeadMoveEventsFromGrowthFrames,
  buildCanonicalDerivationFromGrowthFrames,
  buildCanonicalDerivationFromTree,
  reconcileDerivationStepOperations,
  harmonizeExplanationWithDerivation,
  buildSystemInstruction,
  buildParseContentsPrompt,
  buildNotesSecondPassPrompt,
  regenerateCommittedNoteBindings,
  summarizeProviderReasoningForDisplay,
  summarizeGeneration,
  extractLocalModelResponseText,
  estimateProOutputBudget,
  resolveRouteMaxOutputTokens,
  parseModelJson,
  normalizeNoteBindings,
  normalizeCaseAssignments,
  normalizeSurfaceToken,
  tokenizeSentenceSurfaceOrder,
  anchorOvertLeavesToSentenceTokens,
  deriveCanonicalSurfaceSpans,
  collectOvertTerminalNodes,
  suppressExcessUntokenedHeadCopiesForSurfaceMatch,
  validatePronouncedCopiesAgainstCommittedTree,
  validateNoteBindingsAgainstStructuredAnalysis
};

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
import { createParseRoutes } from './geminiParser/parseRoutes.js';
import { createAnalysisNormalizationHelpers } from './geminiParser/analysisNormalization.js';
import { createParseNormalizationHelpers } from './geminiParser/parseNormalization.js';
import { createDerivationCompilerHelpers } from './geminiParser/derivationCompiler.js';
import { createNormalizationUtils } from './geminiParser/normalizationUtils.js';
import { createStepNormalizationHelpers } from './geminiParser/stepNormalization.js';
import { createSyntaxTreeHelpers } from './geminiParser/syntaxTree.js';
import { parseStrictModelJson, parseStrictModelJsonDetailed } from './geminiParser/strictJson.js';

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
  normalizeOpenChainType,
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
  normalizeVisualRelationEvents,
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
  buildCanonicalVisualRelationEvents,
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
  normalizeSyntaxNode,
  normalizeSyntaxTreeWithIds,
  collectOvertTerminalNodes,
  sameTokenSequence,
  isTraceOrNullOnlySubtree,
  anchorOvertLeavesToSentenceTokens,
  deriveCanonicalSurfaceSpans,
  collectExistingNodeIds,
  collapseOvertHeadLandingChains,
  validateAndCommitSurfaceOrder,
  validateSpelloutConsistency
} = syntaxTreeHelpersRef;

const {
  compileNoteBindingsFromDerivationFrames,
  buildExplanationFromNoteBindings
} = createNoteBindingHelpers({
  normalizeOptionalStepText,
  cleanExplanationWhitespace,
  ensureExplanationTerminator
});

const {
  normalizeTransportJsonArray,
  normalizeDerivationStagesToDerivationFrames,
  normalizeDerivationFrames,
  normalizeMovementStemFromId,
  materializeImplicitPhrasalTraceShellsInDerivationFrames,
  materializeCommittedTraceShells,
  collectDerivationFrameNodeIds,
  canonicalizeDerivationRootCandidateForSentence,
  selectCommittedDerivationRoot,
  findLatestCommittedDerivationFrame,
  buildCanonicalVisualRelationEventsFromDerivationFrames,
  buildCanonicalDerivationFromDerivationFrames,
  assignDerivationStepIds
} = createDerivationCompilerHelpers({
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
  deriveImplicitDerivationChainId
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
  computeCompletenessStatus,
  collectCompletenessWarnings
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
  normalizeCommitmentGraph,
  isProjectedCommitmentKind,
  projectLedgersFromCommitmentGraph,
  buildCommitmentGraphFromNormalizedLedgers,
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
  normalizeParticleLedger,
  normalizeEvidentialityLedger,
  normalizeMirativityLedger,
  normalizeHonorificityLedger,
  normalizeSwitchReferenceLedger,
  normalizeLogophoraLedger,
  normalizeEventStructureLedger,
  ensureStructuredEntryIds
} = createAnalysisNormalizationHelpers({
  normalizeOpenChainType,
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
  normalizeOpenChainType,
  normalizeChainType,
  normalizeMovementOperation,
  normalizeOptionalStepText,
  normalizeOptionalStringArray,
  getLabelProfile,
  tokenizeSentenceSurfaceOrder,
  normalizeSurfaceToken,
  compileNoteBindingsFromDerivationFrames,
  buildExplanationFromNoteBindings,
  normalizeDerivationStagesToDerivationFrames,
  normalizeDerivationFrames,
  materializeImplicitPhrasalTraceShellsInDerivationFrames,
  buildCanonicalDerivationFromDerivationFrames,
  collectNodeReferencesById,
  normalizeSyntaxTreeWithIds,
  buildNodeIndexFromTree,
  buildParentIndexFromTree,
  buildNodeLabelIndexFromTree,
  assignDerivationStepIds,
  normalizeDerivationSteps,
  normalizeVisualRelationEvents,
  validateAndCommitSurfaceOrder,
  validateSpelloutConsistency,
  buildCanonicalVisualRelationEvents,
  stripMovementIndicesFromTree,
  collectOvertTerminalNodes,
  resolveNodeSurface,
  resolveHeadMovementLandingNode,
  materializeCommittedTraceShells,
  buildGroundedExplanation,
  harmonizeExplanationWithDerivation,
  buildCanonicalDerivationFromTree,
  collectDerivationFrameNodeIds,
  normalizeChains,
  normalizeCommitmentGraph,
  isProjectedCommitmentKind,
  projectLedgersFromCommitmentGraph,
  buildCommitmentGraphFromNormalizedLedgers,
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
  normalizeParticleLedger,
  normalizeEvidentialityLedger,
  normalizeMirativityLedger,
  normalizeHonorificityLedger,
  normalizeSwitchReferenceLedger,
  normalizeLogophoraLedger,
  normalizeEventStructureLedger,
  ensureStructuredEntryIds,
  runSemanticValidation,
  validatePronouncedCopiesAgainstCommittedTree,
  validateNoteBindingsAgainstStructuredAnalysis,
  auditNoteConsistency,
  computeCompletenessStatus,
  collectCompletenessWarnings,
  deriveImplicitDerivationChainId,
  deriveChainTypeFromOperation,
  mergeChainTypes,
  normalizeMovementStemFromId,
  subtreeContainsNamedCovertCategoryLeaf
});

const parseModelJson = (rawText) => parseStrictModelJson(
  rawText,
  (code, message, status) => new ParseApiError(code, message, status)
);

const parseModelJsonDetailed = (rawText) => parseStrictModelJsonDetailed(
  rawText,
  (code, message, status) => new ParseApiError(code, message, status)
);

export const {
  parseSentenceWithLocalModel,
  parseSentenceWithGemini
} = createParseRoutes({
  ParseApiError,
  normalizeParseBundle,
  validateFinalProNoteBindings,
  parseModelJson,
  parseModelJsonDetailed
});

export const __test__ = {
  normalizeParseBundle,
  normalizeParseResult,
  validateFinalProNoteBindings,
  normalizeDerivationStagesToDerivationFrames,
  normalizeDerivationFrames,
  validateAndCommitSurfaceOrder,
  canonicalizeDerivationRootCandidateForSentence,
  selectCommittedDerivationRoot,
  findLatestCommittedDerivationFrame,
  buildCanonicalVisualRelationEvents,
  buildCanonicalVisualRelationEventsFromDerivationFrames,
  buildCanonicalDerivationFromDerivationFrames,
  buildCanonicalDerivationFromTree,
  harmonizeExplanationWithDerivation,
  buildSystemInstruction,
  buildParseContentsPrompt,
  summarizeProviderReasoningForDisplay,
  summarizeGeneration,
  extractLocalModelResponseText,
  estimateProOutputBudget,
  resolveRouteMaxOutputTokens,
  parseModelJson,
  compileNoteBindingsFromDerivationFrames,
  normalizeCaseAssignments,
  normalizeSurfaceToken,
  tokenizeSentenceSurfaceOrder,
  anchorOvertLeavesToSentenceTokens,
  deriveCanonicalSurfaceSpans,
  collectOvertTerminalNodes,
  validatePronouncedCopiesAgainstCommittedTree,
  validateNoteBindingsAgainstStructuredAnalysis
};

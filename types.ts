export interface SyntaxNode {
  label: string;
  children?: SyntaxNode[];
  word?: string;
  surfaceSpan?: [number, number];
  id?: string; // Optional ID for D3 indexing
  case?: string;
  assigner?: string;
  caseEvidence?: string;
  caseOvert?: boolean;
}

export type DerivationOperation =
  | 'LexicalSelect'
  | 'ExternalMerge'
  | 'InternalMerge'
  | 'HeadMove'
  | 'A-Move'
  | 'AbarMove'
  | 'CaseAssignment'
  | 'ThetaAssignment'
  | 'Selection'
  | 'Binding'
  | 'ClausalDependency'
  | 'FeatureLedger'
  | 'Project'
  | 'Label'
  | 'Move'
  | 'Agree'
  | 'SpellOutDomain'
  | 'SpellOut'
  | 'Other';

export interface ReplayLedgerBlock {
  title: string;
  lines: string[];
}

export interface FeatureCheckEvent {
  feature: string;
  value?: string;
  status?: 'checked' | 'valued' | 'licensed' | 'deleted' | 'failed' | 'other';
  probeNodeId?: string;
  goalNodeId?: string;
  probeLabel?: string;
  goalLabel?: string;
  note?: string;
}

export interface DerivationStep {
  stepId?: string;
  operation: DerivationOperation;
  microOperations?: DerivationOperation[];
  affectedNodeIds?: string[];
  trigger?: string;
  chainId?: string;
  spelloutDomain?: string;
  preFeatures?: string[];
  postFeatures?: string[];
  thetaRole?: string;
  introducerHead?: string;
  phase?: string;
  labelDecision?: string;
  linearizationEffect?: string;
  morphologyEffect?: string;
  targetLabel?: string;
  targetNodeId?: string;
  sourceNodeIds?: string[];
  sourceLabels?: string[];
  recipe?: string;
  workspaceBefore?: string[];
  workspaceAfter?: string[];
  spelloutOrder?: string[];
  featureChecking?: FeatureCheckEvent[];
  ledgerBlocks?: ReplayLedgerBlock[];
  note?: string;
}

export interface GrowthFrameMovement {
  operation?: DerivationOperation;
  sourceNodeId?: string;
  targetNodeId?: string;
  traceNodeId?: string;
  chainId?: string;
  note?: string;
}

export interface GrowthFrame {
  frameId?: string;
  stepId?: string;
  operation: DerivationOperation;
  microOperations?: DerivationOperation[];
  affectedNodeIds?: string[];
  reusePreviousWorkspace?: boolean;
  recipe?: string;
  trigger?: string;
  chainId?: string;
  spelloutDomain?: string;
  preFeatures?: string[];
  postFeatures?: string[];
  thetaRole?: string;
  introducerHead?: string;
  phase?: string;
  labelDecision?: string;
  linearizationEffect?: string;
  morphologyEffect?: string;
  spelloutOrder?: string[];
  featureChecking?: FeatureCheckEvent[];
  note?: string;
  movement?: GrowthFrameMovement;
  workspaceForest: SyntaxNode[];
}

export interface NoteBinding {
  noteId?: string;
  kind: 'architecture' | 'chain' | 'licensing' | 'closure' | 'other';
  text: string;
  chainId?: string;
  stepIds?: string[];
  nodeIds?: string[];
  supportIds?: string[];
  commitmentFactIds?: string[];
  researchTraceIds?: string[];
  featureEntryIds?: string[];
  phaseIds?: string[];
  morphologyIds?: string[];
  caseAssignmentIds?: string[];
  argumentIds?: string[];
  selectionIds?: string[];
  bindingIds?: string[];
  dependencyIds?: string[];
  agreementIds?: string[];
  predicateClassIds?: string[];
  probeIds?: string[];
  nullElementIds?: string[];
  diagnosticIds?: string[];
  parameterIds?: string[];
  informationStructureIds?: string[];
  operatorScopeIds?: string[];
  voiceValencyIds?: string[];
  linearizationIds?: string[];
  localityIds?: string[];
  predicationIds?: string[];
  order?: number;
}

export interface MovementEvent {
  operation?: 'Move' | 'InternalMerge' | 'HeadMove' | 'A-Move' | 'AbarMove' | 'Other';
  fromNodeId: string;
  toNodeId: string;
  traceNodeId?: string;
  chainId?: string;
  stepIndex?: number;
  note?: string;
}

export type DerivationCompleteness = 'minimal' | 'partial' | 'full';

export interface ChainLedgerEntry {
  chainId: string;
  type?: 'A' | 'A-bar' | 'head' | 'other';
  copies?: string[];
  pronouncedCopy?: string;
  silentCopies?: string[];
  features?: string[];
  note?: string;
}

export interface ResearchTraceAlternative {
  id: string;
  status?: 'selected' | 'rejected' | 'considered' | 'other';
  reason?: string;
}

export interface ResearchTraceSupport {
  nodeIds?: string[];
  chainIds?: string[];
  stepIds?: string[];
}

export interface ResearchTraceEntry {
  decisionId: string;
  stage: string;
  decisionPoint: string;
  observations?: string[];
  alternatives?: ResearchTraceAlternative[];
  commitment?: string;
  supports?: ResearchTraceSupport;
  status?: 'committed' | 'partial' | 'minimal' | 'other';
  note?: string;
}

export interface LedgerSupportAnchors {
  stepIds?: string[];
  nodeIds?: string[];
}

export type CommitmentKind =
  | 'case'
  | 'argument-structure'
  | 'phase'
  | 'morphology'
  | 'feature'
  | 'selection'
  | 'binding'
  | 'clausal-dependency'
  | 'agreement'
  | 'predicate-class'
  | 'probe'
  | 'null-element'
  | 'diagnostic'
  | 'parameter'
  | 'information-structure'
  | 'operator-scope'
  | 'voice-valency'
  | 'linearization'
  | 'locality'
  | 'predication'
  | 'particle'
  | 'evidentiality'
  | 'mirativity'
  | 'honorificity'
  | 'switch-reference'
  | 'logophora'
  | 'event-structure';

export interface CommitmentGraphEntry extends LedgerSupportAnchors {
  factId?: string;
  kind: CommitmentKind;
  chainId?: string;
  nodeId?: string;
  label?: string;
  nodeLabel?: string;
  assigneeLabel?: string;
  case?: string;
  assigner?: string;
  mechanism?: string;
  overt?: boolean;
  position?: string;
  role?: string;
  introducer?: string;
  predicate?: string;
  referent?: string;
  phaseHead?: string;
  complementDomain?: string;
  transferredNodes?: string[];
  edgeNodes?: string[];
  spelloutDomain?: string;
  surfaceExponent?: string;
  featuresRealized?: string[];
  hostHead?: string;
  isPortmanteau?: boolean;
  feature?: string;
  value?: string;
  status?: string;
  sourceStepId?: string;
  selectorNodeId?: string;
  selectorHead?: string;
  selectedNodeId?: string;
  selectedCategory?: string;
  selectorLabel?: string;
  selectedLabel?: string;
  relation?: string;
  domainNodeId?: string;
  antecedentNodeId?: string;
  dependentNodeId?: string;
  antecedentLabel?: string;
  dependentLabel?: string;
  principle?: string;
  type?: string;
  subtype?: string;
  predicateNodeId?: string;
  clauseNodeId?: string;
  controllerNodeId?: string;
  controllerLabel?: string;
  clauseLabel?: string;
  probeNodeId?: string;
  goalNodeId?: string;
  probeLabel?: string;
  goalLabel?: string;
  morphology?: string;
  direction?: string;
  domain?: string;
  defaultValue?: boolean;
  classification?: string;
  diagnostics?: string[];
  locality?: string;
  outcome?: string;
  kindLabel?: string;
  kindValue?: string;
  licensing?: string;
  parameter?: string;
  language?: string;
  operatorNodeId?: string;
  scopeNodeId?: string;
  operatorLabel?: string;
  scopeLabel?: string;
  operatorType?: string;
  voice?: string;
  valency?: string;
  externalArgument?: string;
  internalArgument?: string;
  order?: string[];
  effect?: string;
  movingNodeId?: string;
  landingNodeId?: string;
  movingLabel?: string;
  landingLabel?: string;
  subjectNodeId?: string;
  subjectLabel?: string;
  particleLabel?: string;
  particleType?: string;
  function?: string;
  clauseType?: string;
  markerLabel?: string;
  evidentialType?: string;
  sourceType?: string;
  mirativityType?: string;
  honorificType?: string;
  target?: string;
  markerNodeId?: string;
  controllerClauseNodeId?: string;
  dependentClauseNodeId?: string;
  logophoricLabel?: string;
  eventType?: string;
  lexicalAspect?: string;
  viewpointAspect?: string;
  boundedness?: string;
  telicity?: string;
  evidence?: string;
  note?: string;
}

export interface CaseAssignment extends LedgerSupportAnchors {
  assignmentId?: string;
  nodeId?: string;
  assigneeLabel?: string;
  case?: string;
  assigner?: string;
  mechanism?: string;
  evidence?: string;
  overt?: boolean;
  position?: string;
}

export interface ArgumentStructureEntry extends LedgerSupportAnchors {
  argumentId?: string;
  nodeId?: string;
  role?: string;
  introducer?: string;
  predicate?: string;
  referent?: string;
  position?: string;
  note?: string;
}

export interface PhaseLogEntry extends LedgerSupportAnchors {
  phaseId?: string;
  phaseHead?: string;
  complementDomain?: string;
  transferredNodes?: string[];
  edgeNodes?: string[];
  spelloutDomain?: string;
}

export interface MorphologyRealizationEntry extends LedgerSupportAnchors {
  realizationId?: string;
  nodeId: string;
  surfaceExponent?: string;
  featuresRealized?: string[];
  hostHead?: string;
  isPortmanteau?: boolean;
  note?: string;
}

export interface FeatureLedgerEntry extends LedgerSupportAnchors {
  entryId?: string;
  nodeId?: string;
  feature: string;
  value?: string;
  status?: string;
  sourceStepId?: string;
  note?: string;
}

export interface SelectionLedgerEntry extends LedgerSupportAnchors {
  selectionId?: string;
  selectorNodeId?: string;
  selectorHead?: string;
  selectedNodeId?: string;
  selectedCategory?: string;
  selectorLabel?: string;
  selectedLabel?: string;
  relation?: 'complement' | 'specifier' | 'adjunct' | 'clausal-complement' | 'small-clause' | 'other';
  note?: string;
}

export interface BindingLedgerEntry extends LedgerSupportAnchors {
  bindingId?: string;
  domainNodeId?: string;
  antecedentNodeId?: string;
  dependentNodeId?: string;
  antecedentLabel?: string;
  dependentLabel?: string;
  relation?: 'anaphor' | 'pronoun' | 'r-expression' | 'variable' | 'other';
  principle?: 'A' | 'B' | 'C' | 'other';
  status?: 'satisfied' | 'violated' | 'irrelevant' | 'other';
  note?: string;
}

export interface ClausalDependencyEntry extends LedgerSupportAnchors {
  dependencyId?: string;
  type?: 'raising' | 'control' | 'ecm' | 'finite-complement' | 'small-clause' | 'other';
  subtype?: string;
  predicateNodeId?: string;
  clauseNodeId?: string;
  controllerNodeId?: string;
  dependentNodeId?: string;
  predicateLabel?: string;
  clauseLabel?: string;
  controllerLabel?: string;
  dependentLabel?: string;
  evidence?: string;
  note?: string;
}

export interface AgreementLedgerEntry extends LedgerSupportAnchors {
  agreementId?: string;
  probeNodeId?: string;
  goalNodeId?: string;
  probeLabel?: string;
  goalLabel?: string;
  feature?: string;
  value?: string;
  morphology?: string;
  status?: 'valued' | 'matched' | 'default' | 'failed' | 'other';
  direction?: string;
  domain?: string;
  defaultValue?: boolean;
  evidence?: string;
  note?: string;
}

export interface PredicateClassLedgerEntry extends LedgerSupportAnchors {
  predicateClassId?: string;
  predicateNodeId?: string;
  predicateLabel?: string;
  classification?: 'raising' | 'control' | 'ecm' | 'unaccusative' | 'unergative' | 'transitive' | 'weather' | 'expletive' | 'other';
  subtype?: string;
  diagnostics?: string[];
  evidence?: string;
  note?: string;
}

export interface ProbeLedgerEntry extends LedgerSupportAnchors {
  probeId?: string;
  probeNodeId?: string;
  goalNodeId?: string;
  probeLabel?: string;
  goalLabel?: string;
  feature?: string;
  direction?: string;
  domain?: string;
  locality?: string;
  outcome?: 'matched' | 'valued' | 'failed' | 'blocked' | 'default' | 'other';
  evidence?: string;
  note?: string;
}

export interface NullElementLedgerEntry extends LedgerSupportAnchors {
  nullElementId?: string;
  nodeId?: string;
  label?: string;
  kind?: 'PRO' | 'pro' | 'expletive' | 'silent-head' | 'silent-complementizer' | 'operator' | 'trace' | 'copy' | 'other';
  controllerNodeId?: string;
  controllerLabel?: string;
  antecedentNodeId?: string;
  antecedentLabel?: string;
  licensing?: string;
  evidence?: string;
  note?: string;
}

export interface DiagnosticLedgerEntry extends LedgerSupportAnchors {
  diagnosticId?: string;
  diagnostic?: string;
  observation?: string;
  supports?: string;
  status?: 'supported' | 'undermined' | 'neutral' | 'other';
  evidence?: string;
  note?: string;
}

export interface ParameterLedgerEntry extends LedgerSupportAnchors {
  parameterId?: string;
  parameter?: string;
  value?: string;
  domain?: string;
  language?: string;
  evidence?: string;
  note?: string;
}

export interface InformationStructureLedgerEntry extends LedgerSupportAnchors {
  informationStructureId?: string;
  nodeId?: string;
  label?: string;
  role?: 'topic' | 'focus' | 'background' | 'comment' | 'contrastive-topic' | 'contrastive-focus' | 'given' | 'new' | 'other';
  scope?: string;
  evidence?: string;
  note?: string;
}

export interface OperatorScopeLedgerEntry extends LedgerSupportAnchors {
  operatorScopeId?: string;
  operatorNodeId?: string;
  scopeNodeId?: string;
  operatorLabel?: string;
  scopeLabel?: string;
  operatorType?: string;
  relation?: string;
  evidence?: string;
  note?: string;
}

export interface VoiceValencyLedgerEntry extends LedgerSupportAnchors {
  voiceValencyId?: string;
  predicateNodeId?: string;
  predicateLabel?: string;
  voice?: 'active' | 'passive' | 'middle' | 'antipassive' | 'causative' | 'applicative' | 'reflexive' | 'reciprocal' | 'other';
  valency?: string;
  externalArgument?: string;
  internalArgument?: string;
  evidence?: string;
  note?: string;
}

export interface LinearizationLedgerEntry extends LedgerSupportAnchors {
  linearizationId?: string;
  domainNodeId?: string;
  domainLabel?: string;
  order?: string[];
  mechanism?: string;
  effect?: string;
  evidence?: string;
  note?: string;
}

export interface LocalityLedgerEntry extends LedgerSupportAnchors {
  localityId?: string;
  dependencyType?: string;
  movingNodeId?: string;
  landingNodeId?: string;
  movingLabel?: string;
  landingLabel?: string;
  boundary?: string;
  status?: 'licensed' | 'successive-cyclic' | 'blocked' | 'violated' | 'other';
  evidence?: string;
  note?: string;
}

export interface PredicationLedgerEntry extends LedgerSupportAnchors {
  predicationId?: string;
  predicateNodeId?: string;
  subjectNodeId?: string;
  predicateLabel?: string;
  subjectLabel?: string;
  relation?: 'primary' | 'secondary' | 'depictive' | 'resultative' | 'copular' | 'small-clause' | 'other';
  evidence?: string;
  note?: string;
}

export interface Provenance {
  modelRoute?: 'local' | 'pro';
  framework?: 'xbar' | 'minimalism';
  language?: string;
  timestamp?: string;
  treeSource?: 'growthFrames' | 'committedTree';
  promptVersion?: string;
  parserVersion?: string;
  uiVersion?: string;
  payloadIntegrityFlags?: string[];
  payloadTranscriberUsed?: boolean;
  payloadTranscriberModel?: string;
  payloadTranscriberPromptTokenCount?: number;
  payloadTranscriberOutputTokenCount?: number;
  payloadTranscriberTotalTokenCount?: number;
  payloadTranscriberThoughtsTokenCount?: number;
  hasCommitmentGraph?: boolean;
  hasResearchTrace?: boolean;
  hasGrowthFrames?: boolean;
  hasCaseAssignments?: boolean;
  hasArgumentStructure?: boolean;
  hasPhaseLog?: boolean;
  hasMorphologyRealization?: boolean;
  hasSelectionLedger?: boolean;
  hasBindingLedger?: boolean;
  hasClausalDependencies?: boolean;
  hasAgreementLedger?: boolean;
  hasPredicateClassLedger?: boolean;
  hasProbeLedger?: boolean;
  hasNullElementLedger?: boolean;
  hasDiagnosticLedger?: boolean;
  hasParameterLedger?: boolean;
  hasInformationStructureLedger?: boolean;
  hasOperatorScopeLedger?: boolean;
  hasVoiceValencyLedger?: boolean;
  hasLinearizationLedger?: boolean;
  hasLocalityLedger?: boolean;
  hasPredicationLedger?: boolean;
  parsePromptTokenCount?: number;
  parseOutputTokenCount?: number;
  parseTotalTokenCount?: number;
  primaryPromptTokenCount?: number;
  primaryOutputTokenCount?: number;
  primaryTotalTokenCount?: number;
  providerReasoningRaw?: string;
  providerReasoningSummary?: string;
  providerThoughtsTokenCount?: number;
  notesSecondPass?: boolean;
  notesSecondPassReasoningRaw?: string;
  notesSecondPassReasoningSummary?: string;
  notesSecondPassPromptTokenCount?: number;
  notesSecondPassOutputTokenCount?: number;
  notesSecondPassTotalTokenCount?: number;
  notesSecondPassThoughtsTokenCount?: number;
  completenessStatus?: DerivationCompleteness;
}

export interface ParseResult {
  // There is no `notes` field on committed analyses.
  // Structured notes live in noteBindings, and explanation is the rendered paragraph built from them.
  tree: SyntaxNode;
  explanation: string;
  surfaceOrder?: string[];
  growthFrames?: GrowthFrame[];
  noteBindings?: NoteBinding[];
  rawDerivationSteps?: DerivationStep[];
  derivationSteps?: DerivationStep[];
  movementEvents?: MovementEvent[];
  chains?: ChainLedgerEntry[];
  commitmentGraph?: CommitmentGraphEntry[];
  researchTrace?: ResearchTraceEntry[];
  caseAssignments?: CaseAssignment[];
  argumentStructure?: ArgumentStructureEntry[];
  phaseLog?: PhaseLogEntry[];
  morphologyRealization?: MorphologyRealizationEntry[];
  featureLedger?: FeatureLedgerEntry[];
  selectionLedger?: SelectionLedgerEntry[];
  bindingLedger?: BindingLedgerEntry[];
  clausalDependencies?: ClausalDependencyEntry[];
  agreementLedger?: AgreementLedgerEntry[];
  predicateClassLedger?: PredicateClassLedgerEntry[];
  probeLedger?: ProbeLedgerEntry[];
  nullElementLedger?: NullElementLedgerEntry[];
  diagnosticLedger?: DiagnosticLedgerEntry[];
  parameterLedger?: ParameterLedgerEntry[];
  informationStructureLedger?: InformationStructureLedgerEntry[];
  operatorScopeLedger?: OperatorScopeLedgerEntry[];
  voiceValencyLedger?: VoiceValencyLedgerEntry[];
  linearizationLedger?: LinearizationLedgerEntry[];
  localityLedger?: LocalityLedgerEntry[];
  predicationLedger?: PredicationLedgerEntry[];
  provenance?: Provenance;
  completenessStatus?: DerivationCompleteness;
}

export interface ParseBundle {
  analyses: ParseResult[];
  ambiguityDetected: boolean;
  ambiguityNote?: string;
  requestedModelRoute?: 'local' | 'pro';
  modelUsed?: string;
}

export interface SyntaxNode {
  label: string;
  children?: SyntaxNode[];
  word?: string;
  tokenIndex?: number;
  silent?: boolean;
  surfaceSpan?: [number, number];
  id?: string; // Optional ID for D3 indexing
  aliasIds?: string[];
  lineageId?: string;
  /** Derived display ownership; excluded when projecting the authored syntax contract. */
  replayOrigin?: import('./replay/displayIdentity.ts').ReplayNodeOrigin;
  /** Derived Replay scaffolding that reserves layout space but is never drawn. */
  replayLayoutOnly?: boolean;
}

export type OpenOntologyLabel = string & {};

export type DerivationOperation = OpenOntologyLabel;

export interface ReplayDetailBlock {
  title: string;
  lines: string[];
}

/** Exact syntax occurrences collectively associated with supplied input tokens. */
export interface SurfaceRealization {
  nodeIds: string[];
  tokenIndices: number[];
}

export interface DerivationStage {
  statement: string;
  stageRecord: string;
  relations: DerivationStageRelation[];
  workspaceForest: SyntaxNode[];
  realizations?: SurfaceRealization[];
}

export interface DerivationStageRelation {
  relation: OpenOntologyLabel;
  anchors: Record<string, string | string[]>;
  /**
   * Optional witnesses that resolve in the immediately preceding authored
   * stage's workspace, verbatim. Carried untouched through normalization and
   * replay; renderers use them only for backward comparison cues.
   */
  priorAnchors?: Record<string, string | string[]>;
  /**
   * Optional authored literal payload, verbatim. Values are display literals,
   * never node ids, and never affect neutral-fallback geometry.
   */
  values?: Record<string, string | string[]>;
  /** Normalizer-derived evidence for an unrenderable authored claim; never model-authored. */
  relationContractFailure?: {
    raw: unknown;
    issues: Array<{ fieldPath: string; message: string }>;
  };
}

export interface GenerationPromptContract {
  framework: 'xbar' | 'minimalism';
  promptRoute: 'gemini' | 'gpt' | 'claude' | 'kimi' | 'grok';
  systemInstructionSha256: string;
  promptSha256: string;
  promptTemplateSha256: string;
}

export interface SentGenerationConfig {
  [key: string]: string | number | boolean | null;
}

export interface GenerationRecord {
  schemaVersion: 2;
  provider: 'gemini' | 'gpt' | 'claude' | 'local' | 'kimi' | 'grok';
  sentRequestSha256?: string;
  modelSelection?: {
    catalogId: string;
    label: string;
    provider: string;
    providerRoute: string;
    providerModel: string;
    qualificationStatus: string;
    nativeSettings: Record<string, string>;
    requestPolicy: Record<string, unknown>;
    constraints?: Record<string, unknown>;
  };
  returnedModel?: string;
  rawProviderResponse?: RawOutputArtifact;
  /** False when transport stopped while reading the provider envelope. */
  providerResponseComplete?: boolean;
  promptContract: GenerationPromptContract;
  sentGenerationConfig: SentGenerationConfig;
  /** How the input tokens were derived (the spell-out version, or the tokenizer
   * for older records) and the runtime Unicode data involved. */
  inputTokenization?: { version: string; unicode: string | null; icu: string | null; cldr: string | null };
  timing: {
    requestStartedAt: string;
    durationMs: number;
  };
  processing?: {
    json: { durationMs: number; repairDiagnostics: PayloadRepairDiagnostic[]; diagnostic?: JsonDiagnostic };
    normalization?: { durationMs: number; failure?: ParseFailure };
  };
  /** The Jev pass run after the response was valid; absent on older records. */
  jev?: JevPassRecord;
  outcome?: {
    sentMaxOutputTokens: number;
    finishReason: string;
    finishStatus: string;
    reasoningTokenCount?: number;
    promptTokenCount?: number;
    outputTokenCount?: number;
    totalTokenCount?: number;
    runId: string;
    attempts: Array<{
      attemptNumber: number;
      startedAt: string;
      completedAt: string;
      outcome: string;
      finishReason?: string;
      finishStatus?: string;
      statusCode?: number;
      retryReason?: string;
      retryStopReason?: string;
      responseId?: string;
      message?: string;
    }>;
  };
}

export type ParseFailureClass =
  | 'transport_serialization'
  | 'incomplete_generation'
  | 'contract_misunderstanding'
  | 'linguistic_failure'
  | 'deterministic_engine_failure'
  | 'valid_but_unexpected';

export interface ParseFailure {
  class: ParseFailureClass;
  ruleId: string;
  stageIndex: number | null;
  fieldPath: string;
  offendingValue: unknown;
  analysisIndex?: number;
  processingStep?: string;
  expectedForm?: string;
  message?: string;
}

export interface RawOutputArtifact {
  mediaType: string;
  encoding: 'base64';
  byteLength: number;
  retainedByteLength: number;
  truncated: boolean;
  sha256: string;
  data: string;
}

/** Babel removed JSON delimiter repair on 22 Oct 2026; only earlier saved records carry these. */
export type PayloadRepairKind =
  | 'insert_closers_before_mismatched_closer'
  | 'remove_unmatched_closer'
  | 'append_closers_at_end_of_output';

export interface JsonDiagnostic {
  kind: 'json-syntax' | 'json-root-type' | 'json-delimiter-damage';
  message: string;
  candidateByteOffset?: number;
  originalByteOffset?: number;
  originalSyntaxError?: JsonDiagnostic;
}

export interface PayloadRepairDiagnostic {
  kind: PayloadRepairKind;
  /** UTF-8 byte offset in the JSON candidate after BOM and outer-whitespace removal. */
  candidateByteOffset: number;
  removedText: string;
  insertedText: string;
  removedBytesHex: string;
  insertedBytesHex: string;
}

export interface Provenance {
  modelRoute?: 'gemini' | 'gpt' | 'claude' | 'local' | 'kimi' | 'grok';
  framework?: 'xbar' | 'minimalism';
  language?: string;
  timestamp?: string;
  treeSource?: 'derivationStages';
  promptVersion?: string;
  parserVersion?: string;
  uiVersion?: string;
  payloadIntegrityFlags?: string[];
  payloadRepairDiagnostics?: PayloadRepairDiagnostic[];
  tokenIndexCorrections?: TokenIndexCorrection[];
  hasDerivationStages?: boolean;
  parsePromptTokenCount?: number;
  parseOutputTokenCount?: number;
  parseTotalTokenCount?: number;
  primaryPromptTokenCount?: number;
  primaryOutputTokenCount?: number;
  primaryTotalTokenCount?: number;
}

export interface TokenIndexCorrection {
  kind: 'omitted_mismatched_optional_token_index';
  stageIndex: number;
  fieldPath: string;
  nodeId: string;
  word: string;
  authoredTokenIndex: number;
  inputTokenAtAuthoredIndex: string;
}

export interface ParseResult {
  /** Present when one authored root covers every pronounced input token. */
  tree?: SyntaxNode;
  /** The complete, expanded final workspace; roots are not syntactically merged. */
  finalForest?: SyntaxNode[];
  derivationStages?: DerivationStage[];
  provenance?: Provenance;
  /** Jev's checked readings of this analysis's neutral claims, added by the server after
   * the analysis is valid (docs/design/jev.md). Never model-authored; absent on older records. */
  jevReadings?: JevRecord;
}

/** A claim's own words: everything Jev reads, and the identity its answer is saved under. */
export interface JevTerms {
  relation: string;
  roles: string[];
  values: Record<string, string[]>;
}

/** One family and the Babel slot each authored key reads as; keys read as no slot are omitted. */
export interface JevAnswer {
  family: string;
  roles: Record<string, string>;
  values: Record<string, string>;
}

export interface JevMapping {
  stageIndex: number;
  relationIndex: number;
  terms: JevTerms;
  answer: JevAnswer;
  /** The least confidence of the Choice answers the reading is made of. */
  confidence: number;
}

export interface JevRecord {
  version: 2;
  mappings: JevMapping[];
  /** The service, model and prompt version that produced the answers. */
  provenance?: {
    service?: string;
    requestedModel?: string;
    models?: string[];
    promptVersion?: string;
    at?: string;
    thresholdAtRun?: number;
    [key: string]: unknown;
  };
}

/** One claim Jev was or was not asked about, as the server's pass recorded it. */
export interface JevClaimOutcome {
  /** `s<stage>r<relation>`, one-based. */
  claim: string;
  status: string;
  httpStatus?: number | null;
  errors?: string[];
}

/** The server's Jev pass for one response: what was asked, of which model, and how each claim ended. */
export interface JevPassRecord {
  service: 'typesafe';
  requestedModel: string;
  promptVersion: string;
  thresholdAtRun: number;
  /** `completed`, `partial` (some claims failed or ran out of time), `not-configured`, `skipped` or `failed`. */
  status: 'completed' | 'partial' | 'not-configured' | 'skipped' | 'failed';
  reason?: string;
  budgetMs: number;
  startedAt?: string;
  durationMs?: number;
  models?: string[];
  usage?: { inputTokens: number; outputTokens: number };
  analyses?: Array<{ claims: number; outcomes: JevClaimOutcome[] }>;
}

export interface ParseBundle {
  analyses: ParseResult[];
  ambiguityDetected: boolean;
  ambiguityNote?: string;
  sentence?: string;
  /** Exact token addresses sent to the model; absent only on older saved bundles. */
  inputTokens?: string[];
  requestedModelRoute?: 'gemini' | 'gpt' | 'claude' | 'kimi' | 'grok';
  requestedModelId?: string;
  requestedReasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  rawModelOutput?: RawOutputArtifact;
  modelUsed?: string;
  generationRecord?: GenerationRecord;
}

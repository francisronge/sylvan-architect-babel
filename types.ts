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
  timing: {
    requestStartedAt: string;
    durationMs: number;
  };
  processing?: {
    json: { durationMs: number; repairDiagnostics: PayloadRepairDiagnostic[]; diagnostic?: JsonDiagnostic };
    normalization?: { durationMs: number; failure?: ParseFailure };
  };
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

export type PayloadRepairKind =
  | 'insert_closers_before_mismatched_closer'
  | 'remove_unmatched_closer'
  | 'append_closers_at_end_of_output';

export interface JsonDiagnostic {
  kind: 'json-syntax' | 'json-root-type';
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
  hasDerivationStages?: boolean;
  parsePromptTokenCount?: number;
  parseOutputTokenCount?: number;
  parseTotalTokenCount?: number;
  primaryPromptTokenCount?: number;
  primaryOutputTokenCount?: number;
  primaryTotalTokenCount?: number;
}

export interface ParseResult {
  tree: SyntaxNode;
  derivationStages?: DerivationStage[];
  provenance?: Provenance;
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

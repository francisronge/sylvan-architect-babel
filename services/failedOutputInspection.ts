import type { DerivationStage, RawOutputArtifact, SyntaxNode } from '../types.ts';
import { createAuthoredWorkspaceHelpers } from '../replay/authoredWorkspaceInspection.js';
import { createRealizationHelpers } from '../replay/surfaceRealizations.js';
import { createFailureRecord } from '../server/babelParser/failureRecord.js';
import { tokenizeSentenceSurfaceOrder } from '../server/babelParser/surfaceTokens.js';
import { diagnosticReplayProjection } from '../replay/diagnosticReplay.ts';

// The browser retains the original failed output. Unlike a server error envelope,
// local diagnostics do not need to replace large offending fields with hashes.
const createFailure = (input: any) => createFailureRecord(input, (value: unknown) =>
  value === undefined ? { kind: 'missing' } : value);
class InspectionError extends Error {
  failure: ReturnType<typeof createFailure>;
  constructor(_code: string, message: string, _status: number, details: { failure: ReturnType<typeof createFailure> }) {
    super(message);
    this.failure = details.failure;
  }
}
const helpers = createAuthoredWorkspaceHelpers({
  ParseApiError: InspectionError,
  createFailure,
  withFailureDetails: (details: object, failure: unknown) => ({ ...details, failure: createFailure(failure) }),
  ...createRealizationHelpers({ createFailure }),
  tokenizeSentenceSurfaceOrder
});

export interface FailedStageInspection {
  stageIndex: number;
  authoredStage: unknown;
  workspaceForest: SyntaxNode[] | null;
  diagnostics: unknown[];
  diagnostic?: unknown;
  blockedByStageIndex?: number;
  drawingIssue?: string;
}
export interface FailedAnalysisInspection {
  analysisIndex: number;
  authoredAnalysis: unknown;
  stages: FailedStageInspection[] | null;
  replayStages: DerivationStage[] | null;
  replayIssue?: string;
  ambiguousRelationCount: number;
  duplicateIdentityCount: number;
}
export interface FailedOutputInspection {
  rawText: string;
  payload: unknown;
  analyses: FailedAnalysisInspection[];
}

const record = (value: unknown): value is Record<string, any> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const assertInspectableSize = (payload: unknown) => {
  const pending = [{ value: payload, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++count > 100_000 || depth > 256) throw new Error('This output is too large or deeply nested for diagnostic drawing. The raw download remains available.');
    if (value && typeof value === 'object') Object.values(value).forEach(child => pending.push({ value: child, depth: depth + 1 }));
  }
};

/** This projection ignores unrecognized fields, never supplies missing authored
 * values. The original expanded forest and every authored field remain available. */
export const drawableInspectionForest = (forest: SyntaxNode[] | null): SyntaxNode[] | null => {
  if (!forest) return null;
  const visit = (node: SyntaxNode): SyntaxNode => {
    if (typeof node.id !== 'string' || typeof node.label !== 'string' || !Array.isArray(node.children)) throw new Error('Invalid node shape.');
    if ('word' in node && typeof node.word !== 'string'
      || 'silent' in node && typeof node.silent !== 'boolean'
      || 'lineageId' in node && (typeof node.lineageId !== 'string' || !node.lineageId.trim())
      || 'tokenIndex' in node && (!Number.isInteger(node.tokenIndex) || node.tokenIndex! < 0)
      || 'surfaceSpan' in node && (!Array.isArray(node.surfaceSpan) || node.surfaceSpan.length !== 2
        || !node.surfaceSpan.every(index => Number.isInteger(index) && index >= 0) || node.surfaceSpan[1] < node.surfaceSpan[0])) {
      throw new Error('Invalid optional node field.');
    }
    return Object.fromEntries([
      ['id', node.id], ['label', node.label], ['children', node.children.map(visit)],
      ...['word', 'silent', 'lineageId', 'tokenIndex', 'surfaceSpan'].filter(key => Object.hasOwn(node, key))
        .map(key => [key, structuredClone(node[key as keyof SyntaxNode])])
    ]) as unknown as SyntaxNode;
  };
  try { return forest.map(visit); } catch { return null; }
};

export const inspectFailedPayload = (payload: unknown, rawText: string, sentence = '', inputTokens?: string[]): FailedOutputInspection => {
  if (!record(payload)) throw new Error('The output does not contain a JSON object. The raw download remains available.');
  assertInspectableSize(payload);
  const authors = Array.isArray(payload.analyses) ? payload.analyses : [payload];
  // refId can multiply a small response into a huge forest. Limits cover the
  // expanded output across every analysis, not only the raw JSON container.
  const inspectionBudget = { remainingOccurrences: 10_000, maxDepth: 128, remainingFieldValues: 200_000 };
  const analyses = authors.map((authoredAnalysis: unknown, analysisIndex: number): FailedAnalysisInspection => {
    const authoredStages = record(authoredAnalysis) ? authoredAnalysis.derivationStages : undefined;
    const stages = helpers.inspectDerivationWorkspaces(authoredStages, {
      analysisIndex, inspectionBudget, ...(sentence.trim() ? { sentence } : {}), ...(inputTokens ? { sentenceTokens: inputTokens } : {}),
      fieldPath: Array.isArray(payload.analyses) ? `$.analyses[${analysisIndex}]` : '$'
    }) as FailedStageInspection[] | null;
    const entry: FailedAnalysisInspection = { analysisIndex, authoredAnalysis, stages,
      replayStages: null, ambiguousRelationCount: 0, duplicateIdentityCount: 0 };
    if (!stages?.length) { entry.replayIssue = 'No readable derivation stages were returned.'; return entry; }
    const drawable = stages.map(stage => {
      const forest = drawableInspectionForest(stage.workspaceForest);
      if (stage.workspaceForest && !forest) stage.drawingIssue = 'A node field has an invalid type. Inspect the original stage and diagnostics below.';
      return forest;
    });
    if (drawable.some(forest => !forest) || stages.some(stage => !record(stage.authoredStage)
      || typeof stage.authoredStage.statement !== 'string' || typeof stage.authoredStage.stageRecord !== 'string'
      || !Array.isArray(stage.authoredStage.relations))) {
      entry.replayIssue = 'Replay needs readable workspaces and stage fields throughout. The individual stages remain available.';
      return entry;
    }
    // Malformed relation objects use the same neutral failure representation as
    // normal parsing. No anchor, pronunciation, or missing relation is invented.
    const frames = helpers.normalizeDerivationStagesToDerivationFrames(authoredStages, { validationIssues: [] });
    const replayInput = stages.map((stage, index) => ({
      workspaceForest: drawable[index],
      authoredStage: { ...(stage.authoredStage as DerivationStage),
        relations: frames[index].change.details.derivationStageRelations }
    }));
    const invalidRealizations = stages.some(stage => stage.diagnostics.some((issue: any) => issue.ruleId === 'DERIVATION_REALIZATION_SHAPE'));
    if (invalidRealizations) { entry.replayIssue = 'Invalid realization fields prevent diagnostic Replay. The individual stages remain available.'; return entry; }
    const projection = diagnosticReplayProjection(replayInput);
    entry.replayStages = projection?.stages ?? null;
    entry.ambiguousRelationCount = projection?.ambiguousRelations.length ?? 0;
    entry.duplicateIdentityCount = projection?.identities.length ?? 0;
    if (!sentence.trim() && entry.replayStages?.some(stage => stage.realizations?.length)) {
      entry.replayStages = null;
      entry.replayIssue = 'Replay with realization groups needs the original input sentence. The individual stages remain available.';
    }
    return entry;
  });
  return { rawText, payload, analyses };
};

export const inspectFailedOutput = async (artifact: RawOutputArtifact, sentence = '', inputTokens?: string[]) => {
  if (artifact.truncated) throw new Error('Only a capped copy of this output was retained. Diagnostic drawing is unavailable; the retained bytes can still be downloaded.');
  if (artifact.encoding !== 'base64') throw new Error('The retained output encoding is unsupported.');
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(artifact.data), char => char.charCodeAt(0)); }
  catch { throw new Error('The retained output could not be decoded.'); }
  if (bytes.byteLength !== artifact.retainedByteLength || bytes.byteLength !== artifact.byteLength) {
    throw new Error('The retained output length does not match its record. Diagnostic drawing is unavailable.');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const observedHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (observedHash !== artifact.sha256) throw new Error('The retained output does not match its saved hash. Diagnostic drawing is unavailable.');
  let rawText: string;
  try { rawText = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('The retained bytes are not valid UTF-8. The raw download remains available.'); }
  let payload: unknown;
  try { payload = JSON.parse(rawText.replace(/^\uFEFF/, '')); }
  catch { throw new Error('The output is not complete JSON. No text was repaired; the raw download remains available.'); }
  return inspectFailedPayload(payload, rawText, sentence, inputTokens);
};

import type { ParseBundle } from '../types.ts';
import { canonicalJson, copyJsonData, freezeJsonData, requireExactFields, requirePlainRecord, requireNonemptyString, requireSha256 } from '../derivationalDatabase/jsonData.js';

// Browser-local immutable carriers preserve the received bundle. W17 native export
// requires additional evidence and a separate adapter; these are not W17 envelopes.
export interface TreeBankRecord {
  schemaVersion: 1;
  id: string;
  kind: 'analysis' | 'context';
  payload: any;
  sha256: string;
}
export interface TreeBankWork {
  schemaVersion: 2;
  id: string;
  sentence: string;
  framework: 'xbar' | 'minimalism';
  analysisIds: string[];
  contextId: string;
  activeParseIndex: number;
  view: 'tree' | 'derivation' | 'notes';
  replayStep: number | null;
  abstractionMode: boolean;
  stageCounts: number[];
  createdAt: string;
  updatedAt: string;
  previewId?: string;
  sha256: string;
}
export interface TreeBankPreview {
  id: string;
  dataUrl: string;
  sha256: string;
}
export interface PreparedTreeBankSave {
  work: TreeBankWork;
  records: TreeBankRecord[];
  preview?: TreeBankPreview;
}
export interface TreeBankSaveInput {
  id: string;
  sentence: string;
  framework: 'xbar' | 'minimalism';
  activeParseIndex: number;
  bundle: ParseBundle;
  view?: TreeBankWork['view'];
  replayStep?: number | null;
  abstractionMode?: boolean;
  createdAt: string;
  updatedAt: string;
  treeSnapshotDataUrl?: string;
}

const fail = (message: string): never => { throw new TypeError(message); };
// JSON arrays must be dense; the shared copier intentionally preserves array shape.
const copySnapshot = (value: unknown): any => {
  const copy = copyJsonData(value);
  const check = (item: any) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index += 1) {
        if (!Object.hasOwn(item, index)) fail('JSON arrays must not contain holes.');
        check(item[index]);
      }
    } else Object.values(item).forEach(check);
  };
  check(copy); return copy;
};
const integer = (value: unknown, label: string) => { if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${label} must be a nonnegative safe integer.`); };
const digest = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
};
const withoutHash = (value: any) => { const { sha256, ...body } = value; return body; };
const checkHash = async (value: any) => { requireSha256(value.sha256, 'sha256'); if (await digest(withoutHash(value)) !== value.sha256) fail('Tree Bank integrity mismatch.'); };
const date = (value: unknown, label: string) => { requireNonemptyString(value, label); if (!Number.isFinite(Date.parse(value as string))) fail(`${label} must be a date.`); };
const analysis = (value: any) => {
  requirePlainRecord(value, 'analysis');
  if (!value.tree && !value.finalForest && !value.derivationStages) fail('Analysis has no syntax.');
  if (value.tree !== undefined) requirePlainRecord(value.tree, 'tree');
  if (value.finalForest !== undefined && (!Array.isArray(value.finalForest) || value.finalForest.length === 0)) fail('finalForest must be nonempty.');
  if (value.derivationStages !== undefined && !Array.isArray(value.derivationStages)) fail('derivationStages must be an array.');
  for (const stage of value.derivationStages ?? []) {
    requirePlainRecord(stage, 'stage');
    requireExactFields(stage, ['statement', 'stageRecord', 'relations', 'workspaceForest', ...('realizations' in stage ? ['realizations'] : [])], 'stage');
    if (typeof stage.statement !== 'string' || typeof stage.stageRecord !== 'string' || !Array.isArray(stage.relations) || !Array.isArray(stage.workspaceForest)) fail('Invalid derivation stage.');
    if (stage.realizations !== undefined && !Array.isArray(stage.realizations)) fail('Invalid realizations.');
  }
  if (value.provenance !== undefined) requirePlainRecord(value.provenance, 'provenance');
};
export async function validateTreeBankRecord(value: unknown): Promise<TreeBankRecord> {
  const record = copySnapshot(value) as TreeBankRecord;
  requireExactFields(record, ['schemaVersion', 'id', 'kind', 'payload', 'sha256'], 'record');
  if (record.schemaVersion !== 1 || !['analysis', 'context'].includes(record.kind)) fail('Unsupported Tree Bank record.');
  requirePlainRecord(record.payload, 'payload');
  if (record.kind === 'analysis') analysis(record.payload);
  else if ('analyses' in record.payload || typeof record.payload.ambiguityDetected !== 'boolean') fail('Invalid bundle context.');
  requireSha256(record.sha256, 'sha256');
  if (await digest({ schemaVersion: record.schemaVersion, kind: record.kind, payload: record.payload }) !== record.sha256) fail('Tree Bank integrity mismatch.');
  if (record.id !== `${record.kind}:${record.sha256}`) fail('Record address mismatch.');
  return freezeJsonData(record);
}
export async function validateTreeBankWork(value: unknown): Promise<TreeBankWork> {
  const work = copySnapshot(value) as TreeBankWork;
  requirePlainRecord(work, 'work');
  requireExactFields(work, [
    'schemaVersion', 'id', 'sentence', 'framework', 'analysisIds', 'contextId',
    'activeParseIndex', 'view', 'replayStep', 'abstractionMode', 'stageCounts',
    'createdAt', 'updatedAt', 'sha256', ...('previewId' in work ? ['previewId'] : [])
  ], 'work');
  if (work.schemaVersion !== 2 || !['xbar', 'minimalism'].includes(work.framework)) fail('Unsupported Tree Bank work.');
  requireNonemptyString(work.id, 'id'); requireNonemptyString(work.sentence, 'sentence');
  if (!Array.isArray(work.analysisIds) || !work.analysisIds.length || work.analysisIds.some(id => !/^analysis:[a-f0-9]{64}$/.test(id))) fail('Invalid analysis references.');
  if (!/^context:[a-f0-9]{64}$/.test(work.contextId)) fail('Invalid context reference.');
  integer(work.activeParseIndex, 'activeParseIndex');
  if (work.activeParseIndex >= work.analysisIds.length) fail('Selected analysis is out of range.');
  if (!['tree', 'derivation', 'notes'].includes(work.view) || typeof work.abstractionMode !== 'boolean') fail('Invalid saved view.');
  if (work.replayStep !== null) integer(work.replayStep, 'replayStep');
  if (!Array.isArray(work.stageCounts) || work.stageCounts.length !== work.analysisIds.length) fail('Invalid stage counts.');
  work.stageCounts.forEach(count => integer(count, 'stageCount'));
  date(work.createdAt, 'createdAt'); date(work.updatedAt, 'updatedAt');
  if (Date.parse(work.updatedAt) < Date.parse(work.createdAt)) fail('updatedAt precedes createdAt.');
  if (work.previewId !== undefined && !/^preview:[a-f0-9]{64}$/.test(work.previewId)) fail('Invalid preview reference.');
  await checkHash(work); return freezeJsonData(work);
}
// SVG previews are image data URLs for img elements, never inline SVG markup.
export async function validateTreeBankPreview(value: unknown): Promise<TreeBankPreview> {
  const preview = copySnapshot(value) as TreeBankPreview;
  requireExactFields(preview, ['id', 'dataUrl', 'sha256'], 'preview');
  if (typeof preview.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(preview.dataUrl)) fail('Invalid preview image.');
  requireSha256(preview.sha256, 'preview.sha256');
  if (await digest({ dataUrl: preview.dataUrl }) !== preview.sha256 || preview.id !== `preview:${preview.sha256}`) fail('Preview integrity mismatch.');
  return freezeJsonData(preview);
}
export async function prepareTreeBankSave(input: TreeBankSaveInput): Promise<PreparedTreeBankSave> {
  if (input.view !== undefined && !['tree', 'derivation', 'notes'].includes(input.view)) fail('Invalid saved view.');
  if (input.abstractionMode !== undefined && typeof input.abstractionMode !== 'boolean') fail('Invalid abstraction mode.');
  const bundle = copySnapshot(input.bundle) as ParseBundle;
  requirePlainRecord(bundle, 'bundle');
  if (!Array.isArray(bundle.analyses) || !bundle.analyses.length || typeof bundle.ambiguityDetected !== 'boolean') fail('Invalid parse bundle.');
  const { analyses, ...context } = bundle;
  const records: TreeBankRecord[] = [];
  const makeRecord = async (kind: TreeBankRecord['kind'], payload: any) => {
    // The ID is derived from the carrier body, excluding its own address.
    const sha256 = await digest({ schemaVersion: 1, kind, payload });
    const record = freezeJsonData({ schemaVersion: 1 as const, id: `${kind}:${sha256}`, kind, payload, sha256 });
    if (!records.some(existing => existing.id === record.id)) records.push(record);
    return record.id;
  };
  const analysisIds: string[] = [];
  for (const item of analyses) { analysis(item); analysisIds.push(await makeRecord('analysis', item)); }
  const contextId = await makeRecord('context', context);
  let preview: TreeBankPreview | undefined;
  if (input.treeSnapshotDataUrl !== undefined) {
    const sha256 = await digest({ dataUrl: input.treeSnapshotDataUrl });
    preview = await validateTreeBankPreview({ id: `preview:${sha256}`, dataUrl: input.treeSnapshotDataUrl, sha256 });
  }
  const body = {
    schemaVersion: 2 as const,
    id: input.id,
    sentence: input.sentence,
    framework: input.framework,
    analysisIds,
    contextId,
    activeParseIndex: input.activeParseIndex,
    view: input.view ?? 'tree',
    replayStep: input.replayStep ?? null,
    abstractionMode: input.abstractionMode ?? false,
    stageCounts: analyses.map(item => item.derivationStages?.length ?? 0),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    ...(preview ? { previewId: preview.id } : {})
  };
  const work = await validateTreeBankWork({ ...body, sha256: await digest(body) });
  await restoreTreeBankBundle(work, records);
  return freezeJsonData({ work, records, ...(preview ? { preview } : {}) });
}
export async function restoreTreeBankBundle(value: TreeBankWork, suppliedRecords: TreeBankRecord[]): Promise<ParseBundle> {
  const work = await validateTreeBankWork(value);
  const records = new Map<string, TreeBankRecord>();
  for (const value of suppliedRecords) {
    const record = await validateTreeBankRecord(value);
    if (records.has(record.id)) fail('Duplicate record address.');
    records.set(record.id, record);
  }
  const context = records.get(work.contextId);
  if (!context || context.kind !== 'context') fail('Missing bundle context.');
  const analyses = work.analysisIds.map((id, index) => {
    const record = records.get(id);
    if (!record || record.kind !== 'analysis') fail('Missing analysis record.');
    if ((record.payload.derivationStages?.length ?? 0) !== work.stageCounts[index]) fail('Stage count mismatch.');
    if (record.payload.provenance?.framework !== undefined && record.payload.provenance.framework !== work.framework) fail('Framework mismatch.');
    return record.payload;
  });
  const generationFramework = context.payload.generationRecord?.promptContract?.framework;
  if (generationFramework !== undefined && generationFramework !== work.framework) {
    fail('Generation framework mismatch.');
  }
  if (context.payload.sentence !== undefined && context.payload.sentence !== work.sentence) fail('Sentence mismatch.');
  return freezeJsonData(copyJsonData({ ...context.payload, analyses })) as ParseBundle;
}

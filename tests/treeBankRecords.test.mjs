import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTreeBankSave, restoreTreeBankBundle, validateTreeBankRecord, validateTreeBankWork, validateTreeBankPreview } from '../services/treeBankRecords.ts';
const input = () => ({ id: 'work', sentence: '猫 sees café 🦉', framework: 'minimalism', activeParseIndex: 1, createdAt: '2026-10-06T00:00:00Z', updatedAt: '2026-10-06T01:00:00Z', view: 'derivation', replayStep: 12, abstractionMode: true, bundle: { analyses: [{ tree: { id: '猫' }, derivationStages: [], provenance: { framework: 'minimalism', timestamp: 'exact' } }, { finalForest: [{ id: 'café' }], derivationStages: [{ statement: 'exact stage', stageRecord: 'exact record', workspaceForest: [], relations: [] }] }], ambiguityDetected: true, ambiguityNote: 'é', sentence: '猫 sees café 🦉', inputTokens: ['猫', 'sees', 'café', '🦉'], requestedModelRoute: 'gpt', requestedModelId: 'exact', requestedReasoningEffort: 'high', modelUsed: 'actual', rawModelOutput: { text: '{raw}' }, generationRecord: { prompt: 'exact', usage: { tokens: 12 }, extra: [null, false, 'é'] } } });
test('exact multi-analysis bundle and view roundtrip, immutable and content addressed', async () => {
  const source = input(); const result = await prepareTreeBankSave(source);
  assert.deepEqual(await restoreTreeBankBundle(result.work, result.records), source.bundle);
  assert.equal(result.work.activeParseIndex, 1); assert.equal(result.work.replayStep, 12);
  assert.deepEqual(result.work.stageCounts, [0, 1]); assert.ok(Object.isFrozen(result.records[0].payload));
  assert.equal(result.records.filter(record => record.payload.rawModelOutput).length, 1);
  const again = await prepareTreeBankSave({ ...source, id: 'another' });
  assert.deepEqual(again.work.analysisIds, result.work.analysisIds);
  source.bundle.analyses.reverse(); const reordered = await prepareTreeBankSave(source);
  assert.deepEqual(reordered.work.analysisIds, [...result.work.analysisIds].reverse());
});
test('different alternatives never overwrite and identical alternatives deduplicate', async () => {
  const source = input(); const first = await prepareTreeBankSave(source);
  source.bundle.analyses[0].tree.id = 'different'; const next = await prepareTreeBankSave(source);
  assert.notEqual(first.work.analysisIds[0], next.work.analysisIds[0]);
  source.bundle.analyses = [source.bundle.analyses[0], source.bundle.analyses[0]];
  const repeated = await prepareTreeBankSave(source); assert.equal(repeated.records.length, 2);
  assert.deepEqual(await restoreTreeBankBundle(repeated.work, repeated.records), source.bundle);
});
test('tampering, missing joins and invalid view metadata fail closed', async () => {
  const saved = await prepareTreeBankSave(input());
  await assert.rejects(validateTreeBankRecord({ ...saved.records[0], payload: { tree: { id: 'tamper' } } }), /integrity/);
  await assert.rejects(validateTreeBankWork({ ...saved.work, activeParseIndex: 0 }), /integrity/);
  await assert.rejects(restoreTreeBankBundle(saved.work, saved.records.slice(1)), /Missing/);
  for (const patch of [{ activeParseIndex: 2 }, { activeParseIndex: -1 }, { replayStep: -1 }, { replayStep: 1.5 }, { view: 'bad' }, { framework: 'xbar' }, { updatedAt: '2020-01-01' }]) await assert.rejects(prepareTreeBankSave({ ...input(), ...patch }));
});
test('rejects non-JSON input and malformed bundle without repair', async () => {
  for (const bad of [NaN, Infinity, undefined, new Date()]) { const source = input(); source.bundle.generationRecord = bad; await assert.rejects(prepareTreeBankSave(source)); }
  const source = input(); source.bundle.self = source.bundle; await assert.rejects(prepareTreeBankSave(source), /cycle/);
  for (const bundle of [{ analyses: [], ambiguityDetected: false }, { analyses: [{}], ambiguityDetected: false }, { analyses: [{ tree: {} }], ambiguityDetected: 'false' }]) await assert.rejects(prepareTreeBankSave({ ...input(), bundle }));
});
test('large raw output remains exact; absent optional fields remain absent', async () => {
  const source = input(); source.bundle.rawModelOutput.text = '🦉'.repeat(600_000); delete source.bundle.generationRecord;
  const saved = await prepareTreeBankSave(source); const restored = await restoreTreeBankBundle(saved.work, saved.records);
  assert.deepEqual(restored, source.bundle); assert.equal('generationRecord' in restored, false);
});
test('preview hash and reference roundtrip', async () => {
  const saved = await prepareTreeBankSave({ ...input(), treeSnapshotDataUrl: 'data:image/png;base64,YQ==' });
  assert.equal(saved.work.previewId, saved.preview.id);
  assert.deepEqual(await validateTreeBankPreview(saved.preview), saved.preview);
  await assert.rejects(validateTreeBankPreview({ ...saved.preview, dataUrl: 'data:image/png;base64,Yg==' }), /integrity/);
});
test('accepts the existing SVG snapshot image carrier and preserves its bytes', async () => {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>猫</text></svg>').toString('base64')}`;
  const saved = await prepareTreeBankSave({ ...input(), treeSnapshotDataUrl: dataUrl });
  assert.equal(saved.preview.dataUrl, dataUrl);
  assert.deepEqual(await validateTreeBankPreview(saved.preview), saved.preview);
  await assert.rejects(prepareTreeBankSave({ ...input(), treeSnapshotDataUrl: 'data:text/html;base64,YQ==' }), /preview/);
});
test('generation prompt contract framework must match the saved work', async () => {
  const source = input();
  delete source.bundle.analyses[0].provenance.framework;
  source.bundle.generationRecord.promptContract = { framework: 'minimalism', exactExtra: 'unchanged' };
  const saved = await prepareTreeBankSave(source);
  assert.deepEqual(await restoreTreeBankBundle(saved.work, saved.records), source.bundle);
  await assert.rejects(prepareTreeBankSave({ ...source, framework: 'xbar' }), /Generation framework/);
});

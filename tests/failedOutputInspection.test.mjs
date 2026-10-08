import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { build } from 'esbuild';
import { inspectFailedOutput, inspectFailedPayload, drawableInspectionForest } from '../services/failedOutputInspection.ts';
import { __test__ as parser } from '../server/babelParser.js';
import { createRawOutputArtifact, createFailure } from '../server/babelParser/validationErrors.js';
import { createFailureRecord } from '../server/babelParser/failureRecord.js';
import { prepareReplay } from '../replay/prepareReplay.ts';

const node = (id, children = [], extra = {}) => ({ id, label: 'X', children, ...extra });
const stage = (forest, relations = []) => ({ statement: 'Authored state', stageRecord: 'An unchanged explanation.', relations, workspaceForest: forest });
const raw = payload => createRawOutputArtifact(JSON.stringify(payload));

for (const [label, stages] of [
  ['references', [stage([node('a')]), stage([node('parent', [{ refId: 'a' }])])]],
  ['duplicate IDs and ambiguous anchors', [stage([node('same'), node('same')], [{ relation: 'Agree', anchors: { goal: 'same' } }])]],
  ['invalid node field and unavailable reference', [stage([node('bad', [], { word: 4 })]), stage([{ refId: 'missing' }])]],
  ['invalid relation and realization fields', [stage([node('a')], [null, { relation: 'Agree', anchors: { goal: 9 } }]), { ...stage([node('b')]), realizations: [{ nodeIds: ['b'], tokenIndices: 'wrong' }] }]],
  ['invalid stage shape', [null, {}, stage([node('ok')])]],
  ['conflicting duplicate reference bodies', [stage([node('same'), node('same', [], { label: 'Y' })]), stage([{ refId: 'same' }])]]
]) {
  test(`browser inspection matches canonical server diagnostics: ${label}`, async () => {
    const payload = { analyses: [{ derivationStages: stages }] };
    const original = structuredClone(payload);
    const inspected = await inspectFailedOutput(raw(payload));
    const expected = parser.inspectDerivationWorkspaces(stages, { analysisIndex: 0, sentence: '', fieldPath: '$.analyses[0]' });
    const actual = inspected.analyses[0].stages.map(({ drawingIssue, ...entry }) => entry);
    assert.deepEqual(actual, expected);
    assert.deepEqual(payload, original);
  });
}

test('inspection preserves the exact raw text and every analysis, including unreadable alternatives', async () => {
  const text = '  {"analyses":[{"derivationStages":[]},null,{"unexpected":"unchanged"}]} \n';
  const result = await inspectFailedOutput(createRawOutputArtifact(text));
  assert.equal(result.rawText, text);
  assert.equal(result.analyses.length, 3);
  assert.equal(result.analyses[1].authoredAnalysis, null);
  assert.equal(result.analyses[1].replayStages, null);
  assert.deepEqual(result.payload, JSON.parse(text));
});

test('retained incomplete, corrupted, invalid UTF-8, and malformed bytes are never repaired or drawn', async () => {
  const artifact = raw({ analyses: [] });
  await assert.rejects(inspectFailedOutput({ ...artifact, truncated: true }), /capped copy/);
  await assert.rejects(inspectFailedOutput({ ...artifact, retainedByteLength: 2 }), /length/);
  await assert.rejects(inspectFailedOutput({ ...artifact, sha256: '0'.repeat(64) }), /hash/);
  await assert.rejects(inspectFailedOutput({ ...artifact, data: '%%' }), /decoded/);
  await assert.rejects(inspectFailedOutput(createRawOutputArtifact(Buffer.from([0xc3, 0x28]))), /UTF-8/);
  await assert.rejects(inspectFailedOutput(createRawOutputArtifact('{"analyses":[')), /No text was repaired/);
  await assert.rejects(inspectFailedOutput(raw([])), /JSON object/);
});

test('drawable projection ignores renderer-only injected fields while preserving original node fields', () => {
  const forest = [node('one', [], { word: 'book', tokenIndex: 0, aliasIds: ['other'], replayOrigin: { displayId: 'other' }, unrelated: 'unchanged' })];
  const original = structuredClone(forest);
  const drawable = drawableInspectionForest(forest);
  assert.equal(drawable[0].word, 'book');
  assert.equal(drawable[0].tokenIndex, 0);
  assert.equal(drawable[0].aliasIds, undefined);
  assert.equal(drawable[0].replayOrigin, undefined);
  assert.deepEqual(forest, original);
  assert.equal(drawableInspectionForest([node('bad', [], { silent: 'false' })]), null);
});

test('duplicate occurrences are shown separately and ambiguous relation claims stay neutral', async () => {
  const payload = { derivationStages: [stage([node('same', [], { word: 'one' }), node('same', [], { word: 'two' }), node('probe')], [
    { relation: 'Agree', anchors: { probe: 'probe', goal: 'same' }, values: { features: 'plural' } }
  ])] };
  const analysis = (await inspectFailedOutput(raw(payload), 'one two')).analyses[0];
  assert.equal(analysis.stages[0].workspaceForest[0].id, 'same');
  assert.equal(analysis.ambiguousRelationCount, 1);
  assert.notEqual(analysis.replayStages[0].workspaceForest[0].id, analysis.replayStages[0].workspaceForest[1].id);
  assert.equal(analysis.replayStages[0].relations[0].anchors.goal, 'same');
  assert.ok(analysis.replayStages[0].relations[0].relationContractFailure);
  const replay = prepareReplay({ derivationStages: analysis.replayStages, sentence: 'one two', includePlayback: true });
  assert.equal(replay.playbackSteps.filter(step => step.replayKind === 'relation').length, 1);
});

test('malformed relation fields stay in raw evidence and receive a neutral diagnostic Replay moment', async () => {
  const claim = { relation: 'Agree', anchors: { goal: 4 }, values: { feature: ['plural'] } };
  const payload = { derivationStages: [stage([node('one')], [claim])] };
  const analysis = (await inspectFailedOutput(raw(payload))).analyses[0];
  assert.deepEqual(analysis.authoredAnalysis.derivationStages[0].relations[0], claim);
  assert.deepEqual(analysis.replayStages[0].relations[0].relationContractFailure.raw, claim);
  assert.deepEqual(analysis.replayStages[0].relations[0].anchors, {});
});

test('missing original sentence blocks realization Replay without hiding readable stages', async () => {
  const payload = { derivationStages: [{ ...stage([node('one', [], { word: 'book' })]), realizations: [{ nodeIds: ['one'], tokenIndices: [0] }] }] };
  const analysis = (await inspectFailedOutput(raw(payload))).analyses[0];
  assert.equal(analysis.replayStages, null);
  assert.match(analysis.replayIssue, /original input sentence/);
  assert.equal(analysis.stages[0].workspaceForest[0].word, 'book');
});

test('server failure envelopes keep their exact byte caps and value hashes after pure extraction', () => {
  const small = { failureClass: 'contract_misunderstanding', ruleId: 'R', stageIndex: 2, fieldPath: '$.x', offendingValue: 'hello' };
  assert.deepEqual(createFailure(small), createFailureRecord(small));
  const large = createFailure({ ...small, offendingValue: 'x'.repeat(70_000) });
  assert.equal(large.offendingValue.kind, 'value_too_large_for_inline_error');
  assert.equal(large.offendingValue.byteLength, 70_000);
  assert.match(large.offendingValue.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(createFailure({ offendingValue: undefined }).offendingValue, { kind: 'missing' });
});

test('browser inspection dependency graph contains no Node or provider runtime', async () => {
  const result = await build({ entryPoints: ['services/failedOutputInspection.ts'], bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
  const paths = Object.keys(result.metafile.inputs);
  assert.ok(!paths.some(path => /contractQualification|parseRoutes|modelRuntime|routeConfig|validationErrors\.js/.test(path)));
  assert.ok(paths.includes('server/babelParser/derivationCompiler.js'));
});

test('existing malformed Hindi output keeps all authored copies in app inspection', async () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/hindi-duplicate-workspace.json', import.meta.url), 'utf8'));
  const payload = { derivationStages: fixture.stages.map(entry => entry.authoredStage) };
  const result = inspectFailedPayload(payload, JSON.stringify(payload), fixture.sentence, fixture.inputTokens);
  assert.equal(result.analyses[0].stages.length, 6);
  assert.equal(result.analyses[0].replayStages.length, 6);
  const replay = prepareReplay({ derivationStages: result.analyses[0].replayStages, sentence: fixture.sentence, inputTokens: fixture.inputTokens, includePlayback: true });
  assert.ok(replay.playbackSteps.length > 6);
});

test('tiny repeated references cannot allocate an unbounded diagnostic forest', async () => {
  const stages = [stage([node('n0')])];
  for (let index = 1; index < 30; index++) stages.push(stage([node(`n${index}`, [{ refId: `n${index - 1}` }, { refId: `n${index - 1}` }])]));
  const payload = { analyses: [{ derivationStages: stages }, { derivationStages: stages }] };
  const artifact = raw(payload);
  assert.ok(artifact.byteLength < 20_000, 'a small source can imply over a billion expanded occurrences');
  const original = JSON.stringify(payload);
  const result = await inspectFailedOutput(artifact);
  let totalDrawn = 0;
  const count = forest => { const pending = [...forest]; while (pending.length) { const current = pending.pop(); totalDrawn++; pending.push(...current.children); } };
  for (const analysis of result.analyses) {
    assert.equal(analysis.replayStages, null);
    analysis.stages.forEach(entry => { if (entry.workspaceForest) count(entry.workspaceForest); });
    assert.ok(analysis.stages.some(entry => entry.diagnostics.some(issue => issue.ruleId === 'INSPECTION_WORKSPACE_LIMIT')));
    assert.deepEqual(analysis.authoredAnalysis.derivationStages, stages);
  }
  assert.ok(totalDrawn <= 10_000, 'one expanded occurrence budget covers every analysis');
  assert.equal(JSON.stringify(payload), original);
  assert.equal(result.rawText, original);
});

test('a shallow raw reference chain stops before expanded depth becomes unsafe', async () => {
  const stages = [stage([node('n0')])];
  for (let index = 1; index < 150; index++) stages.push(stage([node(`n${index}`, [{ refId: `n${index - 1}` }])]));
  const payload = { derivationStages: stages };
  const result = await inspectFailedOutput(raw(payload));
  const analysis = result.analyses[0];
  const limited = analysis.stages.find(entry => entry.diagnostics.some(issue => issue.ruleId === 'INSPECTION_WORKSPACE_LIMIT' && /depth/.test(issue.message)));
  assert.ok(limited);
  assert.equal(limited.stageIndex, 128);
  assert.equal(limited.workspaceForest, null);
  assert.equal(analysis.replayStages, null);
  assert.deepEqual(analysis.authoredAnalysis, payload);
  assert.ok(analysis.stages[127].workspaceForest, 'preceding bounded authored states remain inspectable');
  const serverInspection = parser.inspectDerivationWorkspaces(stages.slice(0, 130));
  assert.ok(serverInspection[129].workspaceForest, 'ordinary server inspection remains uncapped by browser limits');
  assert.ok(serverInspection.every(entry => !entry.diagnostics.some(issue => issue.ruleId === 'INSPECTION_WORKSPACE_LIMIT')));
});

test('raw deeply nested data is refused before recursive inspection starts', async () => {
  let root = node('leaf');
  for (let index = 0; index < 200; index++) root = node(`p${index}`, [root]);
  await assert.rejects(inspectFailedOutput(raw({ derivationStages: [stage([root])] })), /deeply nested/);
});

test('reference reuse cannot multiply large extra fields beyond the inspection budget', async () => {
  const metadata = 'abcdefghij';
  const first = node('source', [], { extra: Array(30_000).fill(metadata) });
  const stages = [stage([first]), stage(Array.from({ length: 30 }, () => ({ refId: 'source' })))];
  const analysis = (await inspectFailedOutput(raw({ derivationStages: stages }))).analyses[0];
  assert.equal(analysis.stages[0].workspaceForest[0].extra.length, 30_000);
  assert.equal(analysis.stages[1].workspaceForest, null);
  assert.ok(analysis.stages[1].diagnostics.some(issue => issue.ruleId === 'INSPECTION_WORKSPACE_LIMIT' && /node fields/.test(issue.message)));
  assert.deepEqual(analysis.authoredAnalysis.derivationStages, stages);
});

test('unknown original input does not invent realization index errors', async () => {
  const payload = { derivationStages: [{ ...stage([node('one', [], { word: 'book' })]), realizations: [{ nodeIds: ['one'], tokenIndices: [3] }] }] };
  const withoutInput = (await inspectFailedOutput(raw(payload))).analyses[0];
  assert.equal(withoutInput.replayStages, null);
  assert.match(withoutInput.replayIssue, /original input sentence/);
  assert.deepEqual(withoutInput.stages[0].diagnostics, []);
  const withTokens = (await inspectFailedOutput(raw(payload), '', ['one', 'two', 'three', 'book'])).analyses[0];
  assert.ok(!withTokens.stages[0].diagnostics.some(issue => /outside|out of range/.test(issue.message)));
  const withShortInput = (await inspectFailedOutput(raw(payload), 'book')).analyses[0];
  assert.ok(withShortInput.stages[0].diagnostics.length > 0, 'actual known input still checks token positions');
});

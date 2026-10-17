import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';
import {
  buildSpelloutContentsPrompt, buildSpelloutSystemInstruction, convertSpelloutPayload, planSpelloutAttempts
} from '../contractQualification/spelloutContract.js';
import { writeSpelloutAttempts } from '../contractQualification/spelloutArtifacts.js';
import { resolveResearchModelSelection } from '../server/babelParser/researchModelCatalog.js';
import { buildCodexQualificationRequest } from '../contractQualification/codexOAuth.js';

const repoRoot = path.resolve(import.meta.dirname, '..');

const normalize = (payload, sentence, inputTokens, framework = 'xbar') =>
  normalizeParseBundle(structuredClone(payload), framework, sentence, 'gpt', true, { inputTokens });

const leaf = (id, word, extra = {}) => ({ id, label: word, word, children: [], ...extra });
const node = (id, label, ...children) => ({ id, label, children });
const oneStage = (workspaceForest, realizations) => ({ derivationStages: [{
  statement: 'The clause is complete.', stageRecord: 'Every word is in place.', relations: [], workspaceForest,
  ...(realizations ? { realizations } : {})
}] });
const flat = (...words) => oneStage([node('s', 'S', ...words.map((word, index) => leaf(`w${index}`, word)))]);
const convertOne = (payload, sentence) => {
  const [result] = convertSpelloutPayload(payload, sentence);
  return result;
};

test('the spell-out variant removes every input-token passage and sends only the sentence', () => {
  for (const framework of ['xbar', 'minimalism']) {
    const instruction = buildSpelloutSystemInstruction(framework);
    assert.doesNotMatch(instruction, /tokenIndex|tokenIndices|input token/i);
    assert.match(instruction, /- text: a nonblank string, the exact contiguous stretch of the input sentence/);
    assert.match(instruction, /spell out the input sentence exactly once, in order, ignoring letter case, whitespace and punctuation/);
  }
  assert.equal(buildSpelloutContentsPrompt('Mia laughed.'), 'Sentence: "Mia laughed."');
});

test('the spell-out request differs from the default only in its prompts', () => {
  const request = { sentence: 'ฉันกินข้าว', framework: 'minimalism' };
  const indexed = buildCodexQualificationRequest(request);
  const spellout = buildCodexQualificationRequest({ ...request, contract: 'spellout' });
  assert.equal(spellout.inputTokens, undefined);
  assert.deepEqual(spellout.body, { ...indexed.body, instructions: buildSpelloutSystemInstruction('minimalism'),
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'Sentence: "ฉันกินข้าว"' }] }] });
  assert.throws(() => buildCodexQualificationRequest({ ...request, contract: 'characters' }), /indexed or spellout/);
});

const fixtureRecords = () => {
  const records = [];
  const walk = (value, label) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${label}[${index}]`));
    if (typeof value.sentence === 'string' && (Array.isArray(value.derivationStages) || Array.isArray(value.analyses))) {
      records.push({ label, sentence: value.sentence, framework: value.framework === 'minimalism' ? 'minimalism' : 'xbar',
        inputTokens: value.inputTokens,
        payload: Array.isArray(value.analyses) ? { analyses: value.analyses } : { derivationStages: value.derivationStages } });
      return;
    }
    Object.entries(value).forEach(([key, item]) => walk(item, `${label}.${key}`));
  };
  const visit = (directory) => fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.name.endsWith('.json')) walk(JSON.parse(fs.readFileSync(full, 'utf8')), path.relative(repoRoot, full));
  });
  visit(path.join(repoRoot, 'fixtures'));
  return records;
};

/** Today's analysis as a spell-out response: no tokenIndex, and groups name their text. */
const restateAsSpellout = (analysis, sentence, tokens) => {
  const text = sentence.normalize('NFC');
  let at = 0;
  const spans = tokens.map((token) => {
    const start = text.toLowerCase().indexOf(token.normalize('NFC').toLowerCase(), at);
    at = start + token.normalize('NFC').length;
    return [start, at];
  });
  const strip = (item) => {
    if (!item || typeof item !== 'object' || (Object.keys(item).length === 1 && 'refId' in item)) return item;
    const { tokenIndex, ...rest } = item;
    return Array.isArray(item.children) ? { ...rest, children: item.children.map(strip) } : rest;
  };
  let contiguous = true;
  const derivationStages = analysis.derivationStages.map((stage) => ({
    ...stage,
    workspaceForest: stage.workspaceForest.map(strip),
    ...(Array.isArray(stage.realizations) ? { realizations: stage.realizations.map(({ nodeIds, tokenIndices }) => {
      if (tokenIndices.some((index, position) => position && index !== tokenIndices[position - 1] + 1)) contiguous = false;
      return { nodeIds, text: text.slice(spans[tokenIndices[0]][0], spans[tokenIndices.at(-1)][1]) };
    }) } : {})
  }));
  return { analysis: { ...analysis, derivationStages }, contiguous };
};

test('every complete fixture restated as spell-out reaches the same parse and Replay', () => {
  const derived = (bundle, sentence) => bundle.analyses.map(({ provenance, derivationStages, ...rest }) => ({
    rest, replay: buildReplaySnapshotProjection({ ...bundle, sentence, analyses: [{ provenance, derivationStages, ...rest }] })
  }));
  let identical = 0, resegmented = 0;
  for (const record of fixtureRecords()) {
    const tokens = resolveSavedInputTokens(record.sentence, record.inputTokens);
    let baseline;
    try { baseline = normalize(record.payload, record.sentence, tokens, record.framework); } catch { continue; }
    const analyses = record.payload.analyses || [record.payload];
    const restated = analyses.map(analysis => restateAsSpellout(analysis, record.sentence, tokens));
    if (restated.some(item => !item.contiguous)) continue;
    const spellout = record.payload.analyses ? { analyses: restated.map(item => item.analysis) } : restated[0].analysis;
    const results = convertSpelloutPayload(spellout, record.sentence);
    results.forEach(result => assert.ok(result.ok, `${record.label}: ${JSON.stringify(result.diagnostics)}`));
    const derivedTokens = results[0].inputTokens;
    results.forEach(result => assert.deepEqual(result.inputTokens, derivedTokens, record.label));
    const converted = record.payload.analyses ? { analyses: results.map(result => result.analysis) } : results[0].analysis;
    const candidate = normalize(converted, record.sentence, derivedTokens, record.framework);
    if (JSON.stringify(derivedTokens) === JSON.stringify(tokens)) {
      assert.deepEqual(derived(candidate, record.sentence), derived(baseline, record.sentence), record.label);
      identical += 1;
    } else {
      // Spell-out may only join adjacent tokens that one group realized together.
      const letters = list => list.join('').replace(/[\p{White_Space}\u200B\p{P}]/gu, '');
      assert.equal(letters(derivedTokens), letters(tokens), record.label);
      assert.ok(derivedTokens.length < tokens.length, record.label);
      candidate.analyses.forEach(analysis => buildReplaySnapshotProjection({ ...candidate, sentence: record.sentence, analyses: [analysis] }));
      resegmented += 1;
    }
  }
  assert.ok(identical >= 80, `only ${identical} fixtures compared`);
  assert.ok(resegmented >= 5, `only ${resegmented} resegmented fixtures`);
});

test('a group spells its text once, at its first pronounced terminal', () => {
  const payload = oneStage([node('tp', 'TP', leaf('subj', '花子'), leaf('ga', 'が'),
    node('vp', 'VP', leaf('v', '読む'), leaf('t', 'た')))], [{ nodeIds: ['v', 't'], text: '読んだ' }]);
  const result = convertOne(payload, '花子が読んだ。');
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.inputTokens, ['花子', 'が', '読んだ']);
  assert.deepEqual(result.analysis.derivationStages[0].realizations, [{ nodeIds: ['v', 't'], tokenIndices: [2] }]);
  assert.equal(normalize(result.analysis, '花子が読んだ。', result.inputTokens).analyses.length, 1);
});

test('words follow the model, not spaces or invisible separators', () => {
  const vietnamese = convertOne(flat('Tôi', 'là', 'học sinh'), 'Tôi là học sinh.');
  assert.deepEqual(vietnamese.inputTokens, ['Tôi', 'là', 'học sinh']);
  assert.deepEqual(vietnamese.observations, [{ rule: 'SPELLOUT_SPAN_CROSSES_WHITESPACE', token: 'học sinh' }]);
  const khmer = convertOne(flat('ខ្ញុំ', 'ទៅ', 'ផ្សារ'), 'ខ្ញុំ​ទៅ​ផ្សារ។');
  assert.deepEqual(khmer.inputTokens, ['ខ្ញុំ', 'ទៅ', 'ផ្សារ']);
  const thai = convertOne(flat('ฉัน', 'กิน', 'ข้าว'), 'ฉันกินข้าว');
  assert.deepEqual(thai.inputTokens, ['ฉัน', 'กิน', 'ข้าว']);
  const name = convertOne(flat('小李', '还', '没有', '看'), '小李还没有看。');
  assert.deepEqual(name.inputTokens, ['小李', '还', '没有', '看']);
});

test('spelling ignores case and punctuation but keeps the sentence spelling in tokens', () => {
  const sentence = 'They don’t know.';
  const result = convertOne(flat('they', "don't", 'know'), sentence);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.inputTokens, ['They', 'don’t', 'know']);
  // The parser compares inner marks exactly, so that word is recorded as realizing its token.
  assert.deepEqual(result.spellingGroups, [{ nodeIds: ['w1'], tokenIndices: [1] }]);
  assert.equal(normalize(result.analysis, sentence, result.inputTokens).analyses.length, 1);
  const period = convertOne(flat('Mia', 'laughed', '.'), 'Mia laughed.');
  assert.deepEqual(period.inputTokens, ['Mia', 'laughed', '.']);
});

test('misspelled, missing and indexed words fail the spell-out check', () => {
  assert.equal(convertOne(flat('Mia', 'laughs'), 'Mia laughed.').diagnostics[0].rule, 'SPELLOUT_MISMATCH');
  assert.equal(convertOne(flat('Mia'), 'Mia laughed.').diagnostics[0].rule, 'SPELLOUT_INCOMPLETE');
  const indexed = oneStage([node('s', 'S', leaf('a', 'Mia', { tokenIndex: 0 }), leaf('b', 'laughed'))]);
  assert.equal(convertOne(indexed, 'Mia laughed.').diagnostics[0].rule, 'SPELLOUT_TOKEN_INDEX');
  const numbered = oneStage([node('s', 'S', leaf('a', 'Mia'), leaf('b', 'laughed'))], [{ nodeIds: ['b'], tokenIndices: [1] }]);
  assert.equal(convertOne(numbered, 'Mia laughed.').diagnostics[0].rule, 'SPELLOUT_GROUP_SHAPE');
  const silent = oneStage([node('s', 'S', leaf('a', 'Mia'), leaf('b', 'laughed', { silent: true }))], [{ nodeIds: ['b'], text: 'laughed' }]);
  assert.equal(convertOne(silent, 'Mia laughed.').diagnostics[0].rule, 'SPELLOUT_GROUP_UNPLACED');
});

test('an earlier group with repeated text resolves through the nodes it names', () => {
  const sentence = 'た た';
  const final = [node('s', 'S', leaf('x', 'た'), leaf('y', 'ta'))];
  const payload = { derivationStages: [
    { statement: 'y', stageRecord: 'y', relations: [], workspaceForest: [leaf('y', 'ta')], realizations: [{ nodeIds: ['y'], text: 'た' }] },
    { statement: 's', stageRecord: 's', relations: [], workspaceForest: final, realizations: [{ nodeIds: ['y'], text: 'た' }] }
  ] };
  const result = convertOne(payload, sentence);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.analysis.derivationStages[0].realizations, [{ nodeIds: ['y'], tokenIndices: [1] }]);
});

test('analyses that segment differently become separate attempts', () => {
  const payload = { analyses: [flat('小李', '来', '了'), flat('小', '李', '来', '了'), flat('小李', '来', '了'), flat('大李', '来', '了')] };
  const results = convertSpelloutPayload(payload, '小李来了。');
  const { attempts, failures } = planSpelloutAttempts(payload, results);
  assert.deepEqual(attempts.map(({ id, inputTokens, analysisIndices }) => ({ id, inputTokens, analysisIndices })), [
    { id: 'parse-segmentation-1', inputTokens: ['小李', '来', '了'], analysisIndices: [0, 2] },
    { id: 'parse-segmentation-2', inputTokens: ['小', '李', '来', '了'], analysisIndices: [1] }
  ]);
  assert.equal(attempts[0].payload.analyses.length, 2);
  assert.deepEqual(failures.map(({ id, analysisIndex }) => ({ id, analysisIndex })), [{ id: 'parse-analysis-4-spellout', analysisIndex: 3 }]);
  const single = planSpelloutAttempts(flat('Mia', 'laughed'), convertSpelloutPayload(flat('Mia', 'laughed'), 'Mia laughed.'));
  assert.equal(single.attempts[0].id, 'parse');
});

test('a spell-out response becomes ordinary attempts plus recorded spell-out failures', () => {
  const model = resolveResearchModelSelection('openai:gpt-6.1-sol', {});
  const write = (text) => {
    const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-spellout-'));
    try {
      const written = writeSpelloutAttempts({ outputPath, sentence: '花子が読んだ。', framework: 'xbar', model, text });
      return { written, record: JSON.parse(fs.readFileSync(path.join(outputPath, 'spellout.json'), 'utf8')),
        files: fs.readdirSync(path.join(outputPath, 'attempts')).sort() };
    } finally { fs.rmSync(outputPath, { recursive: true, force: true }); }
  };
  const grouped = oneStage([node('tp', 'TP', leaf('subj', '花子'), leaf('ga', 'が'),
    node('vp', 'VP', leaf('v', '読む'), leaf('t', 'た')))], [{ nodeIds: ['v', 't'], text: '読んだ' }]);
  const valid = write(JSON.stringify(grouped));
  assert.deepEqual(valid.written.map(item => [item.reviewEntry.attemptId, item.receipt.outcome.status]), [['parse', 'valid-pending-review']]);
  assert.deepEqual(valid.written[0].receipt.request.inputTokens, ['花子', 'が', '読んだ']);
  assert.equal(valid.record.analyses[0].units[2].token, '読んだ');

  const mixed = write(JSON.stringify({ analyses: [grouped, flat('花子', 'が', '読む')] }));
  assert.deepEqual(mixed.written.map(item => [item.reviewEntry.attemptId, item.receipt.outcome.status, item.receipt.outcome.phase]),
    [['parse', 'valid-pending-review', undefined], ['parse-analysis-2-spellout', 'failed', 'spellout']]);
  assert.equal(mixed.written[1].receipt.outcome.failure.ruleId, 'SPELLOUT_MISMATCH');
  assert.deepEqual(mixed.files, ['parse', 'parse-analysis-2-spellout']);

  const unreadable = write('not json');
  assert.equal(unreadable.record.ingress.status, 'failed');
  assert.deepEqual(unreadable.written.map(item => [item.reviewEntry.attemptId, item.receipt.outcome.status]), [['parse', 'failed']]);
});

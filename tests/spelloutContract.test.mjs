import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';
import { convertSpelloutPayload } from '../server/babelParser/spellout.js';
import { buildSystemInstruction } from '../server/babelParser/systemInstruction.js';
import { buildParseContentsPrompt } from '../server/babelParser/prompts.js';
import { planSpelloutAttempts, writeSpelloutAttempts } from '../contractQualification/spelloutArtifacts.js';
import { resolveResearchModelSelection } from '../server/babelParser/researchModelCatalog.js';

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

test('the prompt sends only the sentence and asks the model to spell it', () => {
  for (const framework of ['xbar', 'minimalism']) {
    for (const route of ['gemini', 'gpt', 'claude', 'local']) {
      const instruction = buildSystemInstruction(framework, route);
      assert.doesNotMatch(instruction, /tokenIndex|tokenIndices|input token|written word/i);
      assert.match(instruction, /- text: the exact text of the input sentence .* or a nonempty array of nonblank strings, in sentence order, for stretches that are not adjacent\./);
      assert.match(instruction, /including its spacing, does not prescribe word, syntactic or morpheme boundaries/);
      assert.match(instruction, /Omit realizations when the pronounced terminals' own words, in tree order, spell the sentence\./);
      assert.match(instruction, /each group's text claims its own stretches of the sentence; set aside their covered lexical leaves/);
    }
  }
  assert.equal(buildParseContentsPrompt('Mia laughed.'), 'Sentence: "Mia laughed."');
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
  const derivationStages = analysis.derivationStages.map((stage) => ({
    ...stage,
    workspaceForest: stage.workspaceForest.map(strip),
    ...(Array.isArray(stage.realizations) ? { realizations: stage.realizations.map(({ nodeIds, tokenIndices }) => {
      // Positions that are not adjacent become separate pieces.
      const runs = tokenIndices.reduce((list, index) => {
        if (list.length && index === list.at(-1).at(-1) + 1) list.at(-1).push(index); else list.push([index]);
        return list;
      }, []);
      const pieces = runs.map(run => text.slice(spans[run[0]][0], spans[run.at(-1)][1]));
      return { nodeIds, text: pieces.length === 1 ? pieces[0] : pieces };
    }) } : {})
  }));
  return { analysis: { ...analysis, derivationStages } };
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
  // Punctuation the word itself writes at its edges stays in its token.
  const possessive = convertOne(flat('Mia', '’s', 'book'), 'Mia’s book');
  assert.ok(possessive.ok, JSON.stringify(possessive.diagnostics));
  assert.deepEqual(possessive.inputTokens, ['Mia', '’s', 'book']);
  assert.deepEqual(convertOne(flat('Mia', "'s", 'book'), 'Mia’s book').inputTokens, ['Mia', '’s', 'book']);
  assert.deepEqual(convertOne(flat('Mia’s', 'book'), 'Mia’s book').inputTokens, ['Mia’s', 'book']);
  assert.deepEqual(convertOne(flat('Mia', 's', 'book'), 'Mia’s book').inputTokens, ['Mia', 's', 'book']);
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

test('analyses that divide words differently share one word list cut at every boundary', () => {
  const payload = { analyses: [flat('小李', '来', '了'), flat('小', '李', '来', '了'), flat('小李', '来', '了'), flat('大李', '来', '了')] };
  const results = convertSpelloutPayload(payload, '小李来了。');
  assert.deepEqual(results.map(result => result.ok), [true, true, true, false]);
  results.slice(0, 3).forEach(result => assert.deepEqual(result.inputTokens, ['小', '李', '来', '了']));
  // A whole word over several tokens is recorded as that leaf realizing them.
  assert.deepEqual(results[0].spellingGroups, [{ nodeIds: ['w0'], tokenIndices: [0, 1] }]);
  assert.deepEqual(results[1].spellingGroups, []);
  const { attempts, failures } = planSpelloutAttempts(payload, results);
  assert.deepEqual(attempts.map(({ id, inputTokens, analysisIndices }) => ({ id, inputTokens, analysisIndices })), [
    { id: 'parse', inputTokens: ['小', '李', '来', '了'], analysisIndices: [0, 1, 2] }
  ]);
  assert.equal(normalize(attempts[0].payload, '小李来了。', attempts[0].inputTokens).analyses.length, 3);
  assert.deepEqual(failures.map(({ id, analysisIndex }) => ({ id, analysisIndex })), [{ id: 'parse-analysis-4-spellout', analysisIndex: 3 }]);
  const single = planSpelloutAttempts(flat('Mia', 'laughed'), convertSpelloutPayload(flat('Mia', 'laughed'), 'Mia laughed.'));
  assert.equal(single.attempts[0].id, 'parse');
});

test('an earlier group may name part of a word that grows in a later stage', () => {
  const sentence = '他把杯子打破了。';
  const stage = (statement, workspaceForest, realizations) => ({ statement, stageRecord: statement, relations: [], workspaceForest, realizations });
  const compound = node('compound', 'V', leaf('v', '打'), leaf('r', '破'));
  const payload = { derivationStages: [
    stage('Compound.', [compound], [{ nodeIds: ['compound'], text: '打破' }]),
    stage('Clause.', [node('s', 'S', leaf('he', '他'), leaf('ba', '把'), leaf('cup', '杯子'),
      node('asp', 'Asp', { refId: 'compound' }, leaf('le', '了')))], [{ nodeIds: ['asp'], text: '打破了' }])
  ] };
  const result = convertOne(payload, sentence);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.inputTokens, ['他', '把', '杯子', '打破', '了']);
  assert.deepEqual(result.analysis.derivationStages.map(item => item.realizations),
    [[{ nodeIds: ['compound'], tokenIndices: [3] }], [{ nodeIds: ['asp'], tokenIndices: [3, 4] }]]);
  assert.equal(normalize(result.analysis, sentence, result.inputTokens).analyses.length, 1);
  // The part must occur once inside the final words that the group's own nodes pronounce.
  const elsewhere = structuredClone(payload);
  elsewhere.derivationStages[0].realizations[0].text = '杯';
  assert.equal(convertOne(elsewhere, sentence).diagnostics[0].rule, 'SPELLOUT_GROUP_UNRESOLVED');
});

test('a group may claim stretches of the sentence that are not adjacent', () => {
  const sentence = 'Je ne mange pas.';
  const payload = oneStage([node('s', 'S', leaf('je', 'je'), node('neg', 'NegP', leaf('n', 'NEG'), node('vp', 'VP', leaf('v', 'mange'))))],
    [{ nodeIds: ['n'], text: ['ne', 'pas'] }]);
  const result = convertOne(payload, sentence);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.inputTokens, ['Je', 'ne', 'mange', 'pas']);
  assert.deepEqual(result.analysis.derivationStages[0].realizations, [{ nodeIds: ['n'], tokenIndices: [1, 3] }]);
  const bundle = normalize(result.analysis, sentence, result.inputTokens);
  buildReplaySnapshotProjection({ ...bundle, sentence, analyses: bundle.analyses });
  // An earlier stage may name the same pieces.
  const twoStages = { derivationStages: [
    { statement: 'Neg.', stageRecord: 'Neg.', relations: [], workspaceForest: [leaf('n', 'NEG')], realizations: [{ nodeIds: ['n'], text: ['ne', 'pas'] }] },
    payload.derivationStages[0]
  ] };
  const staged = convertOne(twoStages, sentence);
  assert.ok(staged.ok, JSON.stringify(staged.diagnostics));
  assert.deepEqual(staged.analysis.derivationStages[0].realizations, [{ nodeIds: ['n'], tokenIndices: [1, 3] }]);
  assert.equal(convertOne(oneStage([leaf('n', 'NEG')], [{ nodeIds: ['n'], text: [] }]), sentence).diagnostics[0].rule, 'SPELLOUT_GROUP_SHAPE');
});

test('a group claims its words wherever they are, and other words fill the rest in tree order', () => {
  const sentence = 'Mia laughed.';
  // The grouped verb is read before the subject in this tree, but its text comes second.
  const payload = oneStage([node('s', 'S', node('vp', 'VP', leaf('v', 'laugh')), leaf('mia', 'Mia'), leaf('t', 'PAST'))],
    [{ nodeIds: ['v', 't'], text: 'laughed' }]);
  const result = convertOne(payload, sentence);
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.inputTokens, ['Mia', 'laughed']);
  assert.deepEqual(result.analysis.derivationStages[0].realizations, [{ nodeIds: ['v', 't'], tokenIndices: [1] }]);
  assert.equal(normalize(result.analysis, sentence, result.inputTokens).analyses.length, 1);
  // Ordinary words still keep tree order.
  assert.equal(convertOne(flat('laughed', 'Mia'), sentence).diagnostics[0].rule, 'SPELLOUT_MISMATCH');
});

test('a live response is checked and converted inside parsing, with typed failures', () => {
  const sentence = '花子が読んだ。';
  const grouped = oneStage([node('tp', 'TP', leaf('subj', '花子'), leaf('ga', 'が'),
    node('vp', 'VP', leaf('v', '読む'), leaf('t', 'た')))], [{ nodeIds: ['v', 't'], text: '読んだ' }]);
  const bundle = normalizeParseBundle(structuredClone(grouped), 'xbar', sentence, 'gpt', true, { spellout: true });
  assert.deepEqual(bundle.inputTokens, ['花子', 'が', '読んだ']);
  const outcomes = [];
  assert.throws(() => normalizeParseBundle({ analyses: [grouped, flat('花子', 'が', '読む')] }, 'xbar', sentence, 'gpt', true,
    { spellout: true, analysisOutcomes: outcomes }), (error) => {
    assert.equal(error.failure.ruleId, 'SPELLOUT_MISMATCH');
    assert.equal(error.failure.analysisIndex, 1);
    assert.equal(error.failure.fieldPath, '$.analyses[1]');
    assert.match(error.message, /^Analysis 2: "読む" does not spell the sentence/);
    return true;
  });
  assert.deepEqual(outcomes.map(outcome => [outcome.analysisIndex, outcome.status]), [[1, 'failed']]);
  // A failure after the spelling check carries the derived word list.
  // Spelling ignores a node whose children are not a list; the parser rejects it.
  const badField = oneStage([node('s', 'S', leaf('a', 'Mia'), leaf('b', 'laughed'), { id: 'x', label: 'X', children: 'none' })]);
  assert.throws(() => normalizeParseBundle(badField, 'xbar', 'Mia laughed.', 'gpt', true, { spellout: true }), (error) => {
    assert.deepEqual(error.details.inputTokens, ['Mia', 'laughed']);
    return true;
  });
  // The envelope is still checked first.
  assert.throws(() => normalizeParseBundle({ ...grouped, extra: true }, 'xbar', sentence, 'gpt', true, { spellout: true }),
    error => error.failure.ruleId === 'PAYLOAD_ENVELOPE_EXACT');
});

test('a workspace that repeats an occurrence stops at the repeat instead of expanding it', () => {
  // Each stage references the previous root twice; full expansion would double every stage.
  const stages = [{ statement: 's', stageRecord: 's', relations: [], workspaceForest: [node('r0', 'X', leaf('w', 'Mia'))] }];
  for (let index = 1; index < 40; index += 1) {
    stages.push({ statement: 's', stageRecord: 's', relations: [], workspaceForest: [node(`r${index}`, 'X', { refId: `r${index - 1}` }, { refId: `r${index - 1}` })] });
  }
  const started = performance.now();
  const [result] = convertSpelloutPayload({ derivationStages: stages }, 'Mia');
  assert.ok(performance.now() - started < 250, 'expansion stays linear');
  assert.equal(result.diagnostics[0].rule, 'SPELLOUT_UNREADABLE');
  assert.match(result.diagnostics[0].detail, /^Stage 2 repeats occurrence id r0\./);
  const unknownGroupNode = oneStage([node('s', 'S', leaf('a', 'Mia'), leaf('b', 'laughed'))], [{ nodeIds: ['missing'], text: 'laughed' }]);
  assert.match(convertOne(unknownGroupNode, 'Mia laughed.').diagnostics[0].detail, /group 0 names missing, which is not in its workspace/);
  const unknownRef = oneStage([{ refId: 'nowhere' }]);
  assert.match(convertOne(unknownRef, 'Mia').diagnostics[0].detail, /refId nowhere has no earlier definition/);
});

test('an analysis that does not spell another analysis\'s punctuation word fails', () => {
  const results = convertSpelloutPayload({ analyses: [flat('Mia', 'laughed', '.'), flat('Mia', 'laughed')] }, 'Mia laughed.');
  assert.deepEqual(results.map(result => result.ok), [true, false]);
  assert.deepEqual(results[0].inputTokens, ['Mia', 'laughed', '.']);
  assert.equal(results[1].diagnostics[0].rule, 'SPELLOUT_SEGMENTATION_CONFLICT');
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

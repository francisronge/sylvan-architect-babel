import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { parseModelJsonDetailed } from '../server/babelParser/modelJson.js';
import { ParseApiError } from '../server/babelParser/error.js';
import { createParseRoutes } from '../server/babelParser/parseRoutes.js';
import { createTreeBankBundleSnapshot } from '../treeBankSnapshot.js';
import { restateAsSpellout } from './helpers/spelloutPayload.mjs';

// Babel used to rebalance brackets until a response parsed; Francis removed that
// repair on 22 Oct 2026. These tests pin that unbalanced brackets now fail.
const fixturesDirectory = new URL('../fixtures/raw/', import.meta.url);

const parseRawOutput = async (t, rawText, sentence, framework) => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'offline-test-only';
  t.after(() => {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  });
  return createParseRoutes({
    ParseApiError,
    normalizeParseBundle: normalizeParseBundle,
    parseModelJsonDetailed: parseModelJsonDetailed,
    generateOpenAI: async () => ({ text: rawText, status: 'completed', candidates: [{ finishReason: 'COMPLETED' }] })
  }).parseSentenceWithResearchModel(sentence, framework, 'openai:gpt-6-astra');
};

const assertUnbalanced = (error, raw, { candidateByteOffset, message }) => {
  assert.equal(error instanceof ParseApiError, true);
  assert.equal(error.code, 'BAD_MODEL_RESPONSE');
  assert.equal(error.failure.class, 'transport_serialization');
  assert.equal(error.failure.ruleId, 'TRANSPORT_JSON_DELIMITERS_BALANCED');
  assert.equal(error.failure.processingStep, 'json-decoding');
  const { jsonDiagnostic } = error.details;
  assert.equal(jsonDiagnostic.kind, 'json-delimiter-damage');
  assert.equal(jsonDiagnostic.candidateByteOffset, candidateByteOffset);
  assert.match(jsonDiagnostic.message, message);
  assert.equal(error.failure.message, jsonDiagnostic.message);
  assert.equal(jsonDiagnostic.originalSyntaxError.kind, 'json-syntax');
  assert.equal(jsonDiagnostic.originalSyntaxError.candidateByteOffset, candidateByteOffset);
  assert.equal('payloadRepairDiagnostics' in error.details, false);
  assert.equal(Buffer.from(error.rawOutput.data, 'base64').toString('utf8'), raw);
  return true;
};

const rejectsUnbalanced = (raw, expected) => assert.throws(
  () => parseModelJsonDetailed(raw),
  (error) => assertUnbalanced(error, raw, expected)
);

test('brackets left open at the end fail instead of being closed', () => {
  const raw = '{"a":[1,2';
  rejectsUnbalanced(raw, { candidateByteOffset: Buffer.byteLength(raw), message: /ends with 2 brackets still open/ });
});

test('a mismatched closer fails instead of having closers inserted before it', () => {
  const raw = '{"é":[1,2}';
  rejectsUnbalanced(raw, {
    candidateByteOffset: Buffer.byteLength(raw.slice(0, -1)),
    message: /closing bracket at byte 10 does not match/
  });
});

test('a stray closer inside the value fails instead of being removed', () => {
  const raw = '{"a":[1,2]]}';
  rejectsUnbalanced(raw, {
    candidateByteOffset: Buffer.byteLength('{"a":[1,2]'),
    message: /closing bracket at byte 10 does not match/
  });
});

test('a stray closer after the complete value fails instead of being removed', () => {
  for (const tail of ['}', ']', ' }\n]}']) {
    const raw = `{"a":1}${tail}`;
    rejectsUnbalanced(raw, {
      candidateByteOffset: Buffer.byteLength('{"a":1}') + tail.indexOf(tail.trim()[0]),
      message: /follows the complete value/
    });
  }
});

// Reduced from a saved GPT-6.1 Sol output (night4-20261019 40-en-long-question) whose
// analyses each lacked their final "]}": closing the end nested later analyses inside
// earlier ones.
test('closers missing inside the value fail even though closing the end would parse', () => {
  const stage = { statement: 'S', stageRecord: 'R', relations: [], workspaceForest: [{ id: 'n', label: 'N', children: [] }] };
  const analysis = JSON.stringify({ derivationStages: [stage] });
  const raw = `{"analyses":[${analysis.slice(0, -2)},${analysis}]}`;
  assert.equal(JSON.parse(`${raw}]}`).analyses.length, 1);
  rejectsUnbalanced(raw, { candidateByteOffset: Buffer.byteLength(raw), message: /ends with 2 brackets still open/ });
});

test('error offsets account for BOM, whitespace and multibyte text', () => {
  const candidate = '{"é":[1,2}';
  const raw = `﻿\n  ${candidate}\n`;
  assert.throws(() => parseModelJsonDetailed(raw), (error) => {
    const { jsonDiagnostic } = error.details;
    for (const diagnostic of [jsonDiagnostic, jsonDiagnostic.originalSyntaxError]) {
      assert.equal(diagnostic.candidateByteOffset, Buffer.byteLength(candidate.slice(0, -1)));
      assert.equal(diagnostic.originalByteOffset, Buffer.byteLength(raw.slice(0, raw.indexOf('}'))));
    }
    assert.match(jsonDiagnostic.originalSyntaxError.message, /JSON/);
    return true;
  });
});

test('does not treat delimiters inside strings as damage', () => {
  const parsed = parseModelJsonDetailed('{"text":"[}"}');
  assert.deepEqual(parsed, { payload: { text: '[}' } });
});

test('other syntax errors stay ordinary JSON failures with no attempted edits', () => {
  for (const raw of ['{"text":"unterminated}', '{"a":1 "b":2}', '{"a":1} trailing']) {
    assert.throws(() => parseModelJsonDetailed(raw), (error) => {
      assert.equal(error.failure.ruleId, 'TRANSPORT_JSON_OBJECT');
      assert.equal(error.details.jsonDiagnostic.kind, 'json-syntax');
      assert.equal('payloadRepairDiagnostics' in error.details, false);
      return true;
    });
  }
});

test('a stray closer inside a tree fails with the raw output instead of splitting the tree', async (t) => {
  const fixture = JSON.parse(await readFile(new URL('what-did-mia-see.xbar.json', fixturesDirectory), 'utf8'));
  const text = JSON.stringify(restateAsSpellout(fixture.payload, fixture.sentence));
  // Rebalancing this stray "]" used to close cp_question early: two roots, no tree.
  const at = text.indexOf('"children":[]', text.lastIndexOf('"id":"what_high"')) + '"children":[]'.length;
  const damaged = `${text.slice(0, at)}]${text.slice(at)}`;
  await assert.rejects(
    parseRawOutput(t, damaged, fixture.sentence, fixture.framework),
    (error) => assertUnbalanced(error, damaged, {
      candidateByteOffset: Buffer.byteLength(text.slice(0, at)),
      message: /does not match/
    })
  );
});

test('the parse route fails a response with an unclosed end', async (t) => {
  const fixture = JSON.parse(await readFile(new URL('mia-laughed.xbar.json', fixturesDirectory), 'utf8'));
  const raw = JSON.stringify(restateAsSpellout(fixture.payload, fixture.sentence)).slice(0, -1);
  await assert.rejects(
    parseRawOutput(t, raw, fixture.sentence, fixture.framework),
    (error) => assertUnbalanced(error, raw, { candidateByteOffset: Buffer.byteLength(raw), message: /1 bracket still open/ })
  );
});

test('saved records keep the repair evidence they were made with', async () => {
  const fixture = JSON.parse(await readFile(new URL('mia-laughed.xbar.json', fixturesDirectory), 'utf8'));
  const bundle = normalizeParseBundle(fixture.payload, fixture.framework, fixture.sentence, fixture.modelRoute, true);
  const savedRepair = [{ kind: 'append_closers_at_end_of_output', candidateByteOffset: 9,
    removedText: '', insertedText: '}', removedBytesHex: '', insertedBytesHex: '7d' }];
  const saved = { ...bundle, analyses: bundle.analyses.map((analysis) => ({ ...analysis, provenance: {
    ...analysis.provenance,
    payloadIntegrityFlags: ['json_delimiter_damage_repaired'],
    payloadRepairDiagnostics: savedRepair
  } })) };
  const provenance = createTreeBankBundleSnapshot(saved).analyses[0].provenance;
  assert.deepEqual(provenance.payloadRepairDiagnostics, savedRepair);
  assert.deepEqual(provenance.payloadIntegrityFlags, ['json_delimiter_damage_repaired']);
});

test('committed raw fixtures parse with no repair', async () => {
  const fixtureNames = (await readdir(fixturesDirectory))
    .filter((name) => name.endsWith('.json'))
    .sort();
  assert.ok(fixtureNames.length > 0);

  for (const fixtureName of fixtureNames) {
    const rawFixture = await readFile(new URL(fixtureName, fixturesDirectory), 'utf8');
    assert.deepEqual(Object.keys(parseModelJsonDetailed(rawFixture)), ['payload'], fixtureName);
  }
});

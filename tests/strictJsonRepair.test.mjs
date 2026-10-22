import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { parseModelJsonDetailed } from '../server/babelParser/modelJson.js';
import { ParseApiError } from '../server/babelParser/error.js';
import { createParseRoutes } from '../server/babelParser/parseRoutes.js';
import { createTreeBankBundleSnapshot } from '../treeBankSnapshot.js';
import { restateAsSpellout } from './helpers/spelloutPayload.mjs';

const fixturesDirectory = new URL('../fixtures/raw/', import.meta.url);

const expectedDiagnostic = ({
  kind,
  candidateByteOffset,
  removedText = '',
  insertedText = ''
}) => ({
  kind,
  candidateByteOffset,
  removedText,
  insertedText,
  removedBytesHex: Buffer.from(removedText, 'utf8').toString('hex'),
  insertedBytesHex: Buffer.from(insertedText, 'utf8').toString('hex')
});

const createLocalRoutes = (rawText) => createParseRoutes({
  ParseApiError,
  normalizeParseBundle: normalizeParseBundle,
  parseModelJsonDetailed: parseModelJsonDetailed,
  generateLocal: async () => rawText
});

const assertDelimiterRefusal = (raw, expectedEdits) => assert.throws(
  () => parseModelJsonDetailed(raw),
  (error) => {
    assert.equal(error instanceof ParseApiError, true);
    assert.equal(error.code, 'BAD_MODEL_RESPONSE');
    assert.equal(error.failure.class, 'transport_serialization');
    assert.equal(error.failure.ruleId, 'TRANSPORT_JSON_DELIMITERS_BALANCED');
    assert.equal(error.failure.processingStep, 'json-decoding');
    assert.equal(error.details.jsonDiagnostic.kind, 'json-delimiter-damage');
    assert.equal(error.details.jsonDiagnostic.originalSyntaxError.kind, 'json-syntax');
    assert.equal(error.failure.message, error.details.jsonDiagnostic.message);
    assert.deepEqual(error.details.payloadRepairDiagnostics, expectedEdits.map(expectedDiagnostic));
    assert.equal(Buffer.from(error.rawOutput.data, 'base64').toString('utf8'), raw);
    return true;
  }
);

test('refuses to close brackets left open at the end and keeps the declined edit', () => {
  const candidate = '{"a":[1,2';
  assertDelimiterRefusal(candidate, [{
    kind: 'append_closers_at_end_of_output',
    candidateByteOffset: Buffer.byteLength(candidate, 'utf8'),
    insertedText: ']}'
  }]);
});

test('original JSON error offsets account for BOM, whitespace and multibyte text', () => {
  const candidate = '{"é":[1,2}';
  const raw = `\uFEFF\n  ${candidate}\n`;
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

test('a stray closing tail is the only repair, and it preserves strings, escapes and literal delimiters', () => {
  const payload = { derivationStages: [{ relations: [{ relation: 'Open',
    anchors: { 'unfamiliar role': ['n]é', 'quoted"id'] },
    priorAnchors: { old: 'n]é' }, values: { notation: '[}]\\' } }],
    workspaceForest: [{ id: 'n]é', label: 'N', children: [] }, { refId: 'quoted"id' }] }] };
  const json = JSON.stringify(payload);
  for (const tail of ['}', ']', ' }\n]}']) {
    const parsed = parseModelJsonDetailed(`${json}${tail}`);
    assert.deepEqual(parsed.payload, payload);
    assert.deepEqual(parsed.integrityFlags, ['json_delimiter_damage_repaired']);
    assert.deepEqual(parsed.repairDiagnostics, [expectedDiagnostic({
      kind: 'remove_unmatched_closer',
      candidateByteOffset: Buffer.byteLength(json, 'utf8') + tail.indexOf(tail.trim()[0]),
      removedText: tail.trim()
    })]);
  }
  for (const candidate of [json.slice(0, -2), json.slice(0, -2) + '}']) {
    assert.throws(() => parseModelJsonDetailed(candidate),
      (error) => error.failure.ruleId === 'TRANSPORT_JSON_DELIMITERS_BALANCED');
  }
});

test('refuses a mismatched closer instead of inserting closers before it', () => {
  const candidate = '{"é":[1,2}';
  assertDelimiterRefusal(candidate, [{
    kind: 'insert_closers_before_mismatched_closer',
    candidateByteOffset: Buffer.byteLength(candidate.slice(0, -1), 'utf8'),
    insertedText: ']'
  }]);
});

test('refuses a stray closer inside the value instead of removing it', () => {
  const candidate = '{"a":[1,2]]}';
  assertDelimiterRefusal(candidate, [{
    kind: 'remove_unmatched_closer',
    candidateByteOffset: Buffer.byteLength('{"a":[1,2]', 'utf8'),
    removedText: ']'
  }]);
});

// A missing closer leaves everything after it inside the wrong element, and the text
// still parses once the end is closed. Reduced from a saved GPT-6.1 Sol output
// (night4-20261019 40-en-long-question) whose analyses each lacked their final "]}".
test('refuses closers missing inside the value even when closing the end would parse', () => {
  const stage = { statement: 'S', stageRecord: 'R', relations: [], workspaceForest: [{ id: 'n', label: 'N', children: [] }] };
  const analysis = JSON.stringify({ derivationStages: [stage] });
  const candidate = `{"analyses":[${analysis.slice(0, -2)},${analysis}]}`;
  assert.equal(JSON.parse(`${candidate}]}`).analyses.length, 1);
  assertDelimiterRefusal(candidate, [{
    kind: 'append_closers_at_end_of_output',
    candidateByteOffset: Buffer.byteLength(candidate, 'utf8'),
    insertedText: ']}'
  }]);
});

test('removes a stray closer after the complete value with its exact byte edit', () => {
  const candidate = '{"a":1}}';
  const parsed = parseModelJsonDetailed(candidate);

  assert.deepEqual(parsed.payload, { a: 1 });
  assert.deepEqual(parsed.integrityFlags, ['json_delimiter_damage_repaired']);
  assert.deepEqual(parsed.repairDiagnostics, [expectedDiagnostic({
    kind: 'remove_unmatched_closer',
    candidateByteOffset: Buffer.byteLength(candidate.slice(0, -1), 'utf8'),
    removedText: '}'
  })]);
});

test('removes a long stray closing tail as one edit', () => {
  const candidate = '{"derivationStages":[]' + '}'.repeat(10_000);
  const parsed = parseModelJsonDetailed(candidate);
  assert.deepEqual(parsed.payload, { derivationStages: [] });
  assert.equal(parsed.repairDiagnostics.length, 1);
  assert.equal(parsed.repairDiagnostics[0].removedText, '}'.repeat(9_999));
});

test('does not remove a stray closer that more text follows', () => {
  assert.throws(() => parseModelJsonDetailed('{"a":1}},"b":2}'), (error) => {
    assert.equal(error.failure.ruleId, 'TRANSPORT_JSON_OBJECT');
    assert.equal(error.details.jsonDiagnostic.kind, 'json-syntax');
    return true;
  });
});

test('does not treat delimiters inside strings as damage', () => {
  const parsed = parseModelJsonDetailed('{"text":"[}"}');

  assert.deepEqual(parsed.payload, { text: '[}' });
  assert.deepEqual(parsed.integrityFlags, []);
  assert.deepEqual(parsed.repairDiagnostics, []);
});

test('retains attempted edits when delimiter repair cannot produce valid JSON', () => {
  assert.throws(
    () => parseModelJsonDetailed('{"text":"unterminated}'),
    (error) => {
      assert.equal(error instanceof ParseApiError, true);
      assert.equal(error.code, 'BAD_MODEL_RESPONSE');
      assert.equal(error.failure.processingStep, 'json-decoding');
      assert.equal(error.details.jsonDiagnostic.kind, 'json-syntax');
      assert.match(error.details.jsonDiagnostic.message, /Unterminated string/);
      assert.deepEqual(error.details.payloadRepairDiagnostics, [expectedDiagnostic({
        kind: 'append_closers_at_end_of_output',
        candidateByteOffset: Buffer.byteLength('{"text":"unterminated}', 'utf8'),
        insertedText: '}'
      })]);
      return true;
    }
  );
});

test('retains successful delimiter edits when the repaired root is not an object', () => {
  assert.throws(
    () => parseModelJsonDetailed('[1,2]]'),
    (error) => {
      assert.equal(error instanceof ParseApiError, true);
      assert.equal(error.details.jsonDiagnostic.kind, 'json-root-type');
      assert.match(error.details.jsonDiagnostic.message, /received an array/);
      assert.equal(error.details.jsonDiagnostic.originalSyntaxError.kind, 'json-syntax');
      assert.deepEqual(error.details.payloadRepairDiagnostics, [expectedDiagnostic({
        kind: 'remove_unmatched_closer',
        candidateByteOffset: Buffer.byteLength('[1,2]', 'utf8'),
        removedText: ']'
      })]);
      return true;
    }
  );
});

test('successful repair diagnostics persist through normalization and Tree Bank snapshots', async () => {
  const fixture = JSON.parse(await readFile(new URL('mia-laughed.xbar.json', fixturesDirectory), 'utf8'));
  const completePayload = JSON.stringify(fixture.payload);
  const repaired = parseModelJsonDetailed(`${completePayload}}`);
  const bundle = normalizeParseBundle(
    repaired.payload,
    fixture.framework,
    fixture.sentence,
    fixture.modelRoute,
    true,
    {
      payloadIntegrityFlags: repaired.integrityFlags,
      payloadRepairDiagnostics: repaired.repairDiagnostics
    }
  );

  const provenance = bundle.analyses[0].provenance;
  assert.deepEqual(provenance.payloadRepairDiagnostics, repaired.repairDiagnostics);
  assert.deepEqual(
    createTreeBankBundleSnapshot(bundle).analyses[0].provenance.payloadRepairDiagnostics,
    repaired.repairDiagnostics
  );
});

test('the local route returns successful repair diagnostics in parse provenance', async () => {
  const fixture = JSON.parse(await readFile(new URL('mia-laughed.xbar.json', fixturesDirectory), 'utf8'));
  const candidate = `${JSON.stringify(restateAsSpellout(fixture.payload, fixture.sentence))}}`;
  const bundle = await createLocalRoutes(candidate).parseSentenceWithLocalModel(
    fixture.sentence,
    fixture.framework
  );

  assert.equal(bundle.analyses[0].provenance.payloadRepairDiagnostics[0].kind,
    'remove_unmatched_closer');
});

test('the local route retains repair diagnostics when normalization rejects the payload', async () => {
  const candidate = '{"derivationStages":[]}}';
  await assert.rejects(
    createLocalRoutes(candidate).parseSentenceWithLocalModel('Mia', 'xbar'),
    (error) => {
      assert.equal(error instanceof ParseApiError, true);
      assert.equal(error.details.payloadRepairDiagnostics[0].kind,
        'remove_unmatched_closer');
      return true;
    }
  );
});

test('a stray closer inside a tree fails with the raw output instead of splitting the tree', async () => {
  const fixture = JSON.parse(await readFile(new URL('what-did-mia-see.xbar.json', fixturesDirectory), 'utf8'));
  const text = JSON.stringify(restateAsSpellout(fixture.payload, fixture.sentence));
  // Rebalancing this stray "]" used to close cp_question early: two roots, no tree.
  const at = text.indexOf('"children":[]', text.lastIndexOf('"id":"what_high"')) + '"children":[]'.length;
  const damaged = `${text.slice(0, at)}]${text.slice(at)}`;
  await assert.rejects(
    createLocalRoutes(damaged).parseSentenceWithLocalModel(fixture.sentence, fixture.framework),
    (error) => {
      assert.equal(error instanceof ParseApiError, true);
      assert.equal(error.failure.ruleId, 'TRANSPORT_JSON_DELIMITERS_BALANCED');
      assert.equal(error.details.jsonDiagnostic.candidateByteOffset, Buffer.byteLength(text.slice(0, at)));
      assert.equal(error.details.payloadRepairDiagnostics[0].kind, 'insert_closers_before_mismatched_closer');
      assert.equal(Buffer.from(error.rawOutput.data, 'base64').toString('utf8'), damaged);
      return true;
    }
  );
});

test('committed raw fixtures activate no delimiter repair', async () => {
  const fixtureNames = (await readdir(fixturesDirectory))
    .filter((name) => name.endsWith('.json'))
    .sort();
  assert.ok(fixtureNames.length > 0);

  for (const fixtureName of fixtureNames) {
    const rawFixture = await readFile(new URL(fixtureName, fixturesDirectory), 'utf8');
    const parsed = parseModelJsonDetailed(rawFixture);
    assert.deepEqual(parsed.repairDiagnostics, [], fixtureName);
    assert.equal(parsed.integrityFlags.includes('json_delimiter_damage_repaired'), false, fixtureName);
  }
});

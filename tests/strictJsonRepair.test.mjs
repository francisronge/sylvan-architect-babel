import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { __test__, ParseApiError } from '../server/babelParser.js';
import { createParseRoutes } from '../server/babelParser/parseRoutes.js';
import { createTreeBankBundleSnapshot } from '../treeBankSnapshot.js';

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
  normalizeParseBundle: __test__.normalizeParseBundle,
  parseModelJson: __test__.parseModelJson,
  parseModelJsonDetailed: __test__.parseModelJsonDetailed,
  generateLocal: async () => rawText
});

test('reports appended EOF closers with their exact byte edit', () => {
  const candidate = '{"a":[1,2';
  const parsed = __test__.parseModelJsonDetailed(candidate);

  assert.deepEqual(parsed.payload, { a: [1, 2] });
  assert.equal(parsed.jsonDiagnostic.kind, 'json-syntax');
  assert.equal(parsed.jsonDiagnostic.originalByteOffset, Buffer.byteLength(candidate));
  assert.deepEqual(parsed.integrityFlags, ['json_delimiter_damage_repaired']);
  assert.deepEqual(parsed.repairDiagnostics, [expectedDiagnostic({
    kind: 'append_closers_at_end_of_output',
    candidateByteOffset: Buffer.byteLength(candidate, 'utf8'),
    insertedText: ']}'
  })]);
});

test('original JSON error offsets account for BOM, whitespace and multibyte text', () => {
  const candidate = '{"é":[1,2}';
  const raw = `\uFEFF\n  ${candidate}\n`;
  const parsed = __test__.parseModelJsonDetailed(raw);
  assert.equal(parsed.jsonDiagnostic.candidateByteOffset, Buffer.byteLength(candidate.slice(0, -1)));
  assert.equal(parsed.jsonDiagnostic.originalByteOffset, Buffer.byteLength(raw.slice(0, raw.indexOf('}'))));
  assert.match(parsed.jsonDiagnostic.message, /JSON/);
});

test('delimiter repairs preserve node-reference strings, escapes and literal delimiters', () => {
  const payload = { derivationStages: [{ relations: [{ relation: 'Open',
    anchors: { 'unfamiliar role': ['n]é', 'quoted"id'] },
    priorAnchors: { old: 'n]é' }, values: { notation: '[}]\\' } }],
    workspaceForest: [{ id: 'n]é', label: 'N', children: [] }, { refId: 'quoted"id' }] }] };
  const json = JSON.stringify(payload);
  for (const candidate of [json.slice(0, -2), `${json}}`, json.slice(0, -2) + '}']) {
    const parsed = __test__.parseModelJsonDetailed(candidate);
    assert.deepEqual(parsed.payload, payload);
    assert.ok(parsed.repairDiagnostics.length > 0);
  }
});

test('reports closers inserted before a mismatched closer at a UTF-8 byte offset', () => {
  const candidate = '{"é":[1,2}';
  const parsed = __test__.parseModelJsonDetailed(candidate);

  assert.deepEqual(parsed.payload, { é: [1, 2] });
  assert.deepEqual(parsed.repairDiagnostics, [expectedDiagnostic({
    kind: 'insert_closers_before_mismatched_closer',
    candidateByteOffset: Buffer.byteLength(candidate.slice(0, -1), 'utf8'),
    insertedText: ']'
  })]);
});

test('reports an unmatched closer removal with its exact byte edit', () => {
  const candidate = '{"a":1}}';
  const parsed = __test__.parseModelJsonDetailed(candidate);

  assert.deepEqual(parsed.payload, { a: 1 });
  assert.deepEqual(parsed.repairDiagnostics, [expectedDiagnostic({
    kind: 'remove_unmatched_closer',
    candidateByteOffset: Buffer.byteLength(candidate.slice(0, -1), 'utf8'),
    removedText: '}'
  })]);
});

test('does not treat delimiters inside strings as damage', () => {
  const parsed = __test__.parseModelJsonDetailed('{"text":"[}"}');

  assert.deepEqual(parsed.payload, { text: '[}' });
  assert.deepEqual(parsed.integrityFlags, []);
  assert.deepEqual(parsed.repairDiagnostics, []);
});

test('retains attempted edits when delimiter repair cannot produce valid JSON', () => {
  assert.throws(
    () => __test__.parseModelJsonDetailed('{"text":"unterminated}'),
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
    () => __test__.parseModelJsonDetailed('[1,2'),
    (error) => {
      assert.equal(error instanceof ParseApiError, true);
      assert.equal(error.details.jsonDiagnostic.kind, 'json-root-type');
      assert.match(error.details.jsonDiagnostic.message, /received an array/);
      assert.equal(error.details.jsonDiagnostic.originalSyntaxError.kind, 'json-syntax');
      assert.deepEqual(error.details.payloadRepairDiagnostics, [expectedDiagnostic({
        kind: 'append_closers_at_end_of_output',
        candidateByteOffset: Buffer.byteLength('[1,2', 'utf8'),
        insertedText: ']'
      })]);
      return true;
    }
  );
});

test('successful repair diagnostics persist through normalization and Tree Bank snapshots', async () => {
  const fixture = JSON.parse(await readFile(new URL('mia-laughed.xbar.json', fixturesDirectory), 'utf8'));
  const completePayload = JSON.stringify(fixture.payload);
  const repaired = __test__.parseModelJsonDetailed(completePayload.slice(0, -1));
  const bundle = __test__.normalizeParseBundle(
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
  const candidate = JSON.stringify(fixture.payload).slice(0, -1);
  const bundle = await createLocalRoutes(candidate).parseSentenceWithLocalModel(
    fixture.sentence,
    fixture.framework
  );

  assert.equal(bundle.analyses[0].provenance.payloadRepairDiagnostics[0].kind,
    'append_closers_at_end_of_output');
});

test('the local route retains repair diagnostics when normalization rejects the payload', async () => {
  const candidate = '{"derivationStages":[]';
  await assert.rejects(
    createLocalRoutes(candidate).parseSentenceWithLocalModel('Mia', 'xbar'),
    (error) => {
      assert.equal(error instanceof ParseApiError, true);
      assert.equal(error.details.payloadRepairDiagnostics[0].kind,
        'append_closers_at_end_of_output');
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
    const parsed = __test__.parseModelJsonDetailed(rawFixture);
    assert.deepEqual(parsed.repairDiagnostics, [], fixtureName);
    assert.equal(parsed.integrityFlags.includes('json_delimiter_damage_repaired'), false, fixtureName);
  }
});

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeSpelloutAttempts } from '../contractQualification/spelloutArtifacts.js';
import { resolveResearchModelSelection } from '../server/babelParser/researchModelCatalog.js';

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

test('reports appended EOF closers with their exact byte edit', () => {
  const candidate = '{"a":[1,2';
  const parsed = parseModelJsonDetailed(candidate);

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
  const parsed = parseModelJsonDetailed(raw);
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
    const parsed = parseModelJsonDetailed(candidate);
    assert.deepEqual(parsed.payload, payload);
    assert.ok(parsed.repairDiagnostics.length > 0);
  }
});

test('reports closers inserted before a mismatched closer at a UTF-8 byte offset', () => {
  const candidate = '{"é":[1,2}';
  const parsed = parseModelJsonDetailed(candidate);

  assert.deepEqual(parsed.payload, { é: [1, 2] });
  assert.deepEqual(parsed.repairDiagnostics, [expectedDiagnostic({
    kind: 'insert_closers_before_mismatched_closer',
    candidateByteOffset: Buffer.byteLength(candidate.slice(0, -1), 'utf8'),
    insertedText: ']'
  })]);
});

test('reports an unmatched closer removal with its exact byte edit', () => {
  const candidate = '{"a":1}}';
  const parsed = parseModelJsonDetailed(candidate);

  assert.deepEqual(parsed.payload, { a: 1 });
  assert.deepEqual(parsed.repairDiagnostics, [expectedDiagnostic({
    kind: 'remove_unmatched_closer',
    candidateByteOffset: Buffer.byteLength(candidate.slice(0, -1), 'utf8'),
    removedText: '}'
  })]);
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
    () => parseModelJsonDetailed('[1,2'),
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
  const repaired = parseModelJsonDetailed(completePayload.slice(0, -1));
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
  const candidate = JSON.stringify(restateAsSpellout(fixture.payload, fixture.sentence)).slice(0, -1);
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

test('committed raw fixtures activate no JSON repair', async () => {
  const fixtureNames = (await readdir(fixturesDirectory))
    .filter((name) => name.endsWith('.json'))
    .sort();
  assert.ok(fixtureNames.length > 0);

  for (const fixtureName of fixtureNames) {
    const rawFixture = await readFile(new URL(fixtureName, fixturesDirectory), 'utf8');
    for (const layout of [rawFixture, JSON.stringify(JSON.parse(rawFixture), null, 2)]) {
      const parsed = parseModelJsonDetailed(layout);
      assert.deepEqual(parsed.repairDiagnostics, [], fixtureName);
      assert.deepEqual(parsed.integrityFlags, [], fixtureName);
      assert.equal(parsed.jsonDiagnostic, undefined, fixtureName);
    }
  }
});

// One stage's one-line tree closes its forest and stage, which the next lines
// close again, so the root ends before the second stage.
const overclosedStages = [
  '{',
  '  "derivationStages": [',
  '    {',
  '      "statement": "Bäume.",',
  '      "workspaceForest": [',
  '        {"id":"a","label":"A","children":[{"id":"b","label":"B","children":[]}]}]}',
  '      ]',
  '    },',
  '    {',
  '      "statement": "two",',
  '      "workspaceForest": [',
  '        {"id":"c","label":"C","children":[]}',
  '      ]',
  '    }',
  '  ]',
  '}'
];
const overclosedPayload = { derivationStages: [
  { statement: 'Bäume.', workspaceForest: [{ id: 'a', label: 'A', children: [{ id: 'b', label: 'B', children: [] }] }] },
  { statement: 'two', workspaceForest: [{ id: 'c', label: 'C', children: [] }] }
] };
const overclosedValue = '{"id":"a","label":"A","children":[{"id":"b","label":"B","children":[]}]}';
const excessCloserOffset = (text) => Buffer.byteLength(text.slice(0, text.indexOf(overclosedValue) + overclosedValue.length), 'utf8');

test('removes the closers an over-closed line adds after its complete value', () => {
  const candidate = overclosedStages.join('\n');
  assert.throws(() => JSON.parse(candidate));
  const parsed = parseModelJsonDetailed(candidate);

  assert.deepEqual(parsed.payload, overclosedPayload);
  assert.deepEqual(parsed.integrityFlags, ['json_overclosed_lines_repaired']);
  assert.equal(parsed.jsonDiagnostic.kind, 'json-syntax');
  assert.deepEqual(parsed.repairDiagnostics, [expectedDiagnostic({
    kind: 'remove_excess_closers_at_line_end',
    candidateByteOffset: excessCloserOffset(candidate),
    removedText: ']}'
  })]);
});

test('over-closed line repair keeps CRLF line ends and a trailing comma', () => {
  const lines = overclosedStages.slice();
  lines[5] = '        {"id":"a","label":"A","children":[{"id":"b","label":"B","children":[]}]}]},';
  lines.splice(6, 0, '        {"id":"z","label":"Z","children":[]}');
  const candidate = lines.join('\r\n');
  const parsed = parseModelJsonDetailed(candidate);

  assert.deepEqual(parsed.payload.derivationStages[0].workspaceForest.map((root) => root.id), ['a', 'z']);
  assert.deepEqual(parsed.repairDiagnostics, [expectedDiagnostic({
    kind: 'remove_excess_closers_at_line_end',
    candidateByteOffset: excessCloserOffset(candidate),
    removedText: ']}'
  })]);
});

test('valid JSON whose lines close containers they did not open is never rewritten', () => {
  const candidate = ['{', '  "a": [', '    {"b":"]}"}]}'].join('\n');
  const parsed = parseModelJsonDetailed(candidate);

  assert.deepEqual(parsed.payload, { a: [{ b: ']}' }] });
  assert.deepEqual(parsed.integrityFlags, []);
  assert.deepEqual(parsed.repairDiagnostics, []);
  assert.equal(parsed.jsonDiagnostic, undefined);
});

test('over-closed line repair is kept only when the whole response then parses', () => {
  const unrepairable = overclosedStages.slice();
  unrepairable[9] = '      "statement": "two"';
  const candidate = unrepairable.join('\n');
  assert.throws(
    () => parseModelJsonDetailed(candidate),
    (error) => {
      assert.equal(error instanceof ParseApiError, true);
      assert.equal(error.code, 'BAD_MODEL_RESPONSE');
      assert.equal(error.failure.processingStep, 'json-decoding');
      assert.match(error.details.jsonDiagnostic.message, /after JSON/);
      const kinds = error.details.payloadRepairDiagnostics.map((diagnostic) => diagnostic.kind);
      assert.ok(kinds.includes('remove_unmatched_closer'));
      assert.deepEqual(error.details.payloadRepairDiagnostics.at(-1), expectedDiagnostic({
        kind: 'remove_excess_closers_at_line_end',
        candidateByteOffset: excessCloserOffset(candidate),
        removedText: ']}'
      }));
      return true;
    }
  );
});

test('over-closed line repair needs the line layout and one complete value before the closers', () => {
  // One line has no layout that shows which closers are extra.
  const oneLine = '{"derivationStages":[{"workspaceForest":[{"id":"a"}]}]},{"workspaceForest":[]}]}';
  const withLine = (line) => Object.assign(overclosedStages.slice(), { 5: line }).join('\n');
  const candidates = [oneLine,
    // Two values share the line before its closers.
    withLine('        {"id":"a","label":"A","children":[]},{"id":"b","label":"B","children":[]}]}'),
    // The line's value is closed by the wrong delimiter.
    withLine('        {"id":"a","label":"A","children":[}]}]}')];
  for (const candidate of candidates) {
    assert.throws(
      () => parseModelJsonDetailed(candidate),
      (error) => {
        assert.equal(error.code, 'BAD_MODEL_RESPONSE');
        assert.equal((error.details.payloadRepairDiagnostics ?? [])
          .some((diagnostic) => diagnostic.kind === 'remove_excess_closers_at_line_end'), false);
        return true;
      }
    );
  }
});

const overclosedOutput = {
  // GPT-6.1 Sol at high effort, Codex qualification night4-20261019, unaltered.
  file: new URL('de-verb-cluster-overclosed-lines.output.txt', fixturesDirectory),
  sentence: 'Ich glaube, dass der Arzt den Patienten nicht hätte operieren lassen dürfen.',
  framework: 'xbar'
};

test('a provider response with over-closed tree lines yields every analysis with its repairs in provenance', async () => {
  const rawText = await readFile(overclosedOutput.file, 'utf8');
  const bundle = await createLocalRoutes(rawText).parseSentenceWithLocalModel(overclosedOutput.sentence, overclosedOutput.framework);

  assert.equal(bundle.analyses.length, 6);
  const raw = Buffer.from(rawText, 'utf8');
  for (const analysis of bundle.analyses) {
    assert.ok(analysis.provenance.payloadIntegrityFlags.includes('json_overclosed_lines_repaired'));
    const repairs = analysis.provenance.payloadRepairDiagnostics;
    assert.equal(repairs.length, 12);
    for (const repair of repairs) {
      assert.equal(repair.kind, 'remove_excess_closers_at_line_end');
      // The response has no BOM or leading space, so candidate offsets are raw offsets.
      assert.equal(raw.subarray(repair.candidateByteOffset, repair.candidateByteOffset + 3).toString('utf8'), ']}\n');
    }
    assert.deepEqual(createTreeBankBundleSnapshot({ ...bundle, analyses: [analysis] })
      .analyses[0].provenance.payloadRepairDiagnostics, repairs);
  }
});

test('qualification spell-out keeps the over-closed line repairs and every analysis', async () => {
  const text = await readFile(overclosedOutput.file, 'utf8');
  const outputPath = mkdtempSync(path.join(tmpdir(), 'babel-overclosed-'));
  try {
    const written = writeSpelloutAttempts({ outputPath, sentence: overclosedOutput.sentence, framework: overclosedOutput.framework,
      model: resolveResearchModelSelection('openai:gpt-6.1-sol', {}), text });
    assert.deepEqual(written.map((item) => [item.reviewEntry.attemptId, item.receipt.outcome.status]), [['parse', 'valid-pending-review']]);
    assert.equal(written[0].receipt.artifacts.analysisCount, 6);
    const { ingress } = JSON.parse(readFileSync(path.join(outputPath, 'spellout.json'), 'utf8'));
    assert.equal(ingress.status, 'parsed');
    assert.deepEqual(ingress.integrityFlags, ['json_overclosed_lines_repaired']);
    assert.equal(ingress.repairDiagnostics.length, 12);
  } finally {
    rmSync(outputPath, { recursive: true, force: true });
  }
});

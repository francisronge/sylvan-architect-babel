import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import {
  changeReviewSelection, initialReviewSelection, reviewAnalyses, reviewStatus, reviewViews
} from '../contractQualification/reviewModel.js';
import { buildQualificationReviewHtml } from '../contractQualification/reviewPage.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const compiled = await build({
  absWorkingDir: repoRoot, entryPoints: ['contractQualification/reviewComponents.tsx'],
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'local-test-dependencies', setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, ({ path: specifier }) => ({
      path: pathToFileURL(require.resolve(specifier)).href, external: true
    }));
  } }]
});
const { QualificationReview, ReviewTree, ReviewEvidence } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
);
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const node = (id, word) => ({ id, label: 'N', word, children: [] });
const stage = (workspaceForest) => ({ statement: 'External Merge', stageRecord: 'Authored x_i.', relations: [], workspaceForest });
const attempt = () => {
  const mia = node('mia', 'Mia');
  const runs = node('runs', 'runs');
  const tree = { id: 's', label: 'S', children: [mia, runs] };
  return {
    attemptId: 'archived-only', sentence: 'Mia runs', framework: 'xbar', model: { label: 'Archived model' },
    outcome: { status: 'valid-pending-review', reviewDisposition: 'unreviewed' },
    receipt: { ingress: { repairDiagnostics: [] }, rawOutput: { sha256: 'saved' } },
    rawOutput: { encoding: 'utf8', text: 'original response', sha256: 'saved' },
    normalizedRecord: { response: { sentence: 'Mia runs', analyses: [{
      tree, derivationStages: [stage([mia]), stage([mia, runs]), stage([tree])],
      unknownAnalysisField: { retained: true }
    }] } },
    analyses: [{ analysisIndex: 0, replay: { stepCount: 999, archivedOnly: true }, evidence: {
      replay: { frames: [] }, renderer: { tierCounts: { tier1: 0, tier2: 0, tier3: 0 }, diagnostics: [], unregistered: [] }
    } }],
    inspection: { kind: 'authored-workspace-inspection', replayStatus: 'not-compiled',
      repairDiagnostics: [], payload: { untouched: '</script><script>untrusted()</script>' },
      analyses: [{ analysisIndex: 0, stages: [
        { stageIndex: 0, authoredStage: stage([mia]), workspaceForest: [mia] }
      ] }]
    }
  };
};

test('the live view prepares production Replay asynchronously without displaying archived frames or PNGs', () => {
  const record = attempt();
  const before = structuredClone(record);
  const html = render(QualificationReview, { data: { attempts: [record] } });
  assert.match(html, /role="status"/);
  assert.match(html, /Preparing Replay/);
  assert.doesNotMatch(html, /Replay 1\/999|replay-\d+\.png|capture has not|data-babel-replay-panel/);
  assert.match(html, /Live Replay \/ archived normalized derivative/);
  assert.match(html, /Linguistic: unreviewed; visual: unreviewed/);
  assert.match(html, />Normalized<\/span>/);
  assert.deepEqual(record, before);
});

test('failed originals retain all analyses and later inspection stages without inventing Replay', () => {
  const record = attempt();
  record.outcome = { status: 'failed', phase: 'normalization', failure: { ruleId: 'DERIVATION_UNKNOWN_REF_ID' } };
  record.analyses = [];
  record.normalizedRecord = null;
  record.inspection.analyses = [{ analysisIndex: 2, stages: [
    { stageIndex: 0, workspaceForest: null, diagnostic: { fieldPath: '$.analyses[2].derivationStages[0]', unknown: ['raw'] } },
    { stageIndex: 1, workspaceForest: null, blockedByStageIndex: 0 },
    { stageIndex: 2, workspaceForest: [node('later', 'New')], authoredStage: { statement: 'New self-contained state' } }
  ] }];
  const choices = reviewAnalyses(record);
  assert.deepEqual(choices.map((entry) => entry.analysisIndex), [2]);
  assert.equal(choices[0].canReplay, false);
  assert.equal(initialReviewSelection([record]).view, 'Stage inspection');
  const page = render(QualificationReview, { data: { attempts: [record] } });
  assert.match(page, /Inspection copy \/ stage only \/ Replay not compiled/);
  assert.match(page, /Analysis 3/);
  assert.match(page, /Stage 3 \/ 3/);
  assert.match(page, />Failed<\/span>/);
  assert.doesNotMatch(page, /data-babel-replay-panel/);
  const props = { choice: choices[0], mode: 'inspection' };
  assert.match(render(ReviewTree, { ...props, stage: choices[0].inspection.stages[1] }), /Expansion blocked by stage 1/);
  const later = render(ReviewTree, { ...props, stage: choices[0].inspection.stages[2] });
  assert.match(later, /Preparing tree/);
  assert.doesNotMatch(later, /data-babel-replay-panel/);
  assert.match(render(ReviewTree, { choice: choices[0], mode: 'replay' }), /No complete Replay/);
});

test('review navigation resets attempt and stage selection without editing evidence or certification', () => {
  const first = attempt();
  const failure = { ...attempt(), outcome: { status: 'failed' }, analyses: [], normalizedRecord: null };
  const records = [first, failure];
  const original = structuredClone(records);
  let selected = { attempt: 0, analysis: 1, stage: 8, view: 'Receipt' };
  selected = changeReviewSelection(selected, { type: 'attempt', index: 1 }, records);
  assert.deepEqual(selected, { attempt: 1, analysis: 0, stage: 0, view: 'Stage inspection', source: 'original' });
  selected = changeReviewSelection(selected, { type: 'stage', index: 2 }, records);
  assert.equal(selected.stage, 2);
  selected = changeReviewSelection(selected, { type: 'analysis', index: 1 }, records);
  assert.equal(selected.stage, 0);
  selected = changeReviewSelection(selected, { type: 'view', view: 'Raw response' }, records);
  assert.equal(selected.view, 'Raw response');
  assert.deepEqual(records, original);
  assert.equal(reviewStatus(first).label, 'Normalized');
  first.receipt.ingress.repairDiagnostics = [{ kind: 'append_closers_at_end_of_output' }];
  assert.equal(reviewStatus(first).label, 'Normalized after repair');
  assert.equal(reviewStatus(failure).label, 'Failed');
});

test('all evidence views retain original bytes, unknown fields, archived frames and nonfatal diagnostics', () => {
  const record = attempt();
  record.rawOutput.text = '</script><script>untrusted()</script>\u0000';
  record.analyses[0].evidence.renderer.diagnostics = [{ code: 'unrendered-context', raw: ['x_i', '', 'x_i'] }];
  const original = structuredClone(record);
  const choice = reviewAnalyses(record)[0];
  assert.equal(choice.canReplay, true);
  const markup = Object.fromEntries(reviewViews.filter((view) => !['Replay', 'Stage inspection'].includes(view))
    .map((view) => [view, render(ReviewEvidence, { attempt: record, choice, view, runtime: { kind: 'production-tree-visualizer' } })]));
  assert.match(markup['Raw response'], /Original saved response bytes/);
  assert.match(markup['Raw response'], /&lt;script&gt;untrusted/);
  assert.match(markup['Normalized record'], /unknownAnalysisField/);
  assert.match(markup.Diagnostics, /unrendered-context/);
  assert.match(markup.Diagnostics, /untouched/);
  assert.match(markup['Archived Replay'], /archivedOnly/);
  assert.match(markup.Receipt, /production-tree-visualizer/);
  assert.deepEqual(record, original);
  const html = buildQualificationReviewHtml({ attempts: [record] }, { js: '/* </script> */', css: '/* </style> */' });
  const data = JSON.parse(html.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(data.attempts[0], record);
  assert.doesNotMatch(html, /<script>untrusted\(\)/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /worker-src blob:/);
});

test('explicit copy Replay is separate from the failed original and its recorded corrections remain visible', () => {
  const record = attempt();
  const copyBundle = structuredClone(record.normalizedRecord.response);
  record.outcome = { status: 'failed', phase: 'normalization', message: 'Original failure' };
  record.normalizedRecord = null;
  record.analyses = [];
  record.inspectionCopy = { kind: 'inspection-copy', bundle: copyBundle, correctionProvenance: {
    rawSha256: record.rawOutput.sha256,
    jsonRepair: [{ candidateByteOffset: 42, insertedBytesHex: '5d7d' }],
    edits: [{ path: '/relations/0/values', before: ['x_i'], after: { notation: ['x_i'] } }],
    semanticChanges: [], nodesAndReferencesChanged: false
  } };
  const original = structuredClone(record);
  const choice = reviewAnalyses(record)[0];
  assert.equal(choice.canReplay, false);
  assert.equal(choice.canInspectReplay, true);
  assert.equal(initialReviewSelection([record]).source, 'copy');
  const page = render(QualificationReview, { data: { attempts: [record] } });
  assert.match(page, /Inspection copy \/ recorded corrections/);
  assert.match(page, /Preparing Replay/);
  assert.match(page, /aria-label="Replay record"/);
  assert.match(page, />Failed<\/span>/);
  assert.doesNotMatch(page, /Live Replay \/ archived normalized derivative/);
  assert.match(render(ReviewTree, { choice, mode: 'replay', source: 'original' }), /No complete Replay/);
  const normalized = render(ReviewEvidence, { attempt: record, choice, view: 'Normalized record' });
  assert.match(normalized, /No normalized record was produced/);
  const corrections = render(ReviewEvidence, { attempt: record, choice, view: 'Corrections' });
  assert.match(corrections, /candidateByteOffset/);
  assert.match(corrections, /before/);
  assert.match(corrections, /after/);
  assert.match(corrections, /semanticChanges/);
  assert.match(corrections, /nodesAndReferencesChanged/);
  assert.deepEqual(record, original);
});

test('an archive-only build is self-contained, hash-attributed and leaves original files unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-live-review-'));
  try {
    const record = attempt();
    const bytes = Buffer.from([0xff, 0x00, 0xc3, 0x28]);
    record.receipt.rawOutput.sha256 = hash(bytes);
    const artifacts = {
      'raw-output.bin': bytes,
      'receipt.json': record.receipt,
      'bundle.json': record.normalizedRecord,
      'inspection.json': record.inspection,
      'replay.json': record.analyses[0].replay,
      'evidence.json': record.analyses[0].evidence,
      'run-receipt.json': { schemaVersion: 1, providerCallsMade: false },
      'review-manifest.json': { schemaVersion: 1, entries: [{
        attemptId: record.attemptId, sentence: record.sentence, framework: record.framework, model: record.model,
        outcome: record.outcome, receipt: 'receipt.json', rawOutput: 'raw-output.bin', bundle: 'bundle.json',
        inspection: 'inspection.json', analyses: [{ analysisIndex: 0, replay: 'replay.json', evidence: 'evidence.json' }]
      }] }
    };
    for (const [name, value] of Object.entries(artifacts)) fs.writeFileSync(path.join(root, name), Buffer.isBuffer(value) ? value : JSON.stringify(value));
    const originalHashes = Object.keys(artifacts).map((name) => hash(fs.readFileSync(path.join(root, name))));
    const result = spawnSync(process.execPath, ['scripts/buildContractQualificationReview.mjs', '--run', root], {
      cwd: repoRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const html = fs.readFileSync(path.join(root, 'review/index.html'), 'utf8');
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
    assert.match(html, /data:font\//);
    assert.match(html, /__BABEL_LOGO_SRC__="data:image\/png;base64,/);
    assert.match(html, /connect-src 'none'/);
    assert.match(html, /worker-src blob:/);
    const data = JSON.parse(html.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(Buffer.from(data.attempts[0].rawOutput.base64, 'base64'), bytes);
    assert.equal(data.attempts[0].rawOutput.matchesReceipt, true);
    assert.deepEqual(data.attempts[0].inspection, record.inspection);
    assert.deepEqual(data.attempts[0].normalizedRecord, record.normalizedRecord);
    assert.equal(data.attempts[0].inspectionCopy, null);
    assert.deepEqual(data.attempts[0].analyses[0].replay, record.analyses[0].replay);
    const sources = data.runtime.sources.map(({ path: file }) => file);
    assert.ok(sources.includes('components/TreeVisualizer.tsx'));
    assert.ok(sources.includes('replay/replayCompiler.ts'));
    assert.ok(!sources.some((file) => /fixtures\/|App\.tsx|parseRoutes|modelRuntime|prompts\.js/.test(file) && file !== 'contractQualification/reviewApp.tsx'));
    for (const source of data.runtime.sources) assert.equal(source.sha256, hash(fs.readFileSync(path.join(repoRoot, source.path))));
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'review/review-receipt.json'), 'utf8'));
    assert.equal(receipt.interactiveReplay, true);
    assert.equal(receipt.providerCallsMade, false);
    assert.equal(receipt.visualCaptureMade, false);
    assert.deepEqual(receipt.runtime, data.runtime);
    assert.deepEqual(Object.keys(artifacts).map((name) => hash(fs.readFileSync(path.join(root, name)))), originalHashes);

    const provenance = { rawSha256: hash(bytes), jsonRepair: [], edits: [{ before: 'x_i', after: 'x_i' }], semanticChanges: [], nodesAndReferencesChanged: false };
    fs.writeFileSync(path.join(root, 'corrections.json'), JSON.stringify(provenance));
    const mappingPath = path.join(root, 'copies.json');
    fs.writeFileSync(mappingPath, JSON.stringify({ [record.attemptId]: { bundle: 'bundle.json', correctionProvenance: 'corrections.json' } }));
    const withCopies = spawnSync(process.execPath, ['scripts/buildContractQualificationReview.mjs', '--run', root,
      '--out', 'with-copies', '--inspection-copies', mappingPath], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(withCopies.status, 0, withCopies.stderr);
    const copyHtml = fs.readFileSync(path.join(root, 'with-copies/index.html'), 'utf8');
    const copyData = JSON.parse(copyHtml.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const included = copyData.attempts[0].inspectionCopy;
    assert.deepEqual(included.correctionProvenance, provenance);
    assert.deepEqual(included.bundle, record.normalizedRecord);
    assert.equal(included.artifacts.bundle.sha256, hash(fs.readFileSync(path.join(root, 'bundle.json'))));
    assert.equal(included.artifacts.correctionProvenance.sha256, hash(fs.readFileSync(path.join(root, 'corrections.json'))));
    assert.equal(included.sourceRawSha256, hash(bytes));
    assert.deepEqual(copyData.attempts[0].outcome, record.outcome);
    assert.deepEqual(copyData.attempts[0].normalizedRecord, record.normalizedRecord);
    const copyReceipt = JSON.parse(fs.readFileSync(path.join(root, 'with-copies/review-receipt.json'), 'utf8'));
    assert.equal(copyReceipt.inspectionCopyManifest.sha256, hash(fs.readFileSync(mappingPath)));
    assert.equal(copyReceipt.inspectionCopies.length, 1);
    assert.equal(copyReceipt.inspectionCopies[0].analysisCount, 1);
    assert.deepEqual(Object.keys(artifacts).map((name) => hash(fs.readFileSync(path.join(root, name)))), originalHashes);

    fs.writeFileSync(path.join(root, 'corrections.json'), JSON.stringify({ ...provenance, rawSha256: 'wrong-original' }));
    const mismatch = spawnSync(process.execPath, ['scripts/buildContractQualificationReview.mjs', '--run', root,
      '--out', 'mismatch', '--inspection-copies', mappingPath], { cwd: repoRoot, encoding: 'utf8' });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /raw SHA-256 does not match the original attempt/);
    assert.equal(fs.existsSync(path.join(root, 'mismatch/index.html')), false);
    fs.writeFileSync(mappingPath, JSON.stringify({ nonexistent: { bundle: 'bundle.json', correctionProvenance: 'corrections.json' } }));
    const unknown = spawnSync(process.execPath, ['scripts/buildContractQualificationReview.mjs', '--run', root,
      '--out', 'unknown', '--inspection-copies', mappingPath], { cwd: repoRoot, encoding: 'utf8' });
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /unknown attempt/);
    fs.writeFileSync(mappingPath, JSON.stringify({ [record.attemptId]: null }));
    const emptyMapping = spawnSync(process.execPath, ['scripts/buildContractQualificationReview.mjs', '--run', root,
      '--out', 'empty-mapping', '--inspection-copies', mappingPath], { cwd: repoRoot, encoding: 'utf8' });
    assert.notEqual(emptyMapping.status, 0);
    assert.match(emptyMapping.stderr, /requires bundle and correctionProvenance paths/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

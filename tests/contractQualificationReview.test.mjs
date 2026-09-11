import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { buildQualificationReviewHtml } from '../contractQualification/reviewPage.js';
import { buildQualificationAnalysisEvidence } from '../contractQualification/review.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const runScript = (script, args) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
};

test('saved review claims identify the same Tier 2 outputs as the production plan', () => {
  const tree = { id: 'root', label: 'TP', children: [
    { id: 'a', label: 'D', word: 'Mia' }, { id: 'b', label: 'D', word: 'PRO', silent: true }
  ] };
  const relation = { relation: 'Authored control dependency', anchors: { controller: 'a', controlledSubject: 'b' } };
  const evidence = buildQualificationAnalysisEvidence({ sentence: 'Mia', analyses: [{ tree,
    derivationStages: [{ statement: 'Control', stageRecord: 'Authored dependency.', workspaceForest: [tree], relations: [relation] }]
  }] });
  const claim = evidence.renderer.relations[0].claims.find(c => c.tier === 2);
  assert(claim.facet.outputIdentities.length);
  assert(claim.facet.outputIdentities.every(id => typeof id === 'string' && id.length));
  const drawn = evidence.renderer.frames[0].items.flatMap(item => item.tier2OutputIdentities);
  assert(claim.facet.outputIdentities.every(id => drawn.includes(id)));
});

test('inline review runtime escapes HTML comment openers without changing values', async () => {
  const literal = '<!-- <script></script>';
  const { code } = await transform(`console.log(${JSON.stringify(literal)})`, { minify: true });
  assert.ok(code.includes('<!-- <script><\\/script>'), 'esbuild leaves the HTML comment opener literal');
  const reviewData = { raw: literal, unknown: ['<!--', '</script>', '<!--'] };
  const originalData = structuredClone(reviewData);
  const runtime = Object.freeze({ js: code, css: 'body {}' });
  const html = buildQualificationReviewHtml(reviewData, runtime);
  const embeddedRuntime = html.match(/<script>([\s\S]*?)<\/script>/u)[1];
  assert.doesNotMatch(embeddedRuntime, /<!--/u);
  assert.ok(embeddedRuntime.includes('<\\!-- <script><\\/script>'));
  const logged = [];
  runInNewContext(embeddedRuntime, { console: { log: (value) => logged.push(value) } });
  assert.deepEqual(logged, [literal]);
  const embeddedData = html.match(/<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/u)[1];
  assert.deepEqual(JSON.parse(embeddedData), originalData);
  assert.deepEqual(reviewData, originalData);
  assert.equal(runtime.js, code);
});

test('the provider-free review preserves success, repair, and failure evidence', () => {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-qualification-review-'));
  try {
    runScript('scripts/buildContractQualificationDryRun.mjs', ['--out', runRoot]);
    runScript('scripts/buildContractQualificationReview.mjs', ['--run', runRoot]);

    const manifest = readJson(path.join(runRoot, 'review-manifest.json'));
    assert.equal(manifest.entries.length, 5);

    const valid = manifest.entries.find(({ attemptId }) => (
      attemptId === 'smoke-what-did-mia-see-xbar'
    ));
    assert.equal(valid.outcome.status, 'valid-pending-review');
    assert.equal(valid.analyses.length, 1);
    const evidence = readJson(path.join(runRoot, valid.analyses[0].evidence));
    const replay = readJson(path.join(runRoot, valid.analyses[0].replay));
    assert.equal(evidence.replay.frameCount, replay.stepCount);
    assert.deepEqual(evidence.renderer.tierCounts, { tier1: 2, tier2: 0, tier3: 0 });
    assert.deepEqual(
      evidence.replay.frames.map(({ frameIndex }) => frameIndex),
      Array.from({ length: evidence.replay.frameCount }, (_, index) => index)
    );

    const repaired = manifest.entries.find(({ attemptId }) => (
      attemptId === 'smoke-repaired-mia-laughed-xbar'
    ));
    const repairedReceipt = readJson(path.join(runRoot, repaired.receipt));
    assert.equal(repaired.outcome.status, 'valid-pending-review');
    assert.equal(
      repairedReceipt.ingress.repairDiagnostics[0].kind,
      'append_closers_at_end_of_output'
    );
    assert.equal(repairedReceipt.ingress.repairDiagnostics[0].insertedText, '}');

    const malformed = manifest.entries.find(({ attemptId }) => (
      attemptId === 'smoke-malformed-json'
    ));
    const malformedReceipt = readJson(path.join(runRoot, malformed.receipt));
    const malformedBytes = fs.readFileSync(path.join(runRoot, malformed.rawOutput));
    assert.equal(malformed.outcome.status, 'failed');
    assert.equal(malformed.outcome.phase, 'json-ingress');
    assert.equal(malformed.analyses.length, 0);
    assert.equal(malformedReceipt.rawOutput.sha256, sha256(malformedBytes));

    const wrongEnvelope = manifest.entries.find(({ attemptId }) => (
      attemptId === 'smoke-wrong-envelope'
    ));
    assert.equal(wrongEnvelope.outcome.status, 'failed');
    assert.equal(wrongEnvelope.outcome.phase, 'normalization');

    const html = fs.readFileSync(path.join(runRoot, 'review', 'index.html'), 'utf8');
    assert.match(html, /data-babel-replay-timeline/u);
    assert.match(html, /Raw response/u);
    assert.match(html, /Tier coverage/u);
    assert.match(html, /Normalized after repair/u);
    assert.match(html, /Linguistic:/u);
    assert.match(html, /smoke-malformed-json/u);
    assert.match(html, /smoke-wrong-envelope/u);
    assert.match(html, /production-tree-visualizer/u);
    assert.match(html, /review-select review-attempt/u);
    assert.doesNotMatch(html, /<aside/u);
    assert.doesNotMatch(html, /class="heading"/u);
    assert.doesNotMatch(html, /class="tabs"/u);

    const reviewReceipt = readJson(path.join(runRoot, 'review', 'review-receipt.json'));
    assert.equal(reviewReceipt.providerCallsMade, false);
    assert.equal(reviewReceipt.visualCaptureMade, false);
    assert.equal(reviewReceipt.interactiveReplay, true);
    assert.equal(reviewReceipt.attemptCount, 5);
    assert.equal(reviewReceipt.analysisCount, 3);
  } finally {
    fs.rmSync(runRoot, { recursive: true, force: true });
  }
});

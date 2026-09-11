import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { buildQualificationReviewHtml } from '../contractQualification/reviewPage.js';
import { buildQualificationReviewRuntime } from './buildContractQualificationReviewRuntime.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);

const readArg = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? String(args[index + 1] || '') : fallback;
};

const runRoot = path.resolve(repoRoot, readArg(
  'run',
  '.artifacts/contract-qualification/plumbing-smoke'
));
const outputRoot = path.resolve(runRoot, readArg('out', 'review'));
const browserArgument = readArg('browser').trim();
const browserPath = browserArgument ? path.resolve(browserArgument) : '';
if (browserPath && !fs.existsSync(browserPath)) {
  throw new Error('Provide --browser with an existing browser executable.');
}
if (fs.existsSync(outputRoot) && fs.readdirSync(outputRoot).length > 0) {
  throw new Error(`Review output is not empty: ${outputRoot}`);
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const findFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close(() => resolve(port));
  });
  server.on('error', reject);
});

const waitForServer = async (url) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Readiness is confirmed by the first successful HTTP response.
    }
    await wait(150);
  }
  throw new Error(`Vite did not become ready at ${url}.`);
};

const stopOwnedProcess = async (child, timeoutMs = 5000) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    exited.then(() => true),
    wait(timeoutMs).then(() => false)
  ]);
  if (stopped || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGKILL');
  await Promise.race([exited, wait(2000)]);
};

const collectFiles = (root) => {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(root);
  return files.sort();
};

const relativeWebPath = (from, to) => path.relative(from, to).split(path.sep).join('/');

const reviewManifest = readJson(path.join(runRoot, 'review-manifest.json'));
const copiesArgument = readArg('inspection-copies').trim();
const copiesBytes = copiesArgument ? fs.readFileSync(path.resolve(copiesArgument)) : null;
const copies = copiesBytes ? JSON.parse(copiesBytes.toString('utf8')) : {};
if (!copies || typeof copies !== 'object' || Array.isArray(copies)) {
  throw new Error('--inspection-copies must map attempt IDs to bundle and correctionProvenance paths.');
}
for (const attemptId of Object.keys(copies)) {
  if (!reviewManifest.entries?.some((entry) => entry.attemptId === attemptId)) {
    throw new Error(`Inspection copy names an unknown attempt: ${attemptId}`);
  }
}
const runReceiptPath = path.join(runRoot, 'run-receipt.json');
const runReceiptBytes = fs.readFileSync(runReceiptPath);
const runReceipt = JSON.parse(runReceiptBytes.toString('utf8'));
if (!Array.isArray(reviewManifest.entries) || reviewManifest.entries.length === 0) {
  throw new Error('Review manifest contains no attempts.');
}

fs.mkdirSync(outputRoot, { recursive: true });

if (browserPath) {
  const successfulAnalyses = reviewManifest.entries.flatMap((entry) => (
    entry.analyses.map((analysis) => ({ entry, analysis }))
  ));
  if (successfulAnalyses.length > 0) {
    const port = await findFreePort();
    const appUrl = `http://127.0.0.1:${port}`;
    const vite = spawn(
      process.execPath,
      [
        path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort'
      ],
      { cwd: repoRoot, stdio: 'ignore' }
    );

    try {
      await waitForServer(appUrl);
      for (const { entry, analysis } of successfulAnalyses) {
        const destination = path.join(
          outputRoot,
          entry.attemptId,
          `analysis-${analysis.analysisIndex + 1}`
        );
        fs.mkdirSync(destination, { recursive: true });
        const capture = spawnSync(
          process.execPath,
          [
            path.join(repoRoot, 'scripts', 'captureReplayArtifact.mjs'),
            '--bundle', path.join(runRoot, entry.bundle),
            '--analysis-index', String(analysis.analysisIndex),
            '--out', destination,
            '--browser', browserPath,
            '--app-url', appUrl
          ],
          { cwd: repoRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
        );
        if (capture.status !== 0 || capture.signal || capture.error) {
          throw new Error(
            `Capture failed for ${entry.attemptId} analysis ${analysis.analysisIndex + 1}: `
            + `${capture.error?.message || capture.stderr || capture.signal || capture.status}`
          );
        }
      }
    } finally {
      await stopOwnedProcess(vite);
    }
  }
}

const loadRawOutput = (artifactPath, receipt) => {
  const bytes = fs.readFileSync(path.join(runRoot, artifactPath));
  const text = bytes.toString('utf8');
  const isUtf8 = Buffer.from(text, 'utf8').equals(bytes);
  return {
    encoding: isUtf8 ? 'utf8' : 'base64',
    ...(isUtf8 ? { text } : { base64: bytes.toString('base64') }),
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
    recordedSha256: receipt.rawOutput.sha256,
    matchesReceipt: sha256(bytes) === receipt.rawOutput.sha256
  };
};

const loadInspectionCopy = (attemptId, rawOutput) => {
  if (!Object.hasOwn(copies, attemptId)) return null;
  const mapping = copies[attemptId];
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw new Error(`Inspection copy requires bundle and correctionProvenance paths: ${attemptId}`);
  }
  const readCopyArtifact = (file) => {
    if (typeof file !== 'string' || !file || path.isAbsolute(file)) {
      throw new Error(`Inspection copy paths must be relative to the original run: ${attemptId}`);
    }
    const absolute = path.resolve(runRoot, file);
    const relative = path.relative(runRoot, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Inspection copy path leaves the original run: ${file}`);
    }
    const bytes = fs.readFileSync(absolute);
    return { record: JSON.parse(bytes.toString('utf8')), artifact: { path: file, byteLength: bytes.length, sha256: sha256(bytes) } };
  };
  const bundle = readCopyArtifact(mapping.bundle);
  const correction = readCopyArtifact(mapping.correctionProvenance);
  if (correction.record.rawSha256 !== rawOutput.sha256 || !rawOutput.matchesReceipt) {
    throw new Error(`Inspection copy raw SHA-256 does not match the original attempt: ${attemptId}`);
  }
  return {
    kind: 'inspection-copy',
    sourceRawSha256: rawOutput.sha256,
    artifacts: { bundle: bundle.artifact, correctionProvenance: correction.artifact },
    correctionProvenance: correction.record,
    bundle: bundle.record
  };
};

const runtime = await buildQualificationReviewRuntime();
const reviewData = {
  schemaVersion: 1,
  runtime: runtime.metadata,
  runReceipt,
  attempts: reviewManifest.entries.map((entry) => {
    const receipt = readJson(path.join(runRoot, entry.receipt));
    const normalizedRecord = entry.bundle
      ? readJson(path.join(runRoot, entry.bundle))
      : null;
    const rawOutput = loadRawOutput(entry.rawOutput, receipt);
    return {
      attemptId: entry.attemptId,
      sentence: entry.sentence,
      framework: entry.framework,
      model: entry.model,
      outcome: entry.outcome,
      receipt,
      rawOutput,
      normalizedRecord,
      inspectionCopy: loadInspectionCopy(entry.attemptId, rawOutput),
      inspection: entry.inspection ? readJson(path.join(runRoot, entry.inspection)) : null,
      analyses: entry.analyses.map((analysis) => {
        const replay = readJson(path.join(runRoot, analysis.replay));
        const evidence = readJson(path.join(runRoot, analysis.evidence));
        const captureRoot = path.join(
          outputRoot,
          entry.attemptId,
          `analysis-${analysis.analysisIndex + 1}`
        );
        const frameFiles = fs.existsSync(captureRoot)
          ? fs.readdirSync(captureRoot)
            .filter((name) => /^replay-\d+\.png$/u.test(name))
            .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
          : [];
        if (frameFiles.length > 0 && frameFiles.length !== evidence.replay.frameCount) {
          throw new Error(
            `Capture count mismatch for ${entry.attemptId} analysis ${analysis.analysisIndex + 1}: `
            + `${frameFiles.length} image(s) for ${evidence.replay.frameCount} Replay frame(s).`
          );
        }
        return {
          analysisIndex: analysis.analysisIndex,
          replay,
          evidence,
          capture: {
            available: frameFiles.length > 0,
            frames: frameFiles.map((name) => relativeWebPath(
              outputRoot,
              path.join(captureRoot, name)
            ))
          }
        };
      })
    };
  })
};

fs.writeFileSync(
  path.join(outputRoot, 'index.html'),
  buildQualificationReviewHtml(reviewData, runtime),
  'utf8'
);

const artifactFiles = collectFiles(outputRoot)
  .filter((filePath) => path.basename(filePath) !== 'review-receipt.json')
  .map((filePath) => {
    const bytes = fs.readFileSync(filePath);
    return {
      path: relativeWebPath(outputRoot, filePath),
      byteLength: bytes.byteLength,
      sha256: sha256(bytes)
    };
  });
const receiptBase = {
  schemaVersion: 1,
  runReceiptSha256: sha256(runReceiptBytes),
  providerCallsMade: false,
  attemptCount: reviewData.attempts.length,
  analysisCount: reviewData.attempts.reduce(
    (count, attempt) => count + attempt.analyses.length,
    0
  ),
  visualCaptureMade: Boolean(browserPath),
  interactiveReplay: true,
  runtime: runtime.metadata,
  inspectionCopyManifest: copiesBytes ? { path: path.resolve(copiesArgument), sha256: sha256(copiesBytes) } : null,
  inspectionCopies: reviewData.attempts.filter((attempt) => attempt.inspectionCopy).map((attempt) => ({
    attemptId: attempt.attemptId,
    analysisCount: (attempt.inspectionCopy.bundle.response ?? attempt.inspectionCopy.bundle).analyses?.length ?? 0,
    sourceRawSha256: attempt.inspectionCopy.sourceRawSha256,
    artifacts: attempt.inspectionCopy.artifacts
  })),
  artifacts: artifactFiles
};
const reviewReceipt = {
  ...receiptBase,
  receiptSha256: sha256(Buffer.from(JSON.stringify(receiptBase), 'utf8'))
};
fs.writeFileSync(
  path.join(outputRoot, 'review-receipt.json'),
  `${JSON.stringify(reviewReceipt, null, 2)}\n`,
  'utf8'
);

console.log(path.relative(repoRoot, path.join(outputRoot, 'index.html')));
console.log(reviewReceipt.receiptSha256);

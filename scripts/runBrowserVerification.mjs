import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserSuite, requiredTestSummary } from './browserSuites.mjs';

const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
// Videos are opt-in (--video or BABEL_BROWSER_VIDEO=1): no assertion reads one.
let suite = 'full', evidence = process.env.BABEL_BROWSER_EVIDENCE, video = process.env.BABEL_BROWSER_VIDEO === '1';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--suite') suite = args[++i];
  else if (args[i] === '--evidence') evidence = args[++i];
  else if (args[i] === '--video') video = true;
  else throw new Error(`Unknown browser verification argument: ${args[i]}`);
}
const specs = await browserSuite(root, suite);
evidence = path.resolve(evidence || await mkdtemp(path.join(os.tmpdir(), 'babel-browser-verification-')));
await mkdir(evidence, { recursive: true });
const tapFile = path.join(evidence, 'tests.tap');
const started = Date.now();
const buildConcurrency = process.env.GOMAXPROCS || '2';
const receipt = { suite, required: specs, startedAt: new Date(started).toISOString(), evidence,
  node: process.version, testConcurrency: 1, buildConcurrency, video,
  exitCode: null, signal: null, testSummary: null, elapsedMs: null, error: null };
console.log(`Browser ${suite}: ${specs.length} required specs. Evidence: ${evidence}`);
for (const spec of specs) console.log(`  ${spec.owner}: ${spec.file}`);
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=600000',
  '--test-reporter=spec', '--test-reporter=tap', '--test-reporter-destination=stdout',
  `--test-reporter-destination=${tapFile}`, ...specs.map(spec => `tests/browser/${spec.file}`)], {
  cwd: fileURLToPath(root), stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env,
    GOMAXPROCS: buildConcurrency,
    BABEL_BROWSER_VIDEO: video ? '1' : '0',
    BABEL_BROWSER_EVIDENCE: evidence,
    BABEL_WORKFLOW_EVIDENCE: path.join(evidence, 'application'),
    BABEL_CLOSEOUT_EVIDENCE: path.join(evidence, 'closeout'),
    BABEL_TIER2_PRODUCTION_EVIDENCE: path.join(evidence, 'tier2'),
    BABEL_OUTCOME_EVIDENCE: path.join(evidence, 'blocked-outcomes'),
    BABEL_COMPATIBILITY_EVIDENCE: path.join(evidence, 'compatibility'),
    BABEL_CAPTURE_EVIDENCE: path.join(evidence, 'capture') }
});
const forward = signal => child.kill(signal);
const onInterrupt = () => forward('SIGINT'), onTerminate = () => forward('SIGTERM');
process.once('SIGINT', onInterrupt); process.once('SIGTERM', onTerminate);
try {
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  receipt.exitCode = result.code; receipt.signal = result.signal;
  receipt.testSummary = requiredTestSummary(await readFile(tapFile, 'utf8'));
  if (result.code !== 0 || result.signal || receipt.testSummary.fail) throw new Error(`Browser ${suite} failed (exit ${result.code}, signal ${result.signal || 'none'}).`);
} catch (error) {
  receipt.error = String(error);
  console.error(receipt.error);
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate);
  receipt.elapsedMs = Date.now() - started;
  await writeFile(path.join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(`Browser ${suite} finished in ${(receipt.elapsedMs / 1000).toFixed(1)}s. Receipt: ${path.join(evidence, 'receipt.json')}`);
}

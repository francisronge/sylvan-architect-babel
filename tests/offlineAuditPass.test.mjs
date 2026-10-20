import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const script = fileURLToPath(new URL('../scripts/auditReplayVisuals.mjs', import.meta.url));
const run = promisify(execFile);
// One analysis with findings in both audits, so equal reports are not empty ones.
// Its visual findings are listed role-label lanes and crowded plaques.
const RECORD = 'replay-regressions/sol-spanish-qr.json#/analyses/1';
const VISUAL = ['--audit', 'visual', '--viewports', 'desktop,desktop-large'];
const CAMERA = ['--audit', 'camera', '--viewports', 'desktop,mobile'];

test('one pass reports each audit exactly as its own run does', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'babel-audit-pass-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const audit = (...args) => run(process.execPath, [script, '--fixtures', '--only', RECORD, '--jobs', '1', ...args]);
  const out = name => path.join(directory, `${name}.json`);
  await Promise.all([audit(...VISUAL, '--out', out('visual')), audit(...CAMERA, '--out', out('camera'))]);
  const { stdout } = await audit(...VISUAL, '--out', out('shared-visual'), ...CAMERA, '--out', out('shared-camera'));
  assert.match(stdout, /Visual audit: 1 analyses, .* in one pass with the camera audit/);
  assert.match(stdout, /Camera audit: 1 analyses, .* in one pass with the visual audit/);
  const read = name => {
    const { durationMs, jobs, sharedWith, ...report } = JSON.parse(readFileSync(out(name), 'utf8'));
    return report;
  };
  for (const name of ['visual', 'camera']) {
    const own = read(name);
    assert.equal(own.records, 1);
    assert.deepEqual(own.errors, []);
    assert.ok(own.findings.length > 0, `${name}: the record has findings to compare`);
    assert.deepEqual(read(`shared-${name}`), own, name);
  }
});

test('several audits pair their viewports and reports by order', async () => {
  const fails = (args, pattern) => assert.rejects(run(process.execPath, [script, '--fixtures', ...args]),
    error => pattern.test(error.stderr));
  await fails([...VISUAL, '--out', '/dev/null', '--audit', 'camera', '--out', '/dev/null'], /Give --viewports once for each of the 2 audits/);
  await fails([...VISUAL, ...CAMERA, '--out', '/dev/null'], /Give --out once for each of the 2 audits/);
  await fails([...VISUAL, '--out', '/dev/null', '--audit', 'visual', '--viewports', 'mobile', '--out', '/dev/null'], /names each audit once/);
});

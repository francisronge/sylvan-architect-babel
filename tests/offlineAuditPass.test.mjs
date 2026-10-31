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
// Two analyses with findings in both audits between them, so equal reports are not
// empty ones: the first has listed distant plaques, the second listed first-paint jumps.
const RECORD = 'replay-regressions/sol-spanish-qr.json#/analyses/';
const VISUAL = ['--audit', 'visual', '--viewports', 'desktop,desktop-large'];
const CAMERA = ['--audit', 'camera', '--viewports', 'desktop,mobile'];

test('one pass reports each audit exactly as its own run does', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'babel-audit-pass-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const audit = (...args) => run(process.execPath, [script, '--fixtures', '--only', RECORD, '--jobs', '1', ...args]);
  const out = name => path.join(directory, `${name}.json`);
  await Promise.all([audit(...VISUAL, '--out', out('visual')), audit(...CAMERA, '--out', out('camera'))]);
  const { stdout } = await audit(...VISUAL, '--out', out('shared-visual'), ...CAMERA, '--out', out('shared-camera'));
  assert.match(stdout, /Visual audit: 2 analyses, .* in one pass with the camera audit/);
  assert.match(stdout, /Camera audit: 2 analyses, .* in one pass with the visual audit/);
  const read = name => {
    const { durationMs, jobs, sharedWith, ...report } = JSON.parse(readFileSync(out(name), 'utf8'));
    return report;
  };
  for (const name of ['visual', 'camera']) {
    const own = read(name);
    assert.equal(own.records, 2);
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

test('shards merged report exactly what one pass does, and only a complete set of shards merges', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'babel-audit-shards-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // Nine analyses with listed camera findings, split four and five.
  const audit = (...args) => run(process.execPath, [script, '--fixtures', '--only', 'movement/clause-context.json#', '--jobs', '1', ...args]);
  const out = name => path.join(directory, name);
  const reports = name => [...VISUAL, '--out', out(`${name}-visual.json`), ...CAMERA, '--out', out(`${name}-camera.json`)];
  await Promise.all([audit(...reports('one')),
    ...[1, 2].map(shard => audit(...reports('unused'), '--shard', `${shard}/2`, '--results-out', out(`shard-${shard}.json`)))]);
  const shards = [1, 2].map(shard => JSON.parse(readFileSync(out(`shard-${shard}.json`), 'utf8')));
  assert.deepEqual(shards.map(shard => shard.results.length), [5, 4]);
  await audit(...reports('merged'), '--merge', out('shard-1.json'), '--merge', out('shard-2.json'));
  const read = name => {
    const { durationMs, jobs, ...report } = JSON.parse(readFileSync(out(name), 'utf8'));
    return report;
  };
  assert.ok(read('one-camera.json').findings.length > 0, 'the analyses have findings to compare');
  for (const name of ['visual', 'camera']) assert.deepEqual(read(`merged-${name}.json`), read(`one-${name}.json`), name);
  const refused = (args, pattern) => assert.rejects(audit(...reports('refused'), ...args), error => pattern.test(error.stderr));
  const both = ['--merge', out('shard-1.json'), '--merge', out('shard-2.json')];
  await refused(['--merge', out('shard-1.json')], /--merge needs shards 1\/N to N\/N of one N, each once; got 1\/2/);
  await refused(['--merge', out('shard-1.json'), '--merge', out('shard-1.json')], /each once; got 1\/2, 1\/2/);
  await refused(['--every', '2', ...both], /audited other analyses than this run selects/);
  await refused(['--no-canopy', ...both], /ran other audits than this run names/);
  await refused(['--shard', '1/2'], /--shard needs --results-out/);
  await refused(['--shard', '3/2', '--results-out', out('x.json')], /Invalid --shard 3\/2/);
});

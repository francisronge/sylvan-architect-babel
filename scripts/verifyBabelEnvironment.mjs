import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { chromium, webkit } from 'playwright';
import { browserSuite } from './browserSuites.mjs';
import { loadCorpusManifest } from './replayCorpusInputs.mjs';
import { verifyDependencyInstallation } from './verifyDependencyInstallation.mjs';

const { values } = parseArgs({ options: { 'app-url': { type: 'string' }, browser: { type: 'string' }, out: { type: 'string' } } });
const rootUrl = new URL('../', import.meta.url), root = fileURLToPath(rootUrl);
const checks = [];
const check = async (name, action) => {
  try { checks.push({ name, passed: true, detail: await action() }); }
  catch (error) { checks.push({ name, passed: false, detail: String(error.message || error) }); }
};
await check('Node 24', () => {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw Error(`Use Node 24; found ${process.version}.`);
  return process.version;
});
await check('Dependency identity', () => verifyDependencyInstallation(root));
await check('Browser suite ownership', async () => (await browserSuite(rootUrl, 'full')).map(spec => ({ file: spec.file, owner: spec.owner })));
await check('Default corpus inputs', async () => {
  const manifest = await loadCorpusManifest(path.join(root, 'fixtures/replay-corpus/manifest.json'));
  return { path: 'fixtures/replay-corpus/manifest.json', records: manifest.records.length, mechanisms: manifest.coverage, sha256: manifest.sha256 };
});
const requested = values.browser ? [values.browser] : ['chromium', 'webkit'];
for (const engine of requested) await check(`${engine} runtime`, async () => {
  if (!['chromium', 'webkit'].includes(engine)) throw Error(`Unknown browser ${engine}. Use chromium or webkit.`);
  const executable = { chromium, webkit }[engine].executablePath();
  await fs.access(executable);
  return executable;
});
if (values['app-url']) await check('Existing app responds', async () => {
  const url = new URL(values['app-url']);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname.startsWith('/api/')) throw Error('Doctor accepts a credential-free loopback app URL.');
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok) throw Error(`App returned HTTP ${response.status}.`);
  const html = await response.text();
  if (!/<(?:script|div|main)\b/i.test(html)) throw Error('App response is not a usable HTML entry.');
  return { url: url.href, entrySha256: createHash('sha256').update(html).digest('hex'),
    note: 'Entry response checked. Browser gates establish rendered readiness and user-flow correctness.' };
});
const receipt = { ok: checks.every(check => check.passed), root, checks,
  note: 'Doctor checks prerequisites. It does not certify product behavior, launch a server, or dispatch a parse.' };
if (values.out) {
  const output = path.resolve(values.out); await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
}
for (const entry of checks) console.log(`${entry.passed ? 'PASS' : 'FAIL'} ${entry.name}: ${JSON.stringify(entry.detail)}`);
if (!receipt.ok) {
  console.error('Repair failed prerequisites before browser verification. Install locked dependencies with npm ci and missing runtimes with npx --no-install playwright install chromium webkit.');
  process.exitCode = 1;
}

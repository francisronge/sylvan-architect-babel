import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildQualificationReviewRuntime } from '../scripts/buildContractQualificationReviewRuntime.mjs';
import { build } from 'esbuild';
import { sourceSnapshotPlugin } from '../scripts/inlineWorkerPlugin.mjs';
import { createRuntimeProvenance, sha256, verifyRuntimeFreshness } from '../scripts/reviewRuntimeProvenance.mjs';

test('comparison builds resolve Tailwind content in their own checkout', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'babel-build-root-'));
  try {
    const builds = [];
    for (const color of ['red', 'blue']) {
      const root = path.join(scratch, color);
      await mkdir(path.join(root, 'public'), { recursive: true });
      await writeFile(path.join(root, 'public/babellogo.png'), 'unused test logo');
      await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
      await writeFile(path.join(root, 'tailwind.config.cjs'), "module.exports = { content: ['./index.html'] };\n");
      await writeFile(path.join(root, 'index.html'), `<div class="bg-${color}-500"></div>`);
      await writeFile(path.join(root, 'styles.css'), '@tailwind utilities;');
      builds.push(await buildQualificationReviewRuntime({ root, entrySource: "import './styles.css';" }));
      assert.equal((await verifyRuntimeFreshness(builds.at(-1).metadata, { root, entrySource: "import './styles.css';" })).fresh, true);
    }
    assert.match(builds[0].css, /\.bg-red-500/);
    assert.doesNotMatch(builds[0].css, /\.bg-blue-500/);
    assert.match(builds[1].css, /\.bg-blue-500/);
    assert.doesNotMatch(builds[1].css, /\.bg-red-500/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('a file edited after esbuild consumes it cannot be relabelled as a fresh build', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'babel-build-race-')));
  const lock = '{"lockfileVersion":3}\n';
  try {
    await writeFile(path.join(root, 'package-lock.json'), lock);
    await writeFile(path.join(root, 'entry.js'), "window.value = 'compiled original';");
    const consumedSources = new Map([[path.join(root, 'package-lock.json'), sha256(lock)]]);
    const result = await build({ absWorkingDir: root, entryPoints: ['entry.js'], bundle: true, write: false,
      plugins: [sourceSnapshotPlugin({ onSource: (file, bytes) => {
        consumedSources.set(file, sha256(bytes));
        writeFileSync(file, "window.value = 'edited after compilation';");
      } })] });
    assert.match(result.outputFiles[0].text, /compiled original/, 'the artifact must contain the consumed bytes');
    await assert.rejects(createRuntimeProvenance({ root, inputFiles: ['entry.js'], bundleInputFiles: ['entry.js'], styleContent: { patterns: [], files: [] },
      entrySource: "import './entry.js';", tools: {}, js: result.outputFiles[0].text, css: '', consumedSources }),
    /Build input differs from its compiled bytes: entry\.js/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runtime freshness detects CSS-only inputs, content membership, lock and virtual entry changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'babel-runtime-provenance-'));
  const entrySource = "import './styles.css'; window.entryIdentity = 'original';";
  try {
    await mkdir(path.join(root, 'public'));
    await writeFile(path.join(root, 'public/babellogo.png'), 'unused test logo');
    await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
    await writeFile(path.join(root, 'tailwind.config.cjs'), "module.exports = { content: ['./*.html', '!./excluded.html'] };\n");
    await writeFile(path.join(root, 'index.html'), '<div class="bg-red-500"></div>');
    await writeFile(path.join(root, 'styles.css'), '@tailwind utilities;');
    const runtime = await buildQualificationReviewRuntime({ root, entrySource });
    assert.match(runtime.css, /\.bg-red-500/);
    assert(runtime.metadata.sources.some(item => item.path === 'index.html'), 'the CSS-only template is part of source identity');
    assert(!runtime.metadata.bundleInputs.includes('index.html'), 'CSS scanning does not make a template a program import');
    const check = (entry = entrySource) => verifyRuntimeFreshness(runtime.metadata, { root, entrySource: entry });
    assert.equal((await check()).fresh, true);
    assert.equal((await check(entrySource.replace('original', 'changed'))).fresh, false);
    assert.equal((await verifyRuntimeFreshness(runtime.metadata, { root })).fresh, false, 'a virtual entry needs its expected source');
    await writeFile(path.join(root, 'index.html'), '<div class="bg-blue-500"></div>');
    assert((await check()).mismatches.includes('index.html'));
    await writeFile(path.join(root, 'index.html'), '<div class="bg-red-500"></div>');
    await writeFile(path.join(root, 'added.html'), '<div class="text-xl"></div>');
    assert((await check()).mismatches.includes('Tailwind content membership'));
    await rm(path.join(root, 'added.html'));
    await writeFile(path.join(root, 'excluded.html'), '<div class="text-xl"></div>');
    assert.equal((await check()).fresh, true, 'excluded templates are not build inputs');
    await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
    assert((await check()).mismatches.includes('package-lock.json'));
    await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
    assert.equal((await check()).fresh, true);
    const alteredIdentity = structuredClone(runtime.metadata);
    alteredIdentity.jsSha256 = '0'.repeat(64);
    assert((await verifyRuntimeFreshness(alteredIdentity, { root, entrySource })).mismatches.includes('Build identity'));
    const alteredGraph = structuredClone(runtime.metadata);
    alteredGraph.bundleInputs = alteredGraph.bundleInputs.filter(file => file !== 'styles.css');
    assert((await verifyRuntimeFreshness(alteredGraph, { root, entrySource })).mismatches.includes('Source manifest identity'),
      'bundle membership is hash-bound even when all file hashes remain unchanged');
    assert.equal((await verifyRuntimeFreshness({ sources: runtime.metadata.sources }, { root, entrySource })).fresh, false,
      'old partial manifests cannot establish complete freshness');
  } finally { await rm(root, { recursive: true, force: true }); }
});

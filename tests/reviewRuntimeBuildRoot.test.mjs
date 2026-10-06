import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildQualificationReviewRuntime } from '../scripts/buildContractQualificationReviewRuntime.mjs';

test('comparison builds resolve Tailwind content in their own checkout', async () => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'babel-build-root-'));
  try {
    const builds = [];
    for (const color of ['red', 'blue']) {
      const root = path.join(scratch, color);
      await mkdir(path.join(root, 'public'), { recursive: true });
      await writeFile(path.join(root, 'public/babellogo.png'), 'unused test logo');
      await writeFile(path.join(root, 'tailwind.config.cjs'), "module.exports = { content: ['./index.html'] };\n");
      await writeFile(path.join(root, 'index.html'), `<div class="bg-${color}-500"></div>`);
      await writeFile(path.join(root, 'styles.css'), '@tailwind utilities;');
      builds.push(await buildQualificationReviewRuntime({ root, entrySource: "import './styles.css';" }));
    }
    assert.match(builds[0].css, /\.bg-red-500/);
    assert.doesNotMatch(builds[0].css, /\.bg-blue-500/);
    assert.match(builds[1].css, /\.bg-blue-500/);
    assert.doesNotMatch(builds[1].css, /\.bg-red-500/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertCandidateContainsBaseline, checkCaseList, indexHtml, resolveCase } from '../scripts/buildReplayComparison.mjs';

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-comparison-'));
  const main = path.join(root, 'main');
  fs.mkdirSync(main);
  run(main, 'init', '-q', '-b', 'main');
  run(main, 'config', 'user.email', 'test@example.invalid');
  run(main, 'config', 'user.name', 'Test');
  const commit = (cwd, name) => { fs.writeFileSync(path.join(cwd, name), name); run(cwd, 'add', name); run(cwd, 'commit', '-q', '-m', name); };
  commit(main, 'base');
  run(main, 'branch', 'feature');
  commit(main, 'fix-on-main');
  const feature = path.join(root, 'feature');
  run(main, 'worktree', 'add', '-q', feature, 'feature');
  commit(feature, 'change');
  return { main, feature };
}

test('a candidate built before the baseline it is compared with is refused', () => {
  const { main, feature } = repository();
  assert.throws(() => assertCandidateContainsBaseline(main, feature), /does not contain baseline .*Merge the baseline into the candidate first/);
  run(feature, 'merge', '-q', '--no-edit', 'main');
  const { baseline, candidate } = assertCandidateContainsBaseline(main, feature);
  assert.notEqual(baseline.commit, candidate.commit);
  assert.equal(candidate.dirty, false);
});

test('every case says what to watch and which steps to open', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-comparison-case-'));
  const stages = [{ statement: 's', stageRecord: 'r', relations: [], workspaceForest: { id: 'a', label: 'A' } }];
  fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ cases: [{ sentence: 'Mia laughed.', analyses: [{ derivationStages: stages }] }] }));
  const spec = { source: 'fixture.json', selector: '/cases/0', title: 'Mia', watch: 'the merge at step 2', steps: [1, 2] };
  assert.equal(resolveCase(spec, { root }).sentence, 'Mia laughed.');
  assert.throws(() => resolveCase({ ...spec, watch: '' }, { root }), /needs a "watch"/);
  assert.throws(() => resolveCase({ ...spec, steps: [] }, { root }), /needs "steps"/);
  const html = indexHtml({ title: 'T', baseline: { commit: 'a'.repeat(40), dirty: false }, candidate: { commit: 'b'.repeat(40), dirty: true },
    records: [resolveCase(spec, { root })] });
  assert.match(html, /BEFORE · aaaaaaaaa</);
  assert.match(html, /AFTER · bbbbbbbbb \+ uncommitted changes</);
});

test('a review page shows a few cases, each with one short line', () => {
  const ok = { title: 'n3-24', watch: 'The arrow now ends just below the upper t.', steps: [35] };
  assert.equal(checkCaseList([ok]).length, 1);
  assert.throws(() => checkCaseList(Array(5).fill(ok)), /at most 4/);
  assert.throws(() => checkCaseList([{ ...ok, steps: [34, 35, 36, 37] }]), /at most 3/);
  // The note of 29 Oct that Francis could not parse.
  const essay = 'Step 35: the head-movement arrow from the lower t up to the upper t (the place V moved to, which V has since left). Before: the arrowhead passes the upper t and ends above it.';
  assert.throws(() => checkCaseList([{ ...ok, watch: essay }]), /one line of at most 120/);
});

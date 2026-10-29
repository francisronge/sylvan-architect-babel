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

test('a case selecting one analysis keeps the sentence and saved tokens stored above it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'babel-comparison-context-'));
  const stages = [{ statement: 's', stageRecord: 'r', relations: [], workspaceForest: { id: 'a', label: 'A' } }];
  const tokens = ['Mia', 'laughed', '.'];
  fs.writeFileSync(path.join(root, 'bundle.json'), JSON.stringify({ request: { sentence: 'Mia laughed.' },
    response: { inputTokens: tokens, analyses: [{ derivationStages: stages }] } }));
  fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify({ sentence: 'Mia laughed.', inputTokens: tokens, analyses: [{ derivationStages: stages }] }));
  const spec = { title: 'Mia', watch: 'the merge', steps: [1] };
  for (const [source, selector] of [['bundle.json', '/response/analyses/0'], ['fixture.json', '/analyses/0'], ['bundle.json', '/response']]) {
    const record = resolveCase({ ...spec, source, selector }, { root });
    assert.equal(record.sentence, 'Mia laughed.', `${source}${selector}`);
    assert.deepEqual(record.inputTokens, tokens, `${source}${selector}`);
  }
});

test('the panes step together: not before both are ready, and from an arrow key inside either', async () => {
  const { default: vm } = await import('node:vm');
  const html = indexHtml({ title: 'T', baseline: { commit: 'a'.repeat(40), dirty: false }, candidate: { commit: 'b'.repeat(40), dirty: false },
    records: [{ title: 'Mia', watch: 'the merge', steps: [1] }] });
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const listeners = () => ({ handlers: {}, addEventListener(type, handler) { (this.handlers[type] ??= []).push(handler); } });
  const button = label => ({ textContent: label, disabled: false, clicks: 0, click() { this.clicks++; } });
  const pane = () => {
    const frame = Object.assign(listeners(), { src: '', buttons: [], contentWindow: listeners() });
    frame.contentDocument = { querySelectorAll: () => frame.buttons };
    return frame;
  };
  const element = () => Object.assign(listeners(), { append() {}, replaceChildren() {}, textContent: '' });
  const ids = { before: pane(), after: pane(), case: element(), next: element(), prev: element(), watch: element(), steps: element() };
  const document = Object.assign(listeners(), { getElementById: id => ids[id], createElement: () => element() });
  vm.runInNewContext(script, { document, Option: class {} });
  ids.before.buttons = [button('Prev'), button('Next')];
  ids.next.onclick();
  assert.equal(ids.before.buttons[1].clicks, 0, 'a pane still preparing holds the other back');
  ids.after.buttons = [button('Prev'), button('Next')];
  ids.next.onclick();
  assert.deepEqual([ids.before.buttons[1].clicks, ids.after.buttons[1].clicks], [1, 1]);
  for (const side of ['before', 'after']) ids[side].handlers.load.forEach(handler => handler());
  let stopped = 0;
  const arrow = { key: 'ArrowLeft', preventDefault() {}, stopImmediatePropagation() { stopped++; } };
  ids.after.contentWindow.handlers.keydown.forEach(handler => handler(arrow));
  assert.deepEqual([ids.before.buttons[0].clicks, ids.after.buttons[0].clicks, stopped], [1, 1, 1], 'the pane\'s own handler does not step it again');
});

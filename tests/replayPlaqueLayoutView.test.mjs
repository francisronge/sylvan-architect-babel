import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../components/useReplayPlaqueLayout.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('layout.ts', source, ts.ScriptTarget.Latest, true);
const body = parsed.statements.filter(node => !ts.isImportDeclaration(node))
  .map(node => node.getText(parsed).replace(/^export /, '')).join('\n').replaceAll('import.meta.url', '"file:///test/layout.ts"');
const code = ts.transpile(body + '\nreturn useReplayPlaqueLayout;', { target: ts.ScriptTarget.ES2023 });
const mount = () => {
  const slots = [], effects = [], jobs = [], timers = new Map(); let cursor = 0, id = 0;
  const useState = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  };
  const useEffect = (create, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) effects.push(() => {
      slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: create() };
    });
  };
  const start = (input, ready, error) => { const job = { input, ready, error, cancelled: false }; jobs.push(job); return () => { job.cancelled = true; }; };
  const measure = function* (input) { yield; return input; };
  const hook = new Function('useState', 'useEffect', 'measurePlaqueLayoutJob', 'startWorkerJob', 'setTimeout', 'clearTimeout', code)(
    useState, useEffect, measure, start, callback => { timers.set(++id, callback); return id; }, id => timers.delete(id));
  return { jobs, render: input => { cursor = 0; return hook(input); },
    effects: () => { while (effects.length) effects.shift()(); },
    timers: () => { for (const [id, callback] of timers) { timers.delete(id); callback(); } } };
};
const schedule = (name, x) => {
  const box = { x, y: 80, width: 240, height: 120, location: 'local', domainId: name,
    attachmentNodeId: 'head', attachmentX: 0, attachmentY: 0 };
  return { stages: [new Map([[0, box]])],
    steps: new Map([[12, new Map([[0, { ...box, x: x + 100 }]])]]) };
};
const assertPending = view => {
  assert(!view.ready);
  assert.equal(view.schedule.stages.length, 0, 'old completed-stage placements are hidden');
  assert.equal(view.schedule.steps.size, 0, 'old movement-phase placements are hidden');
  assert.equal(view.error, undefined);
};
for (const change of ['viewport', 'analysis']) {
  test(`a new ${change} hides every old placement and ignores stale worker completions`, () => {
    const app = mount(), first = { width: 1200, steps: ['analysis-one'] };
    const next = change === 'viewport' ? { ...first, width: 390 } : { ...first, steps: ['analysis-two'] };
    const initial = schedule('first', 100), stale = schedule('late', 900), expected = schedule('next', 300);
    assertPending(app.render(first)); app.effects(); app.timers();
    app.jobs[0].ready(initial);
    assert.strictEqual(app.render(first).schedule, initial);
    assert(app.render(first).ready);
    assertPending(app.render(next));
    // React has rendered the new input, but the preceding effect can still finish.
    app.jobs[0].ready(stale);
    assertPending(app.render(next));
    app.effects(); app.timers(); assert(app.jobs[0].cancelled);
    app.jobs[0].ready(stale); app.jobs[0].error(new Error('late old worker failure'));
    assertPending(app.render(next));
    app.jobs.at(-1).ready(expected);
    const current = app.render(next);
    assert(current.ready);
    assert.strictEqual(current.schedule, expected);
    assert.equal(current.schedule.stages[0].get(0).x, 300);
    assert.equal(current.schedule.steps.get(12).get(0).x, 400,
      'the active movement phase is distinct from the completed-stage placement');
    app.jobs[0].ready(stale); app.jobs[0].error(new Error('late failure after the new result'));
    assert.strictEqual(app.render(next).schedule, expected);
    assert.equal(app.render(next).error, undefined);
  });
}
test('disabling layout cancels queued measurements and a failed worker can be retried', () => {
  const app = mount(), input = {};
  app.render(input); app.effects(); app.render(null); app.effects(); app.timers(); assert.equal(app.jobs.length, 0);
  app.render(input); app.effects(); app.timers(); app.jobs[0].error(new Error('worker failed'));
  const failed = app.render(input); assert.equal(failed.error, 'worker failed'); assert(!failed.ready);
  failed.retry(); assertPending(app.render(input));
  app.jobs[0].ready(schedule('failed attempt completed late', 900));
  assertPending(app.render(input)); app.effects(); app.timers();
  assert(app.jobs[0].cancelled);
  const expected = schedule('retried', 400);
  app.jobs.at(-1).ready(expected); assert(app.render(input).ready);
  app.jobs[0].error(new Error('old attempt failed again'));
  assert.strictEqual(app.render(input).schedule, expected);
  assert.equal(app.render(input).error, undefined);
});

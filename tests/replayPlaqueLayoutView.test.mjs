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
test('a new viewport or analysis hides old placements immediately and ignores stale workers', () => {
  const app = mount(), first = {}, next = {};
  assert(!app.render(first).ready); app.effects(); app.timers();
  app.jobs[0].ready([new Map([[0, 'first']])]); assert(app.render(first).ready);
  assert(!app.render(next).ready, 'input identity rejects stale layouts before cleanup');
  app.effects(); app.timers(); assert(app.jobs[0].cancelled);
  app.jobs[0].ready([new Map([[0, 'late']])]); assert(!app.render(next).ready);
  app.jobs[1].ready([new Map([[0, 'next']])]); assert.equal(app.render(next).layouts[0].get(0), 'next');
});
test('unmount cancels queued measurements and a failed worker can be retried', () => {
  const app = mount(), input = {};
  app.render(input); app.effects(); app.render(null); app.effects(); app.timers(); assert.equal(app.jobs.length, 0);
  app.render(input); app.effects(); app.timers(); app.jobs[0].error(new Error('worker failed'));
  const failed = app.render(input); assert.equal(failed.error, 'worker failed'); assert(!failed.ready);
  failed.retry(); assert(!app.render(input).ready); app.effects(); app.timers();
  app.jobs[1].ready([]); assert(app.render(input).ready);
});

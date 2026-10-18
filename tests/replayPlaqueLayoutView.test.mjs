import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
// Run the complete hook with controlled effects and worker completions to
// exercise stale-result races without adding a React testing runtime.
const source = readFileSync(new URL('../components/useReplayPlaqueLayout.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('layout.ts', source, ts.ScriptTarget.Latest, true);
const body = parsed.statements.filter(node => !ts.isImportDeclaration(node))
  .map(node => node.getText(parsed).replace(/^export /, '')).join('\n').replaceAll('import.meta.url', '"file:///test/layout.ts"');
const code = ts.transpile(body + '\nreturn useReplayPlaqueLayout;', { target: ts.ScriptTarget.ES2023 });
const desktop = { width: 1200, height: 900 };
// The harness measures by returning the hook's own request input as its job.
const requested = (content, viewport = desktop) => ({ ...content, width: viewport.width, height: viewport.height });
const mount = (cache = { get: () => undefined, put: () => {} }) => {
  const slots = [], effects = [], jobs = [], completions = [], timers = new Map(); let cursor = 0, id = 0;
  const useRef = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  };
  const useState = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  };
  const useMemo = (create, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) slots[index] = { deps, value: create() };
    return slots[index].value;
  };
  const useEffect = (create, deps) => {
    const index = cursor++;
    if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) effects.push(() => {
      slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: create() };
    });
  };
  const start = (input, ready, error, _createWorker, progress) => {
    const job = { input, ready, error, progress, cancelled: false };
    jobs.push(job);
    return () => { job.cancelled = true; };
  };
  const measure = function* (input) { yield; return input; };
  const bind = (_input, _job, result) => {
    if (result.invalid) throw new Error('Invalid prepared Replay coordinates.');
    return { schedule: result, coordinates: result.coordinates ?? new Map() };
  };
  const complete = (input, job, result, early) => {
    completions.push({ input, job, result, early });
    return bind(input, job, result);
  };
  // Only the width enters this key, so a height change reuses the prepared layout.
  const viewportKey = ({ width }) => String(width);
  const hook = new Function('useState', 'useRef', 'useMemo', 'useEffect', 'measurePlaqueLayoutJob', 'bindPlaqueLayoutResult',
    'bindPlaqueLayoutProgress', 'completePlaqueLayoutResult', 'startQueuedLayoutJob', 'plaqueLayoutViewportKey',
    'setTimeout', 'clearTimeout', 'recentLayoutResults', code)(
    useState, useRef, useMemo, useEffect, measure, bind, bind, complete, start, viewportKey,
    callback => { timers.set(++id, callback); return id; }, id => timers.delete(id), cache);
  return { jobs, completions, render: (content, stageIndex = 0, viewport = desktop) => { cursor = 0; return hook(content, viewport, stageIndex); },
    effects: () => { while (effects.length) effects.shift()(); },
    timers: () => { for (const [id, callback] of timers) { timers.delete(id); callback(); } },
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); } };
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
  assert.equal(view.coordinates, undefined, 'old coordinates are hidden');
  assert.equal(view.viewport, undefined, 'no viewport is displayed without its layout');
  assert.equal(view.error, undefined);
};
for (const change of ['analysis', 'analysis and viewport']) {
  test(`a new ${change} hides every old placement and ignores stale worker completions`, () => {
    const app = mount(), first = { steps: ['analysis-one'] }, next = { steps: ['analysis-two'] };
    const nextViewport = change === 'analysis' ? desktop : { width: 390, height: 844 };
    const initial = schedule('first', 100), stale = schedule('late', 900), expected = schedule('next', 300);
    assertPending(app.render(first)); app.effects(); app.timers();
    app.jobs[0].ready(initial);
    assert.strictEqual(app.render(first).schedule, initial);
    assert(app.render(first).ready);
    assertPending(app.render(next, 0, nextViewport));
    // React has rendered the new content, but the preceding effect can still finish.
    app.jobs[0].ready(stale);
    assertPending(app.render(next, 0, nextViewport));
    app.effects(); app.timers(); assert(app.jobs[0].cancelled);
    app.jobs[0].ready(stale); app.jobs[0].error(new Error('late old worker failure'));
    assertPending(app.render(next, 0, nextViewport));
    app.jobs.at(-1).ready(expected);
    const current = app.render(next, 0, nextViewport);
    assert.strictEqual(current.viewport, nextViewport);
    assert(current.ready);
    assert.strictEqual(current.schedule, expected);
    assert.equal(current.schedule.stages[0].get(0).x, 300);
    assert.equal(current.schedule.steps.get(12).get(0).x, 400,
      'the active movement phase is distinct from the completed-stage placement');
    app.jobs[0].ready(stale); app.jobs[0].error(new Error('late failure after the new result'));
    assert.strictEqual(app.render(next, 0, nextViewport).schedule, expected);
    assert.equal(app.render(next, 0, nextViewport).error, undefined);
  });
}
test('a viewport keeps the displayed layout, with the viewport it was drawn for, until its own layout is ready', () => {
  const app = mount(), content = { steps: ['analysis-one'] };
  const taller = { width: 1200, height: 1000 }, narrow = { width: 390, height: 900 };
  const initial = schedule('first', 100), expected = schedule('narrow', 300);
  assertPending(app.render(content)); app.effects(); app.timers();
  app.jobs[0].ready(initial);
  assert.strictEqual(app.render(content).viewport, desktop);
  const reused = app.render(content, 0, taller); app.effects(); app.timers();
  assert.strictEqual(reused.schedule, initial, 'an unchanged layout key reuses the prepared layout');
  assert.strictEqual(reused.viewport, taller, 'and displays it at once for the new viewport');
  assert.equal(app.jobs.length, 1, 'no preparation starts');
  const held = app.render(content, 0, narrow);
  assert(held.ready, 'the painted tree stays displayable while the new viewport is prepared');
  assert.strictEqual(held.schedule, initial);
  assert.strictEqual(held.viewport, taller, 'held geometry keeps the viewport it was drawn for');
  assertPending(app.render({ ...content }, 0, narrow));
  // The preceding request finishing again before cleanup cannot replace the displayed snapshot.
  app.jobs[0].ready(schedule('late first request', 900));
  assert.strictEqual(app.render(content, 0, narrow).schedule, initial);
  app.effects(); app.timers(); assert(app.jobs[0].cancelled);
  app.jobs[0].ready(schedule('after cleanup', 700)); app.jobs[0].error(new Error('late old worker failure'));
  assert.strictEqual(app.render(content, 0, narrow).viewport, taller);
  app.jobs.at(-1).ready(expected);
  const swapped = app.render(content, 0, narrow);
  assert(swapped.ready);
  assert.strictEqual(swapped.schedule, expected);
  assert.strictEqual(swapped.viewport, narrow);
  app.render(content, 0, desktop); app.effects(); app.timers();
  app.jobs.at(-1).error(new Error('new viewport failed'));
  const failed = app.render(content, 0, desktop);
  assert.equal(failed.ready, false);
  assert.equal(failed.error, 'new viewport failed');
  assert.equal(failed.viewport, undefined, 'a failed preparation is not hidden behind the earlier viewport');
});

test('progress for another stage cannot replace a held layout or bring back the cover', () => {
  const app = mount(), content = { steps: ['analysis-one'], layoutGroups: [[0], [1], [2]] }, narrow = { width: 390, height: 900 };
  app.render(content); app.effects(); app.timers();
  const complete = schedule('complete', 100);
  app.jobs[0].ready(complete);
  assert(app.render(content).ready);
  app.render(content, 0, narrow); app.effects(); app.timers();
  assert.equal(app.jobs.at(-1).input.progressStage, 0);
  // Replay advances while the new viewport is prepared.
  const advanced = app.render(content, 1, narrow);
  assert(advanced.ready);
  assert.strictEqual(advanced.viewport, desktop);
  app.jobs.at(-1).progress({ ...schedule('narrow early', 300), preparedStages: [0] });
  const held = app.render(content, 1, narrow);
  assert(held.ready, 'partial progress for the preceding stage keeps the usable layout');
  assert.strictEqual(held.schedule, complete);
  assert.strictEqual(held.viewport, desktop);
  const final = schedule('narrow complete', 300);
  app.jobs.at(-1).ready(final);
  const swapped = app.render(content, 1, narrow);
  assert.strictEqual(swapped.schedule, final);
  assert.strictEqual(swapped.viewport, narrow);
});

test('progress covering the displayed stage replaces the held layout', () => {
  const app = mount(), content = { layoutGroups: [[0], [1]] }, narrow = { width: 390, height: 900 };
  app.render(content); app.effects(); app.timers();
  app.jobs[0].ready(schedule('complete', 100));
  app.render(content, 0, narrow); app.effects(); app.timers();
  const early = { ...schedule('narrow early', 300), preparedStages: [0] };
  app.jobs.at(-1).progress(early);
  const swapped = app.render(content, 0, narrow);
  assert.strictEqual(swapped.schedule, early);
  assert.strictEqual(swapped.viewport, narrow);
});

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

test('invalid prepared coordinates fail visibly and retry never uses synchronous planning', () => {
  const app = mount(), input = {};
  app.render(input); app.effects(); app.timers();
  app.jobs[0].ready({ invalid: true });
  const failed = app.render(input);
  assert(!failed.ready); assert.equal(failed.coordinates, undefined);
  assert.equal(failed.error, 'Invalid prepared Replay coordinates.');
  failed.retry(); app.render(input); app.effects(); app.timers();
  const expected = schedule('valid retry', 200); expected.coordinates = new Map([[0, new Map()]]);
  app.jobs.at(-1).ready(expected);
  assert.strictEqual(app.render(input).coordinates, expected.coordinates);
});

test('a measured cache hit binds before display and starts no worker', () => {
  const input = {}, expected = schedule('cached', 300), measured = [];
  const app = mount({ get: job => { measured.push(job); return expected; }, put: () => assert.fail('a hit does not insert another entry') });
  assertPending(app.render(input)); app.effects();
  assert.equal(measured.length, 0, 'lookup waits for fresh measurements');
  app.timers();
  assert.deepEqual(measured, [requested(input)]);
  assert.equal(app.jobs.length, 0);
  assert.strictEqual(app.render(input).schedule, expected);
  const invalid = mount({ get: () => ({ invalid: true }), put: () => assert.fail('invalid hit') });
  invalid.render(input); invalid.effects(); invalid.timers();
  assert.equal(invalid.jobs.length, 0);
  assert.equal(invalid.render(input).error, 'Invalid prepared Replay coordinates.');
  assert.equal(invalid.render(input).ready, false);
});

test('only an active, successfully bound worker result enters the cache', () => {
  const inserted = [], input = {}, expected = schedule('valid', 200);
  const app = mount({ get: () => undefined, put: (...args) => inserted.push(args) });
  app.render(input); app.effects(); app.timers();
  app.jobs[0].ready({ invalid: true });
  assert.equal(inserted.length, 0);
  app.render(input).retry(); app.render(input); app.effects(); app.timers();
  app.jobs[0].ready(expected);
  assert.equal(inserted.length, 0, 'cancelled attempt cannot populate the cache');
  app.jobs[1].ready(expected);
  assert.deepEqual(inserted, [[{ ...requested(input), progressStage: 0 }, expected]]);
});

test('prepared progress displays only ready stages and completion checks the exact early delivery', () => {
  const inserted = [], input = { layoutGroups: [[0], [1]] };
  const app = mount({ get: () => undefined, put: (...args) => inserted.push(args) });
  app.render(input, 0); app.effects(); app.timers();
  const progress = { ...schedule('early', 100), preparedStages: [0], coordinates: new Map([[0, new Map()]]) };
  app.jobs[0].progress(progress);
  const prepared = app.render(input, 0);
  assert(prepared.ready);
  assert.strictEqual(prepared.schedule, progress);
  assert.strictEqual(prepared.coordinates, progress.coordinates);
  assert.equal(inserted.length, 0, 'partial results never enter the completed-layout cache');

  const waiting = app.render(input, 1); app.effects(); app.timers();
  assert.equal(waiting.ready, false, 'navigation cannot display a stage with unfinished plaques');
  assert.equal(waiting.schedule.stages.length, 0, 'the unfinished stage displays no geometry');
  assert.equal(prepared.schedule.stages[1], undefined, 'the unfinished stage has no published layout');
  assert.equal(app.jobs.length, 1, 'stage navigation keeps the existing worker');
  assert(app.render(input, 0).ready, 'navigation back to a prepared stage remains available');

  const result = schedule('complete', 300);
  result.stages[1] = new Map([[1, { x: 700, y: 80 }]]);
  result.steps.set(24, result.stages[1]);
  result.coordinates = new Map(progress.coordinates);
  app.render(input, 1);
  app.jobs[0].ready(result);
  const completed = app.render(input, 1);
  assert(completed.ready);
  assert.strictEqual(completed.schedule, result);
  assert.strictEqual(completed.schedule.stages[1], result.stages[1], 'the already selected unfinished stage receives its completed maps');
  assert.strictEqual(completed.schedule.steps.get(24), result.steps.get(24));
  assert.strictEqual(completed.coordinates, result.coordinates);
  const retained = app.render(input, 0);
  assert(retained.ready);
  assert.strictEqual(retained.schedule, prepared.schedule, 'completion preserves the whole published schedule identity for its prepared group');
  assert.strictEqual(retained.coordinates, prepared.coordinates);
  assert.equal(retained.schedule.stages[1], undefined, 'completion does not mutate the published early schedule');
  assert.strictEqual(app.render(input, 1).schedule, result, 'later navigation still selects the full layout');
  assert.equal(app.completions.length, 1);
  assert.strictEqual(app.completions[0].early.progress, progress);
  assert.strictEqual(app.completions[0].early.layout.schedule, prepared.schedule);
  assert.strictEqual(app.completions[0].early.layout.coordinates, prepared.coordinates);
  assert.deepEqual(inserted, [[{ ...requested(input), progressStage: 0 }, result]]);
});

test('a shared camera group remains unavailable until every member is prepared', () => {
  const app = mount(), input = { layoutGroups: [[0, 1], [2]] };
  app.render(input, 1); app.effects(); app.timers();
  assert.equal(app.jobs[0].input.progressStage, 1);
  app.jobs[0].progress({ ...schedule('incomplete group', 100), preparedStages: [0] });
  assert.equal(app.render(input, 0).ready, false);
  assert.equal(app.render(input, 1).ready, false);
  app.jobs[0].progress({ ...schedule('complete group', 100), preparedStages: [0, 1] });
  const prepared = app.render(input, 0);
  assert(prepared.ready);
  assert(app.render(input, 1).ready);
  assert.equal(app.render(input, 2).ready, false);
  const result = schedule('completed remaining group', 300);
  app.jobs[0].ready(result);
  for (const stage of [0, 1]) {
    const view = app.render(input, stage);
    assert(view.ready);
    assert.strictEqual(view.schedule, prepared.schedule, 'every member retains the same complete camera-group delivery');
    assert.strictEqual(view.coordinates, prepared.coordinates);
  }
  assert(app.render(input, 2).ready);
  assert.strictEqual(app.render(input, 2).schedule, result);
});

test('the current requested stage is read after deferred measurements finish', () => {
  const app = mount(), input = {};
  app.render(input, 0); app.effects();
  app.render(input, 3); app.effects(); app.timers();
  assert.equal(app.jobs.length, 1);
  assert.equal(app.jobs[0].input.progressStage, 3);
});

test('input replacement hides early geometry and rejects late progress before and after cleanup', () => {
  const app = mount(), input = { steps: ['analysis-one'] }, replacement = { steps: ['analysis-two'] };
  const early = { ...schedule('early', 100), preparedStages: [0] };
  app.render(input); app.effects(); app.timers(); app.jobs[0].progress(early);
  assert(app.render(input).ready);
  assertPending(app.render(replacement));
  app.jobs[0].progress(early);
  assertPending(app.render(replacement));
  app.effects(); app.timers();
  assert(app.jobs[0].cancelled);
  app.jobs[0].progress(early); app.jobs[0].ready(schedule('stale completion', 900));
  assertPending(app.render(replacement));
  const current = { ...schedule('replacement', 300), preparedStages: [0] };
  app.jobs[1].progress(current);
  app.jobs[0].progress(early); app.jobs[0].error(new Error('late failure'));
  assert.strictEqual(app.render(replacement).schedule, current);
  assert.equal(app.render(replacement).error, undefined);
});

test('retry and unmount cancel partial delivery without accepting stale progress', () => {
  const inserted = [], app = mount({ get: () => undefined, put: (...args) => inserted.push(args) });
  const input = {}, early = { ...schedule('early', 100), preparedStages: [0] };
  app.render(input); app.effects(); app.timers(); app.jobs[0].progress(early);
  app.jobs[0].error(new Error('remaining stages failed'));
  const failed = app.render(input);
  assert.equal(failed.ready, false);
  assert.equal(failed.coordinates, undefined);
  assert.equal(failed.error, 'remaining stages failed');
  failed.retry(); assertPending(app.render(input));
  app.jobs[0].progress(early); assertPending(app.render(input));
  app.effects(); app.timers(); assert(app.jobs[0].cancelled);
  app.jobs[0].progress(early); assertPending(app.render(input));
  app.unmount(); assert(app.jobs[1].cancelled);
  app.jobs[1].progress(early); app.jobs[1].ready(schedule('late completion', 900));
  assert.equal(inserted.length, 0);
  assert.equal(app.completions.length, 0);
});

test('a cold opening warms the worker during font measurement and only posts completed measurements', async () => {
  const input = {}, app = mount({ empty: true, get: () => undefined, put: () => {} });
  app.render(input); app.effects();
  assert.equal(app.jobs.length, 1);
  assert(app.jobs[0].input instanceof Promise);
  let posted; app.jobs[0].input.then(job => { posted = job; });
  await Promise.resolve(); assert.equal(posted, undefined);
  app.render(input, 2); app.timers(); await Promise.resolve();
  assert.deepEqual(posted, { ...requested(input), progressStage: 2 });
  app.unmount(); assert(app.jobs[0].cancelled);
});

test('an early worker failure cancels cold measurements and remains visible', () => {
  const input = {}, app = mount({ empty: true, get: () => assert.fail('cancelled measurement'), put: () => {} });
  app.render(input); app.effects();
  app.jobs[0].error(Error('worker initialization failed')); app.timers();
  assert(app.jobs[0].cancelled);
  assert.equal(app.render(input).error, 'worker initialization failed');
  app.unmount();
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeasuredRuns, watchTreeVisualizerFonts } from '../components/treeVisualizerFonts.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
const fontSet = () => {
  const set = new EventTarget(), loads = [];
  let ready;
  set.ready = new Promise(resolve => { ready = resolve; });
  set.load = (font, text) => new Promise((resolve, reject) => loads.push({ font, text, resolve, reject }));
  const emit = family => {
    const event = new Event('loadingdone');
    Object.defineProperty(event, 'fontfaces', { value: [{ family }] });
    set.dispatchEvent(event);
  };
  return { set, loads, ready, emit };
};

test('initial font events produce one layout invalidation after all requested faces and the font set settle', async () => {
  const fonts = fontSet();
  let calls = 0;
  const dispose = watchTreeVisualizerFonts(fonts.set, () => calls++, 'עבריתあğφ');
  assert.equal(fonts.loads.length, 7);
  fonts.loads.forEach(load => assert('θᵢⱼעבריתあğφ'.split('').every(character => load.text.includes(character)),
    'load each recorded script, renderer heading, and chain index before layout'));
  fonts.loads.forEach(load => load.resolve([]));
  fonts.emit('Quicksand');
  fonts.emit('JetBrains Mono');
  await flush();
  assert.equal(calls, 0);
  fonts.ready();
  await flush();
  assert.equal(calls, 1);
  fonts.emit('Crimson Pro');
  assert.equal(calls, 2, 'index font changes invalidate measured syntax ink');
  fonts.emit('Unrelated font');
  assert.equal(calls, 2);
  fonts.emit('"Quicksand"');
  assert.equal(calls, 3, 'later relevant font changes still update measured geometry');
  dispose();
  fonts.emit('JetBrains Mono');
  assert.equal(calls, 3);
});

test('fallback-role font settles before the first layout instead of triggering a second pass', async () => {
  const fonts = fontSet();
  let calls = 0;
  const dispose = watchTreeVisualizerFonts(fonts.set, () => calls++, 'depictedIndividual');
  const fallback = fonts.loads.find(load => /^600 12px ["']?Crimson Pro/.test(load.font));
  assert.ok(fallback, 'request the normal semibold face used by neutral fallback roles');
  fonts.loads.filter(load => load !== fallback).forEach(load => load.resolve([]));
  fonts.ready();
  await flush();
  assert.equal(calls, 0, 'font-set readiness alone cannot bypass the pending fallback face');
  fonts.emit('Crimson Pro');
  fallback.resolve([]);
  await flush();
  assert.equal(calls, 1);
  dispose();
});

test('a failed font request still permits layout using the browser fallback', async () => {
  const fonts = fontSet();
  let calls = 0;
  const dispose = watchTreeVisualizerFonts(fonts.set, () => calls++);
  fonts.loads.forEach(load => load.reject(new Error('unavailable')));
  fonts.ready();
  await flush();
  assert.equal(calls, 1);
  dispose();
});

test('unmounting before fonts finish cancels the layout invalidation', async () => {
  const fonts = fontSet();
  let calls = 0;
  const dispose = watchTreeVisualizerFonts(fonts.set, () => calls++);
  dispose();
  fonts.loads.forEach(load => load.resolve([]));
  fonts.ready();
  await flush();
  assert.equal(calls, 0);
});

// A face whose glyphs keep their widths can still change a pair: "A" stays 10,
// while kerning makes "AA" 22 instead of 20. Only the measured run reveals that.
const kerningFonts = () => {
  let kerning = 0, calls = 0;
  const runs = createMeasuredRuns();
  const measure = runs.track('category', () => text => ({ width: text === 'AA' ? 20 + kerning : [...text].length * 10 }));
  return { runs, measure, kern: amount => { kerning = amount; }, calls: () => calls, changed: () => calls++ };
};

test('a later face invalidates layout only when a measured run measures differently', async () => {
  const fonts = fontSet(), probe = kerningFonts();
  const dispose = watchTreeVisualizerFonts(fonts.set, probe.changed, 'AA', () => probe.runs.changed());
  fonts.loads.forEach(load => load.resolve([]));
  fonts.ready();
  await flush();
  assert.equal(probe.calls(), 1);
  assert.deepEqual(probe.measure('AA'), { width: 20 });
  probe.measure('A');
  fonts.emit('JetBrains Mono');
  fonts.emit('Quicksand');
  assert.equal(probe.calls(), 1, 'app text loading another face of a measured family keeps the layout');
  probe.kern(2);
  fonts.emit('Quicksand');
  assert.equal(probe.calls(), 2, 'a kerning change in a measured run invalidates layout');
  dispose();
});

test('recorded runs re-measure exactly their arguments with uncached measures', () => {
  const probe = kerningFonts(), created = [];
  const inkRuns = createMeasuredRuns();
  const ink = inkRuns.track('ink', () => { created.push('ink'); return (text, style) => `${text}:${style.fontSize}`; });
  ink('Mia', { fontSize: 56 }); ink('Mia', { fontSize: 56 }); ink('Mia', { fontSize: 30 });
  assert.equal(inkRuns.changed(), false);
  assert.equal(created.length, 2, 'one uncached measure per kind and check');
  probe.measure('AA');
  assert.equal(probe.runs.changed(), false);
  probe.kern(2);
  assert.equal(probe.runs.changed(), true, 'a changed pair is visible although each character keeps its width');
});

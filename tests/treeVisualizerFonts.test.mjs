import assert from 'node:assert/strict';
import test from 'node:test';
import { watchTreeVisualizerFonts } from '../components/treeVisualizerFonts.ts';

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
  assert.equal(fonts.loads.length, 3);
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
  assert.equal(calls, 1, 'unrelated text fonts do not invalidate plaque measurements');
  fonts.emit('"Quicksand"');
  assert.equal(calls, 2, 'later relevant font changes still update measured geometry');
  dispose();
  fonts.emit('JetBrains Mono');
  assert.equal(calls, 2);
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

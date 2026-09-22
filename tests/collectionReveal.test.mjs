import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionRevealTiming, revealPlaqueCollections } from '../components/collectionReveal.ts';

const moment = { stageIndex: 2, relationIndex: 4 };
test('a new collector follows its plaque within the same relation moment', () => {
  const timing = collectionRevealTiming([moment], moment, 0, false);
  assert(timing.delay > 0);
  assert(timing.delay + timing.duration < 1000, 'finish before automatic Replay advances');
  assert.deepEqual(collectionRevealTiming([moment], moment, 100, false), {
    ...timing, delay: timing.delay - 100
  });
  assert.equal(collectionRevealTiming([moment], moment, 1000, false), null);
});
test('coalesced prior collectors stay visible when a later owner appears', () => {
  assert.equal(collectionRevealTiming([moment, { stageIndex: 1, relationIndex: 8 }], moment, 0, false), null);
  assert.equal(collectionRevealTiming([moment, { stageIndex: 2, relationIndex: 2 }], moment, 0, false), null);
});
test('reduced motion, final view and unrelated moments reveal immediately', () => {
  assert.equal(collectionRevealTiming([moment], moment, 0, true), null);
  assert.equal(collectionRevealTiming([moment], null, 0, false), null);
  assert.equal(collectionRevealTiming([moment], { stageIndex: 2, relationIndex: 3 }, 0, false), null);
  assert.equal(collectionRevealTiming([], moment, 0, false), null);
});

test('the production reveal masks the unchanged dashed path and releases all temporary geometry', () => {
  const created = [];
  const element = tag => ({ tag, attrs: {}, style: {}, children: [],
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key] ?? null; },
    hasAttribute(key) { return Object.hasOwn(this.attrs, key); },
    removeAttribute(key) { delete this.attrs[key]; },
    appendChild(child) { this.children.push(child); },
    remove() { this.removed = true; },
    animate(keyframes, options) { this.animation = { keyframes, options, cancel() {} }; return this.animation; }
  });
  const path = element('path');
  path.attrs = { d: 'M 10 20 L 80 90', 'data-vr-owner-refs': '2:4', 'stroke-dasharray': '10 8' };
  path.getTotalLength = () => 100;
  path.getBBox = () => ({ x: 10, y: 20, width: 70, height: 70 });
  path.getScreenCTM = () => ({ a: 0.02, b: 0 });
  const svg = element('svg');
  svg.querySelectorAll = selector => {
    assert(selector.includes(':not(.vr-relation-hit-target)'));
    return [path];
  };
  const previousDocument = globalThis.document;
  globalThis.document = { createElementNS: (_ns, tag) => {
    const el = element(tag); created.push(el); return el;
  } };
  try {
    const cleanup = revealPlaqueCollections(svg, moment, { elapsed: 0, reducedMotion: false, idPrefix: 'test' });
    assert.equal(path.attrs.d, 'M 10 20 L 80 90');
    assert.equal(path.attrs['stroke-dasharray'], '10 8');
    assert.equal(path.attrs.mask, 'url(#test-0)');
    const sweep = created.find(el => el.tag === 'path');
    assert.equal(sweep.attrs.d, path.attrs.d);
    assert(Number(sweep.style.strokeWidth) * 0.02 >= 8, 'mask clearance preserves the non-scaling ink at small fits');
    assert.equal(sweep.animation.options.delay, 180);
    sweep.animation.onfinish();
    assert.equal(path.attrs.mask, undefined);
    assert(created.find(el => el.tag === 'defs').removed);
    cleanup();
  } finally { globalThis.document = previousDocument; }
});
